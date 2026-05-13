#!/usr/bin/env bash
# enable-http3.sh — Active HTTP/3 (QUIC) sur le vhost nginx existant.
#
# À LANCER APRÈS que `install.sh` a terminé avec succès et que certbot a
# émis le certificat. Ne PAS l'utiliser avant — il référence des fichiers
# TLS qui doivent déjà exister.
#
# Usage : sudo bash deploy/enable-http3.sh
set -euo pipefail

# ---- VARIABLES PAR DÉFAUT (surchargées par deploy/.env.local si présent) ---
DOMAIN="sqm.example.com"
INSTALL_DIR="/opt/sqm-nightwatch"
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
  echo "!! Créez deploy/.env.local :"
  echo "   cp $SCRIPT_DIR/env.local.example $SCRIPT_DIR/.env.local"
  echo "   nano $SCRIPT_DIR/.env.local"
  exit 1
fi

# 1. Vérifier que nginx supporte HTTP/3
if ! nginx -V 2>&1 | grep -q "with-http_v3_module"; then
  echo "!! Votre nginx n'a pas été compilé avec --with-http_v3_module"
  echo "!! Solutions :"
  echo "   - Debian 13 / Ubuntu 24.04 : déjà OK avec le paquet nginx (>=1.25)"
  echo "   - Sinon : utiliser le repo officiel nginx mainline"
  echo "     https://nginx.org/en/linux_packages.html"
  exit 1
fi
echo "==> nginx supporte HTTP/3 ✓"

# 2. Vérifier que le certificat existe
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "!! Certificat manquant : /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  echo "!! Lancez d'abord : sudo bash deploy/install.sh"
  exit 1
fi
echo "==> Certificat trouvé pour $DOMAIN ✓"

# 3. Backup du vhost actuel
BAK="/etc/nginx/sites-available/sqm-nightwatch.conf.bak.$(date +%s)"
cp /etc/nginx/sites-available/sqm-nightwatch.conf "$BAK"
echo "==> Backup du vhost existant : $BAK"

# 4. Installer la version HTTP/3
sed "s/sqm.example.com/$DOMAIN/g" "$INSTALL_DIR/deploy/nginx-sqm-nightwatch-http3.conf" \
  > /etc/nginx/sites-available/sqm-nightwatch.conf

# 4.b Multi-vhost : si un AUTRE vhost déjà activé utilise `quic reuseport`
#     sur le port 443, supprimer `reuseport` du nôtre pour éviter
#     `nginx: emerg: duplicate listen options for 0.0.0.0:443`.
#     (nginx n'autorise `reuseport` que sur UN seul server block par
#      couple adresse:port à travers TOUS les vhosts.)
OTHER_QUIC=$(grep -lE 'listen[[:space:]]+(\[::\]:)?443[[:space:]]+quic[[:space:]]+reuseport' \
  /etc/nginx/sites-enabled/*.conf 2>/dev/null \
  | grep -v 'sqm-nightwatch\.conf$' || true)

if [ -n "$OTHER_QUIC" ]; then
  echo "==> Détection : un autre vhost utilise déjà 'quic reuseport' sur :443"
  echo "    $OTHER_QUIC"
  echo "==> Suppression de 'reuseport' dans notre vhost (compat multi-site)"
  sed -i -E 's/(listen[[:space:]]+(\[::\]:)?443[[:space:]]+quic)[[:space:]]+reuseport;/\1;/g' \
    /etc/nginx/sites-available/sqm-nightwatch.conf
fi

# 4.c Sécurité supplémentaire : si options-ssl-nginx.conf définit déjà
#     ssl_protocols (cas par défaut avec certbot), on retire toute
#     ligne ssl_protocols résiduelle de notre vhost pour éviter le
#     warning "duplicate value".
if [ -f /etc/letsencrypt/options-ssl-nginx.conf ] \
   && grep -q "^ssl_protocols" /etc/letsencrypt/options-ssl-nginx.conf; then
  sed -i -E '/^[[:space:]]*ssl_protocols[[:space:]]+TLSv/d' \
    /etc/nginx/sites-available/sqm-nightwatch.conf
fi

# 5. Tester
if ! nginx -t; then
  echo "!! nginx -t a échoué. Restauration du backup."
  cp "$BAK" /etc/nginx/sites-available/sqm-nightwatch.conf
  exit 1
fi

# 6. Reload
systemctl reload nginx
echo "==> nginx reloadé avec HTTP/3 activé ✓"

# 7. Pare-feu : ouvrir UDP/443
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 443/udp comment "HTTP/3 QUIC" || true
  echo "==> ufw : UDP/443 autorisé"
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --add-port=443/udp --permanent
  firewall-cmd --reload
  echo "==> firewalld : UDP/443 autorisé"
else
  echo "!! Pensez à autoriser UDP/443 sur votre pare-feu (HTTP/3 = UDP)."
  echo "   Exemple iptables :  iptables -A INPUT -p udp --dport 443 -j ACCEPT"
fi

echo
echo "================ HTTP/3 ACTIVÉ ================"
echo "  Test ligne de commande (curl >= 7.88) :"
echo "    curl --http3-only -I https://$DOMAIN"
echo
echo "  Test navigateur (Chrome/Firefox récents) :"
echo "    DevTools > Network > colonne 'Protocol' doit afficher 'h3'"
echo "    (parfois 'h2' au 1er chargement puis 'h3' au refresh, c'est normal :"
echo "     le client a besoin de l'en-tête Alt-Svc reçu en HTTP/2 pour basculer)"
echo
echo "  Diag en ligne :"
echo "    https://http3check.net/?host=$DOMAIN"
echo "==============================================="
