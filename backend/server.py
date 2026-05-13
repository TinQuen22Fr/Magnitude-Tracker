from fastapi import FastAPI, APIRouter, Header, HTTPException, Response, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import secrets
import asyncio
import logging
import io
import csv
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime, timezone


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
