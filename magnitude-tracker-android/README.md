# Magnitude Tracker — version Android (APK)

Wrapper [Capacitor](https://capacitorjs.com/) qui embarque l'interface React de
SQM Nightwatch dans une application Android installable via APK.

- **AppId** : `com.magnitudetracker.app`
- **AppName** : `Magnitude Tracker`
- **Source UI** : `../frontend` (build React, embarqué dans l'APK)
- **Backend** : configurable au build (`REACT_APP_BACKEND_URL`) ET au runtime
  (écran Réglages, sauvegardé en localStorage de la WebView)

## Sommaire

1. [Build automatique (GitHub Actions)](#build-automatique-github-actions)
2. [Build local (Android Studio)](#build-local-android-studio)
3. [Installation de l'APK sur le téléphone](#installation-de-lapk-sur-le-téléphone)
4. [Configuration runtime](#configuration-runtime)
5. [Mises à jour](#mises-à-jour)
6. [Signature de release (optionnel)](#signature-de-release-optionnel)

---

## Build automatique (GitHub Actions)

Un workflow GitHub Actions est fourni dans
[`.github/workflows/build-android-apk.yml`](../.github/workflows/build-android-apk.yml).
Il se déclenche automatiquement à chaque push sur la branche
`magnitude-tracker-android` (ou manuellement via l'onglet **Actions**).

### Étapes du workflow
1. Checkout du repo
2. Setup Node 20 + Java 17
3. Build du frontend React avec `REACT_APP_BACKEND_URL` (variable du workflow)
4. Install des deps Capacitor + `npx cap add android` (génère le dossier `android/`)
5. `gradle assembleDebug` (ou `assembleRelease` si secret keystore configuré)
6. Upload de l'APK comme **artifact** (téléchargeable depuis l'onglet Actions)
7. (Optionnel) Création d'une **Release** GitHub avec l'APK attaché

### Déclenchement manuel avec URL custom
Depuis GitHub web :

> **Actions** → **Build Android APK** → **Run workflow** → (renseigner
> `backend_url`) → **Run**

---

## Build local (Android Studio)

### Prérequis
- Node.js ≥ 20
- Java JDK 17
- [Android Studio](https://developer.android.com/studio) (Iguana ou +) avec
  Android SDK 34 installé + Build-Tools 34.0.0
- Un appareil/émulateur Android 8+ (API 26)

### Build complet (première fois)
```bash
# 1. Cloner et basculer sur la branche
git clone https://github.com/<vous>/<repo>.git
cd <repo>
git checkout magnitude-tracker-android

# 2. Build du frontend avec l'URL backend en dur
cd frontend
yarn install
REACT_APP_BACKEND_URL=https://sqm.votre-domaine.tld yarn build
cd ..

# 3. Init Capacitor (génère le dossier android/)
cd magnitude-tracker-android
npm install
npx cap add android      # uniquement la 1ère fois
npx cap sync android

# 4. Construire l'APK (debug)
cd android
./gradlew assembleDebug

# APK prêt : android/app/build/outputs/apk/debug/app-debug.apk
```

### Rebuild après modif de l'UI React
```bash
cd frontend && yarn build && cd ../magnitude-tracker-android
npx cap sync android
cd android && ./gradlew assembleDebug
```

### Ouvrir le projet dans Android Studio
```bash
cd magnitude-tracker-android
npx cap open android
```
Depuis Android Studio : **Run > Run 'app'** sur un appareil/émulateur.

---

## Installation de l'APK sur le téléphone

1. Télécharger l'APK :
   - depuis GitHub Actions → dernier run → **Artifacts** → `magnitude-tracker-apk.zip`
   - ou depuis GitHub Releases (si configuré)
2. Sur Android : activer **Installation d'applications inconnues** pour le
   navigateur ou gestionnaire de fichiers (Paramètres → Sécurité).
3. Ouvrir l'APK avec le gestionnaire de fichiers → **Installer**.
4. Lancer l'app. Si l'URL backend par défaut diffère de votre serveur, aller
   dans l'onglet **Réglages** (icône sliders en haut à droite) et saisir la
   bonne URL.

---

## Configuration runtime

L'app accepte une **URL backend personnalisée** via l'écran **Réglages** :
- Saisir l'URL (ex: `https://sqm.votre-domaine.tld`)
- **Tester la connexion** (ping `/api/` du serveur)
- **Enregistrer** → l'app recharge avec la nouvelle URL
- **Réinitialiser** → revient à l'URL compilée par défaut

Cette URL est stockée en localStorage de la WebView (persistant entre
lancements, effacé si l'app est désinstallée).

---

## Mises à jour

Deux stratégies :

1. **Rebuild APK** à chaque release :
   - Push sur la branche `magnitude-tracker-android` → nouvel APK auto
   - Réinstaller l'APK sur le téléphone (l'ancien est conservé si les versions
     correspondent, sinon réinstallation propre)

2. **Pointer vers le serveur web** :
   - Le serveur web (frontend) est mis à jour par `git pull && yarn build`
   - L'APK contient juste une "vieille" UI mais le backend reste compatible
   - Pour mettre à jour l'UI Android : rebuild + réinstall

---

## Signature de release (optionnel)

Par défaut, le workflow produit un APK **debug-signé** (parfait pour usage
perso, mais Android affiche un avertissement à l'install).

Pour produire un APK **release-signé** :

1. Générer un keystore (une seule fois, à garder précieusement) :
   ```bash
   keytool -genkeypair -v -keystore release.keystore \
     -alias magnitude-tracker -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Encoder en base64 et l'ajouter en secret GitHub :
   - `ANDROID_KEYSTORE_BASE64` : `base64 -w 0 release.keystore`
   - `ANDROID_KEYSTORE_PASSWORD` : mot de passe du keystore
   - `ANDROID_KEY_ALIAS` : `magnitude-tracker`
   - `ANDROID_KEY_PASSWORD` : mot de passe de la clé
3. Le workflow détecte automatiquement les secrets et bascule en
   `assembleRelease` avec signature.

> ⚠  **Ne perdez pas votre keystore.** Si vous le perdez, vous ne pourrez plus
> publier de mise à jour compatible avec l'APK installé par les utilisateurs
> (même en perso, l'install d'une nouvelle version exigerait de désinstaller
> l'ancienne).
