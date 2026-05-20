"""
auth_routes.py — Endpoints /api/auth/* (Phase 5).

Tous les endpoints renvoient/consomment du JSON.
La session est portée par un cookie httpOnly `sqm_session`.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

import auth
import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/auth', tags=['auth'])


# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    status: str               # 'logged_in' | '2fa_required'
    requires_2fa: bool = False
    challenge_id: Optional[str] = None
    must_change_password: bool = False
    user: Optional[dict] = None


class TwoFactorVerifyRequest(BaseModel):
    challenge_id: str
    code: str = Field(min_length=6, max_length=8)


class TotpSetupRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class TotpConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class TotpDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    code: str = Field(min_length=6, max_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


# ---------------------------------------------------------------------------
# /me
# ---------------------------------------------------------------------------
@router.get('/me')
async def me(user: Optional[dict] = Depends(auth.get_current_user)):
    if not user:
        return {'authenticated': False}
    return {
        'authenticated': True,
        'user': db.user_to_public(user),
    }


# ---------------------------------------------------------------------------
# /login (étape 1) — email + password
# ---------------------------------------------------------------------------
@router.post('/login', response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
):
    ip = auth.client_ip(request)
    ua = auth.client_ua(request)
    await auth.check_rate_limit(body.email, ip)

    user = await db.get_user_by_email(body.email)
    pwd_ok = False
    if user and user.get('password_hash'):
        pwd_ok = auth.verify_password(body.password, user['password_hash'])

    if not user or not pwd_ok or not user.get('is_active'):
        await db.record_login_attempt(body.email, ip, success=False)
        # Message volontairement vague pour ne pas distinguer email/password
        raise HTTPException(status_code=401, detail='Identifiants invalides.')

    # Si TOTP activé → on émet un challenge et on demande l'étape 2
    if user.get('totp_enabled'):
        cid = auth.new_challenge_id()
        await db.create_challenge(
            cid, user['id'], auth._challenge_expiry_iso(),
            purpose='2fa', ip=ip, user_agent=ua,
        )
        # On ne marque PAS encore comme success (la 2FA peut échouer)
        return LoginResponse(
            status='2fa_required',
            requires_2fa=True,
            challenge_id=cid,
            must_change_password=bool(user.get('must_change_password')),
        )

    # Sans TOTP (premier login de l'admin par ex) → on connecte direct
    token = await auth.create_user_session(user['id'], ip=ip, ua=ua)
    auth.set_session_cookie(response, token)
    await db.touch_user_login(user['id'])
    await db.record_login_attempt(body.email, ip, success=True)
    return LoginResponse(
        status='logged_in',
        requires_2fa=False,
        must_change_password=bool(user.get('must_change_password')),
        user=db.user_to_public(user),
    )


# ---------------------------------------------------------------------------
# /2fa/verify (étape 2)
# ---------------------------------------------------------------------------
@router.post('/2fa/verify', response_model=LoginResponse)
async def two_factor_verify(
    body: TwoFactorVerifyRequest,
    request: Request,
    response: Response,
):
    ip = auth.client_ip(request)
    ua = auth.client_ua(request)

    chal = await db.get_challenge(body.challenge_id)
    if not chal:
        raise HTTPException(status_code=400, detail='Challenge invalide ou expiré.')
    user = await db.get_user_by_id(chal['user_id'])
    if not user or not user.get('is_active'):
        await db.delete_challenge(body.challenge_id)
        raise HTTPException(status_code=400, detail='Utilisateur invalide.')

    enc_secret = user.get('totp_secret')
    secret = auth.decrypt_secret(enc_secret) if enc_secret else None
    if not secret or not auth.verify_totp(secret, body.code):
        await db.record_login_attempt(user['email'], ip, success=False)
        raise HTTPException(status_code=401, detail='Code 2FA invalide.')

    # OK → consomme le challenge, crée la session, set cookie
    await db.delete_challenge(body.challenge_id)
    token = await auth.create_user_session(user['id'], ip=ip, ua=ua)
    auth.set_session_cookie(response, token)
    await db.touch_user_login(user['id'])
    await db.record_login_attempt(user['email'], ip, success=True)
    return LoginResponse(
        status='logged_in',
        requires_2fa=False,
        must_change_password=bool(user.get('must_change_password')),
        user=db.user_to_public(user),
    )


# ---------------------------------------------------------------------------
# /logout
# ---------------------------------------------------------------------------
@router.post('/logout')
async def logout(
    request: Request,
    response: Response,
):
    token = request.cookies.get(auth.SESSION_COOKIE_NAME)
    if token:
        await db.delete_session(token)
    auth.clear_session_cookie(response)
    return {'status': 'logged_out'}


# ---------------------------------------------------------------------------
# /2fa/totp/setup — génère un secret + QR. Ne l'enregistre PAS comme actif.
# ---------------------------------------------------------------------------
@router.post('/2fa/totp/setup')
async def totp_setup(
    body: TotpSetupRequest,
    user: dict = Depends(auth.require_user),
):
    # Re-auth par mot de passe (sensible)
    if not auth.verify_password(body.password, user['password_hash']):
        raise HTTPException(status_code=401, detail='Mot de passe invalide.')
    if user.get('totp_enabled'):
        raise HTTPException(
            status_code=400,
            detail='TOTP déjà activé. Désactivez-le avant de re-générer.',
        )

    secret = auth.generate_totp_secret()
    # On le stocke chiffré dès maintenant mais on garde `totp_enabled=0`
    enc = auth.encrypt_secret(secret)
    await db.update_user_totp(user['id'], totp_secret=enc, enabled=False)

    uri = auth.totp_provisioning_uri(secret, user['email'])
    qr_b64 = auth.totp_qr_png_b64(uri)
    return {
        'secret': secret,            # à afficher en fallback (saisie manuelle)
        'otpauth_uri': uri,
        'qr_png_base64': qr_b64,     # à intégrer dans <img src="data:image/png;base64,...">
        'issuer': auth.TOTP_ISSUER,
        'label': user['email'],
    }


# ---------------------------------------------------------------------------
# /2fa/totp/confirm — active TOTP après vérification d'un 1er code valide
# ---------------------------------------------------------------------------
@router.post('/2fa/totp/confirm')
async def totp_confirm(
    body: TotpConfirmRequest,
    user: dict = Depends(auth.require_user),
):
    enc = user.get('totp_secret')
    secret = auth.decrypt_secret(enc) if enc else None
    if not secret:
        raise HTTPException(
            status_code=400,
            detail='Aucun setup TOTP en cours. Appelez /setup d\'abord.',
        )
    if not auth.verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail='Code TOTP invalide.')
    await db.update_user_totp(user['id'], enabled=True)
    return {'status': 'enabled'}


# ---------------------------------------------------------------------------
# /2fa/totp/disable — nécessite mot de passe + code TOTP
# ---------------------------------------------------------------------------
@router.post('/2fa/totp/disable')
async def totp_disable(
    body: TotpDisableRequest,
    user: dict = Depends(auth.require_user),
):
    if not auth.verify_password(body.password, user['password_hash']):
        raise HTTPException(status_code=401, detail='Mot de passe invalide.')
    enc = user.get('totp_secret')
    secret = auth.decrypt_secret(enc) if enc else None
    if not secret or not auth.verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail='Code TOTP invalide.')
    await db.update_user_totp(user['id'], totp_secret='', enabled=False)
    return {'status': 'disabled'}


# ---------------------------------------------------------------------------
# /change_password
# ---------------------------------------------------------------------------
@router.post('/change_password')
async def change_password(
    body: ChangePasswordRequest,
    user: dict = Depends(auth.require_user),
):
    if not auth.verify_password(body.current_password, user['password_hash']):
        raise HTTPException(status_code=401, detail='Mot de passe actuel invalide.')
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400,
            detail='Le nouveau mot de passe doit différer de l\'ancien.',
        )
    new_hash = auth.hash_password(body.new_password)
    await db.update_user_password(user['id'], new_hash)
    return {'status': 'password_changed'}
