import { useEffect, useState } from "react";
import { fetchLatest } from "@/lib/sqmApi";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Header reception status pill.
 * - Green dot if last measurement < 2min
 * - Amber dot if 2-10min
 * - Red dot if > 10min or none
 */
export default function ReceptionStatus() {
  const [latest, setLatest] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchLatest();
        if (!cancelled) setLatest(res?.data || null);
      } catch {
        // silent
      }
    };
    load();
    const id = setInterval(load, 30000);
    const tickId = setInterval(() => setTick((t) => t + 1), 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(tickId);
    };
  }, []);

  let color = "bg-destructive";
  let ringColor = "ring-destructive/30";
  let label = "Aucune mesure";
  if (latest?.ts) {
    const ageMs = Date.now() - new Date(latest.ts).getTime();
    const min = ageMs / 60000;
    if (min < 2) {
      color = "bg-emerald-500";
      ringColor = "ring-emerald-500/25";
      label = `Reçu ${fmtRelative(latest.ts)}`;
    } else if (min < 10) {
      color = "bg-amber-500";
      ringColor = "ring-amber-500/25";
      label = `Reçu ${fmtRelative(latest.ts)}`;
    } else {
      color = "bg-destructive";
      ringColor = "ring-destructive/30";
      label = `Reçu ${fmtRelative(latest.ts)}`;
    }
  }
  // tick is read so React keeps re-rendering the relative time
  void tick;

  return (
    <div
      className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground border border-border/60 bg-secondary/30 rounded-full px-2 sm:px-3 py-1 sm:py-1.5"
      data-testid="reception-status"
      title={latest?.ts || "Aucune mesure reçue"}
    >
      <span
        className={cn(
          "inline-block size-2 rounded-full ring-2 sm:ring-4",
          color,
          ringColor
        )}
        data-testid="reception-status-dot"
      />
      <span data-testid="reception-status-text">{label}</span>
    </div>
  );
}
