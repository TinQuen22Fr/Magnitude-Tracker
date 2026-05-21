"""
invitation_routes.py — Endpoints /api/invitations/* et /api/admin/invitations/*
(Phase 6).

Flux fonctionnel :
  1. Visiteur public  : POST /api/invitations/request   (formulaire de demande)
  2. Admin notifi\u00e9   : GET  /api/admin/invitations      (liste des demandes)
  3. Admin d\u00e9cide   : POST /api/admin/invitations/{id}/accept|reject
  4. User cliquant le lien email :
        GET  /api/invitations/{token}/check               (valide encore ?)
        POST /api/invitations/{token}/setup               (choisit mot de passe)
  5. \u2192 Compte activ\u00e9, redirection vers /login dans le frontend.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator

import auth
import db
import emailer

logger = logging.getLogger(__name__)

router = APIRouter(tags=['invitations'])

INVITATION_TOKEN_TTL_HOURS = int(
    os.environ.get('INVITATION_TOKEN_TTL_HOURS', '48') or '48'
)

# Rate-limit basique : max N demandes / IP / heure (anti-spam minimal)
_REQUEST_RATE_MAX = 3
_REQUEST_RATE_WINDOW_MIN = 60


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class InvitationRequestBody(BaseModel):
    email: EmailStr
    display_name: Optional[str] = Field(default=None, max_length=80)
    # Motivation OBLIGATOIRE (min 50 caract\u00e8res apr\u00e8s strip) : permet de
    # filtrer les demandes vides ou non s\u00e9rieuses avant m\u00eame de solliciter
    # l'admin. 50 caract\u00e8res \u2248 une vraie phrase de 10-15 mots.
    motivation: str = Field(min_length=50, max_length=1000)
    # Honeypot anti-bot : ce champ doit toujours \u00eatre vide. S'il est rempli,
    # on "accepte" la demande silencieusement sans rien faire pour ne pas
    # alerter le bot.
    website: Optional[str] = Field(default=None, max_length=200)

    @field_validator('motivation')
    @classmethod
    def _strip_motivation(cls, v: str) -> str:
        # Rejette les motivations qui ne sont QUE des espaces/retours ligne.
        # Sinon "          50 espaces          " passerait le min_length=50.
        stripped = (v or '').strip()
        if len(stripped) < 50:
            raise ValueError(
                'La motivation doit contenir au moins 50 caract\u00e8res '
                'significatifs (hors espaces).'
            )
        return stripped


class InvitationDecisionBody(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class InvitationSetupBody(BaseModel):
    password: str = Field(min_length=10, max_length=256)
    display_name: Optional[str] = Field(default=None, max_length=80)


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _token_expiry_iso(hours: int = INVITATION_TOKEN_TTL_HOURS) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _new_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def _public(inv: dict) -> dict:
    """Strippe les champs sensibles (token brut) avant exposition front."""
    if not inv:
        return {}
    safe = dict(inv)
    safe.pop('invitation_token', None)
    return safe


# ---------------------------------------------------------------------------
# Public : POST /api/invitations/request
# ---------------------------------------------------------------------------
@router.post('/invitations/request')
async def request_invitation(
    body: InvitationRequestBody,
    request: Request,
):
    """Endpoint public de demande d'acc\u00e8s. Pas d'auth."""
    # 1) Honeypot : si le bot a rempli le champ "website", on simule un succ\u00e8s
    if body.website and body.website.strip():
        logger.info(f'Honeypot triggered (IP={auth.client_ip(request)})')
        return {'status': 'received'}

    email = body.email.lower().strip()
    ip = auth.client_ip(request)

    # 2) Rate limit IP (3 demandes / heure max)
    recent = await db.count_recent_invitation_requests(
        ip=ip, window_minutes=_REQUEST_RATE_WINDOW_MIN,
    )
    if recent >= _REQUEST_RATE_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f'Trop de demandes envoy\u00e9es ({recent}). '
                f'R\u00e9essayez dans 1 heure.'
            ),
        )

    # 3) V\u00e9rifie qu'aucun compte existant ni demande pending sur ce mail
    existing_user = await db.get_user_by_email(email)
    if existing_user:
        # On ne r\u00e9v\u00e8le pas qu'un compte existe d\u00e9j\u00e0 (anti-\u00e9num\u00e9ration),
        # on renvoie un "succ\u00e8s" g\u00e9n\u00e9rique. L'utilisateur l\u00e9gitime saura
        # qu'il a un compte (mot de passe oubli\u00e9 \u00e0 venir).
        logger.info(f'Invitation request: email already has account ({email})')
        return {'status': 'received'}

    pending = await db.get_invitation_by_email(email, status_filter='pending')
    if pending:
        # On consid\u00e8re comme idempotent
        return {'status': 'received', 'already_pending': True}

    # 4) Cr\u00e9e la demande
    inv_id = await db.create_invitation_request(
        email=email,
        display_name=(body.display_name or '').strip() or None,
        motivation=(body.motivation or '').strip() or None,
        ip_address=ip,
    )

    # 5) Envoie les 2 emails en best-effort (ne PAS bloquer si \u00e9chec)
    try:
        await emailer.send_invitation_request_received(
            to_email=email, display_name=body.display_name,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f'Confirmation email failed (non-blocking): {exc}')

    # Notifie l'admin (le premier user is_admin=1 trouv\u00e9)
    try:
        admins = await db.list_admin_emails()
        for admin_email in admins:
            await emailer.send_admin_new_request_notification(
                admin_email=admin_email,
                requester_email=email,
                requester_name=body.display_name,
                motivation=body.motivation,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f'Admin notification email failed (non-blocking): {exc}')

    logger.info(f'Invitation request created: id={inv_id} email={email}')
    return {'status': 'received'}


# ---------------------------------------------------------------------------
# Admin : GET /api/admin/invitations
# ---------------------------------------------------------------------------
@router.get('/admin/invitations')
async def list_invitations(
    status: Optional[str] = None,
    _admin: dict = Depends(auth.require_admin),
):
    """Liste les demandes d'invitation (admin uniquement).

    `status` : pending | accepted | rejected | activated | None (toutes).
    """
    rows = await db.list_invitations(status_filter=status)
    return {
        'invitations': [_public(r) for r in rows],
        'count': len(rows),
        'token_ttl_hours': INVITATION_TOKEN_TTL_HOURS,
    }


# ---------------------------------------------------------------------------
# Admin : POST /api/admin/invitations/{id}/accept
# ---------------------------------------------------------------------------
@router.post('/admin/invitations/{inv_id}/accept')
async def accept_invitation(
    inv_id: int,
    body: InvitationDecisionBody,
    admin: dict = Depends(auth.require_admin),
):
    inv = await db.get_invitation_by_id(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail='Demande introuvable.')
    if inv['status'] not in ('pending',):
        raise HTTPException(
            status_code=400,
            detail=f'Demande d\u00e9j\u00e0 trait\u00e9e (statut={inv["status"]}).',
        )

    token = _new_invitation_token()
    expires_at = _token_expiry_iso()
    await db.update_invitation_status(
        inv_id=inv_id,
        status='accepted',
        invitation_token=token,
        token_expires_at=expires_at,
        reviewed_by_user_id=admin['id'],
        reviewer_notes=body.notes,
    )

    # Envoi du mail "approuv\u00e9" avec le lien de setup. Si \u00e9chec, on log mais
    # on garde la demande comme accepted (l'admin pourra renvoyer manuellement).
    sent = await emailer.send_invitation_approved(
        to_email=inv['email'],
        display_name=inv.get('display_name'),
        setup_token=token,
        ttl_hours=INVITATION_TOKEN_TTL_HOURS,
    )
    if not sent.ok:
        logger.error(
            f'send_invitation_approved failed for {inv["email"]}: {sent.error}'
        )

    return {
        'status': 'accepted',
        'email_sent': sent.ok,
        'email_provider': sent.provider,
        'email_error': sent.error,
        'setup_token': token,        # expos\u00e9 \u00e0 l'admin pour debug/copy-paste
        'expires_at': expires_at,
    }


# ---------------------------------------------------------------------------
# Admin : POST /api/admin/invitations/{id}/reject
# ---------------------------------------------------------------------------
@router.post('/admin/invitations/{inv_id}/reject')
async def reject_invitation(
    inv_id: int,
    body: InvitationDecisionBody,
    admin: dict = Depends(auth.require_admin),
):
    inv = await db.get_invitation_by_id(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail='Demande introuvable.')
    if inv['status'] not in ('pending',):
        raise HTTPException(
            status_code=400,
            detail=f'Demande d\u00e9j\u00e0 trait\u00e9e (statut={inv["status"]}).',
        )

    await db.update_invitation_status(
        inv_id=inv_id,
        status='rejected',
        reviewed_by_user_id=admin['id'],
        reviewer_notes=body.notes,
    )
    sent = await emailer.send_invitation_rejected(
        to_email=inv['email'],
        display_name=inv.get('display_name'),
        reason=body.notes,
    )
    return {
        'status': 'rejected',
        'email_sent': sent.ok,
        'email_provider': sent.provider,
    }


# ---------------------------------------------------------------------------
# Admin : DELETE /api/admin/invitations/{id} (purge demande)
# ---------------------------------------------------------------------------
@router.delete('/admin/invitations/{inv_id}')
async def delete_invitation(
    inv_id: int,
    _admin: dict = Depends(auth.require_admin),
):
    inv = await db.get_invitation_by_id(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail='Demande introuvable.')
    await db.delete_invitation(inv_id)
    return {'status': 'deleted', 'id': inv_id}


# ---------------------------------------------------------------------------
# Public : GET /api/invitations/{token}/check
# ---------------------------------------------------------------------------
@router.get('/invitations/{token}/check')
async def check_invitation_token(token: str):
    """V\u00e9rifie si un token est encore valide (non expir\u00e9, non utilis\u00e9)."""
    inv = await db.get_invitation_by_token(token)
    if not inv:
        return {'valid': False, 'reason': 'not_found'}
    if inv['status'] == 'activated':
        return {'valid': False, 'reason': 'already_used'}
    if inv['status'] != 'accepted':
        return {'valid': False, 'reason': 'invalid_status'}
    if inv.get('token_expires_at'):
        try:
            exp = datetime.fromisoformat(
                inv['token_expires_at'].replace('Z', '+00:00'),
            )
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                return {'valid': False, 'reason': 'expired'}
        except Exception:
            return {'valid': False, 'reason': 'malformed_expiry'}
    return {
        'valid': True,
        'email': inv['email'],
        'display_name': inv.get('display_name'),
        'expires_at': inv.get('token_expires_at'),
    }


# ---------------------------------------------------------------------------
# Public : POST /api/invitations/{token}/setup
# ---------------------------------------------------------------------------
@router.post('/invitations/{token}/setup')
async def setup_invitation_account(
    token: str,
    body: InvitationSetupBody,
):
    """Cr\u00e9e le compte utilisateur final \u00e0 partir d'un token accept\u00e9."""
    inv = await db.get_invitation_by_token(token)
    if not inv or inv['status'] != 'accepted':
        raise HTTPException(
            status_code=400, detail='Lien invalide ou d\u00e9j\u00e0 utilis\u00e9.',
        )
    # Expiration
    if inv.get('token_expires_at'):
        try:
            exp = datetime.fromisoformat(
                inv['token_expires_at'].replace('Z', '+00:00'),
            )
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(
                    status_code=400, detail='Lien expir\u00e9.',
                )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail='Lien corrompu.')

    # V\u00e9rifie qu'un compte n'a pas \u00e9t\u00e9 cr\u00e9\u00e9 entre temps
    existing = await db.get_user_by_email(inv['email'])
    if existing:
        raise HTTPException(
            status_code=409,
            detail='Un compte existe d\u00e9j\u00e0 pour cet email.',
        )

    display = (body.display_name or '').strip() or inv.get('display_name')
    pwd_hash = auth.hash_password(body.password)
    user_id = await db.create_user(
        email=inv['email'],
        password_hash=pwd_hash,
        display_name=display,
        is_admin=False,
        must_change_password=False,
    )
    await db.mark_invitation_activated(inv['id'], user_id=user_id)

    logger.info(f'Invitation {inv["id"]} activated \u2192 user_id={user_id}')
    return {
        'status': 'activated',
        'user_id': user_id,
        'email': inv['email'],
    }
