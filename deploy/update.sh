#!/usr/bin/env bash
# update.sh — Met à jour SQM Nightwatch en place (à lancer en root).
#
# À utiliser après chaque `git pull` ou à la place de install.sh quand on
# veut juste déployer une mise à jour sans toucher à NGINX/Let's Encrypt.
#
# Étapes effectuées :
#   1. Pull de la branche Testing (ou autre via $BRANCH)
#   2. Reprise des droits sqm:sqm sur tout le dossier
#   3. Mise à jour des dépendances backend (pip install)
#   4. Mise à jour des dépendances frontend (yarn install)
#   5. Build du frontend (yarn build)
#   6. Restart du service systemd
#   7. Healthcheck sur l'API
#
# Usage :
#   sudo bash /opt/sqm-nightwatch/deploy/update.sh                    # branche Testing
#   sudo BRANCH=magnitude-tracker-android bash deploy/update.sh       # autre branche
#   sudo SKIP_FRONTEND=1 bash deploy/update.sh                        # backend seul (rapide)

set -euo pipefail

# ---- VARIABLES (alignées sur install.sh, surchargées par .env.local) -------
INSTALL_DIR="/opt/sqm-nightwatch"
SERVICE_USER="sqm"
SERVICE_NAME="sqm-nightwatch"
BRANCH="${BRANCH:-Testing}"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_BACKEND="${SKIP_BACKEND:-0}"
SKIP_PULL="${SKIP_PULL:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env.local" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.local"
fi
# ----------------------------------------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
  echo "!! Ce script doit être lancé en root (sudo bash $0)" >&2
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "!! $INSTALL_DIR n'est pas un dépôt Git. Lance d'abord deploy/install.sh." >&2
  exit 1
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  echo "!! L'utilisateur système '$SERVICE_USER' n'existe pas. Lance install.sh d'abord." >&2
  exit 1
fi

cd "$INSTALL_DIR"

# ── 1. Pull ─────────────────────────────────────────────────────────────────
if [ "$SKIP_PULL" != "1" ]; then
  echo "==> 1/6  git pull (branche $BRANCH)"
  # Important : pull en root pour gérer les permissions, on rétablit ensuite
  git fetch origin
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo "==> 1/6  git pull (skip)"
fi

# ── 2. Permissions ─────────────────────────────────────────────────────────
echo "==> 2/6  Reprise des droits $SERVICE_USER:$SERVICE_USER sur $INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ── 3. Backend ─────────────────────────────────────────────────────────────
if [ "$SKIP_BACKEND" != "1" ]; then
  echo "==> 3/6  Backend : mise à jour des dépendances Python"
  if [ -f "$INSTALL_DIR/backend/requirements-prod.txt" ]; then
    REQ_FILE="$INSTALL_DIR/backend/requirements-prod.txt"
  else
    REQ_FILE="$INSTALL_DIR/backend/requirements.txt"
  fi
  sudo -u "$SERVICE_USER" "$INSTALL_DIR/backend/.venv/bin/pip" install \
    --upgrade pip --quiet
  sudo -u "$SERVICE_USER" "$INSTALL_DIR/backend/.venv/bin/pip" install \
    -r "$REQ_FILE" --quiet
  echo "    -> deps installées depuis $(basename "$REQ_FILE")"
else
  echo "==> 3/6  Backend (skip)"
fi

# ── 4-5. Frontend ──────────────────────────────────────────────────────────
if [ "$SKIP_FRONTEND" != "1" ]; then
  echo "==> 4/6  Frontend : yarn install"
  sudo -u "$SERVICE_USER" bash -c \
    "cd '$INSTALL_DIR/frontend' && yarn install --frozen-lockfile 2>&1 | tail -5"

  # Récupère l'URL backend depuis le service systemd (REACT_APP_BACKEND_URL
  # est compilé dans le bundle React, donc doit refléter le domaine prod)
  BACKEND_URL=""
  if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    BACKEND_URL=$(grep -oP 'REACT_APP_BACKEND_URL=\K[^"\s]+' \
      "/etc/systemd/system/${SERVICE_NAME}.service" 2>/dev/null || true)
  fi
  if [ -z "$BACKEND_URL" ] && [ -f "$INSTALL_DIR/frontend/.env" ]; then
    BACKEND_URL=$(grep -oP 'REACT_APP_BACKEND_URL=\K.+' \
      "$INSTALL_DIR/frontend/.env" 2>/dev/null || true)
  fi
  if [ -z "$BACKEND_URL" ]; then
    # Dernier recours : déduire depuis le vhost NGINX
    BACKEND_URL=$(grep -hroP 'server_name\s+\K[^;\s]+' \
      /etc/nginx/sites-enabled/ 2>/dev/null | grep -v '^_$' | head -1 || true)
    [ -n "$BACKEND_URL" ] && BACKEND_URL="https://$BACKEND_URL"
  fi

  echo "==> 5/6  Frontend : yarn build (REACT_APP_BACKEND_URL=${BACKEND_URL:-non détecté})"
  # Suppression préventive du dossier build pour éviter EACCES si un build
  # précédent a laissé des fichiers root:
  rm -rf "$INSTALL_DIR/frontend/build"
  sudo -u "$SERVICE_USER" bash -c \
    "cd '$INSTALL_DIR/frontend' && REACT_APP_BACKEND_URL='$BACKEND_URL' yarn build 2>&1 | tail -10"
else
  echo "==> 4-5/6  Frontend (skip)"
fi

# ── 6. Restart service ─────────────────────────────────────────────────────
echo "==> 6/6  Restart du service $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "    -> $SERVICE_NAME : actif ✓"
else
  echo "    !! $SERVICE_NAME n'est pas actif. Logs :"
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi

# ── Healthcheck ────────────────────────────────────────────────────────────
echo ""
echo "==> Healthcheck API locale"
if curl -fsS "http://127.0.0.1:8001/api/" >/dev/null 2>&1; then
  echo "    -> /api/ répond ✓"
else
  echo "    !! /api/ ne répond pas en local. Logs récents :"
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager
fi

echo ""
echo "✓ Mise à jour terminée."
git -C "$INSTALL_DIR" log --oneline -1
