from fastapi import FastAPI, APIRouter, Header, HTTPException, Response, Query
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
# Storage helpers (lock-protected)
# ---------------------------------------------------------------------------
async def _read_all_unlocked() -> list:
    try:
        content = HISTORY_FILE.read_text()
        if not content.strip():
            return []
        data = json.loads(content)
        if not isinstance(data, list):
            return []
        return data
    except (json.JSONDecodeError, FileNotFoundError):
        return []


async def read_all() -> list:
    async with file_lock:
        return await _read_all_unlocked()


async def append_record(record: dict) -> int:
    """Append a record to the JSON history with atomic write under lock."""
    async with file_lock:
        data = await _read_all_unlocked()
        data.append(record)
        tmp_path = HISTORY_FILE.with_suffix('.json.tmp')
        # Atomic write: write to tmp, then rename
        tmp_path.write_text(json.dumps(data, ensure_ascii=False))
        os.replace(tmp_path, HISTORY_FILE)
        return len(data)


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
async def _fetch_latest_release() -> dict:
    """Récupère (avec cache) les métadonnées de la dernière release firmware.

    Cache TTL : FIRMWARE_META_TTL secondes. Si l'appel échoue mais qu'on a
    une valeur cachée, on la renvoie quand même (tolérance aux pannes API).
    """
    now = time.time()
    async with _firmware_cache_lock:
        cached = _firmware_cache['release']
        if cached and now < _firmware_cache['expires_at']:
            return cached

    url = f'https://api.github.com/repos/{FIRMWARE_OWNER}/{FIRMWARE_REPO}/releases/latest'
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
        # Si on a une vieille valeur cachée, on la renvoie en mode dégradé
        async with _firmware_cache_lock:
            if _firmware_cache['release']:
                logger.warning(
                    f'GitHub release fetch failed ({exc}) — fallback sur cache')
                return _firmware_cache['release']
        raise HTTPException(
            status_code=502,
            detail=f'Impossible de récupérer la release firmware GitHub: {exc}',
        )

    async with _firmware_cache_lock:
        _firmware_cache['release'] = release
        _firmware_cache['expires_at'] = now + FIRMWARE_META_TTL
    return release


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
async def firmware_manifest_esp8266():
    """Manifest ESP Web Tools dynamique pour le firmware ESP8266.

    Génère à la volée le JSON attendu par <esp-web-install-button>, en
    pointant vers /api/firmware/esp8266/firmware.bin (servi par ce backend,
    pas par GitHub directement → évite le blocage CORS).
    """
    release = await _fetch_latest_release()
    _find_firmware_asset(release)  # 404 propre si manquant
    version = release.get('tag_name', 'latest')

    manifest = {
        '$schema': 'https://esphome.github.io/esp-web-tools/manifest.schema.json',
        'name': f'SQM Pro — Firmware ESP8266 {version}',
        'version': version,
        'funding_url': f'https://github.com/{FIRMWARE_OWNER}/{FIRMWARE_REPO}',
        'new_install_prompt_erase': True,
        'builds': [
            {
                'chipFamily': 'ESP8266',
                'improv': False,
                'parts': [
                    {
                        # Chemin RELATIF au manifest pour rester portable
                        # (dev local, prod, derrière proxy, etc.).
                        # ESP Web Tools résout ça contre l'URL du manifest.
                        'path': 'firmware.bin',
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
async def firmware_binary_esp8266():
    """Proxy du firmware .bin depuis la dernière release GitHub.

    - Télécharge depuis GitHub avec Accept: application/octet-stream
    - Met en cache mémoire (TTL FIRMWARE_BIN_TTL) pour ne pas hammer GitHub
    - Renvoie avec les headers CORS adéquats pour ESP Web Tools (fetch
      depuis un autre origin si servi via un sous-domaine, etc.)
    """
    release = await _fetch_latest_release()
    asset = _find_firmware_asset(release)
    asset_url = asset.get('url')  # API URL (pas browser_download_url) :
                                  # permet de passer Accept: octet-stream
    version = release.get('tag_name', 'latest')

    now = time.time()
    cache_key = f"{version}|{asset.get('id')}"

    async with _firmware_cache_lock:
        if (
            _firmware_cache['bin_bytes'] is not None
            and _firmware_cache['bin_etag'] == cache_key
            and now < _firmware_cache['bin_expires_at']
        ):
            content = _firmware_cache['bin_bytes']
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
                detail=f'Téléchargement du firmware depuis GitHub échoué: {exc}',
            )
        async with _firmware_cache_lock:
            _firmware_cache['bin_bytes'] = content
            _firmware_cache['bin_etag'] = cache_key
            _firmware_cache['bin_expires_at'] = now + FIRMWARE_BIN_TTL
        logger.info(
            f'Firmware {version} ({FIRMWARE_ASSET_NAME}) téléchargé '
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
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
        },
    )


@api_router.get('/firmware/esp8266/info')
async def firmware_info_esp8266():
    """Métadonnées publiques sur la dernière release firmware.

    Utile pour afficher la version courante dans l'UI Flasher sans avoir à
    appeler l'API GitHub depuis le navigateur (qui poserait du CORS).
    """
    release = await _fetch_latest_release()
    try:
        asset = _find_firmware_asset(release)
        asset_info = {
            'name': asset.get('name'),
            'size': asset.get('size'),
            'updated_at': asset.get('updated_at'),
        }
    except HTTPException:
        asset_info = None
    return {
        'version': release.get('tag_name'),
        'name': release.get('name'),
        'published_at': release.get('published_at'),
        'html_url': release.get('html_url'),
        'asset': asset_info,
        'source_repo': f'https://github.com/{FIRMWARE_OWNER}/{FIRMWARE_REPO}',
    }


# Include the router in the main app
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
    logger.info(f'History file : {HISTORY_FILE}')
    logger.info(f'X-API-Key    : {SQM_API_KEY}')
    logger.info("POST endpoint: /api/sqm_push  (Header: X-API-Key)")
    logger.info('=' * 70)
