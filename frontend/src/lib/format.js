// Lightweight date/number formatters (no extra deps).

export function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function fmtRelative(iso) {
  if (!iso) return "jamais";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s}\u00a0s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m}\u00a0min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}\u00a0h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}\u00a0j`;
}

export function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtLux(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.01) return Number(n).toExponential(2);
  return Number(n).toLocaleString("fr-FR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
