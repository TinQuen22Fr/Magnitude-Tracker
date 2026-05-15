import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

// Web Component <esp-web-install-button> (Nabu Casa / ESPHome).
// Le simple import enregistre globalement le custom element.
// React traite les custom elements comme des balises HTML standard.
import "esp-web-tools";

const FIRMWARE_SOURCE_URL = "https://github.com/TinQuen22Fr/SQM-Pro-ESP8266";
const RELEASES_URL =
  "https://github.com/TinQuen22Fr/SQM-Pro-ESP8266/releases";

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

  useEffect(() => {
    setSupported(isSerialSupported());
    const ua = navigator.userAgent || "";
    if (/Firefox\//.test(ua)) setBrowser("Firefox");
    else if (/Edg\//.test(ua)) setBrowser("Edge");
    else if (/Chrome\//.test(ua)) setBrowser("Chrome");
    else if (/Safari\//.test(ua)) setBrowser("Safari");
    else setBrowser("Inconnu");
  }, []);

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
              className="font-mono text-[10px] border-[hsl(var(--chart-3))]/40 text-[hsl(var(--chart-3))]"
            >
              Stable
            </Badge>
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
            <BrowserSupportedFlashRow />
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

function BrowserSupportedFlashRow() {
  const ref = useRef(null);
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-[hsl(var(--chart-3))]/40 bg-[hsl(var(--chart-3))]/5 px-3 py-2 flex items-start gap-2 text-xs">
        <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-[hsl(var(--chart-3))]" />
        <span className="text-foreground/85">
          Votre navigateur supporte Web Serial. Vous pouvez flasher directement.
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center pt-2">
        <esp-web-install-button
          ref={ref}
          manifest="/firmware/manifest-esp8266.json"
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
