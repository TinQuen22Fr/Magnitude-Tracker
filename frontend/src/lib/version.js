/**
 * Source unique de verite pour la version de l'application.
 *
 * La version est lue depuis frontend/package.json a la build, et exposee
 * comme constante exportable. Bumpez le champ "version" du package.json
 * a chaque ajout fonctionnel UX/feature (convention SemVer) :
 *
 *   - MAJOR : breaking change (refonte API, schema DB)
 *   - MINOR : nouvelle fonctionnalite utilisateur (mode nuit, flasher...)
 *   - PATCH : correctif / amelioration mineure (a11y, perf)
 *
 * Historique recommande (a entretenir manuellement quand vous mergez
 * Testing -> main pour les versions stables notables) :
 *
 *   1.0.0 : MVP -- reception ESP8266, dashboard, charts magnitude
 *   1.1.0 : GPS + carte OpenStreetMap, optimisations mobile
 *   1.2.0 : Mode Nuit Astronomique (palette rouge profond exclusive)
 *   1.3.0 : Carte OSM integree nuit-friendly + versioning centralise
 *   1.4.0 : Web Flasher firmware ESP8266 (ESP Web Tools)
 */
import pkg from "../../package.json";

export const APP_VERSION = pkg.version || "0.0.0";
