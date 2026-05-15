import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BORTLE_SEGMENTS, bortleFromMag, classifyMag, toNightRed } from "@/lib/skyQuality";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { useNightMode } from "@/lib/nightMode";

export default function BortleIndicator({ mag }) {
  const active = bortleFromMag(mag);
  const quality = classifyMag(mag);
  const { isNight } = useNightMode();
  const colorize = (hex) => (isNight ? toNightRed(hex) : hex);

  return (
    <Card
      className="border-border/70 bg-card/80 backdrop-blur h-full"
      data-testid="bortle-indicator"
    >
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase">
          Qualité du ciel — Échelle Bortle
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={150}>
          <div className="flex items-end gap-1.5">
            {BORTLE_SEGMENTS.map((seg) => {
              const isActive = active === seg.level;
              return (
                <Tooltip key={seg.level}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "flex-1 flex flex-col items-center gap-1 cursor-help select-none",
                        isActive ? "opacity-100" : "opacity-70"
                      )}
                      data-testid={
                        isActive ? "bortle-active-level" : `bortle-level-${seg.level}`
                      }
                    >
                      <div
                        className={cn(
                          "w-full rounded-sm border",
                          isActive
                            ? "h-7 border-foreground/70 ring-1 ring-foreground/40"
                            : "h-4 border-border/60"
                        )}
                        style={{ backgroundColor: colorize(seg.hex) }}
                      />
                      <span
                        className={cn(
                          "text-[10px] font-mono",
                          isActive ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {seg.level}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span className="text-xs">
                      Bortle {seg.level} — {seg.label}
                    </span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        <div className="mt-4 pt-3 border-t border-border/50 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Magnitude actuelle</span>
            <span className="font-mono text-lg">
              {mag !== null && mag !== undefined ? fmtNum(mag, 2) : "—"}
              <span className="text-[10px] text-muted-foreground ml-1">
                mag/arcsec²
              </span>
            </span>
          </div>
          {quality && (
            <div className="flex items-center gap-2 text-xs">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: colorize(quality.hex) }}
              />
              <span className="text-muted-foreground">{quality.description}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
