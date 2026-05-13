# Déploiement SQM Nightwatch sur serveur perso (nginx existant)

Procédure pour héberger l'application sur votre propre serveur Linux
(Debian/Ubuntu) avec un nginx déjà en place.

## Architecture cible

```
  ESP / capteur SQM
        |  HTTPS GET ?ID=...&KEY=...&S=...
        v
  +---------------------+
  |       NGINX         |   :443  TLS (certbot)
  |   votre.domaine.tld |   :80   redirect -> 443
  +----------+----------+
             |
   /api/* -> | proxy_pass http://127.0.0.1:8001
             |
  +----------v----------+
  |  uvicorn (systemd)  |   service sqm-nightwatch
  |  FastAPI server.py  |   écrit /opt/sqm-nightwatch/backend/sqm_history.json
  +---------------------+
             |
             v
        sqm_history.json
```

## Prérequis

- Debian 12 ou Ubuntu 22.04+
- Un domaine (ex: `sqm.example.com`) pointé sur le serveur (A/AAAA)
- nginx + certbot déjà installés (sinon le script les installe)
- Python 3.11+, Node 20+, yarn

## Installation rapide (script)

1. Cloner votre repo sur le serveur :
   ```bash
   sudo git clone https://github.com/<vous>/<repo>.git /opt/sqm-nightwatch
   ```
2. Éditer `/opt/sqm-nightwatch/deploy/install.sh` : remplir `DOMAIN` et `REPO_URL`.
3. Lancer :
   ```bash
   sudo bash /opt/sqm-nightwatch/deploy/install.sh
   ```
4. Le script installe les dépendances, build le frontend, configure systemd + nginx + Let's Encrypt.
5. À la fin, le script affiche votre **clé API** (`SQM_API_KEY`) — à reporter dans votre `Config.h`.

## Installation manuelle (étape par étape)

### 1. Créer un utilisateur dédié
```bash
sudo adduser --system --group --home /opt/sqm-nightwatch sqm
sudo git clone https://github.com/<vous>/<repo>.git /opt/sqm-nightwatch
sudo chown -R sqm:sqm /opt/sqm-nightwatch
```

### 2. Backend (FastAPI + uvicorn)
```bash
cd /opt/sqm-nightwatch/backend
sudo -u sqm python3 -m venv .venv
sudo -u sqm .venv/bin/pip install -U pip
# Utilise requirements-prod.txt (dépendances minimales, sans package Emergent)
sudo -u sqm .venv/bin/pip install -r requirements-prod.txt
sudo -u sqm .venv/bin/pip install "uvicorn[standard]"

# .env minimal (la clé SQM_API_KEY est générée au 1er démarrage)
sudo -u sqm tee .env >/dev/null <<EOF
CORS_ORIGINS="https://votre.domaine.tld"
EOF
```

> **Important** : utilisez bien `requirements-prod.txt` et **pas** `requirements.txt`.
> Ce dernier contient des packages spécifiques à l'environnement Emergent
> (notamment `emergentintegrations`) qui ne sont pas disponibles sur PyPI
> public et ne sont **pas nécessaires** pour cette app.

### 3. Frontend (build statique)
```bash
cd /opt/sqm-nightwatch/frontend
sudo -u sqm yarn install --frozen-lockfile
sudo -u sqm REACT_APP_BACKEND_URL=https://votre.domaine.tld yarn build
# Le résultat est dans /opt/sqm-nightwatch/frontend/build/
```

### 4. Service systemd
```bash
sudo cp /opt/sqm-nightwatch/deploy/sqm-nightwatch.service \
        /etc/systemd/system/sqm-nightwatch.service
sudo systemctl daemon-reload
sudo systemctl enable --now sqm-nightwatch
sudo systemctl status sqm-nightwatch        # doit être "active (running)"
sudo journalctl -u sqm-nightwatch -f         # logs en direct
```

Les logs affichent au démarrage la **clé API auto-générée**, par ex. :
```
SQM Nightwatch backend started
X-API-Key    : xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Elle est aussi persistée dans `/opt/sqm-nightwatch/backend/.env`.

### 5. Vhost nginx
```bash
sudo cp /opt/sqm-nightwatch/deploy/nginx-sqm-nightwatch.conf \
        /etc/nginx/sites-available/sqm-nightwatch.conf
# Remplacer le domaine
sudo sed -i 's/sqm.example.com/votre.domaine.tld/g' \
        /etc/nginx/sites-available/sqm-nightwatch.conf
sudo ln -sf /etc/nginx/sites-available/sqm-nightwatch.conf \
            /etc/nginx/sites-enabled/sqm-nightwatch.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 6. TLS (Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d votre.domaine.tld --redirect
# Le renouvellement est auto (timer systemd certbot.timer)
```

## Vérification

```bash
# 1. Santé du backend en local
curl http://127.0.0.1:8001/api/
# {"app":"SQM Nightwatch","version":"1.0.0","status":"ready"}

# 2. Accès public
curl https://votre.domaine.tld/api/

# 3. Push de test (remplacer la clé)
KEY=$(grep '^SQM_API_KEY=' /opt/sqm-nightwatch/backend/.env | cut -d= -f2)
curl "https://votre.domaine.tld/api/sqm_push?ID=TEST&KEY=$KEY&S=21.34&T=12.5&V=3.95"
```

Ouvrir `https://votre.domaine.tld` : la mesure doit apparaître dans les 30 s.

## Mise à jour

```bash
cd /opt/sqm-nightwatch && sudo -u sqm git pull
# Si requirements.txt a changé :
sudo -u sqm /opt/sqm-nightwatch/backend/.venv/bin/pip install -r backend/requirements-prod.txt
# Rebuild frontend si modifié :
cd frontend && sudo -u sqm REACT_APP_BACKEND_URL=https://votre.domaine.tld yarn build
# Restart
sudo systemctl restart sqm-nightwatch
```

## Activer HTTP/3 (QUIC) — optionnel

Si votre nginx supporte QUIC (Debian 13 / Ubuntu 24.04 ou nginx mainline ≥ 1.25) :

```bash
# 1. Vérifier le support
nginx -V 2>&1 | grep -o with-http_v3_module

# 2. Éditer enable-http3.sh : renseigner DOMAIN
sudo nano /opt/sqm-nightwatch/deploy/enable-http3.sh

# 3. Activer (script idempotent, backup automatique du vhost existant)
sudo bash /opt/sqm-nightwatch/deploy/enable-http3.sh

# 4. Vérifier
curl --http3-only -I https://votre.domaine.tld
# ou DevTools navigateur : colonne 'Protocol' doit afficher 'h3'
# ou diagnostic en ligne : https://http3check.net/?host=votre.domaine.tld
```

Le script `enable-http3.sh` :
- ajoute `listen 443 quic reuseport;` et `http3 on;` au vhost
- ajoute l'en-tête `Alt-Svc: h3=":443"` (qui permet aux navigateurs de basculer auto en H3 après la 1ère connexion HTTP/2)
- ouvre **UDP/443** dans ufw/firewalld (HTTP/3 ne passe pas par TCP)
- garde un backup horodaté du vhost précédent
- restaure le backup automatiquement si `nginx -t` échoue

> **Note** : HTTP/3 ne change rien fonctionnellement pour l'app — c'est le
> transport (TCP → UDP) qui change, avec un handshake plus rapide et une
> meilleure résilience aux changements de réseau (utile depuis un téléphone
> qui passe de Wi-Fi à 4G).

## Sauvegarde de l'historique

L'unique source de vérité est `sqm_history.json`. Pour une sauvegarde
quotidienne via cron :
```bash
0 4 * * * /usr/bin/install -d /var/backups/sqm && \
  /bin/cp -a /opt/sqm-nightwatch/backend/sqm_history.json \
  /var/backups/sqm/sqm_history.$(date +\%Y\%m\%d).json
```

## Dépannage

| Symptôme                                | Diagnostic / fix |
| --------------------------------------- | ---------------- |
| `502 Bad Gateway` sur `/api/...`        | `systemctl status sqm-nightwatch` + `journalctl -u sqm-nightwatch -n 100` |
| Frontend OK mais aucune mesure          | Vérifier la clé API côté ESP : `curl https://...?KEY=xxx&S=21` doit répondre 200 |
| Clé oubliée                              | `grep SQM_API_KEY /opt/sqm-nightwatch/backend/.env` ou `journalctl -u sqm-nightwatch \| grep X-API-Key` |
| Accès `mixed content` dans le navigateur | Frontend rebuild avec `REACT_APP_BACKEND_URL=https://...` (et non http) puis `systemctl reload nginx` |
| Permission denied sur `sqm_history.json` | `chown sqm:sqm /opt/sqm-nightwatch/backend/sqm_history.json` |
| `No matching distribution found for emergentintegrations` | Vous utilisez `requirements.txt` au lieu de `requirements-prod.txt`. Refaites `pip install -r backend/requirements-prod.txt` dans le venv. |
| `ERROR: Could not find a version that satisfies the requirement emergentintegrations` | Même cause, même fix que ci-dessus. Ce package est Emergent-only, pas sur PyPI. |
| `nginx: configuration file ... test failed` et `options-ssl-nginx.conf` No such file | Votre vhost contient des directives HTTPS **avant** que certbot n'ait émis le certificat. Partez du vhost HTTP-only (version actuelle de `deploy/nginx-sqm-nightwatch.conf`) et laissez `certbot --nginx` ajouter lui-même le bloc HTTPS. |
| `certbot --nginx` échoue avec timeout ou 404 sur challenge | DNS pas propagé, ou port 80 fermé. Tester `dig $DOMAIN +short` puis `curl -I http://$DOMAIN/`. |
| HTTP/3 activé mais navigateur reste en `h2` | Normal au 1er chargement : le navigateur a besoin de recevoir `Alt-Svc` une fois en HTTP/2 avant de basculer. Refresh = `h3`. |
| `curl --http3-only` échoue après `enable-http3.sh` | Vérifier UDP/443 ouvert : `nc -u -zv votre.domaine.tld 443` et `nginx -V 2>&1 \| grep http_v3`. |
| `nginx: emerg: "quic" parameter requires ngx_quic_module` | nginx trop vieux. Passer en nginx mainline (≥ 1.25) ou Debian 13+. |
| `nginx: emerg: duplicate listen options for 0.0.0.0:443` lors d'`enable-http3.sh` | Un autre vhost utilise déjà `listen 443 quic reuseport`. `reuseport` ne peut être sur qu'UN SEUL server block par adresse:port. Le script récent détecte ça automatiquement et supprime `reuseport` du vhost SQM. Si vous installez manuellement, retirez `reuseport` de l'un des deux. |
| `nginx: warn: duplicate value "TLSv1.2"` | `options-ssl-nginx.conf` définit déjà `ssl_protocols`. Supprimer toute ligne `ssl_protocols` du vhost. Le script récent le fait automatiquement. |

## Notes

- Backend en `127.0.0.1:8001` : non exposé publiquement, seul nginx y accède.
- Pas de base de données : un fichier JSON local + asyncio.Lock. Suffisant
  pour des dizaines de milliers de mesures.
- CORS déjà limité dans le `.env` au domaine de production.
- Pour ajouter une 2ème instance (autre capteur), dupliquer le service
  systemd + un autre vhost nginx + un autre dossier d'install.
