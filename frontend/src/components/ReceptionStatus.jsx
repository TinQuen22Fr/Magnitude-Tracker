import { useEffect, useState } from "react";
import { fetchLatest } from "@/lib/sqmApi";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNightMode } from "@/lib/nightMode";

/**
 * Pastille d'état réception dans le header.
 *  - vert    : dernière mesure < 2 min
 *  - orange  : 2 → 10 min
 *  - rouge   : > 10 min ou aucune
 *
 * En mode nuit astronomique, les 3 états sont déclinés en nuances de
 * rouge (luminance différente) pour préserver la vision scotopique.
 */
export default function ReceptionStatus() {
  const [latest, setLatest] = useState(null);
  const [tick, setTick] = useState(0);
  const { isNight } = useNightMode();

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

  // Détermine la sévérité (state) puis applique le bon couple de couleurs
  let state = "ko";
  let label = "Aucune mesure";
  if (latest?.ts) {
    const ageMs = Date.now() - new Date(latest.ts).getTime();
    const min = ageMs / 60000;
    if (min < 2) state = "ok";
    else if (min < 10) state = "warn";
    else state = "ko";
    label = `Reçu ${fmtRelative(latest.ts)}`;
  }

  // Palette adaptative : mode jour = vert/orange/rouge classique ;
  // mode nuit = dégradé de rouges uniquement.
  const palette = isNight
    ? {
        ok: { dot: "hsl(0 95% 60%)", ring: "rgba(255, 60, 60, 0.25)" },
        warn: { dot: "hsl(0 80% 45%)", ring: "rgba(200, 40, 40, 0.25)" },
        ko: { dot: "hsl(0 70% 32%)", ring: "rgba(140, 25, 25, 0.30)" },
      }
    : {
        ok: { dot: "#10b981", ring: "rgba(16, 185, 129, 0.25)" }, // emerald-500
        warn: { dot: "#f59e0b", ring: "rgba(245, 158, 11, 0.25)" }, // amber-500
        ko: { dot: "#a93b3b", ring: "rgba(169, 59, 59, 0.30)" }, // destructive
      };
  const colors = palette[state];

  void tick; // garde le re-render relatif au tick

  return (
    <div
      className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground border border-border/60 bg-secondary/30 rounded-full px-2 sm:px-3 py-1 sm:py-1.5"
      data-testid="reception-status"
      title={latest?.ts || "Aucune mesure reçue"}
    >
      <span
        className={cn("inline-block size-2 rounded-full")}
        style={{
          backgroundColor: colors.dot,
          boxShadow: `0 0 0 4px ${colors.ring}`,
        }}
        data-testid="reception-status-dot"
      />
      <span data-testid="reception-status-text" className="hidden sm:inline">{label}</span>
    </div>
  );
}
