# 🌌 Magnitude Tracker — SQM Nightwatch

API web et dashboard d'astronomie pour DIY SQM-LE (Sky Quality Meter)
basé sur ESP8266. Réception automatique des données du capteur, stockage
local en JSON (pas de base de données), graphique interactif de la
magnitude au fil de la nuit avec rafraîchissement automatique.

---

## ✨ Fonctionnalités

- **Réception capteur** : routes `POST/GET /api/sqm_push` sécurisées par clé API
- **Stockage local** : fichier `backend/sqm_history.json` (rétention illimitée, pas de base lourde)
- **Dashboard dark-mode** : graphique magnitude/temps, batterie, température, GPS sur carte OpenStreetMap
- **Auto-refresh** : 30 secondes
- **Export CSV** : `GET /api/sqm/export.csv`
- **Déploiement** : NGINX + HTTPS Let's Encrypt + HTTP/3 (QUIC) optionnel
- **Service systemd** auto-démarré

---

## 🚀 Installation rapide (Debian / Ubuntu)

> Prérequis : un serveur avec un domaine pointé dessus (A/AAAA DNS),
> les ports 80, 443 ouverts.

```bash
# 1. Cloner le repo en root
sudo git clone https://github.com/<votre-user>/Magnitude-Tracker.git /opt/sqm-nightwatch
cd /opt/sqm-nightwatch

# 2. Préparer la config locale (DOMAIN, email, etc.)
cp deploy/env.local.example deploy/.env.local
sudo nano deploy/.env.local        # personnaliser DOMAIN au minimum

# 3. Lancer l'installation
sudo bash deploy/install.sh
```

À la fin du script, le dashboard est accessible sur `https://<votre-domaine>`
et la clé API est affichée (à reporter dans le firmware ESP).

### Activer HTTP/3 (QUIC) — optionnel

```bash
sudo bash deploy/enable-http3.sh
```

---

## 📡 Configuration de l'ESP8266

Le firmware ESP doit envoyer une requête HTTP régulière vers :

```
GET https://<votre-domaine>/api/sqm_push?key=<API_KEY>&mag=21.3&temp=12.4&batt=4.1
```

Ou en POST JSON :

```bash
curl -X POST https://<votre-domaine>/api/sqm_push \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"mag":21.3,"temp":12.4,"batt":4.1}'
```

Champs supportés : `mag` (magnitude), `lux`, `temp`, `batt`, `err`,
`gps_lat`, `gps_lon`, `gps_alt`.

---

## 🛠️ Stack technique

- **Backend** : FastAPI (Python 3.10+), Uvicorn, stockage JSON avec
  `asyncio.Lock` pour la concurrence
- **Frontend** : React 19 + Tailwind + Shadcn/UI + Recharts (graphiques)
  + OpenStreetMap (carte GPS)
- **Serveur** : NGINX + Let's Encrypt + HTTP/3 (optionnel)

---

## 📁 Structure

```
.
├── backend/                # API FastAPI (server.py)
│   ├── server.py
│   ├── requirements-prod.txt
│   └── test_core.py
├── frontend/               # Dashboard React
│   ├── src/
│   ├── public/
│   └── package.json
├── deploy/                 # Scripts d'installation serveur
│   ├── install.sh                          # script principal
│   ├── enable-http3.sh                     # activation QUIC
│   ├── env.local.example                   # template config
│   ├── nginx-sqm-nightwatch.conf           # vhost HTTP/HTTPS
│   ├── nginx-sqm-nightwatch-http3.conf     # vhost HTTP/3
│   └── sqm-nightwatch.service              # unit systemd
└── README.md
```

---

## 🔧 Maintenance

```bash
# Logs en direct
sudo journalctl -u sqm-nightwatch -f

# Redémarrer le service
sudo systemctl restart sqm-nightwatch

# Récupérer la clé API
grep '^SQM_API_KEY=' /opt/sqm-nightwatch/backend/.env

# Mise à jour
cd /opt/sqm-nightwatch
sudo git pull
sudo systemctl restart sqm-nightwatch
sudo -u sqm bash -c "cd frontend && yarn install --frozen-lockfile && REACT_APP_BACKEND_URL='https://<DOMAIN>' yarn build"
```

---

## 📝 Licence

MIT — voir `LICENSE`
