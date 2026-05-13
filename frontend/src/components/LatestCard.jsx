import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Moon, Sun, Thermometer, Clock } from "lucide-react";
import { fmtDateTime, fmtNum, fmtLux, fmtRelative } from "@/lib/format";
import { classifyMag } from "@/lib/skyQuality";

export default function LatestCard({ data, count, loading }) {
  const quality = data ? classifyMag(data.mag) : null;

  return (
    <Card
      className="border-border/70 bg-card/80 backdrop-blur"
      data-testid="last-measure-card"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
              Dernière mesure
            </CardTitle>
            <p className="text-xs text-muted-foreground/80 flex items-center gap-1.5">
              <Clock className="size-3" />
              {data?.ts ? (
                <span data-testid="last-measure-timestamp">
                  {fmtDateTime(data.ts)} · {fmtRelative(data.ts)}
                </span>
              ) : (
                <span data-testid="last-measure-timestamp">
                  En attente de la première mesure…
                </span>
              )}
            </p>
          </div>
          {quality && (
            <Badge
              variant="outline"
              className="shrink-0 border-border/70 bg-secondary/30 font-medium text-xs gap-1.5"
              data-testid="last-measure-quality-badge"
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: quality.hex }}
                aria-hidden
              />
              <span data-testid="sky-quality-label">{quality.label}</span>
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {loading && !data ? (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Metric
              icon={<Moon className="size-3.5 text-[hsl(var(--chart-2))]" />}
              label="Magnitude"
              unit="mag/arcsec²"
              value={data ? fmtNum(data.mag, 2) : "—"}
              testid="last-measure-mag"
              big
            />
            <Metric
              icon={<Sun className="size-3.5 text-[hsl(var(--chart-4))]" />}
              label="Lux"
              unit="lx"
              value={data ? fmtLux(data.lux) : "—"}
              testid="last-measure-lux"
            />
            <Metric
              icon={
                <Thermometer className="size-3.5 text-[hsl(var(--chart-1))]" />
              }
              label="Température"
              unit="°C"
              value={data ? fmtNum(data.temp, 1) : "—"}
              testid="last-measure-temp"
            />
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>Total de mesures enregistrées</span>
          <span className="font-mono" data-testid="total-count">
            {count ?? 0}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ icon, label, unit, value, testid, big }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={
          "font-mono tabular-nums tracking-tight " +
          (big ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl")
        }
        data-testid={testid}
      >
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{unit}</div>
    </div>
  );
}
