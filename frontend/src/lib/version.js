/**
 * Source unique de vérité pour la version de l'application.
 *
 * La version est lue depuis frontend/package.json à la build, et exposée
 * comme constante exportable. Bumpez le champ "version" du package.json
 * à chaque ajout fonctionnel UX/feature (convention SemVer) :
 *
 *   - MAJOR : breaking change (refonte API, schéma DB)
 *   - MINOR : nouvelle fonctionnalité utilisateur (mode nuit, flasher…)
 *   - PATCH : correctif / amélioration mineure (a11y, perf)
 *
 * Historique recommandé (à entretenir manuellement quand vous mergez
 * Testing -> main pour les versions stables notables) :
 *
 *   1.0.0 : MVP — réception ESP8266, dashboard, charts magnitude
 *   1.1.0 : GPS + carte OpenStreetMap, optimisations mobile
 *   1.2.0 : Mode Nuit Astronomique (palette rouge profond exclusive)
 *   1.3.0 : Carte OSM intégrée nuit-friendly + versioning centralisé
 */
import pkg from "../../package.json";

export const APP_VERSION = pkg.version || "0.0.0";
