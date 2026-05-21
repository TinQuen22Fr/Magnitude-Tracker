import { useCallback, useEffect, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Mailbox, RefreshCw, CheckCircle2, XCircle, Trash2,
  Clock, AlertCircle, Loader2, Inbox,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  adminListInvitations, adminAcceptInvitation, adminRejectInvitation,
  adminDeleteInvitation,
} from "@/lib/invitationApi";

/**
 * Composant admin : gestion des demandes d'invitation (Phase 6).
 *
 * Affiche les demandes pending en haut, puis l'historique (accepted, rejected,
 * activated). Actions : accepter / rejeter / supprimer.
 */

function StatusBadge({ status }) {
  const map = {
    pending: { label: "En attente", className: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Clock },
    accepted: { label: "Accept\u00e9e (email envoy\u00e9)", className: "bg-blue-500/15 text-blue-300 border-blue-500/30", icon: CheckCircle2 },
    rejected: { label: "Rejet\u00e9e", className: "bg-rose-500/15 text-rose-300 border-rose-500/30", icon: XCircle },
    activated: { label: "Compte cr\u00e9\u00e9", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
  };
  const cfg = map[status] || { label: status, className: "", icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`} data-testid={`invitation-status-${status}`}>
      <Icon className="size-3" />
      {cfg.label}
    </Badge>
  );
}

function RelTime({ iso }) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return (
      <time dateTime={iso} className="text-xs text-muted-foreground" title={d.toLocaleString()}>
        {d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}{" "}
        à {d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
      </time>
    );
  } catch {
    return <span className="text-xs text-muted-foreground">{iso}</span>;
  }
}

export default function InvitationManager() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState(null); // id en cours d'action
  const [decisionDialog, setDecisionDialog] = useState(null); // {invitation, action: 'accept'|'reject'}
  const [notes, setNotes] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const data = await adminListInvitations(null);
      setInvitations(data.invitations || []);
    } catch (err) {
      toast.error("Impossible de charger les invitations.");
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAccept(invitation) {
    setActionId(invitation.id);
    try {
      const res = await adminAcceptInvitation(invitation.id, notes.trim());
      if (res.email_sent) {
        toast.success(
          `Demande accept\u00e9e — email envoy\u00e9 via ${res.email_provider}.`,
        );
      } else {
        toast.warning(
          `Demande accept\u00e9e mais l'email n'a pas pu \u00eatre envoy\u00e9 (${res.email_error || "inconnu"}). Token : ${res.setup_token}`,
        );
      }
      setDecisionDialog(null);
      setNotes("");
      await load(true);
    } catch (err) {
      const msg = err?.response?.data?.detail || "\u00c9chec de l'acceptation.";
      toast.error(msg);
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(invitation) {
    setActionId(invitation.id);
    try {
      const res = await adminRejectInvitation(invitation.id, notes.trim());
      toast.success(
        res.email_sent
          ? `Demande rejet\u00e9e — email de notification envoy\u00e9.`
          : `Demande rejet\u00e9e (email non envoy\u00e9).`,
      );
      setDecisionDialog(null);
      setNotes("");
      await load(true);
    } catch (err) {
      const msg = err?.response?.data?.detail || "\u00c9chec du rejet.";
      toast.error(msg);
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(invitation) {
    if (!confirm(`Supprimer d\u00e9finitivement la demande de ${invitation.email}\u202f?`)) return;
    setActionId(invitation.id);
    try {
      await adminDeleteInvitation(invitation.id);
      toast.success("Demande supprim\u00e9e.");
      await load(true);
    } catch (err) {
      const msg = err?.response?.data?.detail || "\u00c9chec de la suppression.";
      toast.error(msg);
    } finally {
      setActionId(null);
    }
  }

  const pending = invitations.filter((i) => i.status === "pending");
  const others = invitations.filter((i) => i.status !== "pending");

  return (
    <Card data-testid="invitation-manager" id="invitations">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mailbox className="size-4" /> Demandes d'invitation
            {pending.length > 0 && (
              <Badge
                className="bg-amber-500/15 text-amber-300 border-amber-500/30"
                variant="outline"
                data-testid="invitation-pending-count"
              >
                {pending.length} en attente
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Gérez les demandes d'accès envoyées via le formulaire public.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={refreshing}
          data-testid="invitation-refresh-button"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Chargement…
          </p>
        ) : invitations.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="invitation-empty-state">
            <Inbox className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Aucune demande d'accès pour l'instant.
            </p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  En attente ({pending.length})
                </h4>
                {pending.map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    invitation={inv}
                    onAccept={() => { setDecisionDialog({ invitation: inv, action: "accept" }); setNotes(""); }}
                    onReject={() => { setDecisionDialog({ invitation: inv, action: "reject" }); setNotes(""); }}
                    onDelete={() => handleDelete(inv)}
                    busy={actionId === inv.id}
                  />
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Historique ({others.length})
                </h4>
                {others.map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    invitation={inv}
                    onDelete={() => handleDelete(inv)}
                    busy={actionId === inv.id}
                    readonly
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Dialog décision */}
      <Dialog
        open={!!decisionDialog}
        onOpenChange={(o) => { if (!o) { setDecisionDialog(null); setNotes(""); } }}
      >
        <DialogContent data-testid="invitation-decision-dialog">
          <DialogHeader>
            <DialogTitle>
              {decisionDialog?.action === "accept"
                ? "Accepter la demande"
                : "Rejeter la demande"}
            </DialogTitle>
            <DialogDescription>
              {decisionDialog?.action === "accept"
                ? `Un email avec un lien d'activation sera envoy\u00e9 \u00e0 ${decisionDialog?.invitation?.email}.`
                : `Un email de notification sera envoy\u00e9 \u00e0 ${decisionDialog?.invitation?.email}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Notes (optionnel
              {decisionDialog?.action === "reject" ? ", incluses dans l'email" : ", admin only"}
              )
            </label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                decisionDialog?.action === "reject"
                  ? "Ex\u202f: Pas de motivation suffisante, r\u00e9essayez avec plus de contexte."
                  : "Ex\u202f: Profil int\u00e9ressant, contact via le club d'astro."
              }
              data-testid="invitation-decision-notes"
            />
          </div>
          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => { setDecisionDialog(null); setNotes(""); }}
              data-testid="invitation-decision-cancel"
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (!decisionDialog) return;
                if (decisionDialog.action === "accept") handleAccept(decisionDialog.invitation);
                else handleReject(decisionDialog.invitation);
              }}
              disabled={actionId === decisionDialog?.invitation?.id}
              className={
                decisionDialog?.action === "accept"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-rose-600 hover:bg-rose-500"
              }
              data-testid="invitation-decision-confirm"
            >
              {actionId === decisionDialog?.invitation?.id ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : decisionDialog?.action === "accept" ? (
                <CheckCircle2 className="size-4 mr-2" />
              ) : (
                <XCircle className="size-4 mr-2" />
              )}
              {decisionDialog?.action === "accept" ? "Accepter" : "Rejeter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InvitationRow({ invitation, onAccept, onReject, onDelete, busy, readonly }) {
  return (
    <div
      className="rounded-lg border border-border/60 bg-secondary/20 p-3 sm:p-4 space-y-2"
      data-testid={`invitation-row-${invitation.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm break-all" data-testid={`invitation-email-${invitation.id}`}>
            {invitation.email}
          </div>
          {invitation.display_name && (
            <div className="text-xs text-muted-foreground">{invitation.display_name}</div>
          )}
        </div>
        <StatusBadge status={invitation.status} />
      </div>
      {invitation.motivation && (
        <p className="text-xs italic text-muted-foreground bg-background/40 rounded-md p-2 border border-border/40 whitespace-pre-wrap">
          « {invitation.motivation} »
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <RelTime iso={invitation.created_at} />
        {invitation.reviewer_notes && (
          <span className="italic">Note admin : {invitation.reviewer_notes}</span>
        )}
      </div>
      {!readonly && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-500"
            onClick={onAccept}
            disabled={busy}
            data-testid={`invitation-accept-${invitation.id}`}
          >
            <CheckCircle2 className="size-4 mr-1" /> Accepter
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
            onClick={onReject}
            disabled={busy}
            data-testid={`invitation-reject-${invitation.id}`}
          >
            <XCircle className="size-4 mr-1" /> Rejeter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={busy}
            data-testid={`invitation-delete-${invitation.id}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
      {readonly && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={busy}
            data-testid={`invitation-delete-${invitation.id}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
