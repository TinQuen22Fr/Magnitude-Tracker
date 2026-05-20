"""
db.py — Couche d'accès SQLite pour SQM Nightwatch.

Stockage : un seul fichier `sqm.db` à la racine du backend (configurable via
SQM_DB_PATH). Aucune dépendance externe à un serveur de base de données.

Le schéma anticipe les phases futures (auth, multi-users, invitations) pour
éviter d'avoir à migrer le schéma deux fois.

Drivers : aiosqlite (async) directement, sans ORM, pour rester léger et
debuggable.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiosqlite

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = BACKEND_DIR / 'sqm.db'
DB_PATH = Path(os.environ.get('SQM_DB_PATH', str(DEFAULT_DB_PATH)))

# Chemin du fichier JSON historique pour la migration initiale.
LEGACY_JSON_PATH = BACKEND_DIR / 'sqm_history.json'

# ---------------------------------------------------------------------------
# Schéma complet (préparé pour Phases 4-7)
# ---------------------------------------------------------------------------
SCHEMA = """
-- =====================================================================
-- Phase 4 : mesures + devices
-- =====================================================================
CREATE TABLE IF NOT EXISTS measurements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TIMESTAMP NOT NULL,        -- ISO UTC
    device_id       TEXT NOT NULL,
    mag             REAL,                       -- mpsas
    dmag            REAL,                       -- erreur mpsas
    temp            REAL,                       -- °C
    humidity        INTEGER,                    -- %
    pressure        INTEGER,                    -- hPa
    battery         REAL,                       -- V
    battery_pct     INTEGER,                    -- %
    lux             REAL,
    gps_alt         REAL,
    gps_lat         REAL,
    gps_lon         REAL,
    raw_payload     TEXT,                       -- JSON du payload reçu (debug)
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_meas_ts        ON measurements(ts);
CREATE INDEX IF NOT EXISTS idx_meas_device    ON measurements(device_id);
CREATE INDEX IF NOT EXISTS idx_meas_device_ts ON measurements(device_id, ts);

CREATE TABLE IF NOT EXISTS devices (
    device_id           TEXT PRIMARY KEY,
    display_name        TEXT,
    owner_user_id       INTEGER,                -- NULL = sonde non claim
    first_seen          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_measurements  INTEGER DEFAULT 0,
    is_public           INTEGER DEFAULT 1,      -- 0/1
    notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_user_id);

-- =====================================================================
-- Phase 5 : utilisateurs + sessions + 2FA
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT,
    password_hash   TEXT,
    is_admin        INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    mfa_method      TEXT DEFAULT 'email',       -- 'email' | 'totp'
    totp_secret     TEXT,                       -- base32, NULL si non configuré
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token           TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS email_otp (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    code_hash       TEXT NOT NULL,
    purpose         TEXT NOT NULL,              -- 'login' | 'reset'
    expires_at      TIMESTAMP NOT NULL,
    used            INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Challenge intermédiaire entre étape 1 (password OK) et étape 2 (TOTP).
-- TTL court (5 min). Détruit après validation ou expiration.
CREATE TABLE IF NOT EXISTS login_challenges (
    challenge_id    TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    purpose         TEXT NOT NULL DEFAULT '2fa',
    expires_at      TIMESTAMP NOT NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chal_expire ON login_challenges(expires_at);

-- Tentatives de login pour rate-limiting basique (par email + IP).
CREATE TABLE IF NOT EXISTS login_attempts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT,
    ip_address      TEXT,
    success         INTEGER DEFAULT 0,
    ts              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attempts_email_ts ON login_attempts(email, ts);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_ts    ON login_attempts(ip_address, ts);

-- =====================================================================
-- Phase 6 : invitations
-- =====================================================================
CREATE TABLE IF NOT EXISTS invitations (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    email                   TEXT NOT NULL,
    display_name            TEXT,
    motivation              TEXT,
    status                  TEXT DEFAULT 'pending',  -- pending|accepted|rejected|activated
    invitation_token        TEXT UNIQUE,
    token_expires_at        TIMESTAMP,
    reviewed_by_user_id     INTEGER,
    reviewed_at             TIMESTAMP,
    reviewer_notes          TEXT,
    user_id                 INTEGER,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
"""


# ---------------------------------------------------------------------------
# Initialisation / migration
# ---------------------------------------------------------------------------
async def init_db() -> None:
    """Crée le fichier sqm.db et le schéma si absents. Idempotent."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        # PRAGMAs pour la performance et la fiabilité sur un single-host VPS :
        # - WAL : meilleures perfs concurrents lecteurs/écrivain
        # - synchronous=NORMAL : compromis vitesse/durabilité acceptable
        await db.execute('PRAGMA journal_mode = WAL')
        await db.execute('PRAGMA synchronous = NORMAL')
        await db.execute('PRAGMA foreign_keys = ON')
        await db.executescript(SCHEMA)
        await db.commit()
        # Ajoute les colonnes manquantes pour les phases ultérieures (idempotent)
        await _ensure_user_columns(db)
        await db.commit()
    logger.info(f'SQLite database ready: {DB_PATH}')


# Colonnes à garantir sur la table `users` (migrations idempotentes).
# Format : (col_name, sql_type_with_default)
_USER_EXTRA_COLUMNS = [
    ('totp_enabled',           'INTEGER DEFAULT 0'),
    ('must_change_password',   'INTEGER DEFAULT 0'),
    ('failed_login_count',     'INTEGER DEFAULT 0'),
    ('locked_until',           'TIMESTAMP'),
]


async def _ensure_user_columns(db: aiosqlite.Connection) -> None:
    """Ajoute les colonnes manquantes à `users` sans casser les données."""
    async with db.execute('PRAGMA table_info(users)') as cur:
        existing_rows = await cur.fetchall()
    existing = {row[1] for row in existing_rows}
    for col, definition in _USER_EXTRA_COLUMNS:
        if col not in existing:
            await db.execute(f'ALTER TABLE users ADD COLUMN {col} {definition}')
            logger.info(f"users: added column '{col}'")


async def migrate_legacy_json(json_path: Path = LEGACY_JSON_PATH) -> int:
    """Importe `sqm_history.json` dans la table measurements si non déjà fait.

    Retourne le nombre de lignes importées (0 si déjà migré ou fichier absent).
    Backup automatique de l'ancien fichier en `.bak` après import réussi.
    """
    if not json_path.exists():
        logger.info('No legacy sqm_history.json to migrate.')
        return 0

    # Skip si la DB contient déjà des mesures (migration déjà faite)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute('SELECT COUNT(*) FROM measurements') as cur:
            row = await cur.fetchone()
            existing = row[0] if row else 0
    if existing > 0:
        logger.info(
            f'Skip migration: SQLite already contains {existing} measurements.'
        )
        return 0

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as exc:  # noqa: BLE001
        logger.error(f'Cannot parse legacy JSON: {exc}')
        return 0

    rows = data.get('data') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        logger.warning('Legacy JSON has unexpected format, skip.')
        return 0

    inserted = 0
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN')
        try:
            for r in rows:
                if not isinstance(r, dict):
                    continue
                ts = r.get('ts') or r.get('timestamp') or r.get('created_at')
                if not ts:
                    continue
                device_id = r.get('device_id') or r.get('ID') or r.get('id') \
                    or 'SQM-001'
                await db.execute(
                    """
                    INSERT INTO measurements
                        (ts, device_id, mag, dmag, temp, humidity, pressure,
                         battery, battery_pct, lux, gps_alt, gps_lat, gps_lon,
                         raw_payload)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        ts, device_id,
                        _to_float(r.get('mag') or r.get('S')),
                        _to_float(r.get('dmag') or r.get('D') or r.get('err')),
                        _to_float(r.get('temp') or r.get('T')),
                        _to_int(r.get('hum') or r.get('H') or r.get('humidity')),
                        _to_int(r.get('pres') or r.get('P') or r.get('pressure')),
                        _to_float(r.get('batt') or r.get('V') or r.get('battery')),
                        _to_int(r.get('batt_pct') or r.get('Vpct')),
                        _to_float(r.get('lux') or r.get('L')),
                        _to_float(r.get('alt') or r.get('Alt')),
                        _to_float(r.get('lat') or r.get('Lat')),
                        _to_float(r.get('lon') or r.get('Lon')),
                        json.dumps(r, separators=(',', ':')),
                    ),
                )
                inserted += 1

            # Met aussi à jour la table devices avec les agrégats
            await db.execute(
                """
                INSERT OR REPLACE INTO devices
                    (device_id, first_seen, last_seen, total_measurements,
                     is_public)
                SELECT
                    device_id,
                    MIN(ts) AS first_seen,
                    MAX(ts) AS last_seen,
                    COUNT(*) AS total_measurements,
                    1
                FROM measurements
                GROUP BY device_id
                """
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

    # Backup du fichier JSON pour ne pas le re-migrer accidentellement
    bak = json_path.with_suffix(json_path.suffix + '.bak')
    try:
        json_path.rename(bak)
        logger.info(f'Legacy JSON moved to {bak}')
    except Exception as exc:  # noqa: BLE001
        logger.warning(f'Could not rename legacy JSON: {exc}')

    logger.info(f'Migrated {inserted} measurements from legacy JSON.')
    return inserted


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------
def _to_float(v: Any) -> Optional[float]:
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_int(v: Any) -> Optional[int]:
    if v is None or v == '':
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _row_to_dict(row: aiosqlite.Row, columns: list[str]) -> dict:
    return {col: row[idx] for idx, col in enumerate(columns)}


# ---------------------------------------------------------------------------
# CRUD measurements
# ---------------------------------------------------------------------------
async def insert_measurement(payload: dict, device_id: str,
                             ts: Optional[str] = None) -> int:
    """Insère une mesure et met à jour la table devices.

    Retourne le ROWID de la mesure insérée.
    """
    if ts is None:
        ts = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('PRAGMA foreign_keys = ON')
        cur = await db.execute(
            """
            INSERT INTO measurements
                (ts, device_id, mag, dmag, temp, humidity, pressure,
                 battery, battery_pct, lux, gps_alt, gps_lat, gps_lon,
                 raw_payload)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                ts, device_id,
                _to_float(payload.get('mag') or payload.get('S')),
                _to_float(payload.get('dmag') or payload.get('D')),
                _to_float(payload.get('temp') or payload.get('T')),
                _to_int(payload.get('hum') or payload.get('H')),
                _to_int(payload.get('pres') or payload.get('P')),
                _to_float(payload.get('batt') or payload.get('V')),
                _to_int(payload.get('batt_pct') or payload.get('Vpct')),
                _to_float(payload.get('lux') or payload.get('L')),
                _to_float(payload.get('alt') or payload.get('Alt')),
                _to_float(payload.get('lat') or payload.get('Lat')),
                _to_float(payload.get('lon') or payload.get('Lon')),
                json.dumps(payload, separators=(',', ':')),
            ),
        )
        # Upsert dans devices
        await db.execute(
            """
            INSERT INTO devices (device_id, first_seen, last_seen, total_measurements)
                VALUES (?, ?, ?, 1)
            ON CONFLICT(device_id) DO UPDATE SET
                last_seen = excluded.last_seen,
                total_measurements = total_measurements + 1
            """,
            (device_id, ts, ts),
        )
        await db.commit()
        return cur.lastrowid or 0


async def get_latest_measurement(device_id: Optional[str] = None) -> Optional[dict]:
    """Renvoie la dernière mesure (toutes sondes ou pour un device_id donné)."""
    query = (
        'SELECT id, ts, device_id, mag, dmag, temp, humidity, pressure, '
        'battery, battery_pct, lux, gps_alt, gps_lat, gps_lon '
        'FROM measurements '
    )
    params: tuple = ()
    if device_id:
        query += 'WHERE device_id = ? '
        params = (device_id,)
    query += 'ORDER BY ts DESC LIMIT 1'

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_history(
    device_id: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = 1000,
    order: str = 'desc',
) -> list[dict]:
    """Renvoie l'historique des mesures (filtré par device + plage)."""
    where = []
    params: list = []
    if device_id:
        where.append('device_id = ?')
        params.append(device_id)
    if since:
        where.append('ts >= ?')
        params.append(since)

    sql = (
        'SELECT id, ts, device_id, mag, dmag, temp, humidity, pressure, '
        'battery, battery_pct, lux, gps_alt, gps_lat, gps_lon '
        'FROM measurements '
    )
    if where:
        sql += 'WHERE ' + ' AND '.join(where) + ' '
    sql += f'ORDER BY ts {"ASC" if order.lower() == "asc" else "DESC"} '
    sql += 'LIMIT ?'
    params.append(int(limit))

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, tuple(params)) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def count_measurements(
    device_id: Optional[str] = None,
    start_ts: Optional[str] = None,
    end_ts: Optional[str] = None,
) -> int:
    where = []
    params: list = []
    if device_id:
        where.append('device_id = ?')
        params.append(device_id)
    if start_ts:
        where.append('ts >= ?')
        params.append(start_ts)
    if end_ts:
        where.append('ts <= ?')
        params.append(end_ts)
    sql = 'SELECT COUNT(*) FROM measurements'
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(sql, tuple(params)) as cur:
            row = await cur.fetchone()
    return row[0] if row else 0


async def delete_measurements_range(
    start_ts: str,
    end_ts: str,
    device_id: Optional[str] = None,
) -> int:
    """Supprime les mesures dans [start_ts, end_ts] (inclus) pour un device
    optionnel. Retourne le nombre de lignes effacées.

    Met à jour la colonne `total_measurements` de devices en conséquence.
    """
    where = ['ts >= ?', 'ts <= ?']
    params: list = [start_ts, end_ts]
    if device_id:
        where.append('device_id = ?')
        params.append(device_id)
    where_sql = ' AND '.join(where)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('BEGIN')
        try:
            cur = await db.execute(
                f'DELETE FROM measurements WHERE {where_sql}',
                tuple(params),
            )
            deleted = cur.rowcount or 0
            # Recompute totals & last_seen pour les devices impactés
            await db.execute(
                """
                UPDATE devices
                SET
                    total_measurements = COALESCE(
                        (SELECT COUNT(*) FROM measurements
                         WHERE measurements.device_id = devices.device_id),
                        0),
                    last_seen = COALESCE(
                        (SELECT MAX(ts) FROM measurements
                         WHERE measurements.device_id = devices.device_id),
                        last_seen),
                    first_seen = COALESCE(
                        (SELECT MIN(ts) FROM measurements
                         WHERE measurements.device_id = devices.device_id),
                        first_seen)
                """
            )
            await db.commit()
            return deleted
        except Exception:
            await db.rollback()
            raise


# ---------------------------------------------------------------------------
# CRUD devices (listing pour la future UI multi-stations)
# ---------------------------------------------------------------------------
async def list_devices() -> list[dict]:
    sql = (
        'SELECT device_id, display_name, owner_user_id, first_seen, last_seen, '
        'total_measurements, is_public, notes '
        'FROM devices ORDER BY last_seen DESC'
    )
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Stats globales
# ---------------------------------------------------------------------------
async def get_stats() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            'SELECT COUNT(*), MIN(ts), MAX(ts) FROM measurements'
        ) as cur:
            total_row = await cur.fetchone()
        async with db.execute(
            'SELECT COUNT(*) FROM devices'
        ) as cur:
            dev_row = await cur.fetchone()
    return {
        'total_measurements': total_row[0] if total_row else 0,
        'earliest_ts': total_row[1] if total_row else None,
        'latest_ts': total_row[2] if total_row else None,
        'total_devices': dev_row[0] if dev_row else 0,
    }



# ===========================================================================
# Phase 5 — Users / Sessions / Challenges / Rate-limit
# ===========================================================================
USER_PUBLIC_COLS = (
    'id', 'email', 'display_name', 'is_admin', 'is_active',
    'mfa_method', 'totp_enabled', 'must_change_password',
    'created_at', 'last_login',
)


async def get_user_by_email(email: str) -> Optional[dict]:
    """Renvoie l'utilisateur (avec password_hash + totp_secret) ou None."""
    if not email:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            'SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
            (email.strip(),),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_user_by_id(user_id: int) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            'SELECT * FROM users WHERE id = ? LIMIT 1', (int(user_id),),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def count_users() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute('SELECT COUNT(*) FROM users') as cur:
            row = await cur.fetchone()
    return row[0] if row else 0


async def create_user(
    email: str,
    password_hash: str,
    *,
    display_name: Optional[str] = None,
    is_admin: bool = False,
    must_change_password: bool = False,
) -> int:
    """Crée un utilisateur et renvoie son id."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            INSERT INTO users
                (email, display_name, password_hash, is_admin, is_active,
                 mfa_method, totp_enabled, must_change_password)
            VALUES (?, ?, ?, ?, 1, 'totp', 0, ?)
            """,
            (
                email.strip().lower(),
                display_name,
                password_hash,
                1 if is_admin else 0,
                1 if must_change_password else 0,
            ),
        )
        await db.commit()
        return cur.lastrowid or 0


async def update_user_password(user_id: int, password_hash: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            'UPDATE users SET password_hash = ?, must_change_password = 0 '
            'WHERE id = ?',
            (password_hash, int(user_id)),
        )
        await db.commit()


async def update_user_totp(
    user_id: int,
    *,
    totp_secret: Optional[str] = None,
    enabled: Optional[bool] = None,
) -> None:
    """Met à jour le secret TOTP (chiffré) et/ou l'état d'activation."""
    sets = []
    params: list = []
    if totp_secret is not None:
        sets.append('totp_secret = ?')
        params.append(totp_secret)
    if enabled is not None:
        sets.append('totp_enabled = ?')
        params.append(1 if enabled else 0)
    if not sets:
        return
    params.append(int(user_id))
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f'UPDATE users SET {", ".join(sets)} WHERE id = ?',
            tuple(params),
        )
        await db.commit()


async def touch_user_login(user_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            'UPDATE users SET last_login = ? WHERE id = ?',
            (datetime.now(timezone.utc).isoformat(), int(user_id)),
        )
        await db.commit()


def user_to_public(u: dict) -> dict:
    """Strippe les champs sensibles avant exposition front."""
    if not u:
        return {}
    return {k: u.get(k) for k in USER_PUBLIC_COLS if k in u}


# ----- Sessions ------------------------------------------------------------
async def create_session(
    token: str,
    user_id: int,
    expires_at: str,
    *,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, int(user_id), expires_at, ip, user_agent),
        )
        await db.commit()


async def get_session(token: str) -> Optional[dict]:
    """Renvoie (session, user) si valide, sinon None. Supprime si expirée."""
    if not token:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT s.token, s.user_id, s.expires_at, s.ip_address, s.user_agent,
                   s.created_at
            FROM sessions s WHERE s.token = ?
            """,
            (token,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        # Vérifie expiration
        try:
            exp = datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00'))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
        except Exception:
            exp = None
        now = datetime.now(timezone.utc)
        if exp is None or exp < now:
            await db.execute('DELETE FROM sessions WHERE token = ?', (token,))
            await db.commit()
            return None
    return dict(row)


async def delete_session(token: str) -> None:
    if not token:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('DELETE FROM sessions WHERE token = ?', (token,))
        await db.commit()


async def cleanup_expired_sessions() -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            'DELETE FROM sessions WHERE expires_at < ?', (now,),
        )
        await db.commit()
        return cur.rowcount or 0


# ----- Login challenges (entre étape 1 et étape 2 du 2FA) -----------------
async def create_challenge(
    challenge_id: str,
    user_id: int,
    expires_at: str,
    *,
    purpose: str = '2fa',
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO login_challenges
                (challenge_id, user_id, purpose, expires_at, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (challenge_id, int(user_id), purpose, expires_at, ip, user_agent),
        )
        await db.commit()


async def get_challenge(challenge_id: str) -> Optional[dict]:
    if not challenge_id:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            'SELECT * FROM login_challenges WHERE challenge_id = ?',
            (challenge_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        try:
            exp = datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00'))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
        except Exception:
            exp = None
        if exp is None or exp < datetime.now(timezone.utc):
            await db.execute(
                'DELETE FROM login_challenges WHERE challenge_id = ?',
                (challenge_id,),
            )
            await db.commit()
            return None
    return dict(row)


async def delete_challenge(challenge_id: str) -> None:
    if not challenge_id:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            'DELETE FROM login_challenges WHERE challenge_id = ?',
            (challenge_id,),
        )
        await db.commit()


# ----- Rate limiting ------------------------------------------------------
async def record_login_attempt(
    email: Optional[str], ip: Optional[str], success: bool,
) -> None:
    # On enregistre `ts` explicitement en ISO UTC pour pouvoir comparer
    # avec les cutoffs ISO calculés côté Python (sinon SQLite renvoie
    # 'YYYY-MM-DD HH:MM:SS' sans timezone, incompatible).
    ts = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            'INSERT INTO login_attempts (email, ip_address, success, ts) '
            'VALUES (?, ?, ?, ?)',
            (
                (email or '').strip().lower() or None,
                ip,
                1 if success else 0,
                ts,
            ),
        )
        await db.commit()


async def count_recent_failed_attempts(
    email: Optional[str], ip: Optional[str], window_minutes: int = 15,
) -> int:
    """Compte les tentatives ÉCHOUÉES dans la fenêtre, par email OU par IP."""
    cutoff = datetime.now(timezone.utc).timestamp() - window_minutes * 60
    cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
    where = ['success = 0', 'ts >= ?']
    params: list = [cutoff_iso]
    sub = []
    if email:
        sub.append('LOWER(email) = LOWER(?)')
        params.append(email.strip())
    if ip:
        sub.append('ip_address = ?')
        params.append(ip)
    if sub:
        where.append('(' + ' OR '.join(sub) + ')')
    sql = 'SELECT COUNT(*) FROM login_attempts WHERE ' + ' AND '.join(where)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(sql, tuple(params)) as cur:
            row = await cur.fetchone()
    return row[0] if row else 0
