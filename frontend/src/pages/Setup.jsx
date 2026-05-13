import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, KeyRound, Globe2, Code2 } from "lucide-react";
import { fetchInfo, getBackendUrl } from "@/lib/sqmApi";
import { toast } from "sonner";

const BACKEND_URL = getBackendUrl();

export default function Setup() {
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("/api/sqm_push");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchInfo();
        if (cancelled) return;
        setApiKey(info.api_key || "");
        setEndpoint(info.endpoint || "/api/sqm_push");
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Erreur de chargement");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute host parts (host and path) for Config.h-style hardware setups.
  let host = "";
  try {
    host = new URL(BACKEND_URL).host;
  } catch {
    host = BACKEND_URL;
  }
  const path = endpoint || "/api/sqm_push";
  const fullUrl = `${BACKEND_URL}${path}`;

  // GET URL example using the user's exact hardware format.
  const getQuery = `?ID=SQM-001&KEY=${apiKey || "VOTRE_CLE_API"}&S=21.34&D=0.05&T=12.5&H=78.2&P=1013.4&V=3.95&Alt=420&Lat=48.8566&Lon=2.3522`;
  const getUrl = `${fullUrl}${getQuery}`;

  const curlGetExample = `curl -G "${fullUrl}" \\
  --data-urlencode "ID=SQM-001" \\
  --data-urlencode "KEY=${apiKey || "VOTRE_CLE_API"}" \\
  --data-urlencode "S=21.34" \\
  --data-urlencode "D=0.05" \\
  --data-urlencode "T=12.5" \\
  --data-urlencode "H=78.2" \\
  --data-urlencode "P=1013.4" \\
  --data-urlencode "V=3.95" \\
  --data-urlencode "Alt=420" \\
  --data-urlencode "Lat=48.8566" \\
  --data-urlencode "Lon=2.3522"`;

  const curlPostExample = `curl -X POST "${fullUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey || "VOTRE_CLE_API"}" \\
  -d '{"mag": 21.34, "lux": 0.0008, "temp": 12.5}'`;

  const configHExample = `// Config.h — paramètres pour le capteur SQM (HTTP GET)
#ifndef CONFIG_H
#define CONFIG_H

// --- WiFi ------------------------------------------------------------------
#define WIFI_SSID        "VOTRE_WIFI"
#define WIFI_PASSWORD    "VOTRE_MOT_DE_PASSE"

// --- Hôte de réception (SQM Nightwatch) ------------------------------------
#define SQM_HOST         "${host}"      // hôte (sans https://)
#define SQM_PATH         "${path}"   // chemin (app)
#define SQM_PORT         443                              // 443 = HTTPS, 80 = HTTP
#define SQM_USE_HTTPS    1                                // 1 = TLS, 0 = HTTP

// --- Identifiants capteur --------------------------------------------------
#define SQM_DEVICE_ID    "SQM-001"
#define SQM_API_KEY      "${apiKey || "VOTRE_CLE_API"}"

// --- Périodicité d'envoi ---------------------------------------------------
#define SQM_INTERVAL_MS  60000UL    // 60 s entre 2 envois

#endif // CONFIG_H`;

  const arduinoGetExample = `// Exemple Arduino (ESP8266) — envoi HTTP GET avec votre format
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include "Config.h"

void sendMeasure(float S, float D, float T, float H,
                 float P, float V, float Alt, float Lat, float Lon) {
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure(); // simple : sans pin certificat. Sinon utiliser setFingerprint().

  // Construit l'URL avec exactement votre format ?ID=...&KEY=...&S=...
  String url = String("https://") + SQM_HOST + SQM_PATH +
    "?ID="  + String(SQM_DEVICE_ID) +
    "&KEY=" + String(SQM_API_KEY) +
    "&S="   + String(S, 3) +
    "&D="   + String(D, 3) +
    "&T="   + String(T, 2) +
    "&H="   + String(H, 1) +
    "&P="   + String(P, 1) +
    "&V="   + String(V, 2) +
    "&Alt=" + String(Alt, 1) +
    "&Lat=" + String(Lat, 6) +
    "&Lon=" + String(Lon, 6);

  HTTPClient http;
  if (http.begin(*client, url)) {
    int code = http.GET();
    Serial.printf("GET %d\\n", code);
    http.end();
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print('.'); }
  Serial.println("\\nWiFi OK");
}

void loop() {
  // TODO : remplacer par les valeurs réelles lues sur le capteur
  sendMeasure(21.34, 0.05, 12.5, 78.2, 1013.4, 3.95, 420.0, 48.8566, 2.3522);
  delay(SQM_INTERVAL_MS);
}`;

  return (
    <div className="flex flex-col gap-6" data-testid="esp-setup-page">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          Configuration capteur SQM
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paramètres et exemples pour brancher votre capteur SQM (DIY ou
          existant) sur cette application — flux HTTP GET ou POST.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          Erreur : {error}
        </div>
      )}

      {/* Hôte / chemin / clé — ce dont a besoin Config.h */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card className="border-border/70 bg-card/80">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
              <Globe2 className="size-4" /> Hôte (host)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeRow value={host} testid="api-host-value" copyTestId="copy-host-button" loading={loading} />
            <p className="text-xs text-muted-foreground mt-3">
              À renseigner dans <code className="font-mono text-foreground">SQM_HOST</code> de votre <code className="font-mono text-foreground">Config.h</code> (sans <code>https://</code>).
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
                Chemin (app / path)
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">GET ou POST</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <CodeRow value={path} testid="api-path-value" copyTestId="copy-path-button" loading={loading} />
            <p className="text-xs text-muted-foreground mt-3">
              À renseigner dans <code className="font-mono text-foreground">SQM_PATH</code>. Le même chemin accepte le GET (votre format) et le POST (JSON).
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
              <KeyRound className="size-4" /> Clé API
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeRow value={apiKey} testid="api-key-value" copyTestId="copy-api-key-button" loading={loading} />
            <p className="text-xs text-muted-foreground mt-3">
              Paramètre <code className="font-mono text-foreground">KEY</code> en GET, ou en-tête <code className="font-mono text-foreground">X-API-Key</code> en POST.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mode tabs : GET (par défaut) / POST */}
      <Tabs defaultValue="get" data-testid="setup-mode-tabs">
        <TabsList className="bg-muted/30 border border-border/60 p-1 rounded-lg">
          <TabsTrigger value="get" data-testid="setup-tab-get" className="data-[state=active]:bg-background">
            HTTP GET (capteur existant)
          </TabsTrigger>
          <TabsTrigger value="post" data-testid="setup-tab-post" className="data-[state=active]:bg-background">
            HTTP POST (DIY JSON)
          </TabsTrigger>
        </TabsList>

        {/* GET tab */}
        <TabsContent value="get" className="flex flex-col gap-4 sm:gap-6 mt-4 sm:mt-6">
          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
                <Code2 className="size-4" /> Format d'URL accepté (GET)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="get-url-format">
{`${path}?ID=<id>&KEY=<key>&S=<mag>&D=<err>&T=<temp>&H=<hum>&P=<press>&V=<batt>&Alt=<alt>&Lat=<lat>&Lon=<lon>`}
              </pre>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                <Mapping name="S" desc="Magnitude (mag/arcsec²)" />
                <Mapping name="D" desc="Erreur de mesure" />
                <Mapping name="T" desc="Température (°C)" />
                <Mapping name="H" desc="Humidité (%)" />
                <Mapping name="P" desc="Pression (hPa)" />
                <Mapping name="V" desc="Tension batterie (V)" />
                <Mapping name="Alt" desc="Altitude GPS (m)" />
                <Mapping name="Lat" desc="Latitude GPS" />
                <Mapping name="Lon" desc="Longitude GPS" />
                <Mapping name="ID" desc="Identifiant capteur" />
                <Mapping name="KEY" desc="Clé API (= X-API-Key)" required />
                <Mapping name="S" desc="(requis)" required />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
                  Exemple URL prête à coller (test navigateur)
                </CardTitle>
                <CopyButton text={getUrl} testId="copy-get-url-button" />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto break-all whitespace-pre-wrap" data-testid="get-url-example">
{getUrl}
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                Ouvrez cette URL dans votre navigateur pour simuler une mesure. Vous devriez voir la mesure apparaître immédiatement sur le tableau de bord.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
                  Exemple Config.h
                </CardTitle>
                <CopyButton text={configHExample} testId="copy-config-h-button" />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto" data-testid="config-h-example">
{configHExample}
              </pre>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
                  Exemple Arduino (HTTP GET)
                </CardTitle>
                <CopyButton text={arduinoGetExample} testId="copy-arduino-get-button" />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto" data-testid="arduino-get-example">
{arduinoGetExample}
              </pre>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
                  Exemple curl (HTTP GET)
                </CardTitle>
                <CopyButton text={curlGetExample} testId="copy-curl-get-button" />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto" data-testid="curl-get-example">
{curlGetExample}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* POST tab */}
        <TabsContent value="post" className="flex flex-col gap-4 sm:gap-6 mt-4 sm:mt-6">
          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
                <Code2 className="size-4" /> Format JSON attendu (POST)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto">
{`{
  "mag":  21.34,    // float, magnitude (mag/arcsec²)
  "lux":  0.0008,   // float, illuminance (lux)
  "temp": 12.5      // float, température capteur (°C)
}`}
              </pre>
              <Separator className="my-4" />
              <p className="text-xs text-muted-foreground">
                Header requis : <code className="font-mono text-foreground">X-API-Key: &lt;clé&gt;</code>.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
                  Exemple curl (HTTP POST)
                </CardTitle>
                <CopyButton text={curlPostExample} testId="copy-curl-post-button" />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/20 border border-border/60 rounded-lg p-3 font-mono text-xs overflow-x-auto" data-testid="curl-post-example">
{curlPostExample}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="border-border/70 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>
            • Chaque mesure est horodatée par le serveur (UTC) puis ajoutée au fichier local{" "}
            <code className="font-mono text-foreground">sqm_history.json</code> de façon
            atomique (asyncio.Lock + tmp/rename) — aucune corruption sous écritures parallèles.
          </p>
          <p>
            • Le Dashboard affiche la dernière mesure, l'échelle Bortle, la
            courbe de magnitude et — si fournis dans le flux GET — la batterie,
            l'humidité, la pression et le GPS. Auto-refresh toutes les 30 s.
          </p>
          <p>
            • Pour conserver l'historique long terme, gardez simplement le
            fichier <code className="font-mono text-foreground">sqm_history.json</code>{" "}
            (export CSV disponible depuis le Dashboard).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CodeRow({ value, testid, copyTestId, loading }) {
  return (
    <div className="flex items-center gap-2">
      <code
        className="flex-1 bg-muted/20 border border-border/60 rounded-lg px-3 py-2 font-mono text-xs overflow-x-auto text-foreground break-all"
        data-testid={testid}
      >
        {loading ? "Chargement…" : value || "—"}
      </code>
      <CopyButton text={value} testId={copyTestId} />
    </div>
  );
}

function Mapping({ name, desc, required }) {
  return (
    <div className="flex items-baseline gap-2">
      <code className={"font-mono text-foreground " + (required ? "text-[hsl(var(--chart-1))]" : "")}>
        {name}
      </code>
      <span className="text-muted-foreground">{desc}</span>
    </div>
  );
}

function CopyButton({ text, testId, label }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      toast.success("Copié !");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Impossible de copier");
    }
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onCopy}
      data-testid={testId}
      className="shrink-0"
    >
      {copied ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
      {label || (copied ? "Copié" : "Copier")}
    </Button>
  );
}
