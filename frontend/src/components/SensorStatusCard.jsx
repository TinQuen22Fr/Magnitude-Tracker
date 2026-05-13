import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Battery, BatteryLow, Droplets, Gauge, MapPin, Cpu, AlertCircle } from "lucide-react";
import { fmtNum } from "@/lib/format";

/**
 * Carte « Status capteur » : batterie + météo + GPS + ID + erreur de mesure.
 * Ne s'affiche que si AU MOINS un de ces champs étendus est présent dans la dernière mesure.
 */
export default function SensorStatusCard({ data }) {
  if (!data) return null;
  const hasAny =
    data.battery !== undefined && data.battery !== null
      ? true
      : data.humidity !== undefined && data.humidity !== null
      ? true
      : data.pressure !== undefined && data.pressure !== null
      ? true
      : data.gps && (data.gps.lat !== null || data.gps.lon !== null || data.gps.alt !== null)
      ? true
      : data.device_id
      ? true
      : data.error !== undefined && data.error !== null
      ? true
      : false;
  if (!hasAny) return null;

  const battery = typeof data.battery === "number" ? data.battery : null;
  // Heuristic for LiPo cell ~3.0V empty / ~4.2V full
  const batteryPct =
    battery !== null
      ? Math.max(0, Math.min(100, Math.round(((battery - 3.2) / (4.2 - 3.2)) * 100)))
      : null;
  const batteryLow = battery !== null && battery < 3.5;

  return (
    <Card
      className="border-border/70 bg-card/80 backdrop-blur"
      data-testid="sensor-status-card"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
            Status du capteur
          </CardTitle>
          {data.device_id && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] gap-1.5"
              data-testid="device-id-badge"
            >
              <Cpu className="size-3" />
              {data.device_id}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {battery !== null && (
            <Item
              icon={
                batteryLow ? (
                  <BatteryLow className="size-3.5 text-[hsl(var(--chart-1))]" />
                ) : (
                  <Battery className="size-3.5 text-[hsl(var(--chart-3))]" />
                )
              }
              label="Batterie"
              value={`${fmtNum(battery, 2)} V`}
              sub={batteryPct !== null ? `${batteryPct} %` : null}
              testid="status-battery"
              warn={batteryLow}
            />
          )}
          {data.humidity !== undefined && data.humidity !== null && (
            <Item
              icon={<Droplets className="size-3.5 text-[hsl(var(--chart-2))]" />}
              label="Humidité"
              value={`${fmtNum(data.humidity, 1)} %`}
              testid="status-humidity"
            />
          )}
          {data.pressure !== undefined && data.pressure !== null && (
            <Item
              icon={<Gauge className="size-3.5 text-[hsl(var(--chart-4))]" />}
              label="Pression"
              value={`${fmtNum(data.pressure, 1)} hPa`}
              testid="status-pressure"
            />
          )}
          {data.error !== undefined && data.error !== null && (
            <Item
              icon={<AlertCircle className="size-3.5 text-[hsl(var(--chart-1))]" />}
              label="Erreur mesure"
              value={`± ${fmtNum(data.error, 3)}`}
              testid="status-error"
            />
          )}
        </div>

        {data.gps && (data.gps.lat !== null || data.gps.lon !== null || data.gps.alt !== null) && (
          <div
            className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
            data-testid="status-gps"
          >
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" />
              <span className="text-muted-foreground/80">GPS</span>
            </span>
            {data.gps.lat !== null && data.gps.lat !== undefined && (
              <span className="font-mono text-foreground">
                Lat {fmtNum(data.gps.lat, 4)}°
              </span>
            )}
            {data.gps.lon !== null && data.gps.lon !== undefined && (
              <span className="font-mono text-foreground">
                Lon {fmtNum(data.gps.lon, 4)}°
              </span>
            )}
            {data.gps.alt !== null && data.gps.alt !== undefined && (
              <span className="font-mono text-foreground">
                Alt {fmtNum(data.gps.alt, 0)} m
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Item({ icon, label, value, sub, testid, warn }) {
  return (
    <div
      className={
        "rounded-lg border bg-muted/20 p-3 flex flex-col gap-1 " +
        (warn ? "border-[hsl(var(--chart-1))]/40" : "border-border/60")
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className="font-mono text-lg sm:text-xl tabular-nums"
        data-testid={testid}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
