import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Telescope, Loader2, ShieldCheck, KeyRound, Mail, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/authContext";
import { login as apiLogin, verify2fa } from "@/lib/authApi";

export default function Login() {
  const { refresh, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = location.state?.from || "/";

  // Étape 1 : email/password
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("credentials"); // 'credentials' | '2fa'
  const [challengeId, setChallengeId] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [mustChangePwd, setMustChangePwd] = useState(false);

  // Déjà connecté ? On redirige immédiatement.
  if (user) {
    navigate(fromPath, { replace: true });
    return null;
  }

  async function onSubmitCredentials(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await apiLogin({ email: email.trim(), password });
      if (data.requires_2fa) {
        setChallengeId(data.challenge_id);
        setMustChangePwd(!!data.must_change_password);
        setStep("2fa");
        toast.info("Code 2FA requis (Google Authenticator).");
      } else {
        // Connecté directement (pas de TOTP encore activé)
        await refresh();
        toast.success("Connexion réussie");
        if (data.must_change_password) {
          navigate("/account?force_password=1", { replace: true });
        } else {
          navigate(fromPath, { replace: true });
        }
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || "Identifiants invalides.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit2fa(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await verify2fa({ challengeId, code: code.trim() });
      await refresh();
      toast.success("Connexion réussie");
      if (data.must_change_password || mustChangePwd) {
        navigate("/account?force_password=1", { replace: true });
      } else {
        navigate(fromPath, { replace: true });
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || "Code 2FA invalide.";
      toast.error(msg);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto" data-testid="login-page">
      <div className="flex flex-col items-center gap-2 mb-6 mt-4">
        <span className="flex items-center justify-center size-12 rounded-xl border border-border/70 bg-secondary/40">
          <Telescope className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          SQM Nightwatch
        </h1>
        <p className="text-sm text-muted-foreground">
          Connexion administrateur
        </p>
      </div>

      <Card>
        {step === "credentials" && (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" /> Identifiants
              </CardTitle>
              <CardDescription>
                Saisis ton email et ton mot de passe pour accéder à ton tableau
                de bord.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmitCredentials} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Adresse email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      placeholder="vous@exemple.com"
                      data-testid="login-email-input"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="login-password-input"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || !email || !password}
                  data-testid="login-submit-button"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Connexion…
                    </>
                  ) : (
                    "Se connecter"
                  )}
                </Button>
              </form>
            </CardContent>
          </>
        )}

        {step === "2fa" && (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4" /> Double authentification
              </CardTitle>
              <CardDescription>
                Entre le code à 6 chiffres de ton application
                d'authentification (Google Authenticator, Authy…).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit2fa} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Code 2FA</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={8}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="font-mono tracking-[0.4em] text-center text-lg"
                    data-testid="login-2fa-code-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    Le code change toutes les 30 secondes.
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || code.length < 6}
                  data-testid="login-2fa-submit-button"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Vérification…
                    </>
                  ) : (
                    "Valider le code"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep("credentials");
                    setCode("");
                    setChallengeId(null);
                  }}
                  data-testid="login-2fa-back-button"
                >
                  <ArrowLeft className="size-4 mr-2" />
                  Revenir à l'étape précédente
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>

      <div className="mt-6 text-center text-xs text-muted-foreground space-y-2">
        <div>
          Pas encore de compte&nbsp;?{" "}
          <Link
            to="/request-access"
            className="hover:text-foreground underline-offset-4 hover:underline"
            data-testid="login-request-access-link"
          >
            Demander un accès
          </Link>
        </div>
        <div>
          <Link
            to="/"
            className="hover:text-foreground underline-offset-4 hover:underline"
          >
            Retour aux données publiques
          </Link>
        </div>
      </div>
    </div>
  );
}
