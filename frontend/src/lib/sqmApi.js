import axios from "axios";

const STORAGE_KEY = "sqm_backend_url";
const DEFAULT_URL = process.env.REACT_APP_BACKEND_URL || "";

/**
 * Résolution dynamique de l'URL backend :
 *   1. localStorage (override runtime — écran Réglages, utile pour l'APK Android)
 *   2. variable d'env REACT_APP_BACKEND_URL (build-time, fallback)
 */
export function getBackendUrl() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && stored.trim()) {
        return stored.trim().replace(/\/$/, "");
      }
    }
  } catch (_) {
    // localStorage indisponible (mode privé, etc.) — fallback silencieux
  }
  return (DEFAULT_URL || "").replace(/\/$/, "");
}

export function setBackendUrl(url) {
  const v = (url || "").trim().replace(/\/$/, "");
  if (!v) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, v);
}

export function resetBackendUrl() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (_) { /* noop */ }
}

export function getDefaultBackendUrl() {
  return (DEFAULT_URL || "").replace(/\/$/, "");
}

// API client — baseURL recalculée à chaque requête via interceptor.
export const api = axios.create({
  timeout: 15000,
});

api.interceptors.request.use((cfg) => {
  const base = getBackendUrl();
  cfg.baseURL = `${base}/api`;
  return cfg;
});

export const API = `${getBackendUrl()}/api`;

export async function fetchLatest() {
  const { data } = await api.get("/sqm/latest");
  return data;
}

export async function fetchHistory({ since, limit } = {}) {
  const params = {};
  if (since) params.since = since;
  if (limit) params.limit = limit;
  const { data } = await api.get("/sqm/history", { params });
  return data;
}

export async function fetchStats({ since } = {}) {
  const params = {};
  if (since) params.since = since;
  const { data } = await api.get("/sqm/stats", { params });
  return data;
}

export async function fetchInfo() {
  const { data } = await api.get("/sqm/info");
  return data;
}

export async function pingRoot() {
  const { data } = await api.get("/");
  return data;
}

export function downloadCsvUrl(since) {
  const u = new URL(`${getBackendUrl()}/api/sqm/export.csv`);
  if (since) u.searchParams.set("since", since);
  return u.toString();
}
