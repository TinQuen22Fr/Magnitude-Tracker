/**
 * Hook + Provider Mode Nuit Astronomique.
 *
 * Le mode nuit applique une palette rouge profond exclusive (préservation
 * de la vision scotopique) sur toute l'app via la classe CSS `.night-mode`
 * appliquée sur <html>.
 *
 * Sources d'activation :
 *   1. Toggle manuel utilisateur (icône dans le header)
 *   2. Plage horaire automatique 21h → 6h (locale machine) — opt-in via Settings
 *
 * Persistance localStorage :
 *   - sqm_night_mode  : "true" / "false" — état manuel
 *   - sqm_night_auto  : "true" / "false" — auto-activation horaire
 *
 * Un petit script anti-FOUC dans public/index.html applique la classe AVANT
 * le render React pour éviter le flash blanc/bleu au chargement.
 */
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

const NightModeContext = createContext(null);

const LS_MANUAL = "sqm_night_mode";
const LS_AUTO = "sqm_night_auto";

// Plage horaire considérée "nuit astronomique" pour l'auto-mode.
// 21h00 inclus -> 06h00 exclu (heure locale).
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;

function isNightHourNow() {
  const h = new Date().getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

function readBool(key, fallback = false) {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "true";
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    /* localStorage saturé / mode privé */
  }
}

export function NightModeProvider({ children }) {
  const [manual, setManual] = useState(() => readBool(LS_MANUAL, false));
  const [autoSchedule, setAutoSchedule] = useState(() => readBool(LS_AUTO, false));
  // tick rafraîchi toutes les minutes pour que l'auto-mode bascule à 21h00
  // sans nécessiter un refresh manuel.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!autoSchedule) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [autoSchedule]);

  const isNight = useMemo(() => {
    if (manual) return true;
    if (autoSchedule && isNightHourNow()) return true;
    return false;
  }, [manual, autoSchedule]);

  // Applique / retire la classe sur <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (isNight) {
      root.classList.add("night-mode");
      // Le color-scheme du navigateur dirige les scrollbars natives,
      // bordures par défaut, etc. On reste sur "dark" qui est le plus
      // proche cosmétiquement.
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("night-mode");
      root.style.colorScheme = "dark";
    }
  }, [isNight]);

  const toggleManual = useCallback(() => {
    setManual((prev) => {
      const next = !prev;
      writeBool(LS_MANUAL, next);
      return next;
    });
  }, []);

  const setManualState = useCallback((value) => {
    setManual(value);
    writeBool(LS_MANUAL, value);
  }, []);

  const setAutoScheduleState = useCallback((value) => {
    setAutoSchedule(value);
    writeBool(LS_AUTO, value);
  }, []);

  const value = useMemo(
    () => ({
      isNight,
      manual,
      autoSchedule,
      toggleManual,
      setManual: setManualState,
      setAutoSchedule: setAutoScheduleState,
      nightHourWindow: { start: NIGHT_START_HOUR, end: NIGHT_END_HOUR },
    }),
    [isNight, manual, autoSchedule, toggleManual, setManualState, setAutoScheduleState]
  );

  return <NightModeContext.Provider value={value}>{children}</NightModeContext.Provider>;
}

export function useNightMode() {
  const ctx = useContext(NightModeContext);
  if (!ctx) {
    throw new Error("useNightMode doit être utilisé dans un <NightModeProvider>");
  }
  return ctx;
}
