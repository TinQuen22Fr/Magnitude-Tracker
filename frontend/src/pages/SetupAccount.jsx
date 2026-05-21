import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Telescope, KeyRound, User, Loader2, CheckCircle2, AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  checkInvitationToken, setupInvitationAccount,
} from "@/lib/invitationApi";

/**
 * Page publique : finalisation du compte via lien d'invitation.
 *
 * Flux :
 *  1. Récupérer ?token=xxx de l'URL
 *  2. GET /check pour valider le token → si invalide, on affiche l'erreur
 *  3. Sinon, formulaire pour choisir mot de passe (+ display_name optionnel)
 *  4. POST /setup → toast succès + redirection /login
 */
export default function SetupAccount() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = (params.get("token") || "").trim();

  const [checking, setChecking] = useState(true);
  const [tokenInfo, setTokenInfo] = useState(null); // { valid, email, display_name, expires_at, reason }
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenInfo({ valid: false, reason: "missing_token" });
      setChecking(false);
      return;
    }
    checkInvitationToken(token)
      .then((info) => {
        setTokenInfo(info);
        if (info.valid && info.display_name) setDisplayName(info.display_name);
      })
      .catch(() => setTokenInfo({ valid: false, reason: "network_error" }))
      .finally(() => setChecking(false));
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 10) {
      toast.error("Mot de passe trop court (minimum 10 caract\u00e8res).");
      return;
    }
    if (password !== password2) {
      toast.error("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      await setupInvitationAccount(token, {
        password,
        displayName: displayName.trim(),
      });
      setDone(true);
      toast.success("Compte cr\u00e9\u00e9 ! Vous pouvez maintenant vous connecter.");
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err) {
      const msg = err?.response?.data?.detail || "\u00c9chec de la cr\u00e9ation du compte.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  // ---- States UI ---------------------------------------------------------
  if (checking) {
    return (
      <div className="max-w-md mx-auto" data-testid="setup-account-checking">
        <Card className="mt-8">
          <CardHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tokenInfo || !tokenInfo.valid) {
    const reasonMessages = {
      missing_token: "Aucun token fourni dans l'URL.",
      not_found: "Ce lien d'invitation n'existe pas.",
      already_used: "Ce lien a d\u00e9j\u00e0 \u00e9t\u00e9 utilis\u00e9.",
      invalid_status: "Cette demande n'a pas \u00e9t\u00e9 accept\u00e9e.",
      expired: "Ce lien d'invitation a expir\u00e9 (>48h).",
      malformed_expiry: "Lien corrompu.",
      network_error: "Erreur r\u00e9seau, r\u00e9essayez plus tard.",
    };
    const reason = tokenInfo?.reason || "unknown";
    return (
      <div className="max-w-md mx-auto" data-testid="setup-account-invalid">
        <div className="flex flex-col items-center gap-2 mb-6 mt-4">
          <span className="flex items-center justify-center size-14 rounded-2xl border border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="size-7 text-amber-400" />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Lien invalide
          </h1>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm" data-testid="setup-account-invalid-reason">
              {reasonMessages[reason] || "Ce lien n'est plus valable."}
            </p>
            <p className="text-sm text-muted-foreground">
              Vous pouvez refaire une demande d'accès ou revenir au tableau
              de bord public.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button asChild className="w-full">
                <Link to="/request-access">Refaire une demande</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/">Retour au tableau de bord</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto" data-testid="setup-account-done">
        <div className="flex flex-col items-center gap-2 mb-6 mt-4">
          <span className="flex items-center justify-center size-14 rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="size-7 text-emerald-400" />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Compte créé !
          </h1>
          <p className="text-sm text-muted-foreground">
            Redirection vers la connexion…
          </p>
        </div>
      </div>
    );
  }

  // ---- Form principal ----------------------------------------------------
  return (
    <div className="max-w-md mx-auto" data-testid="setup-account-page">
      <div className="flex flex-col items-center gap-2 mb-6 mt-4">
        <span className="flex items-center justify-center size-12 rounded-xl border border-border/70 bg-secondary/40">
          <Telescope className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Finaliser mon compte
        </h1>
        <p className="text-sm text-muted-foreground text-center">
          Bienvenue ! Choisissez votre mot de passe pour activer l'accès.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> Configuration du compte
          </CardTitle>
          <CardDescription>
            Compte associé à{" "}
            <strong className="text-foreground" data-testid="setup-account-email">
              {tokenInfo.email}
            </strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Nom d'affichage (optionnel)</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="displayName"
                  type="text"
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="pl-9"
                  placeholder="Comment souhaitez-vous appara\u00eetre ?"
                  data-testid="setup-account-name-input"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 10 caract\u00e8res"
                data-testid="setup-account-password-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password2">Confirmation</Label>
              <Input
                id="password2"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="Retapez le mot de passe"
                data-testid="setup-account-password2-input"
              />
              {password && password2 && password !== password2 && (
                <p className="text-xs text-rose-400">
                  Les deux mots de passe ne correspondent pas.
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                !password ||
                password.length < 10 ||
                password !== password2
              }
              data-testid="setup-account-submit-button"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Création…
                </>
              ) : (
                <>
                  Activer mon compte
                  <ArrowRight className="size-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
