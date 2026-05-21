"""
emailer.py — Envoi d'emails transactionnels SQM Nightwatch (Phase 6).

Stratégie : Brevo en primaire (quota gratuit 300 emails/jour), Resend en
fallback si Brevo est down ou refuse. Les deux providers ont des APIs HTTP
JSON très simples, on n'utilise donc PAS de SDK lourd (juste httpx).

Design goals :
- Asynchrone (httpx) pour ne pas bloquer l'event loop FastAPI
- Pas d'exception qui remonte si l'envoi échoue : on log + on renvoie False.
  Les routes appelantes peuvent décider quoi faire (alerte admin, etc.).
- Templates HTML inline avec un fallback texte simple
- Aucun rendu Jinja : on fait des f-strings, suffisant pour 3-4 templates.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration depuis l'environnement (.env chargé au boot du backend)
# ---------------------------------------------------------------------------
# Lecture lazy : on lit les variables d'env à CHAQUE envoi (et pas à
# l'import) car emailer.py est importé via invitation_routes AVANT que
# server.py n'appelle load_dotenv(). Sinon les clés seraient vides.
def _cfg() -> dict:
    return {
        'brevo_key': os.environ.get('BREVO_API_KEY', '').strip(),
        'resend_key': os.environ.get('RESEND_API_KEY', '').strip(),
        'from_email': os.environ.get(
            'INVITATION_FROM_EMAIL', 'no-reply@example.com',
        ).strip(),
        'from_name': os.environ.get(
            'INVITATION_FROM_NAME', 'SQM Nightwatch',
        ).strip(),
        'public_url': os.environ.get(
            'INVITATION_PUBLIC_URL', 'http://localhost:3000',
        ).strip().rstrip('/'),
    }


BREVO_API = 'https://api.brevo.com/v3/smtp/email'
RESEND_API = 'https://api.resend.com/emails'


@dataclass
class SendResult:
    ok: bool
    provider: str               # 'brevo' | 'resend' | 'none'
    message_id: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Provider 1 : Brevo (https://developers.brevo.com/reference/sendtransacemail)
# ---------------------------------------------------------------------------
async def _send_via_brevo(
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
    text: str,
) -> SendResult:
    cfg = _cfg()
    if not cfg['brevo_key']:
        return SendResult(ok=False, provider='brevo', error='BREVO_API_KEY missing')

    payload = {
        'sender': {'name': cfg['from_name'], 'email': cfg['from_email']},
        'to': [{'email': to_email, 'name': to_name or to_email}],
        'subject': subject,
        'htmlContent': html,
        'textContent': text,
    }
    headers = {
        'accept': 'application/json',
        'api-key': cfg['brevo_key'],
        'content-type': 'application/json',
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(BREVO_API, headers=headers, json=payload)
        if 200 <= resp.status_code < 300:
            data = resp.json() if resp.content else {}
            return SendResult(
                ok=True, provider='brevo',
                message_id=data.get('messageId'),
            )
        # Brevo renvoie {code, message} en cas d'erreur
        body = resp.text[:500]
        logger.warning(f'Brevo refusal {resp.status_code}: {body}')
        return SendResult(
            ok=False, provider='brevo',
            error=f'HTTP {resp.status_code}: {body}',
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f'Brevo network error: {exc}')
        return SendResult(ok=False, provider='brevo', error=str(exc))


# ---------------------------------------------------------------------------
# Provider 2 : Resend (https://resend.com/docs/api-reference/emails/send-email)
# ---------------------------------------------------------------------------
async def _send_via_resend(
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
    text: str,
) -> SendResult:
    cfg = _cfg()
    if not cfg['resend_key']:
        return SendResult(ok=False, provider='resend', error='RESEND_API_KEY missing')

    # Resend accepte un format "Name <email@x>" pour le sender
    from_value = (
        f'{cfg["from_name"]} <{cfg["from_email"]}>'
        if cfg['from_name'] else cfg['from_email']
    )
    payload = {
        'from': from_value,
        'to': [to_email],
        'subject': subject,
        'html': html,
        'text': text,
    }
    headers = {
        'Authorization': f'Bearer {cfg["resend_key"]}',
        'Content-Type': 'application/json',
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(RESEND_API, headers=headers, json=payload)
        if 200 <= resp.status_code < 300:
            data = resp.json() if resp.content else {}
            return SendResult(
                ok=True, provider='resend',
                message_id=data.get('id'),
            )
        body = resp.text[:500]
        logger.warning(f'Resend refusal {resp.status_code}: {body}')
        return SendResult(
            ok=False, provider='resend',
            error=f'HTTP {resp.status_code}: {body}',
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f'Resend network error: {exc}')
        return SendResult(ok=False, provider='resend', error=str(exc))


# ---------------------------------------------------------------------------
# Façade publique
# ---------------------------------------------------------------------------
async def send_email(
    to_email: str,
    subject: str,
    html: str,
    text: str,
    to_name: Optional[str] = None,
) -> SendResult:
    """Envoie un email : Brevo d'abord, Resend si Brevo échoue.

    Retourne un SendResult (ok=True/False + provider utilisé). Ne lève
    JAMAIS d'exception : l'envoi d'email est best-effort.
    """
    to_email = (to_email or '').strip().lower()
    if '@' not in to_email:
        return SendResult(ok=False, provider='none', error='invalid recipient')

    # 1) Brevo
    res = await _send_via_brevo(to_email, to_name, subject, html, text)
    if res.ok:
        logger.info(
            f'Email envoyé via Brevo à {to_email} (msg={res.message_id})'
        )
        return res
    logger.info(f'Brevo a échoué ({res.error}) — fallback Resend…')

    # 2) Resend
    res2 = await _send_via_resend(to_email, to_name, subject, html, text)
    if res2.ok:
        logger.info(
            f'Email envoyé via Resend à {to_email} (msg={res2.message_id})'
        )
        return res2

    logger.error(
        f'Envoi email TOTAL échec → {to_email}. '
        f'Brevo: {res.error} | Resend: {res2.error}'
    )
    return SendResult(
        ok=False, provider='none',
        error=f'Brevo: {res.error} | Resend: {res2.error}',
    )


# ---------------------------------------------------------------------------
# Templates (HTML + texte) — design sobre, compatible clients mail (inline CSS)
# ---------------------------------------------------------------------------
_BASE_HTML_STYLE = (
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,'
    'Arial,sans-serif;line-height:1.6;color:#1a1a2e;'
    'background:#f4f4f7;margin:0;padding:24px;'
)
_BASE_CARD_STYLE = (
    'max-width:560px;margin:0 auto;background:#fff;border-radius:16px;'
    'padding:32px;box-shadow:0 8px 24px rgba(0,0,0,.06);'
    'border:1px solid rgba(98,84,243,.08);'
)
_BASE_BUTTON_STYLE = (
    'display:inline-block;background:#6254f3;color:#fff!important;'
    'text-decoration:none;padding:14px 28px;border-radius:12px;'
    'font-weight:600;margin:20px 0;'
)
_FOOTER_STYLE = (
    'color:#7a7a90;font-size:12px;margin-top:32px;'
    'border-top:1px solid #ececf2;padding-top:16px;text-align:center;'
)


def _wrap_html(title: str, body_html: str, public_url: str) -> str:
    return (
        f'<!doctype html><html><body style="{_BASE_HTML_STYLE}">'
        f'<div style="{_BASE_CARD_STYLE}">'
        f'<h2 style="margin:0 0 16px 0;color:#1a1a2e;font-size:22px;">'
        f'\U0001F319 {title}</h2>'
        f'{body_html}'
        f'<div style="{_FOOTER_STYLE}">'
        f'SQM Nightwatch — observation de la qualit\u00e9 du ciel<br/>'
        f'<a href="{public_url}" style="color:#6254f3;text-decoration:none;">'
        f'{public_url}</a>'
        f'</div></div></body></html>'
    )


async def send_invitation_request_received(
    to_email: str, display_name: Optional[str],
) -> SendResult:
    """Email envoy\u00e9 \u00e0 l'utilisateur APR\u00c8S sa demande d'acc\u00e8s
    (confirmation de prise en compte)."""
    name = display_name or to_email.split('@')[0]
    public_url = _cfg()['public_url']
    subject = 'Demande re\u00e7ue \u2014 SQM Nightwatch'
    body_html = (
        f'<p>Bonjour {name},</p>'
        f'<p>Nous avons bien re\u00e7u votre demande d\'acc\u00e8s \u00e0 '
        f'<strong>SQM Nightwatch</strong>, le dashboard d\'observation '
        f'astronomique de Quentin.</p>'
        f'<p>Un administrateur va l\'examiner sous peu. Vous recevrez un '
        f'nouveau message d\u00e8s qu\'elle aura \u00e9t\u00e9 trait\u00e9e '
        f'(g\u00e9n\u00e9ralement sous 24h).</p>'
        f'<p>En attendant, vous pouvez consulter le dashboard public sur '
        f'<a href="{public_url}" style="color:#6254f3;">{public_url}</a>.</p>'
        f'<p>\u00c0 tr\u00e8s vite sous les \u00e9toiles \u2728</p>'
    )
    text = (
        f'Bonjour {name},\n\n'
        f'Nous avons bien re\u00e7u votre demande d\'acc\u00e8s \u00e0 '
        f'SQM Nightwatch. Un administrateur va l\'examiner sous peu '
        f'(g\u00e9n\u00e9ralement sous 24h).\n\n'
        f'Dashboard public : {public_url}\n\n'
        f'\u00c0 bient\u00f4t,\nL\'\u00e9quipe SQM Nightwatch'
    )
    return await send_email(
        to_email, subject, _wrap_html('Demande re\u00e7ue', body_html, public_url),
        text, to_name=name,
    )


async def send_invitation_approved(
    to_email: str, display_name: Optional[str], setup_token: str,
    ttl_hours: int = 48,
) -> SendResult:
    name = display_name or to_email.split('@')[0]
    public_url = _cfg()['public_url']
    setup_url = f'{public_url}/setup-account?token={setup_token}'
    subject = 'Votre acc\u00e8s SQM Nightwatch a \u00e9t\u00e9 valid\u00e9 \u2728'
    body_html = (
        f'<p>Bonjour {name},</p>'
        f'<p>Excellente nouvelle : votre demande d\'acc\u00e8s a \u00e9t\u00e9 '
        f'<strong>approuv\u00e9e</strong>. Il ne reste plus qu\'\u00e0 '
        f'choisir votre mot de passe pour activer votre compte.</p>'
        f'<p style="text-align:center;">'
        f'<a href="{setup_url}" style="{_BASE_BUTTON_STYLE}">'
        f'Finaliser mon compte</a></p>'
        f'<p style="font-size:13px;color:#7a7a90;">'
        f'Ce lien est valable {ttl_hours} heures. Pass\u00e9 ce d\u00e9lai, '
        f'vous devrez refaire une demande.</p>'
        f'<p style="font-size:13px;color:#7a7a90;word-break:break-all;">'
        f'Si le bouton ne fonctionne pas, copiez ce lien :<br/>'
        f'<a href="{setup_url}" style="color:#6254f3;">{setup_url}</a></p>'
        f'<p>Bonnes observations,<br/>Quentin</p>'
    )
    text = (
        f'Bonjour {name},\n\n'
        f'Votre demande d\'acc\u00e8s \u00e0 SQM Nightwatch a \u00e9t\u00e9 '
        f'approuv\u00e9e.\n\nFinalisez votre compte ici (valable {ttl_hours}h) :\n'
        f'{setup_url}\n\nBonnes observations,\nQuentin'
    )
    return await send_email(
        to_email, subject, _wrap_html('Acc\u00e8s approuv\u00e9', body_html, public_url),
        text, to_name=name,
    )


async def send_invitation_rejected(
    to_email: str, display_name: Optional[str], reason: Optional[str] = None,
) -> SendResult:
    name = display_name or to_email.split('@')[0]
    public_url = _cfg()['public_url']
    subject = 'Concernant votre demande SQM Nightwatch'
    reason_html = (
        f'<p style="background:#fef2f2;border-left:3px solid #f87171;'
        f'padding:12px 16px;border-radius:8px;"><em>{reason}</em></p>'
        if reason else ''
    )
    body_html = (
        f'<p>Bonjour {name},</p>'
        f'<p>Nous vous remercions pour votre int\u00e9r\u00eat envers SQM '
        f'Nightwatch. Apr\u00e8s examen, votre demande d\'acc\u00e8s n\'a '
        f'malheureusement pas pu \u00eatre accept\u00e9e pour le moment.</p>'
        f'{reason_html}'
        f'<p>Le dashboard public reste accessible \u00e0 tous sur '
        f'<a href="{public_url}" style="color:#6254f3;">{public_url}</a>.</p>'
        f'<p>Ciel clair,<br/>Quentin</p>'
    )
    text = (
        f'Bonjour {name},\n\n'
        f'Votre demande d\'acc\u00e8s \u00e0 SQM Nightwatch n\'a pas pu '
        f'\u00eatre accept\u00e9e.'
        + (f'\n\nMotif : {reason}' if reason else '') +
        f'\n\nDashboard public : {public_url}\n\nCiel clair,\nQuentin'
    )
    return await send_email(
        to_email, subject, _wrap_html('Demande non retenue', body_html, public_url),
        text, to_name=name,
    )


async def send_admin_new_request_notification(
    admin_email: str, requester_email: str, requester_name: Optional[str],
    motivation: Optional[str],
) -> SendResult:
    """Notifie l'admin qu'une nouvelle demande est en attente."""
    public_url = _cfg()['public_url']
    subject = f'Nouvelle demande d\'acc\u00e8s : {requester_email}'
    motiv = (
        f'<p><strong>Motivation :</strong></p>'
        f'<blockquote style="background:#f4f4f7;border-left:3px solid #6254f3;'
        f'padding:12px 16px;margin:8px 0;border-radius:8px;">{motivation}'
        f'</blockquote>'
        if motivation else '<p><em>Aucune motivation fournie.</em></p>'
    )
    review_url = f'{public_url}/settings#invitations'
    body_html = (
        f'<p>Une nouvelle demande d\'acc\u00e8s vient d\'arriver :</p>'
        f'<ul style="line-height:2;">'
        f'<li><strong>Email :</strong> {requester_email}</li>'
        f'<li><strong>Nom :</strong> {requester_name or "(non fourni)"}</li>'
        f'</ul>'
        f'{motiv}'
        f'<p style="text-align:center;">'
        f'<a href="{review_url}" style="{_BASE_BUTTON_STYLE}">'
        f'Examiner la demande</a></p>'
    )
    text = (
        f'Nouvelle demande d\'acc\u00e8s SQM Nightwatch :\n'
        f'Email : {requester_email}\n'
        f'Nom : {requester_name or "(non fourni)"}\n'
        + (f'Motivation : {motivation}\n' if motivation else '') +
        f'\nExaminer : {review_url}'
    )
    return await send_email(
        admin_email, subject, _wrap_html('Nouvelle demande', body_html, public_url),
        text,
    )
