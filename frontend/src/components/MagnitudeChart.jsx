import { useState, useRef, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MapPin,
  ExternalLink,
  X,
  MousePointerClick,
  ChevronLeft,
  ChevronRight,
  StepForward,
  AlertTriangle,
} from "lucide-react";
import { fmtNum, fmtTime, fmtDateTime } from "@/lib/format";
import { useNightMode } from "@/lib/nightMode";

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const hasGps =
    d.gps &&
    d.gps.lat !== null &&
    d.gps.lat !== undefined &&
    d.gps.lon !== null &&
    d.gps.lon !== undefined;
  return (
    <div
      className="rounded-md border border-border/70 bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg min-w-[220px]"
      data-testid="magnitude-chart-tooltip"
    >
      <div className="text-muted-foreground mb-1 font-mono">
        {fmtDateTime(d.ts)}
      </div>
      <div className="font-mono text-foreground space-y-0.5">
        <div>
          Magnitude :{" "}
          <span className="text-[hsl(var(--chart-2))]">{fmtNum(d.mag, 2)}</span>{" "}
          <span className="text-muted-foreground">mag/arcsec²</span>
        </div>
        {d.temp !== undefined && d.temp !== null && (
          <div className="text-muted-foreground">
            Température :{" "}
            <span className="text-foreground">{fmtNum(d.temp, 1)}</span> °C
          </div>
        )}
        {d.battery !== undefined && d.battery !== null && (
          <div className="text-muted-foreground">
            Batterie :{" "}
            <span className="text-foreground">{fmtNum(d.battery, 2)}</span> V
          </div>
        )}
      </div>
      {hasGps && (
        <div className="mt-2 pt-2 border-t border-border/50 font-mono">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
            <MapPin className="size-3" />
            <span>Position GPS</span>
          </div>
          <div className="text-foreground">
            {fmtNum(d.gps.lat, 4)}°, {fmtNum(d.gps.lon, 4)}°
          </div>
        </div>
      )}
      <div className="mt-2 text-[10px] text-muted-foreground/80 italic">
        Touchez pour épingler le relevé ↓
      </div>
    </div>
  );
}

function osmExternalUrl(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

/**
 * URL "embed" d'OpenStreetMap (iframe) centrée sur lat/lon avec marqueur.
 * On calcule une bbox de ±0.005° autour du point (zoom ~15).
 */
function osmEmbedUrl(lat, lon) {
  const d = 0.005;
  const west = lat - d;
  const east = lat + d;
  const south = lon - d;
  const north = lon + d;
  // OSM attend l'ordre: bbox=lonMin,latMin,lonMax,latMax
  const bbox = `${south},${west},${north},${east}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

/**
 * Bouton + Dialog : ouvre la carte OSM EMBARQUÉE dans une modal.
 * En mode nuit, l'iframe est filtrée en rouge pour préserver la vision
 * scotopique. Un lien secondaire permet d'ouvrir OSM dans un nouvel
 * onglet (assorti d'un avertissement en mode nuit).
 */
function GpsMapDialog({ lat, lon }) {
  const { isNight } = useNightMode();
  const [open, setOpen] = useState(false);
  const externalUrl = osmExternalUrl(lat, lon);
  const embedUrl = osmEmbedUrl(lat, lon);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto sm:self-start h-11 sm:h-10 text-sm font-medium text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2))]/40 hover:border-[hsl(var(--chart-2))]/60"
          data-testid="selected-gps-map-link"
        >
          <MapPin className="size-4" />
          Voir sur la carte
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-3xl w-[min(96vw,768px)] p-0 overflow-hidden bg-card border-border/70"
        data-testid="gps-map-dialog"
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="font-display text-base flex items-center gap-2">
            <MapPin className="size-4 text-[hsl(var(--chart-1))]" />
            Position du capteur
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Lat {fmtNum(lat, 6)}° · Lon {fmtNum(lon, 6)}°
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pb-2">
          <div
            className={
              "relative w-full aspect-[16/10] rounded-md overflow-hidden border border-border/60 " +
              (isNight ? "osm-night-filter" : "")
            }
          >
            <iframe
              title="OpenStreetMap"
              src={embedUrl}
              className="absolute inset-0 w-full h-full"
              loading="lazy"
              referrerPolicy="no-referrer"
              data-testid="gps-map-iframe"
            />
          </div>
        </div>

        <div className="px-4 pb-4 pt-1 flex flex-col gap-2">
          {isNight && (
            <div
              className="rounded-md border border-[hsl(var(--chart-1))]/40 bg-[hsl(var(--chart-1))]/5 px-3 py-2 flex items-start gap-2 text-xs"
              data-testid="gps-map-night-warning"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-[hsl(var(--chart-1))]" />
              <span className="text-foreground/85">
                Mode nuit actif. Ouvrir la carte dans un nouvel onglet
                affichera les couleurs OpenStreetMap d'origine
                (blanc/bleu/vert) — votre vision scotopique sera perdue.
              </span>
            </div>
          )}
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
            data-testid="gps-map-external-link"
          >
            <ExternalLink className="size-3.5" />
            Ouvrir dans un nouvel onglet (OpenStreetMap)
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectedMeasurePanel({
  data,
  total,
  currentIndex,
  onPrev,
  onNext,
  onLatest,
  onClose,
}) {
  if (!data) return null;
  const hasGps =
    data.gps &&
    data.gps.lat !== null &&
    data.gps.lat !== undefined &&
    data.gps.lon !== null &&
    data.gps.lon !== undefined;

  const canPrev = currentIndex > 0;
  const canNext = currentIndex < total - 1;

  return (
    <div
      className="mt-4 rounded-lg border border-[hsl(var(--chart-2))]/40 bg-muted/20 p-3 sm:p-4"
      data-testid="selected-measure-panel"
    >
      {/* Header : titre + close */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground uppercase tracking-wide">
            <MousePointerClick className="size-3.5" />
            <span>Mesure sélectionnée</span>
            <span className="font-mono text-foreground/70">
              {currentIndex + 1} / {total}
            </span>
          </div>
          <div
            className="font-mono text-sm sm:text-base text-foreground mt-1 break-words"
            data-testid="selected-measure-datetime"
          >
            {fmtDateTime(data.ts)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-9 w-9 shrink-0 -mt-1 -mr-1"
          aria-label="Fermer le panneau"
          data-testid="selected-measure-close"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Navigation prev / next / latest — boutons larges (touch 44px) */}
      <div className="flex items-stretch gap-2 mb-3" data-testid="selected-measure-nav">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={!canPrev}
          className="flex-1 h-11 gap-1.5"
          data-testid="selected-measure-prev"
        >
          <ChevronLeft className="size-4" />
          <span>Précédent</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!canNext}
          className="flex-1 h-11 gap-1.5"
          data-testid="selected-measure-next"
        >
          <span>Suivant</span>
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onLatest}
          className="h-11 px-3 gap-1.5"
          data-testid="selected-measure-latest"
          aria-label="Aller à la dernière mesure"
        >
          <StepForward className="size-4" />
          <span className="hidden sm:inline">Dernière</span>
        </Button>
      </div>

      {/* Grille des champs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <Field
          label="Magnitude"
          value={`${fmtNum(data.mag, 2)} mag/arcsec²`}
          accent="text-[hsl(var(--chart-2))]"
          testid="selected-mag"
        />
        {data.temp !== undefined && data.temp !== null && (
          <Field label="Température" value={`${fmtNum(data.temp, 1)} °C`} testid="selected-temp" />
        )}
        {data.battery !== undefined && data.battery !== null && (
          <Field label="Batterie" value={`${fmtNum(data.battery, 2)} V`} testid="selected-battery" />
        )}
        {data.humidity !== undefined && data.humidity !== null && (
          <Field label="Humidité" value={`${fmtNum(data.humidity, 1)} %`} testid="selected-humidity" />
        )}
        {data.pressure !== undefined && data.pressure !== null && (
          <Field label="Pression" value={`${fmtNum(data.pressure, 1)} hPa`} testid="selected-pressure" />
        )}
        {data.error !== undefined && data.error !== null && (
          <Field label="Erreur mesure" value={`± ${fmtNum(data.error, 3)}`} testid="selected-error" />
        )}
        {data.device_id && (
          <Field label="Capteur" value={data.device_id} testid="selected-device-id" />
        )}
      </div>

      {/* GPS + lien carte */}
      {hasGps ? (
        <div
          className="mt-4 pt-3 border-t border-border/60 flex flex-col gap-3"
          data-testid="selected-gps-block"
        >
          <div className="flex items-start gap-2 text-xs">
            <MapPin className="size-4 text-[hsl(var(--chart-1))] shrink-0 mt-0.5" />
            <div className="font-mono text-foreground break-all">
              <div>
                Lat <span data-testid="selected-gps-lat">{fmtNum(data.gps.lat, 6)}</span>°{" "}
                · Lon <span data-testid="selected-gps-lon">{fmtNum(data.gps.lon, 6)}</span>°
              </div>
              {data.gps.alt !== null && data.gps.alt !== undefined && (
                <div className="text-muted-foreground">
                  Alt <span data-testid="selected-gps-alt">{fmtNum(data.gps.alt, 0)}</span> m
                </div>
              )}
            </div>
          </div>
          <GpsMapDialog lat={data.gps.lat} lon={data.gps.lon} />
        </div>
      ) : (
        <div className="mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground italic">
          Aucune position GPS enregistrée pour cette mesure.
        </div>
      )}
    </div>
  );
}

function Field({ label, value, accent, testid }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span
        className={
          "font-mono text-sm sm:text-base break-words " +
          (accent || "text-foreground")
        }
        data-testid={testid}
      >
        {value}
      </span>
    </div>
  );
}

export default function MagnitudeChart({ history, loading, periodLabel }) {
  // selectedIndex : index dans le tableau `data` ; null = aucune sélection
  const [selectedIndex, setSelectedIndex] = useState(null);
  const containerRef = useRef(null);

  const data = (history || []).map((d) => ({
    ts: d.ts,
    label: fmtTime(d.ts),
    mag: Number(d.mag),
    temp: typeof d.temp === "number" ? d.temp : null,
    battery: typeof d.battery === "number" ? d.battery : null,
    humidity: typeof d.humidity === "number" ? d.humidity : null,
    pressure: typeof d.pressure === "number" ? d.pressure : null,
    error: typeof d.error === "number" ? d.error : null,
    gps: d.gps || null,
    device_id: d.device_id || null,
  }));

  // Si l'historique change et qu'on avait une sélection hors-bornes, on clamp
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= data.length) {
      setSelectedIndex(data.length > 0 ? data.length - 1 : null);
    }
  }, [data.length, selectedIndex]);

  // Y domain auto
  let yMin = 18, yMax = 22;
  if (data.length > 0) {
    const mags = data.map((d) => d.mag).filter((v) => !isNaN(v));
    if (mags.length) {
      const dmin = Math.min(...mags);
      const dmax = Math.max(...mags);
      yMin = Math.max(0, Math.floor((dmin - 0.3) * 10) / 10);
      yMax = Math.min(25, Math.ceil((dmax + 0.3) * 10) / 10);
      if (yMax - yMin < 0.3) yMax = yMin + 0.3;
    }
  }

  // Recharts envoie state.activeIndex (string ou number selon les versions).
  // On sélectionne le point le plus proche peu importe où l'on tape sur le chart.
  const handleChartClick = (state) => {
    if (!state) return;
    const raw = state.activeIndex;
    const idx = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (Number.isInteger(idx) && idx >= 0 && idx < data.length) {
      setSelectedIndex(idx);
      // Petite vibration tactile en feedback (si supportée par le navigateur mobile)
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(10); } catch (_) { /* ignore */ }
      }
    }
  };

  const selected = selectedIndex !== null ? data[selectedIndex] : null;

  const handlePrev = () => {
    if (selectedIndex !== null && selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
  };
  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < data.length - 1)
      setSelectedIndex(selectedIndex + 1);
  };
  const handleLatest = () => {
    if (data.length > 0) setSelectedIndex(data.length - 1);
  };

  // Quand on sélectionne via les boutons, scroller doucement le panneau dans la vue
  useEffect(() => {
    if (selected && containerRef.current) {
      // Donne le temps au DOM de monter le panneau
      const t = setTimeout(() => {
        const panel = containerRef.current.querySelector(
          '[data-testid="selected-measure-panel"]'
        );
        if (panel && typeof panel.scrollIntoView === "function") {
          panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 80);
      return () => clearTimeout(t);
    }
  }, [selectedIndex, selected]);

  return (
    <Card
      ref={containerRef}
      className="border-border/70 bg-card/80 backdrop-blur"
      data-testid="magnitude-chart-card"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
            Évolution de la magnitude
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {periodLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {/* Hauteur plus grande sur mobile pour faciliter le tap */}
        <div className="h-80 sm:h-80 touch-manipulation select-none" data-testid="magnitude-chart">
          {loading && data.length === 0 ? (
            <Skeleton className="h-full w-full" />
          ) : data.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 12, right: 18, left: 4, bottom: 4 }}
                onClick={handleChartClick}
              >
                <CartesianGrid
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.4}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  minTickGap={40}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[yMin, yMax]}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  width={56}
                  allowDecimals
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{
                    stroke: "hsl(var(--chart-1))",
                    strokeDasharray: "3 3",
                    strokeOpacity: 0.55,
                    strokeWidth: 1.5,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="mag"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2.5}
                  dot={
                    data.length <= 120
                      ? {
                          r: 2.5,
                          stroke: "hsl(var(--chart-2))",
                          fill: "hsl(var(--background))",
                          strokeWidth: 1.5,
                        }
                      : false
                  }
                  // activeDot agrandi pour faciliter le tap mobile
                  activeDot={{
                    r: 7,
                    fill: "hsl(var(--chart-1))",
                    stroke: "hsl(var(--background))",
                    strokeWidth: 2,
                    cursor: "pointer",
                  }}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Aide quand pas de sélection — visible mobile/desktop */}
        {!selected && data.length > 0 && (
          <div className="mt-3 text-[11px] sm:text-xs text-muted-foreground flex items-start sm:items-center gap-1.5">
            <MousePointerClick className="size-3.5 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              Touchez n'importe où sur la courbe pour épingler le relevé le plus
              proche. Vous pourrez ensuite naviguer avec ◀ ▶.
            </span>
          </div>
        )}

        <SelectedMeasurePanel
          data={selected}
          total={data.length}
          currentIndex={selectedIndex ?? 0}
          onPrev={handlePrev}
          onNext={handleNext}
          onLatest={handleLatest}
          onClose={() => setSelectedIndex(null)}
        />
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4">
      <div className="size-10 rounded-full border border-dashed border-border/70 flex items-center justify-center text-muted-foreground/70">
        ···
      </div>
      <div className="text-sm text-muted-foreground">
        En attente des premières mesures du capteur…
      </div>
      <div className="text-[11px] text-muted-foreground/80">
        Configurez votre ESP8266 dans l'onglet « Configuration » pour commencer
        la réception.
      </div>
    </div>
  );
}
