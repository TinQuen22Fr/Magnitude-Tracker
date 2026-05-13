import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const PERIOD_OPTIONS = [
  { value: "1h", label: "1\u202fh", ms: 60 * 60 * 1000 },
  { value: "6h", label: "6\u202fh", ms: 6 * 60 * 60 * 1000 },
  { value: "24h", label: "24\u202fh", ms: 24 * 60 * 60 * 1000 },
  { value: "7d", label: "7\u202fj", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "30\u202fj", ms: 30 * 24 * 60 * 60 * 1000 },
  { value: "all", label: "Tout", ms: null },
];

export function periodSinceIso(value) {
  const opt = PERIOD_OPTIONS.find((o) => o.value === value);
  if (!opt || opt.ms === null) return null;
  return new Date(Date.now() - opt.ms).toISOString();
}

export default function PeriodSelector({ value, onChange }) {
  return (
    <Tabs
      value={value}
      onValueChange={onChange}
      data-testid="period-selector"
      className="w-full sm:w-auto"
    >
      <TabsList className="bg-muted/30 border border-border/60 p-1 rounded-lg flex w-full sm:w-auto h-auto">
        {PERIOD_OPTIONS.map((opt) => (
          <TabsTrigger
            key={opt.value}
            value={opt.value}
            data-testid={`period-tab-${opt.value}`}
            className="flex-1 sm:flex-initial data-[state=active]:bg-background data-[state=active]:text-foreground text-xs sm:text-xs font-mono h-9 sm:h-8 px-2 sm:px-3"
          >
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
