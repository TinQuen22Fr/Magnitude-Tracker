/**
 * Source unique de vérité pour la version de l'application web.
 *
 * La version est lue depuis frontend/package.json à la build, et exposée
 * comme constante exportable (utilisée notamment dans AppShell footer).
 *
 * Convention SemVer (https://semver.org/lang/fr/) :
 *
 *   MAJOR.MINOR.PATCH
 *
 *   - MAJOR : breaking change visible utilisateur (refonte UI majeure,
 *             changement d'API qui casse les clients existants, refonte
 *             du schéma DB qui demande une migration manuelle).
 *   - MINOR : nouvelle fonctionnalité utilisateur visible et autonome
 *             (mode nuit, flasher, invitations, multi-user…). Ne casse
 *             rien, ajoute juste de la valeur.
 *   - PATCH : correctif de bug, polish UI/UX, optimisation perf,
 *             refactor interne, mise à jour de dépendances sans impact.
 *
 * RÈGLE OPÉRATIONNELLE :
 *   - À chaque commit qui ajoute une feature visible utilisateur,
 *     bumper MINOR et reset PATCH à 0 (ex: 1.6.x → 1.7.0).
 *   - À chaque fix/polish, bumper PATCH (ex: 1.6.0 → 1.6.1).
 *   - Le bump se fait dans frontend/package.json, champ "version".
 *
 * ----------------------------------------------------------------------------
 * Historique (à entretenir manuellement à chaque bump notable) :
 * ----------------------------------------------------------------------------
 *
 *   1.0.0 : MVP — réception ESP8266, dashboard, charts magnitude.
 *   1.1.0 : GPS + carte OpenStreetMap, optimisations mobile.
 *   1.2.0 : Mode Nuit Astronomique (palette rouge profond exclusive).
 *   1.3.0 : Carte OSM intégrée nuit-friendly + versioning centralisé.
 *   1.4.0 : Web Flasher firmware ESP8266 (ESP Web Tools + proxy backend).
 *   1.4.1 : Toggle canal Stable / Beta WiFiManager sur la page Flasher.
 *   1.5.0 : Phase 5 — Migration MongoDB → SQLite, authentification
 *           multi-utilisateur (login/password bcrypt, JWT sessions,
 *           2FA TOTP, admin cleanup endpoints, fond stellaire animé).
 *   1.6.0 : Phase 6 — Système d'invitations (demande publique avec
 *           motivation min 50 chars, validation admin), emails
 *           transactionnels via Brevo (primaire) + Resend (fallback),
 *           rate-limiting DB des envois.
 *   1.6.1 : Polish UX — Fix header mobile (bouton Connexion invisible
 *           sur écrans < 640 px → regroupement Settings/Flasher/Setup
 *           dans un menu hamburger), distinction visuelle Stable vs Beta
 *           sur la page Flasher (suffixe -beta automatique).
 *
 * ----------------------------------------------------------------------------
 * À venir :
 * ----------------------------------------------------------------------------
 *
 *   1.7.0 : Phase 7 — Architecture multi-utilisateur complète (rôles,
 *           claim de sondes publiques sur dashboards personnels).
 *   2.0.0 : Portage ESP32 (peut casser certains manifests/firmware ancien)
 *           OU refonte UI majeure si jugée nécessaire.
 */
import pkg from "../../package.json";

export const APP_VERSION = pkg.version || "0.0.0";
