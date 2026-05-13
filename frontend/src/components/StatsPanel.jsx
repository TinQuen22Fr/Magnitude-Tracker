import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNum } from "@/lib/format";

export default function StatsPanel({ stats }) {
  const m = stats?.mag || {};
  const lx = stats?.lux || {};
  const tp = stats?.temp || {};
  const count = stats?.count || 0;

  return (
    <Card
      className="border-border/70 bg-card/80 backdrop-blur"
      data-testid="stats-panel"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
            Statistiques de la période
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {count} mesures
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="Min mag"
            value={fmtNum(m.min, 2)}
            testid="stat-min"
            accent="text-[hsl(var(--chart-3))]"
          />
          <Stat
            label="Max mag"
            value={fmtNum(m.max, 2)}
            testid="stat-max"
            accent="text-[hsl(var(--chart-2))]"
          />
          <Stat
            label="Moyenne"
            value={fmtNum(m.avg, 2)}
            testid="stat-avg"
          />
          <Stat
            label="Médiane"
            value={fmtNum(m.median, 2)}
            testid="stat-median"
          />
        </div>
        <div className="mt-4 pt-3 border-t border-border/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-muted-foreground">
          <Mini label="Temp moy." value={`${fmtNum(tp.avg, 1)} °C`} />
          <Mini label="Temp min" value={`${fmtNum(tp.min, 1)} °C`} />
          <Mini label="Temp max" value={`${fmtNum(tp.max, 1)} °C`} />
          <Mini label="Lux moy." value={fmtNum(lx.avg, 4)} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testid, accent }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          "font-mono text-xl sm:text-2xl tabular-nums " + (accent || "")
        }
        data-testid={testid}
      >
        {value}
      </span>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="flex flex-col">
      <span>{label}</span>
      <span className="font-mono text-foreground text-sm">{value}</span>
    </div>
  );
}
