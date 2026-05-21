"""
auth.py — Couche d'authentification SQM Nightwatch (Phase 5).

Fonctionnalités :
- Hash mot de passe : bcrypt (passlib)
- 2FA TOTP (RFC 6238) compatible Google Authenticator / Authy / 1Password
- Secret TOTP chiffré au repos avec Fernet (clé `AUTH_SECRET_KEY` env)
- Sessions cookie httpOnly (token UUID stocké en DB, révocable)
- Rate-limit basique sur le login (par IP + email)
- Dependencies FastAPI : `get_current_user`, `require_admin`

Aucune dépendance externe (pas d'email, pas de JWT, pas de Redis) — adapté
au déploiement self-hosted minimaliste.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import pyotp
import qrcode
import bcrypt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Cookie, Depends, HTTPException, Request, status

import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
SESSION_COOKIE_NAME = 'sqm_session'
SESSION_LIFETIME_DAYS = 14            # sessions web : 14 jours glissants
CHALLENGE_LIFETIME_MINUTES = 5        # entre étape 1 et étape 2
TOTP_ISSUER = 'SQM Nightwatch'

RATE_LIMIT_MAX_FAILURES = 5           # max d'échecs / fenêtre
RATE_LIMIT_WINDOW_MIN = 15

# NB : on utilise désormais directement la lib `bcrypt` (recommandation
# officielle 2024+). Passlib a un bug connu avec bcrypt >= 4.0
# (`detect_wrap_bug` plante au premier hash) et n'est plus maintenu
# depuis 2020. La lib `bcrypt` est plus simple, plus rapide et n'a aucun
# bug de ce genre.

# ---------------------------------------------------------------------------
# Fernet : chiffre les secrets TOTP au repos
# ---------------------------------------------------------------------------
def _derive_fernet_key(secret: str) -> bytes:
    """Dérive une clé Fernet (32 bytes URL-safe b64) depuis n'importe quelle
    chaîne raisonnablement entropique. SHA-256 + b64url.
    """
    digest = hashlib.sha256(secret.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest)


_AUTH_SECRET = os.environ.get('AUTH_SECRET_KEY', '').strip()
if not _AUTH_SECRET:
    # On utilise la SQM_API_KEY comme fallback : déjà persistée dans .env,
    # haute entropie (>= 32 octets URL-safe). Évite de devoir gérer une 2e clé.
    _AUTH_SECRET = os.environ.get('SQM_API_KEY', '').strip() or 'CHANGE_ME_INSECURE'
    if _AUTH_SECRET == 'CHANGE_ME_INSECURE':
        logger.warning(
            'AUTH_SECRET_KEY non configurée — chiffrement TOTP affaibli.'
        )

_FERNET = Fernet(_derive_fernet_key(_AUTH_SECRET))


def encrypt_secret(plain: str) -> str:
    return _FERNET.encrypt(plain.encode('utf-8')).decode('utf-8')


def decrypt_secret(token: str) -> Optional[str]:
    if not token:
        return None
    try:
        return _FERNET.decrypt(token.encode('utf-8')).decode('utf-8')
    except InvalidToken:
        logger.error('decrypt_secret: invalid Fernet token')
        return None


# ---------------------------------------------------------------------------
# Hash mot de passe (bcrypt direct, sans passlib)
# ---------------------------------------------------------------------------
# bcrypt impose une limite stricte de 72 bytes sur le mot de passe (limitation
# historique de l'algorithme). On tronque proprement à 72 bytes UTF-8 côté
# hash ET côté vérification (pour rester cohérent), sans casser les caractères
# multi-bytes (accents, emojis…). Convention courante (Django, fastapi-users).
BCRYPT_MAX_BYTES = 72


def _bcrypt_payload(plain: str) -> bytes:
    """Renvoie le mot de passe encodé UTF-8 et tronqué à 72 bytes.
    Gère proprement les caractères multi-bytes (ne coupe pas un accent en deux).
    """
    raw = plain.encode("utf-8")
    if len(raw) <= BCRYPT_MAX_BYTES:
        return raw
    # On tronque, puis on re-decode/re-encode pour éliminer les bytes orphelins
    return raw[:BCRYPT_MAX_BYTES].decode("utf-8", errors="ignore").encode("utf-8")


def hash_password(plain: str) -> str:
    """Génère un hash bcrypt (cost=12 par défaut)."""
    return bcrypt.hashpw(_bcrypt_payload(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        if not hashed:
            return False
        return bcrypt.checkpw(_bcrypt_payload(plain), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# TOTP helpers
# ---------------------------------------------------------------------------
def generate_totp_secret() -> str:
    """Renvoie un secret TOTP base32 (160 bits)."""
    return pyotp.random_base32(length=32)


def totp_provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(
        name=email, issuer_name=TOTP_ISSUER,
    )


def totp_qr_png_b64(uri: str) -> str:
    """Renvoie le QR code PNG encodé en base64 (sans préfixe data:)."""
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('ascii')


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    # `valid_window=1` : tolère ±30s de dérive d'horloge
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _session_expiry_iso() -> str:
    return (_now_utc() + timedelta(days=SESSION_LIFETIME_DAYS)).isoformat()


def _challenge_expiry_iso() -> str:
    return (
        _now_utc() + timedelta(minutes=CHALLENGE_LIFETIME_MINUTES)
    ).isoformat()


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def new_challenge_id() -> str:
    return secrets.token_urlsafe(32)


def _cookie_secure_flag() -> bool:
    """En prod (NGINX HTTPS), on veut Secure. En dev local : non."""
    return os.environ.get('COOKIE_SECURE', '1') not in ('0', 'false', 'False', '')


def set_session_cookie(response, token: str) -> None:
    max_age = SESSION_LIFETIME_DAYS * 24 * 3600
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite='lax',
        secure=_cookie_secure_flag(),
        path='/',
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path='/',
        samesite='lax',
        secure=_cookie_secure_flag(),
        httponly=True,
    )


async def create_user_session(
    user_id: int, *, ip: Optional[str] = None, ua: Optional[str] = None,
) -> str:
    token = new_session_token()
    await db.create_session(
        token, user_id, _session_expiry_iso(), ip=ip, user_agent=ua,
    )
    return token


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
async def check_rate_limit(email: Optional[str], ip: Optional[str]) -> None:
    failures = await db.count_recent_failed_attempts(
        email, ip, window_minutes=RATE_LIMIT_WINDOW_MIN,
    )
    if failures >= RATE_LIMIT_MAX_FAILURES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f'Trop de tentatives échouées ({failures}). '
                f'Réessayez dans {RATE_LIMIT_WINDOW_MIN} minutes.'
            ),
        )


# ---------------------------------------------------------------------------
# Dependencies FastAPI
# ---------------------------------------------------------------------------
async def get_current_user(
    sqm_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Optional[dict]:
    """Renvoie l'utilisateur courant (dict) ou None — ne lève PAS."""
    if not sqm_session:
        return None
    sess = await db.get_session(sqm_session)
    if not sess:
        return None
    user = await db.get_user_by_id(sess['user_id'])
    if not user or not user.get('is_active'):
        return None
    return user


async def require_user(
    user: Optional[dict] = Depends(get_current_user),
) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail='Authentification requise.')
    return user


async def require_admin(
    user: Optional[dict] = Depends(get_current_user),
) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail='Authentification requise.')
    if not user.get('is_admin'):
        raise HTTPException(status_code=403, detail='Privilèges administrateur requis.')
    return user


async def require_admin_or_api_key(
    request: Request,
    user: Optional[dict] = Depends(get_current_user),
) -> dict:
    """Accepte soit une session admin (cookie), soit la X-API-Key existante.
    Permet de garder la compatibilité avec les scripts/CI/admin cleanup
    historique pendant la migration.
    """
    # 1) session admin
    if user and user.get('is_admin'):
        return user
    # 2) fallback X-API-Key
    api_key = request.headers.get('x-api-key') or request.headers.get('X-API-Key')
    expected = os.environ.get('SQM_API_KEY', '')
    if api_key and expected and secrets.compare_digest(api_key, expected):
        return {'id': 0, 'email': 'api-key', 'is_admin': True, '_via': 'api_key'}
    raise HTTPException(status_code=401, detail='Authentification administrateur requise.')


# ---------------------------------------------------------------------------
# Helpers HTTP
# ---------------------------------------------------------------------------
def client_ip(request: Request) -> Optional[str]:
    """Retourne l'IP du client (gère X-Forwarded-For derrière NGINX)."""
    xff = request.headers.get('x-forwarded-for')
    if xff:
        return xff.split(',')[0].strip()
    return request.client.host if request.client else None


def client_ua(request: Request) -> Optional[str]:
    ua = request.headers.get('user-agent', '')
    return ua[:255] if ua else None


# ---------------------------------------------------------------------------
# Seed admin au boot
# ---------------------------------------------------------------------------
async def seed_admin_if_needed() -> Optional[dict]:
    """Si la table users est vide et que ADMIN_EMAIL + ADMIN_PASSWORD sont
    fournis, crée un compte admin initial. Idempotent : ne fait rien si un
    utilisateur existe déjà.
    """
    total = await db.count_users()
    if total > 0:
        return None
    email = (os.environ.get('ADMIN_EMAIL') or '').strip()
    password = os.environ.get('ADMIN_PASSWORD') or ''
    if not email or not password:
        logger.warning(
            'Aucun utilisateur en base et ADMIN_EMAIL/ADMIN_PASSWORD non '
            'configurés — créez un admin via /api/auth/setup ou les envs.'
        )
        return None
    pwd_hash = hash_password(password)
    uid = await db.create_user(
        email=email,
        password_hash=pwd_hash,
        display_name='Administrateur',
        is_admin=True,
        must_change_password=True,
    )
    logger.info(f'Admin seed créé : {email} (id={uid}). Mot de passe à changer à la 1ère connexion.')
    return {'id': uid, 'email': email}
