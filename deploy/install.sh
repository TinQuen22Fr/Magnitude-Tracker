#!/usr/bin/env bash
# Installation locale (Debian/Ubuntu) — à lancer en root.
# Adapter le DOMAIN avant de lancer.
set -euo pipefail

# ---- VARIABLES PAR DÉFAUT (surchargées par deploy/.env.local si présent) ---
DOMAIN="sqm.example.com"
REPO_URL="https://github.com/<votre-user>/<votre-repo>.git"
INSTALL_DIR="/opt/sqm-nightwatch"
SERVICE_USER="sqm"
LETSENCRYPT_EMAIL=""   # (optionnel) email pour les notifs Let's Encrypt
# ----------------------------------------------------------------------------

# Charge la config locale si elle existe — survit aux `git pull`
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env.local" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.local"
  echo "==> Config chargée depuis $SCRIPT_DIR/.env.local"
fi

if [ "$DOMAIN" = "sqm.example.com" ]; then
  echo "!! DOMAIN n'a pas été personnalisé."
  echo "!! Créez deploy/.env.local depuis env.local.example et adaptez-le :"
  echo "   cp $SCRIPT_DIR/env.local.example $SCRIPT_DIR/.env.local"
  echo "   nano $SCRIPT_DIR/.env.local"
  exit 1
fi

echo "==> 1. Prérequis système"
apt-get update
apt-get install -y python3 python3-venv python3-pip git curl ca-certificates nginx
# Node + yarn (pour builder le frontend)
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v yarn >/dev/null; then
  npm install -g yarn
fi

echo "==> 2. Utilisateur dédié"
id -u "$SERVICE_USER" >/dev/null 2>&1 || adduser --system --group --home "$INSTALL_DIR" "$SERVICE_USER"

echo "==> 3. Code source"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> 4. Backend (venv + dépendances)"
sudo -u "$SERVICE_USER" python3 -m venv "$INSTALL_DIR/backend/.venv"
sudo -u "$SERVICE_USER" "$INSTALL_DIR/backend/.venv/bin/pip" install --upgrade pip

# Utilise requirements-prod.txt (minimal, sans package Emergent) si présent,
# sinon se rabat sur requirements.txt.
if [ -f "$INSTALL_DIR/backend/requirements-prod.txt" ]; then
  REQ_FILE="$INSTALL_DIR/backend/requirements-prod.txt"
else
  REQ_FILE="$INSTALL_DIR/backend/requirements.txt"
fi
sudo -u "$SERVICE_USER" "$INSTALL_DIR/backend/.venv/bin/pip" install -r "$REQ_FILE"
# Sécurité : s'assurer qu'uvicorn est bien présent
sudo -u "$SERVICE_USER" "$INSTALL_DIR/backend/.venv/bin/pip" install "uvicorn[standard]"

echo "==> 5. .env minimal (la clé API sera générée au 1er lancement)"
if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
  cat > "$INSTALL_DIR/backend/.env" <<EOF
# .env minimal — SQM_API_KEY sera générée auto au 1er démarrage et persistée ici.
# Pas de base MongoDB utilisée : l'API stocke ses données dans backend/sqm_history.json
CORS_ORIGINS="https://$DOMAIN"
EOF
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/backend/.env"
fi

echo "==> 6. Frontend (build statique)"
# Pointe le frontend vers son propre domaine
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR/frontend' && yarn install --frozen-lockfile"
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR/frontend' && REACT_APP_BACKEND_URL='https://$DOMAIN' yarn build"

echo "==> 7. systemd service"
cp "$INSTALL_DIR/deploy/sqm-nightwatch.service" /etc/systemd/system/sqm-nightwatch.service
systemctl daemon-reload
systemctl enable --now sqm-nightwatch

echo "==> 8. nginx vhost (HTTP only — certbot ajoutera le HTTPS)"
install -d /etc/nginx/sites-available /etc/nginx/sites-enabled /var/www/letsencrypt
sed "s/sqm.example.com/$DOMAIN/g" "$INSTALL_DIR/deploy/nginx-sqm-nightwatch.conf" \
  > /etc/nginx/sites-available/sqm-nightwatch.conf
ln -sf /etc/nginx/sites-available/sqm-nightwatch.conf /etc/nginx/sites-enabled/sqm-nightwatch.conf

# Si un ancien vhost cassé (HTTPS avant cert) traîne, on s'assure que nginx -t passe.
if ! nginx -t 2>/dev/null; then
  echo "!! nginx -t a échoué. Affichage du message :"
  nginx -t || true
  echo "!! Vérifiez qu'aucun ancien vhost HTTPS ne référence un cert inexistant."
  echo "!! Astuce : commentez temporairement les directives ssl_certificate* puis relancez."
  exit 1
fi
systemctl reload nginx

echo "==> 9. SSL Let's Encrypt (certbot --nginx)"
if ! command -v certbot >/dev/null; then apt-get install -y certbot python3-certbot-nginx; fi

# certbot --nginx va :
#   - valider le domaine via HTTP-01 (vhost HTTP déjà en place et rechargé)
#   - injecter automatiquement le bloc 443 ssl + la redirection 80->443
#   - gérer le renouvellement auto via certbot.timer
certbot --nginx -d "$DOMAIN" --redirect --keep-until-expiring --non-interactive \
  --agree-tos \
  $( [ -n "$LETSENCRYPT_EMAIL" ] && echo "--email $LETSENCRYPT_EMAIL" || echo "--register-unsafely-without-email" ) \
  || {
    echo "!! certbot a échoué. Vérifiez :"
    echo "   - que $DOMAIN pointe bien sur ce serveur (A/AAAA DNS)"
    echo "   - que le port 80 est ouvert (pare-feu / fournisseur)"
    echo "   - que 'curl http://$DOMAIN/.well-known/acme-challenge/test' renvoie 404 (et pas une autre erreur)"
    exit 1
  }

nginx -t && systemctl reload nginx

echo
echo "================ INSTALL OK ================"
echo "  URL dashboard : https://$DOMAIN"
echo "  Clé API auto-générée (visible dans le .env et les logs) :"
grep '^SQM_API_KEY=' "$INSTALL_DIR/backend/.env" || journalctl -u sqm-nightwatch -n 50 | grep 'X-API-Key'
echo "============================================"
