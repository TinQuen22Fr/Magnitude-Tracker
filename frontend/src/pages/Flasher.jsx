import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cpu,
  Github,
  AlertTriangle,
  CheckCircle2,
  Usb,
  BookOpen,
  Zap,
  Info,
  ExternalLink,
  FlaskConical,
} from "lucide-react";
import { getBackendUrl } from "@/lib/sqmApi";

// Web Component <esp-web-install-button> (Nabu Casa / ESPHome).
// Le simple import enregistre globalement le custom element.
// React traite les custom elements comme des balises HTML standard.
import "esp-web-tools";

const FIRMWARE_SOURCE_URL = "https://github.com/TinQuen22Fr/SQM-Pro-ESP8266";
const RELEASES_URL =
  "https://github.com/TinQuen22Fr/SQM-Pro-ESP8266/releases";

const STORAGE_KEY_CHANNEL = "sqm_firmware_channel";

/**
 * Manifest ESP Web Tools : on passe par le backend FastAPI qui proxifie
 * le .bin depuis GitHub Releases, ce qui contourne le blocage CORS de
 * GitHub (qui ne renvoie pas Access-Control-Allow-Origin sur les release
 * assets).
 *
 * Le paramètre `channel` (stable|beta) permet de basculer entre la
 * release de prod et la pre-release `latest-wifimanager` en cours de test.
 */
function getFirmwareManifestUrl(channel) {
  const base = getBackendUrl() || "";
  return `${base}/api/firmware/esp8266/manifest.json?channel=${channel}`;
}

function getFirmwareInfoUrl(channel) {
  const base = getBackendUrl() || "";
  return `${base}/api/firmware/esp8266/info?channel=${channel}`;
}

/**
 * Détection du support Web Serial API (utilisé par esp-web-tools).
 * - Chrome/Edge/Brave/Opera Desktop : OK
 * - Firefox : non (sauf Nightly avec flag depuis fin 2025)
 * - Safari : non
 * - Mobile : non (Web Serial nécessite USB OTG + autorisations natives,
 *            pas exposé par les WebView mobiles)
 */
function isSerialSupported() {
  if (typeof navigator === "undefined") return false;
  return "serial" in navigator;
}

export default function Flasher() {
  const [supported, setSupported] = useState(true);
  const [browser, setBrowser] = useState("");
  const [firmwareInfo, setFirmwareInfo] = useState(null);
  const [firmwareLoading, setFirmwareLoading] = useState(true);
  const [firmwareError, setFirmwareError] = useState(null);
  // Canal firmware sélectionné (persisté en localStorage) :
  //   - 'stable' : release officielle taguée (par défaut)
  //   - 'beta'   : pre-release de la branche wifimanager (test)
  const [channel, setChannel] = useState(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY_CHANNEL);
      return stored === "beta" ? "beta" : "stable";
    } catch (_) {
      return "stable";
    }
  });

  const handleChannelChange = (newChannel) => {
    if (newChannel !== channel) {
      setChannel(newChannel);
      try {
        window.localStorage.setItem(STORAGE_KEY_CHANNEL, newChannel);
      } catch (_) {
        /* noop */
      }
    }
  };

  useEffect(() => {
    setSupported(isSerialSupported());
    const ua = navigator.userAgent || "";
    if (/Firefox\//.test(ua)) setBrowser("Firefox");
    else if (/Edg\//.test(ua)) setBrowser("Edge");
    else if (/Chrome\//.test(ua)) setBrowser("Chrome");
    else if (/Safari\//.test(ua)) setBrowser("Safari");
    else setBrowser("Inconnu");
  }, []);

  // Récupération des métadonnées du firmware (version courante etc.)
  // Refetch à chaque changement de canal.
  useEffect(() => {
    let cancelled = false;
    setFirmwareLoading(true);
    setFirmwareError(null);
    (async () => {
      try {
        const resp = await fetch(getFirmwareInfoUrl(channel), {
          headers: { Accept: "application/json" },
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (!cancelled) {
          setFirmwareInfo(data);
          setFirmwareError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setFirmwareError(err.message || "Erreur de récupération");
        }
      } finally {
        if (!cancelled) setFirmwareLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel]);

  return (
    <div className="flex flex-col gap-6" data-testid="flasher-page">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight flex items-center gap-3">
          <Zap className="size-7 sm:size-8 text-[hsl(var(--chart-1))]" />
          Flasher en ligne
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Flashez le firmware <strong className="text-foreground">SQM Pro</strong> directement
          depuis votre navigateur, sans Arduino IDE ni outil externe. Branchez
          votre carte en USB, cliquez sur le bouton, et c'est parti.
        </p>
      </div>

      <Card
        className="border-border/70 bg-card/80 backdrop-blur"
        data-testid="flasher-esp8266-card"
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
              <Cpu className="size-4" /> NodeMCU Lolin V3 (ESP8266)
            </CardTitle>
            <Badge
              variant="outline"
              className={
                channel === "beta"
                  ? "font-mono text-[10px] border-[hsl(var(--chart-1))]/50 text-[hsl(var(--chart-1))]"
                  : "font-mono text-[10px] border-[hsl(var(--chart-3))]/40 text-[hsl(var(--chart-3))]"
              }
              data-testid="firmware-version-badge"
            >
              {firmwareLoading
                ? "…"
                : firmwareInfo?.display_version || firmwareInfo?.version
                ? firmwareInfo.display_version || firmwareInfo.version
                : "indisponible"}
            </Badge>
          </div>

          {/* Toggle canal Stable / Beta */}
          <div className="pt-3" data-testid="firmware-channel-toggle">
            <Tabs value={channel} onValueChange={handleChannelChange}>
              <TabsList className="grid w-full sm:w-[420px] grid-cols-2">
                <TabsTrigger value="stable" data-testid="channel-stable">
                  <CheckCircle2 className="size-3.5 mr-1.5" />
                  Stable
                </TabsTrigger>
                <TabsTrigger value="beta" data-testid="channel-beta">
                  <FlaskConical className="size-3.5 mr-1.5" />
                  Beta (WiFiManager)
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {channel === "beta" && (
              <div
                className="mt-2 rounded-md border border-[hsl(var(--chart-1))]/30 bg-[hsl(var(--chart-1))]/5 px-3 py-2 text-xs flex items-start gap-2"
                data-testid="beta-warning"
              >
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-[hsl(var(--chart-1))]" />
                <span className="text-foreground/80">
                  <strong className="text-foreground">Version de test.</strong>{" "}
                  Firmware{" "}
                  {firmwareInfo?.display_version ? (
                    <strong className="text-foreground font-mono">
                      {firmwareInfo.display_version}
                    </strong>
                  ) : (
                    "beta"
                  )}{" "}
                  avec portail captif WiFiManager + double reset detection.
                  À utiliser pour valider la nouvelle procédure avant merge
                  dans la branche stable.
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
            <li>
              Carte cible :{" "}
              <strong className="text-foreground">NodeMCU Lolin V3</strong>{" "}
              (ESP8266, USB CH340)
            </li>
            <li>
              Chip family : <code className="font-mono">ESP8266</code> · Offset
              flash : <code className="font-mono">0x00000</code>
            </li>
            <li>
              Source firmware :{" "}
              <a
                href={FIRMWARE_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[hsl(var(--chart-2))] hover:underline inline-flex items-center gap-1"
              >
                <Github className="size-3" />
                TinQuen22Fr/SQM-Pro-ESP8266
              </a>
            </li>
          </ul>

          {!supported ? (
            <BrowserNotSupportedAlert browser={browser} />
          ) : (
            <BrowserSupportedFlashRow
              channel={channel}
              firmwareInfo={firmwareInfo}
              firmwareLoading={firmwareLoading}
              firmwareError={firmwareError}
            />
          )}
        </CardContent>
      </Card>

      <Card
        className="border-border/70 bg-card/80 opacity-70"
        data-testid="flasher-esp32-card"
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
              <Cpu className="size-4" /> ESP32 / S2 / S3 / C3
            </CardTitle>
            <Badge variant="outline" className="font-mono text-[10px]">
              Bientôt
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Le portage du firmware vers les variantes ESP32 est prévu pour
            profiter de leur surcroît de puissance (BLE, Wi-Fi dual-band,
            secondes connexions parallèles). Le flasher détectera
            automatiquement la variante connectée et proposera le bon
            binaire.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/80" data-testid="flasher-procedure-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
            <BookOpen className="size-4" /> Procédure
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <strong className="text-foreground">Branchez</strong> votre
              NodeMCU en USB sur l'ordinateur (un câble{" "}
              <em>data</em>, pas un câble charge seule).
            </li>
            <li>
              <strong className="text-foreground">Cliquez</strong> sur le
              bouton <em>Connecter & Installer</em> ci-dessus.
            </li>
            <li>
              Le navigateur ouvre une fenêtre de sélection de port série :
              choisissez le port qui correspond au chip{" "}
              <code className="font-mono">CH340</code> (souvent{" "}
              <code className="font-mono">USB-Serial</code> ou{" "}
              <code className="font-mono">/dev/ttyUSB0</code> sur Linux).
            </li>
            <li>
              Laissez ESP Web Tools effacer la mémoire flash puis y écrire
              le firmware. <strong className="text-foreground">~30 s</strong>{" "}
              à ~1 min selon votre USB.
            </li>
            <li>
              Une fois le flash terminé, configurez le Wi-Fi via le portail
              captif <code className="font-mono">SQM-Setup</code> qui
              apparaît, puis renseignez l'URL de votre serveur SQM
              Nightwatch et la clé API.
            </li>
          </ol>

          <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap gap-3 text-xs">
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[hsl(var(--chart-2))] hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Historique des releases firmware
            </a>
            <a
              href={FIRMWARE_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[hsl(var(--chart-2))] hover:underline"
            >
              <Github className="size-3.5" />
              Compiler depuis les sources (Arduino IDE)
            </a>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/80" data-testid="flasher-requirements-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
            <Info className="size-4" /> Pré-requis
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong className="text-foreground">Navigateur</strong>{" "}
              compatible Web Serial : Chrome, Edge, Brave, Opera (desktop).
              Firefox ne supporte pas cette API pour l'instant (mode
              expérimental Nightly uniquement).
            </li>
            <li>
              <strong className="text-foreground">PC</strong> (Linux,
              macOS, Windows). Le flashage <em>n'est pas possible</em>{" "}
              depuis un téléphone Android/iOS (limitations Web Serial mobile).
            </li>
            <li>
              <strong className="text-foreground">Driver USB-Serial</strong>{" "}
              CH340 : déjà inclus dans Linux (Ubuntu 24.04+) et macOS
              récents. Sous Windows, télécharger le driver depuis le site
              WCH.
            </li>
            <li>
              <strong className="text-foreground">Câble USB DATA</strong>{" "}
              (pas un câble charge seule) — beaucoup de soucis viennent de
              là.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Sous-composants
 * ------------------------------------------------------------------------- */

function BrowserSupportedFlashRow({ channel, firmwareInfo, firmwareLoading, firmwareError }) {
  const ref = useRef(null);
  // Re-monter le composant ESP Web Tools quand le canal change (le manifest
  // est lu à la création du custom element, pas à chaque update)
  const manifestUrl = getFirmwareManifestUrl(channel);
  const sizeKb =
    firmwareInfo?.asset?.size != null
      ? (firmwareInfo.asset.size / 1024).toFixed(1)
      : null;

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-[hsl(var(--chart-3))]/40 bg-[hsl(var(--chart-3))]/5 px-3 py-2 flex items-start gap-2 text-xs">
        <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-[hsl(var(--chart-3))]" />
        <span className="text-foreground/85">
          Votre navigateur supporte Web Serial. Vous pouvez flasher directement.
        </span>
      </div>

      {/* Détails du firmware proxifié (utile pour debug + transparence) */}
      <div
        className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1"
        data-testid="firmware-details"
      >
        {firmwareLoading ? (
          <Skeleton className="h-3.5 w-48" />
        ) : firmwareError ? (
          <div className="flex items-start gap-2 text-[hsl(var(--chart-1))]">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <span>
              Impossible de récupérer les infos du firmware : {firmwareError}.
              Le bouton ci-dessous restera fonctionnel si le proxy backend
              répond.
            </span>
          </div>
        ) : firmwareInfo ? (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              <span>
                Version :{" "}
                <code className="font-mono text-foreground">
                  {firmwareInfo.display_version || firmwareInfo.version}
                </code>
              </span>
              {sizeKb && (
                <span>
                  Taille : <code className="font-mono">{sizeKb} Ko</code>
                </span>
              )}
              {(firmwareInfo.asset?.updated_at || firmwareInfo.published_at) && (
                <span>
                  Build du{" "}
                  <code className="font-mono">
                    {new Date(
                      firmwareInfo.asset?.updated_at ||
                        firmwareInfo.published_at,
                    ).toLocaleDateString("fr-FR")}
                  </code>
                </span>
              )}
            </div>
            {firmwareInfo.html_url && (
              <a
                href={firmwareInfo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[hsl(var(--chart-2))] hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="size-3" />
                Voir la release sur GitHub
              </a>
            )}
          </>
        ) : null}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center pt-2">
        <esp-web-install-button
          key={channel}
          ref={ref}
          manifest={manifestUrl}
          data-testid="esp-flash-button"
        >
          <Button
            slot="activate"
            size="lg"
            className="gap-2 h-12 w-full sm:w-auto"
            data-testid="esp-flash-trigger"
          >
            <Usb className="size-4" />
            Connecter & Installer le firmware
          </Button>
          <span slot="unsupported" className="text-xs text-destructive">
            Navigateur non supporté pour Web Serial.
          </span>
          <span slot="not-allowed" className="text-xs text-destructive">
            Cette page doit être servie en HTTPS pour autoriser Web Serial.
          </span>
        </esp-web-install-button>
      </div>
    </div>
  );
}

function BrowserNotSupportedAlert({ browser }) {
  return (
    <div
      className="rounded-md border border-[hsl(var(--chart-1))]/50 bg-[hsl(var(--chart-1))]/10 px-3 py-3 flex items-start gap-2 text-xs"
      data-testid="flasher-unsupported-warning"
    >
      <AlertTriangle className="size-4 shrink-0 mt-0.5 text-[hsl(var(--chart-1))]" />
      <div className="space-y-1.5 text-foreground/85">
        <div>
          <strong className="text-foreground">
            Navigateur {browser} non supporté
          </strong>{" "}
          pour le flashage en ligne. Web Serial API n'est pas implémentée
          (ou trop limitée) dans ce navigateur.
        </div>
        <div>
          Solutions :
          <ul className="list-disc list-inside ml-1 mt-1">
            <li>
              Ouvrez cette page dans{" "}
              <strong className="text-foreground">Chrome, Edge, Brave</strong>{" "}
              ou Opera (desktop).
            </li>
            <li>
              Ou compilez et flashez via Arduino IDE depuis le{" "}
              <a
                href={FIRMWARE_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[hsl(var(--chart-2))] hover:underline"
              >
                repo source
              </a>
              .
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
