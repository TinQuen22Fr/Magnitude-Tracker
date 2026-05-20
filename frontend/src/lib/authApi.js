import { api } from "@/lib/sqmApi";

/**
 * authApi.js — Wrappers pour les endpoints /api/auth/*
 *
 * Toutes les requêtes envoient le cookie httpOnly de session.
 * On s'appuie sur l'instance `api` (axios) déjà configurée dans sqmApi.js.
 */

// Active l'envoi automatique des cookies (sessions) sur toutes les requêtes
// passant par l'instance axios partagée.
api.defaults.withCredentials = true;

export async function fetchMe() {
  const { data } = await api.get("/auth/me");
  return data;
}

export async function login({ email, password }) {
  const { data } = await api.post("/auth/login", { email, password });
  return data;
}

export async function verify2fa({ challengeId, code }) {
  const { data } = await api.post("/auth/2fa/verify", {
    challenge_id: challengeId,
    code,
  });
  return data;
}

export async function logout() {
  const { data } = await api.post("/auth/logout");
  return data;
}

export async function totpSetup({ password }) {
  const { data } = await api.post("/auth/2fa/totp/setup", { password });
  return data;
}

export async function totpConfirm({ code }) {
  const { data } = await api.post("/auth/2fa/totp/confirm", { code });
  return data;
}

export async function totpDisable({ password, code }) {
  const { data } = await api.post("/auth/2fa/totp/disable", { password, code });
  return data;
}

export async function changePassword({ currentPassword, newPassword }) {
  const { data } = await api.post("/auth/change_password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
  return data;
}
