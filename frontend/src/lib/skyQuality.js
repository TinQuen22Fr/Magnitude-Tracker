// Sky quality classification based on SQM magnitude (mag/arcsec^2)
// Mapping aligned with the Bortle scale (approximation).

export const QUALITY_LEVELS = [
  {
    key: "exceptional",
    label: "Ciel Noir Exceptionnel",
    short: "Exceptionnel",
    bortle: 1,
    minMag: 21.75,
    description: "Bortle 1 — Ciel noir exceptionnel. Voie lactée très contrastée.",
    colorVar: "--chart-1",
    hex: "#FF3B5C",
  },
  {
    key: "very_dark",
    label: "Ciel Très Sombre",
    short: "Très sombre",
    bortle: 2,
    minMag: 21.5,
    description: "Bortle 2 — Ciel très sombre, sites de qualité.",
    colorVar: "--chart-2",
    hex: "#3A82FF",
  },
  {
    key: "rural",
    label: "Ciel Rural",
    short: "Rural",
    bortle: 3,
    minMag: 21.25,
    description: "Bortle 3 — Ciel rural. Voie lactée visible.",
    colorVar: "--chart-3",
    hex: "#2FBF8F",
  },
  {
    key: "rural_suburban",
    label: "Rural / Périurbain",
    short: "Périurbain",
    bortle: 4,
    minMag: 20.5,
    description: "Bortle 4 — Transition rural / banlieue.",
    colorVar: "--chart-3",
    hex: "#2FBF8F",
  },
  {
    key: "suburban",
    label: "Ciel de Banlieue",
    short: "Banlieue",
    bortle: 5,
    minMag: 19.5,
    description: "Bortle 5 — Banlieue. Voie lactée à peine perceptible.",
    colorVar: "--chart-4",
    hex: "#D6A24A",
  },
  {
    key: "bright_suburb",
    label: "Banlieue Lumineuse",
    short: "B. lumineuse",
    bortle: 6,
    minMag: 18.75,
    description: "Bortle 6–7 — Banlieue lumineuse / transition urbaine.",
    colorVar: "--chart-4",
    hex: "#D6A24A",
  },
  {
    key: "urban",
    label: "Ciel Urbain",
    short: "Urbain",
    bortle: 8,
    minMag: 0,
    description: "Bortle 8–9 — Ciel urbain. Pollution lumineuse importante.",
    colorVar: "--destructive",
    hex: "#A93B3B",
  },
];

// 9-segment Bortle palette (1 -> dark, 9 -> urban)
export const BORTLE_SEGMENTS = [
  { level: 1, label: "Ciel noir exceptionnel", hex: "#0d2440" },
  { level: 2, label: "Très sombre", hex: "#16365e" },
  { level: 3, label: "Rural", hex: "#1f4f87" },
  { level: 4, label: "Rural-banlieue", hex: "#3e6da6" },
  { level: 5, label: "Banlieue", hex: "#7e6dbf" },
  { level: 6, label: "Banlieue lumineuse", hex: "#b56ba2" },
  { level: 7, label: "Périurbain", hex: "#d68466" },
  { level: 8, label: "Urbain", hex: "#d6a24a" },
  { level: 9, label: "Centre-ville", hex: "#e0c068" },
];

export function classifyMag(mag) {
  if (mag === null || mag === undefined || isNaN(mag)) return null;
  for (const lvl of QUALITY_LEVELS) {
    if (mag >= lvl.minMag) return lvl;
  }
  return QUALITY_LEVELS[QUALITY_LEVELS.length - 1];
}

export function bortleFromMag(mag) {
  if (mag === null || mag === undefined || isNaN(mag)) return null;
  if (mag >= 21.99) return 1;
  if (mag >= 21.89) return 2;
  if (mag >= 21.69) return 3;
  if (mag >= 21.25) return 4;
  if (mag >= 20.49) return 5;
  if (mag >= 19.5) return 6;
  if (mag >= 18.94) return 7;
  if (mag >= 18.38) return 8;
  return 9;
}
