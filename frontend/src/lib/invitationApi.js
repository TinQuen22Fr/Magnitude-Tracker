import { api } from "@/lib/sqmApi";

/**
 * invitationApi.js — Wrappers pour les endpoints d'invitations (Phase 6).
 *
 * • Endpoints publics : request, check, setup (pas de cookie)
 * • Endpoints admin   : list, accept, reject, delete (cookie requis)
 *
 * On s'appuie sur l'instance axios partagée qui a déjà withCredentials=true
 * configuré (cf. authApi.js).
 */

// ---- Public --------------------------------------------------------------
export async function requestInvitation({ email, displayName, motivation, website }) {
  const { data } = await api.post("/invitations/request", {
    email,
    display_name: displayName || undefined,
    motivation: motivation || undefined,
    website: website || undefined, // honeypot, doit être vide
  });
  return data;
}

export async function checkInvitationToken(token) {
  const { data } = await api.get(`/invitations/${encodeURIComponent(token)}/check`);
  return data;
}

export async function setupInvitationAccount(token, { password, displayName }) {
  const { data } = await api.post(
    `/invitations/${encodeURIComponent(token)}/setup`,
    {
      password,
      display_name: displayName || undefined,
    },
  );
  return data;
}

// ---- Admin ---------------------------------------------------------------
export async function adminListInvitations(statusFilter = null) {
  const params = statusFilter ? { status: statusFilter } : {};
  const { data } = await api.get("/admin/invitations", { params });
  return data;
}

export async function adminAcceptInvitation(id, notes = "") {
  const { data } = await api.post(`/admin/invitations/${id}/accept`, { notes });
  return data;
}

export async function adminRejectInvitation(id, notes = "") {
  const { data } = await api.post(`/admin/invitations/${id}/reject`, { notes });
  return data;
}

export async function adminDeleteInvitation(id) {
  const { data } = await api.delete(`/admin/invitations/${id}`);
  return data;
}
