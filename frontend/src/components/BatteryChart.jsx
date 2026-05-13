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
import { fmtNum, fmtTime, fmtDateTime } from "@/lib/format";

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border/70 bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground mb-1">{fmtDateTime(d.ts)}</div>
      <div className="font-mono text-foreground">
        Batterie : <span className="text-[hsl(var(--chart-3))]">{fmtNum(d.battery, 2)}</span>{" "}
        <span className="text-muted-foreground">V</span>
      </div>
    </div>
  );
}

export default function BatteryChart({ history, periodLabel }) {
  const data = (history || [])
    .filter((d) => d.battery !== undefined && d.battery !== null)
    .map((d) => ({
      ts: d.ts,
      label: fmtTime(d.ts),
      battery: Number(d.battery),
    }));

  if (data.length === 0) return null;

  let yMin = 3.0, yMax = 4.3;
  const vals = data.map((d) => d.battery);
  if (vals.length) {
    yMin = Math.max(2.5, Math.floor((Math.min(...vals) - 0.05) * 10) / 10);
    yMax = Math.min(5.0, Math.ceil((Math.max(...vals) + 0.05) * 10) / 10);
    if (yMax - yMin < 0.2) yMax = yMin + 0.2;
  }

  return (
    <Card
      className="border-border/70 bg-card/80 backdrop-blur"
      data-testid="battery-chart-card"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
            Tension batterie
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {periodLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-44 sm:h-52" data-testid="battery-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 18, left: 4, bottom: 4 }}
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
                minTickGap={50}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[yMin, yMax]}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                width={48}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: "hsl(var(--chart-1))",
                  strokeDasharray: "3 3",
                  strokeOpacity: 0.5,
                }}
              />
              <Line
                type="monotone"
                dataKey="battery"
                stroke="hsl(var(--chart-3))"
                strokeWidth={2.5}
                dot={data.length <= 80
                  ? { r: 2.5, stroke: "hsl(var(--chart-3))", fill: "hsl(var(--background))", strokeWidth: 1.5 }
                  : false
                }
                activeDot={{ r: 4.5, fill: "hsl(var(--chart-1))", stroke: "hsl(var(--chart-1))" }}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
