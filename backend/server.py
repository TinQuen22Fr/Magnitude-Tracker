from fastapi import FastAPI, APIRouter, Header, HTTPException, Response, Query, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import secrets
import asyncio
import logging
import io
import csv
import time
import httpx
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime, timezone

# Phase 5 — auth & sessions
import auth
import auth_routes


# ---------------------------------------------------------------------------
# Constantes firmware (proxy GitHub Releases → contourne CORS)
# ---------------------------------------------------------------------------
FIRMWARE_OWNER = 'TinQuen22Fr'
FIRMWARE_REPO = 'SQM-Pro-ESP8266'
FIRMWARE_ASSET_NAME = 'sqm-pro-esp8266.bin'
# Cache mémoire des métadonnées de release (évite de marteler l'API GitHub).
# TTL court (5 min) : permet quand même de détecter rapidement une nouvelle
# release publiée sans avoir à redémarrer le backend.
_firmware_cache = {
    'release': None,      # dict (réponse API GitHub)
    'expires_at': 0,      # epoch
    'bin_bytes': None,    # bytes du .bin
    'bin_etag': None,
    'bin_expires_at': 0,
}
_firmware_cache_lock = asyncio.Lock()
FIRMWARE_META_TTL = 300       # 5 min — invalide la métadonnée de release
FIRMWARE_BIN_TTL = 3600       # 1 h — invalide le binaire en cache


ROOT_DIR = Path(__file__).parent
ENV_FILE = ROOT_DIR / '.env'
HISTORY_FILE = ROOT_DIR / 'sqm_history.json'
load_dotenv(ENV_FILE)

# ---------------------------------------------------------------------------
# API Key bootstrap (auto-generation on first start)
# ---------------------------------------------------------------------------
def _ensure_api_key() -> str:
    key = os.environ.get('SQM_API_KEY', '').strip()
    if not key or len(key) < 20:
        key = secrets.token_urlsafe(32)
        try:
            existing = ENV_FILE.read_text() if ENV_FILE.exists() else ''
            # remove old SQM_API_KEY lines if any
            lines = [l for l in existing.splitlines() if not l.startswith('SQM_API_KEY=')]
            lines.append(f'SQM_API_KEY={key}')
            ENV_FILE.write_text('\n'.join(lines) + '\n')
        except Exception as e:
            logging.warning(f'Could not persist SQM_API_KEY to .env: {e}')
        os.environ['SQM_API_KEY'] = key
    return key


SQM_API_KEY = _ensure_api_key()

# ---------------------------------------------------------------------------
# History file bootstrap
# ---------------------------------------------------------------------------
if not HISTORY_FILE.exists():
    HISTORY_FILE.write_text('[]')

# Global async lock to guarantee no JSON corruption on concurrent writes
file_lock = asyncio.Lock()

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title='SQM Nightwatch', version='1.1.0')
api_router = APIRouter(prefix='/api')


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Measurement(BaseModel):
    model_config = ConfigDict(extra='ignore')
    mag: float = Field(..., ge=0, le=30, description='Sky magnitude (mag/arcsec^2)')
    lux: float = Field(..., ge=0, description='Illuminance in lux')
    temp: float = Field(..., ge=-60, le=90, description='Sensor temperature (C)')


# ---------------------------------------------------------------------------
# Storage helpers — SQLite via db.py (Phase 4)
# ---------------------------------------------------------------------------
# Le module db.py gère le fichier sqm.db. Le code historique JSON est conservé
# pour le fallback de lecture (et migration au startup), mais toutes les
# écritures vont désormais dans SQLite.
import db  # noqa: E402


def _row_to_legacy_dict(r: dict) -> dict:
    """Adapte une ligne SQLite vers le format attendu par les clients
    (frontend Recharts, exports CSV, ancien firmware). Conserve la rétro-
    compatibilité des clés `mag`, `lux`, `temp`, `gps`, etc.
    """
    gps = None
    if r.get('gps_alt') is not None or r.get('gps_lat') is not None or r.get('gps_lon') is not None:
        gps = {
            'alt': r.get('gps_alt'),
            'lat': r.get('gps_lat'),
            'lon': r.get('gps_lon'),
        }
    return {
        'ts': r.get('ts'),
        'mag': r.get('mag') if r.get('mag') is not None else 0.0,
        'lux': r.get('lux') if r.get('lux') is not None else 0.0,
        'temp': r.get('temp') if r.get('temp') is not None else 0.0,
        'humidity': r.get('humidity'),
        'pressure': r.get('pressure'),
        'battery': r.get('battery'),
        'battery_pct': r.get('battery_pct'),
        'error': r.get('dmag'),
        'gps': gps,
        'device_id': r.get('device_id'),
    }


async def read_all() -> list:
    """Lit TOUT l'historique depuis SQLite, format ascendant (chronologique).

    NB : la limite à 100 000 protège la RAM si la DB explose. Au-dessus,
    l'API préfèrera /api/sqm/history avec since= ou device_id=.
    """
    rows = await db.get_history(limit=100000, order='asc')
    return [_row_to_legacy_dict(r) for r in rows]


async def append_record(record: dict) -> int:
    """Insère une mesure dans SQLite et retourne le total cumulé.

    `record` est le dict construit par /api/sqm_push, il contient au moins
    `ts` (UTC ISO) et `mag`. `device_id` est utilisé pour la table devices ;
    si absent on retombe sur "SQM-001" (compatibilité historique).
    """
    ts = record.get('ts') or datetime.now(timezone.utc).isoformat()
    device_id = record.get('device_id') or 'SQM-001'
    # Normalisation : on injecte tous les champs connus dans le payload pour
    # que db.insert_measurement les extraie via les alias.
    payload = {
        'mag': record.get('mag'),
        'lux': record.get('lux'),
        'temp': record.get('temp'),
        'hum': record.get('humidity'),
        'pres': record.get('pressure'),
        'batt': record.get('battery'),
        'batt_pct': record.get('battery_pct'),
        'dmag': record.get('error'),
    }
    gps = record.get('gps') or {}
    if isinstance(gps, dict):
        payload['alt'] = gps.get('alt')
        payload['lat'] = gps.get('lat')
        payload['lon'] = gps.get('lon')
    await db.insert_measurement(payload, device_id=device_id, ts=ts)
    return await db.count_measurements()


def _filter_by_since(data: list, since_iso: Optional[str]) -> list:
    if not since_iso:
        return data
    try:
        # Accept Z suffix as UTC
        s = since_iso.replace('Z', '+00:00')
        since_dt = datetime.fromisoformat(s)
        if since_dt.tzinfo is None:
            since_dt = since_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return data
    out = []
    for d in data:
        try:
            ts = datetime.fromisoformat(d['ts'].replace('Z', '+00:00'))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= since_dt:
                out.append(d)
        except Exception:
            continue
    return out


def _stats(values: List[float]) -> dict:
    if not values:
        return {'min': None, 'max': None, 'avg': None, 'median': None}
    s = sorted(values)
    n = len(s)
    median = s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
    return {
        'min': min(values),
        'max': max(values),
        'avg': sum(values) / n,
        'median': median,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@api_router.get('/')
async def root():
    return {'app': 'SQM Nightwatch', 'version': '1.1.0', 'status': 'ready'}


@api_router.post('/sqm_push')
async def sqm_push(
    payload: Measurement,
    x_api_key: Optional[str] = Header(default=None, alias='X-API-Key'),
):
    # ⚠️ NE JAMAIS exiger de cookie/session/TOTP ici. Cet endpoint est
    # consommé par le firmware ESP8266 qui n'envoie QUE le header X-API-Key
    # (clé injectée à la compilation via le secret GitHub `SENSOR_KEY`).
    # Toute modification de la garde casserait silencieusement les sondes.
    if not x_api_key or x_api_key != SQM_API_KEY:
        raise HTTPException(status_code=401, detail='Invalid or missing X-API-Key')
    record = {
        'ts': datetime.now(timezone.utc).isoformat(),
        'mag': float(payload.mag),
        'lux': float(payload.lux),
        'temp': float(payload.temp),
    }
    total = await append_record(record)
    return {'status': 'ok', 'stored': record, 'total': total}


@api_router.get('/sqm_push')
async def sqm_push_get(
    KEY: Optional[str] = Query(default=None, description='API key'),
    S: Optional[float] = Query(default=None, description='Magnitude (mag/arcsec^2)'),
    D: Optional[float] = Query(default=None, description='Erreur de mesure'),
    T: Optional[float] = Query(default=None, description='Temperature (C)'),
    H: Optional[float] = Query(default=None, description='Humidite (%)'),
    P: Optional[float] = Query(default=None, description='Pression (hPa)'),
    V: Optional[float] = Query(default=None, description='Tension batterie (V)'),
    Alt: Optional[float] = Query(default=None, description='Altitude GPS (m)'),
    Lat: Optional[float] = Query(default=None, description='Latitude GPS'),
    Lon: Optional[float] = Query(default=None, description='Longitude GPS'),
    ID: Optional[str] = Query(default=None, description='Identifiant du capteur'),
    L: Optional[float] = Query(default=None, description='Lux (optionnel)'),
):
    """Receveur HTTP GET compatible avec les capteurs SQM existants.

    Format d'URL: /api/sqm_push?ID=...&KEY=...&S=...&D=...&T=...&H=...&P=...&V=...&Alt=...&Lat=...&Lon=...

    Mapping des variables:
      - S   : magnitude (mag/arcsec^2)
      - D   : erreur de mesure
      - T/H/P : temperature / humidite / pression
      - V   : tension batterie (V)
      - Alt/Lat/Lon : coordonnees GPS
      - ID  : identifiant unique du capteur
      - KEY : cle API (= X-API-Key)

    ⚠️ NE JAMAIS exiger de cookie/session/TOTP ici. Cet endpoint est consommé
    par le firmware ESP8266 (GET en clair via WiFi du capteur) qui n'envoie
    QUE le query param `KEY`. Toute modification de la garde casserait
    silencieusement les sondes (SQM-Quentin et futures sondes communautaires).
    """
    if not KEY or KEY != SQM_API_KEY:
        raise HTTPException(status_code=401, detail='Invalid or missing KEY')
    if S is None:
        raise HTTPException(status_code=422, detail='Missing required parameter: S (magnitude)')
    if not (0 <= S <= 30):
        raise HTTPException(status_code=422, detail='S out of range (expected 0..30)')

    gps = None
    if Alt is not None or Lat is not None or Lon is not None:
        gps = {
            'alt': float(Alt) if Alt is not None else None,
            'lat': float(Lat) if Lat is not None else None,
            'lon': float(Lon) if Lon is not None else None,
        }

    record = {
        'ts': datetime.now(timezone.utc).isoformat(),
        'mag': float(S),
        'lux': float(L) if L is not None else 0.0,
        'temp': float(T) if T is not None else 0.0,
        'humidity': float(H) if H is not None else None,
        'pressure': float(P) if P is not None else None,
        'battery': float(V) if V is not None else None,
        'error': float(D) if D is not None else None,
        'gps': gps,
        'device_id': str(ID) if ID else None,
        'source': 'http_get',
    }
    total = await append_record(record)
    return {'status': 'ok', 'stored': record, 'total': total}


@api_router.get('/sqm/latest')
async def sqm_latest():
    data = await read_all()
    if not data:
        return {'data': None, 'count': 0}
    return {'data': data[-1], 'count': len(data)}


@api_router.get('/sqm/history')
async def sqm_history(since: Optional[str] = None, limit: Optional[int] = None):
    data = await read_all()
    data = _filter_by_since(data, since)
    if limit and limit > 0:
        data = data[-limit:]
    return {'data': data, 'count': len(data)}


@api_router.get('/sqm/stats')
async def sqm_stats(since: Optional[str] = None):
    data = await read_all()
    data = _filter_by_since(data, since)
    if not data:
        return {
            'count': 0,
            'mag': _stats([]),
            'lux': _stats([]),
            'temp': _stats([]),
            'first_ts': None,
            'last_ts': None,
        }
    return {
        'count': len(data),
        'mag': _stats([d['mag'] for d in data]),
        'lux': _stats([d['lux'] for d in data]),
        'temp': _stats([d['temp'] for d in data]),
        'first_ts': data[0]['ts'],
        'last_ts': data[-1]['ts'],
    }


@api_router.get('/sqm/export.csv')
async def sqm_export(since: Optional[str] = None):
    data = await read_all()
    data = _filter_by_since(data, since)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['timestamp_utc', 'mag', 'lux', 'temp'])
    for d in data:
        writer.writerow([d.get('ts', ''), d.get('mag', ''), d.get('lux', ''), d.get('temp', '')])
    csv_content = output.getvalue()
    return Response(
        content=csv_content,
        media_type='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename=sqm_history.csv'},
    )


@api_router.get('/sqm/info')
async def sqm_info():
    """Public read-only info used by the Setup page (URL + API key).

    The dashboard is intended for local self-hosted use (read-only access).
    The X-API-Key still protects the ingestion endpoint.
    """
    return {
        'api_key': SQM_API_KEY,
        'endpoint': '/api/sqm_push',
        'method': 'POST',
        'header_name': 'X-API-Key',
        'expected_payload': {'mag': 21.34, 'lux': 0.0008, 'temp': 12.5},
        'http_get': {
            'endpoint': '/api/sqm_push',
            'method': 'GET',
            'auth_param': 'KEY',
            'query_format': '?ID=<id>&KEY=<key>&S=<mag>&D=<err>&T=<temp>&H=<hum>&P=<press>&V=<batt>&Alt=<alt>&Lat=<lat>&Lon=<lon>',
            'mapping': {
                'S': 'magnitude (mag/arcsec\u00b2)',
                'D': 'erreur de mesure',
                'T': 'temp\u00e9rature (\u00b0C)',
                'H': 'humidit\u00e9 (%)',
                'P': 'pression (hPa)',
                'V': 'tension batterie (V)',
                'Alt': 'altitude GPS (m)',
                'Lat': 'latitude GPS',
                'Lon': 'longitude GPS',
                'ID': 'identifiant capteur',
                'KEY': 'cl\u00e9 API',
            },
        },
    }


# ---------------------------------------------------------------------------
# Firmware proxy : contourne le CORS bloquant de GitHub Releases
# ---------------------------------------------------------------------------
# Canaux supportés pour le firmware :
#   - stable : pointe vers /releases/latest (= dernière release officielle
#              taguée vX.Y.Z sur main, prête pour la prod)
#   - beta   : pointe vers le tag /releases/latest-wifimanager (= pre-release
#              de la branche wifimanager, pour tester les nouveautés)
#
# Pour ajouter d'autres canaux plus tard, juste étendre FIRMWARE_CHANNELS.
FIRMWARE_CHANNELS = {
    'stable': {
        'github_endpoint': 'releases/latest',
        'label': 'Stable',
    },
    'beta': {
        'github_endpoint': 'releases/tags/latest-wifimanager',
        'label': 'Beta WiFiManager',
    },
}

def _resolve_channel(channel: Optional[str]) -> str:
    """Normalise le canal demandé. Tombe sur 'stable' si invalide."""
    if not channel:
        return 'stable'
    c = channel.strip().lower()
    return c if c in FIRMWARE_CHANNELS else 'stable'


async def _fetch_release(channel: str) -> dict:
    """Récupère (avec cache par canal) les métadonnées de la release firmware.

    Cache TTL : FIRMWARE_META_TTL secondes. Si l'appel échoue mais qu'on a
    une valeur cachée, on la renvoie quand même (tolérance aux pannes API).
    """
    now = time.time()
    cache_key = f'release:{channel}'
    async with _firmware_cache_lock:
        cached = _firmware_cache.get(cache_key)
        cached_expiry = _firmware_cache.get(f'{cache_key}_expires', 0)
        if cached and now < cached_expiry:
            return cached

    endpoint = FIRMWARE_CHANNELS[channel]['github_endpoint']
    url = f'https://api.github.com/repos/{FIRMWARE_OWNER}/{FIRMWARE_REPO}/{endpoint}'
    headers = {'Accept': 'application/vnd.github+json'}
    token = os.environ.get('GITHUB_TOKEN', '').strip()
    if token:
        headers['Authorization'] = f'token {token}'

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            release = resp.json()
    except Exception as exc:  # noqa: BLE001
        async with _firmware_cache_lock:
            if _firmware_cache.get(cache_key):
                logger.warning(
                    f'GitHub release ({channel}) fetch failed ({exc}) — fallback cache')
                return _firmware_cache[cache_key]
        raise HTTPException(
            status_code=502,
            detail=f'Impossible de récupérer la release {channel}: {exc}',
        )

    async with _firmware_cache_lock:
        _firmware_cache[cache_key] = release
        _firmware_cache[f'{cache_key}_expires'] = now + FIRMWARE_META_TTL
    return release


# Compatibilité : ancien helper (canal stable uniquement)
async def _fetch_latest_release() -> dict:
    return await _fetch_release('stable')


def _find_firmware_asset(release: dict) -> dict:
    """Trouve l'asset .bin attendu dans la release. 404 sinon."""
    for asset in release.get('assets', []):
        if asset.get('name') == FIRMWARE_ASSET_NAME:
            return asset
    raise HTTPException(
        status_code=404,
        detail=(
            f"Asset '{FIRMWARE_ASSET_NAME}' introuvable dans la release "
            f"{release.get('tag_name', '?')}. Vérifiez le workflow CI du repo "
            f'{FIRMWARE_OWNER}/{FIRMWARE_REPO}.'
        ),
    )


@api_router.get('/firmware/esp8266/manifest.json')
async def firmware_manifest_esp8266(channel: Optional[str] = Query(default='stable')):
    """Manifest ESP Web Tools dynamique pour le firmware ESP8266.

    Génère à la volée le JSON attendu par <esp-web-install-button>, en
    pointant vers /api/firmware/esp8266/firmware.bin (servi par ce backend,
    pas par GitHub directement → évite le blocage CORS).

    Le query param `channel` (stable|beta) sélectionne la release ciblée.
    """
    ch = _resolve_channel(channel)
    release = await _fetch_release(ch)
    _find_firmware_asset(release)  # 404 propre si manquant
    version = release.get('tag_name', 'latest')
    label = FIRMWARE_CHANNELS[ch]['label']

    manifest = {
        '$schema': 'https://esphome.github.io/esp-web-tools/manifest.schema.json',
        'name': f'SQM Pro — Firmware ESP8266 {version} ({label})',
        'version': version,
        'funding_url': f'https://github.com/{FIRMWARE_OWNER}/{FIRMWARE_REPO}',
        'new_install_prompt_erase': True,
        'builds': [
            {
                'chipFamily': 'ESP8266',
                'improv': False,
                'parts': [
                    {
                        # Chemin RELATIF au manifest, en passant le canal
                        # comme query param pour que firmware.bin retourne
                        # bien le bon binaire.
                        'path': f'firmware.bin?channel={ch}',
                        'offset': 0,
                    }
                ],
            }
        ],
    }
    return JSONResponse(
        content=manifest,
        headers={
            'Cache-Control': 'no-store, max-age=0',
            'Access-Control-Allow-Origin': '*',
        },
    )


@api_router.get('/firmware/esp8266/firmware.bin')
async def firmware_binary_esp8266(channel: Optional[str] = Query(default='stable')):
    """Proxy du firmware .bin depuis la release GitHub du canal demandé.

    - Télécharge depuis GitHub avec Accept: application/octet-stream
    - Met en cache mémoire (TTL FIRMWARE_BIN_TTL) par canal
    - Renvoie avec les headers CORS adéquats pour ESP Web Tools
    """
    ch = _resolve_channel(channel)
    release = await _fetch_release(ch)
    asset = _find_firmware_asset(release)
    asset_url = asset.get('url')
    version = release.get('tag_name', 'latest')

    now = time.time()
    bin_cache_key = f"bin:{ch}:{version}:{asset.get('id')}"

    async with _firmware_cache_lock:
        if (
            _firmware_cache.get(bin_cache_key) is not None
            and now < _firmware_cache.get(f'{bin_cache_key}_expires', 0)
        ):
            content = _firmware_cache[bin_cache_key]
            cached_hit = True
        else:
            cached_hit = False

    if not cached_hit:
        headers = {'Accept': 'application/octet-stream'}
        token = os.environ.get('GITHUB_TOKEN', '').strip()
        if token:
            headers['Authorization'] = f'token {token}'
        try:
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                resp = await client.get(asset_url, headers=headers)
                resp.raise_for_status()
                content = resp.content
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=502,
                detail=f'Téléchargement firmware ({ch}) échoué: {exc}',
            )
        async with _firmware_cache_lock:
            _firmware_cache[bin_cache_key] = content
            _firmware_cache[f'{bin_cache_key}_expires'] = now + FIRMWARE_BIN_TTL
        logger.info(
            f'Firmware {ch} {version} téléchargé '
            f'({len(content)/1024:.1f} Ko) et mis en cache.'
        )

    return Response(
        content=content,
        media_type='application/octet-stream',
        headers={
            'Content-Disposition': (
                f'attachment; filename={FIRMWARE_ASSET_NAME}'
            ),
            'X-Firmware-Version': version,
            'X-Firmware-Channel': ch,
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
        },
    )


@api_router.get('/firmware/esp8266/info')
async def firmware_info_esp8266(channel: Optional[str] = Query(default='stable')):
    """Métadonnées publiques sur la release firmware du canal demandé.

    Utile pour afficher la version courante dans l'UI Flasher sans avoir à
    appeler l'API GitHub depuis le navigateur (qui poserait du CORS).
    """
    import re

    ch = _resolve_channel(channel)
    release = await _fetch_release(ch)
    try:
        asset = _find_firmware_asset(release)
        asset_info = {
            'name': asset.get('name'),
            'size': asset.get('size'),
            'updated_at': asset.get('updated_at'),
        }
    except HTTPException:
        asset_info = None

    tag_name = release.get('tag_name') or ''
    release_name = release.get('name') or ''

    # Extraction de la "vraie" version vX.Y.Z :
    # - Si le tag suit le format sémantique (vX.Y.Z) → utilise directement
    # - Sinon (tag mobile type "latest-wifimanager") → cherche dans le nom
    #   de la release ("Beta v2.3.1 — WiFiManager portail captif")
    # - Sinon fallback sur le tag_name brut
    semver_re = re.compile(r'v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)')
    m = semver_re.search(tag_name)
    if m:
        display_version = f'v{m.group(1)}'
    else:
        m = semver_re.search(release_name)
        if m:
            display_version = f'v{m.group(1)}'
        else:
            display_version = tag_name or 'latest'

    return {
        'channel': ch,
        'channel_label': FIRMWARE_CHANNELS[ch]['label'],
        'version': release.get('tag_name'),          # brut, pour debug
        'display_version': display_version,          # à afficher dans l'UI
        'name': release.get('name'),
        'published_at': release.get('published_at'),
        'prerelease': release.get('prerelease', False),
        'html_url': release.get('html_url'),
        'asset': asset_info,
        'source_repo': f'https://github.com/{FIRMWARE_OWNER}/{FIRMWARE_REPO}',
    }


@api_router.get('/firmware/esp8266/channels')
async def firmware_channels_esp8266():
    """Liste les canaux firmware disponibles (pour peupler un toggle UI)."""
    return {
        'channels': [
            {'id': cid, 'label': cfg['label']}
            for cid, cfg in FIRMWARE_CHANNELS.items()
        ],
        'default': 'stable',
    }


# ---------------------------------------------------------------------------
# Phase 4 — Admin endpoints (suppression de mesures par plage)
# ---------------------------------------------------------------------------
# Authentification provisoire : on protège via la SQM_API_KEY pour la
# Phase 4. Quand la Phase 5 (auth utilisateurs) sera en place, ces routes
# seront migrées vers une vérification du rôle admin via JWT.

class DeleteRangeRequest(BaseModel):
    """Plage de timestamps ISO (UTC) à supprimer, optionnellement filtrée
    par device_id. Les bornes sont INCLUSES.
    """
    model_config = ConfigDict(extra='ignore')
    start_ts: str = Field(..., description='Borne basse incluse (ISO UTC, ex 2026-05-19T22:00:00Z)')
    end_ts: str = Field(..., description='Borne haute incluse (ISO UTC)')
    device_id: Optional[str] = Field(default=None, description='Filtre sonde (None = toutes)')


def _require_admin(x_api_key: Optional[str]):
    """[DEPRECATED Phase 5] Garde héritée. Conservée pour compat éventuelle ;
    les routes admin utilisent désormais `auth.require_admin_or_api_key`."""
    if not x_api_key or x_api_key != SQM_API_KEY:
        raise HTTPException(status_code=401, detail='Invalid or missing X-API-Key')


def _validate_iso_ts(ts: str, field: str) -> str:
    """Normalise un timestamp ISO côté serveur (accepte Z suffix)."""
    try:
        s = ts.replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=422,
            detail=f'Invalid ISO timestamp for {field}: {exc}',
        )


@api_router.get('/admin/measurements/preview_delete_range')
async def admin_preview_delete_range(
    start_ts: str = Query(..., description='Borne basse ISO UTC'),
    end_ts: str = Query(..., description='Borne haute ISO UTC'),
    device_id: Optional[str] = Query(default=None),
    _admin: dict = Depends(auth.require_admin_or_api_key),
):
    """Renvoie le nombre de mesures qui seraient supprimées + un échantillon
    (jusqu'à 5 lignes au bord de la plage) pour validation avant action.

    Auth : session admin (cookie) OU X-API-Key (rétrocompatibilité scripts/CI).
    """
    start = _validate_iso_ts(start_ts, 'start_ts')
    end = _validate_iso_ts(end_ts, 'end_ts')
    if start > end:
        raise HTTPException(status_code=422, detail='start_ts > end_ts')

    count = await db.count_measurements(
        device_id=device_id, start_ts=start, end_ts=end
    )
    # Échantillon (5 lignes au début, 5 à la fin pour visualiser)
    sample_first = await db.get_history(
        device_id=device_id, limit=5, order='asc',
    )
    sample_last = await db.get_history(
        device_id=device_id, limit=5, order='desc',
    )
    return {
        'matched': count,
        'start_ts': start,
        'end_ts': end,
        'device_id': device_id,
        'sample_first': [_row_to_legacy_dict(r) for r in sample_first],
        'sample_last': [_row_to_legacy_dict(r) for r in sample_last],
    }


@api_router.post('/admin/measurements/delete_range')
async def admin_delete_range(
    body: DeleteRangeRequest,
    _admin: dict = Depends(auth.require_admin_or_api_key),
):
    """Supprime les mesures dans la plage [start_ts, end_ts] (incluses),
    optionnellement filtrées par device_id.

    Auth : session admin (cookie) OU X-API-Key (rétrocompatibilité scripts/CI).
    Renvoie le nombre exact de lignes effacées + les stats post-suppression.
    """
    start = _validate_iso_ts(body.start_ts, 'start_ts')
    end = _validate_iso_ts(body.end_ts, 'end_ts')
    if start > end:
        raise HTTPException(status_code=422, detail='start_ts > end_ts')

    deleted = await db.delete_measurements_range(
        start_ts=start, end_ts=end, device_id=body.device_id,
    )
    stats = await db.get_stats()
    logger.info(
        f'Admin delete_range: device={body.device_id or "*"} '
        f'{start} → {end}: {deleted} measurements deleted.'
    )
    return {
        'status': 'ok',
        'deleted': deleted,
        'start_ts': start,
        'end_ts': end,
        'device_id': body.device_id,
        'stats': stats,
    }


@api_router.get('/devices')
async def list_devices_endpoint():
    """Liste publique des sondes connues (pour les dropdowns UI).

    Renvoie pour chaque sonde : ID, nom d'affichage, première/dernière
    mesure, compteur. Sans données sensibles (pas d'IP, pas de propriétaire
    tant que la Phase 5 n'a pas associé les sondes à des comptes).
    """
    devices = await db.list_devices()
    # On masque pour l'instant owner_user_id (Phase 5 nécessaire) et notes
    public = [
        {
            'device_id': d['device_id'],
            'display_name': d.get('display_name'),
            'first_seen': d.get('first_seen'),
            'last_seen': d.get('last_seen'),
            'total_measurements': d.get('total_measurements'),
            'is_public': bool(d.get('is_public', 1)),
        }
        for d in devices
    ]
    return {'devices': public, 'count': len(public)}


# Include the router in the main app
api_router.include_router(auth_routes.router)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    # Origines additionnelles pour l'APK Capacitor (Android WebView).
    # Capacitor charge l'app depuis https://localhost (androidScheme=https),
    # capacitor://localhost (legacy) ou http://localhost (dev).
    allow_origin_regex=r"^(https?://localhost(:\d+)?|capacitor://localhost|ionic://localhost)$",
    allow_methods=['*'],
    allow_headers=['*'],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)


@app.on_event('startup')
async def _on_startup():
    logger.info('=' * 70)
    logger.info('SQM Nightwatch backend started')

    # Phase 4 : initialisation SQLite + migration JSON → DB si nécessaire
    try:
        await db.init_db()
        logger.info(f'SQLite DB   : {db.DB_PATH}')
        migrated = await db.migrate_legacy_json()
        if migrated > 0:
            logger.info(
                f'Migration   : {migrated} mesures importées depuis '
                f'{db.LEGACY_JSON_PATH.name} (renommé en .bak)'
            )
        stats = await db.get_stats()
        logger.info(
            f'Stats DB    : {stats["total_measurements"]} mesures, '
            f'{stats["total_devices"]} sondes'
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(f'!! Erreur init/migration SQLite : {exc}')

    # Phase 5 : seed du compte admin si la table users est vide
    try:
        seeded = await auth.seed_admin_if_needed()
        if seeded:
            logger.info(
                f'Admin seed : compte initial créé ({seeded["email"]}). '
                f'Changement du mot de passe requis à la 1ère connexion.'
            )
        total_users = await db.count_users()
        logger.info(f'Users DB    : {total_users} utilisateur(s) en base')
    except Exception as exc:  # noqa: BLE001
        logger.exception(f'!! Erreur seed admin : {exc}')

    logger.info(f'X-API-Key   : {SQM_API_KEY}')
    logger.info('POST endpoint: /api/sqm_push  (Header: X-API-Key)')
    logger.info('=' * 70)
