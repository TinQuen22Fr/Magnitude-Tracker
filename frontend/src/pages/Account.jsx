import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  QrCode,
  Loader2,
  LogOut,
  Copy,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAuth } from "@/lib/authContext";
import {
  totpSetup,
  totpConfirm,
  totpDisable,
  changePassword,
} from "@/lib/authApi";

export default function Account() {
  const { user, refresh, logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const forcePwd = params.get("force_password") === "1";

  // --- Password ----------------------------------------------------------
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdNew2, setPwdNew2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  // --- TOTP --------------------------------------------------------------
  const [totpBusy, setTotpBusy] = useState(false);
  const [setupData, setSetupData] = useState(null); // { secret, otpauth_uri, qr_png_base64 }
  const [setupPassword, setSetupPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [disablePwd, setDisablePwd] = useState("");
  const [disableCode, setDisableCode] = useState("");

  useEffect(() => {
    if (user?.must_change_password) {
      // Affiche un toast une seule fois
      toast.warning("Ton mot de passe initial doit être changé.", {
        id: "must-change-pwd",
      });
    }
  }, [user?.must_change_password]);

  if (!user) {
    return null;
  }

  // --- Handlers ----------------------------------------------------------
  async function onSubmitPassword(e) {
    e.preventDefault();
    if (pwdBusy) return;
    if (pwdNew.length < 8) {
      toast.error("Mot de passe trop court (8 caractères minimum).");
      return;
    }
    if (pwdNew !== pwdNew2) {
      toast.error("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (pwdNew === pwdCurrent) {
      toast.error("Le nouveau mot de passe doit différer de l'ancien.");
      return;
    }
    setPwdBusy(true);
    try {
      await changePassword({ currentPassword: pwdCurrent, newPassword: pwdNew });
      toast.success("Mot de passe mis à jour.");
      setPwdCurrent("");
      setPwdNew("");
      setPwdNew2("");
      await refresh();
      if (forcePwd) {
        params.delete("force_password");
        setParams(params, { replace: true });
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || "Erreur lors du changement.";
      toast.error(msg);
    } finally {
      setPwdBusy(false);
    }
  }

  async function onStartTotpSetup() {
    if (totpBusy) return;
    if (!setupPassword) {
      toast.error("Saisis ton mot de passe pour activer le 2FA.");
      return;
    }
    setTotpBusy(true);
    try {
      const data = await totpSetup({ password: setupPassword });
      setSetupData(data);
      setSetupPassword("");
      toast.info("Scanne le QR code, puis saisis le code généré.");
    } catch (err) {
      const msg = err?.response?.data?.detail || "Impossible de démarrer le setup TOTP.";
      toast.error(msg);
    } finally {
      setTotpBusy(false);
    }
  }

  async function onConfirmTotp(e) {
    e.preventDefault();
    if (totpBusy) return;
    setTotpBusy(true);
    try {
      await totpConfirm({ code: confirmCode.trim() });
      toast.success("2FA TOTP activée — déconnexion conseillée pour tester.");
      setSetupData(null);
      setConfirmCode("");
      await refresh();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Code invalide.";
      toast.error(msg);
    } finally {
      setTotpBusy(false);
    }
  }

  async function onDisableTotp(e) {
    e.preventDefault();
    if (totpBusy) return;
    setTotpBusy(true);
    try {
      await totpDisable({ password: disablePwd, code: disableCode.trim() });
      toast.success("2FA TOTP désactivée.");
      setDisablePwd("");
      setDisableCode("");
      await refresh();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Impossible de désactiver.";
      toast.error(msg);
    } finally {
      setTotpBusy(false);
    }
  }

  function copySecret() {
    if (!setupData?.secret) return;
    navigator.clipboard.writeText(setupData.secret).then(
      () => toast.success("Secret copié."),
      () => toast.error("Copie impossible."),
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6" data-testid="account-page">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Mon compte
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {user.email}
            {user.is_admin ? (
              <Badge variant="secondary" className="ml-2 align-middle">
                Administrateur
              </Badge>
            ) : null}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => logout()}
          data-testid="account-logout-button"
        >
          <LogOut className="size-4 mr-2" /> Se déconnecter
        </Button>
      </header>

      {!!user.must_change_password && (
        <Alert variant="destructive" data-testid="must-change-password-alert">
          <AlertTriangle className="size-4" />
          <AlertTitle>Mot de passe à changer</AlertTitle>
          <AlertDescription>
            Tu utilises encore le mot de passe initial fourni à
            l'installation. Modifie-le ci-dessous avant d'activer le 2FA.
          </AlertDescription>
        </Alert>
      )}

      {/* -------- CHANGEMENT DE MOT DE PASSE -------------------------- */}
      <Card data-testid="change-password-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> Mot de passe
          </CardTitle>
          <CardDescription>
            8 caractères minimum. Choisis quelque chose de robuste — il protège
            ton accès admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmitPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pwd-current">Mot de passe actuel</Label>
              <Input
                id="pwd-current"
                type="password"
                autoComplete="current-password"
                value={pwdCurrent}
                onChange={(e) => setPwdCurrent(e.target.value)}
                required
                data-testid="current-password-input"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pwd-new">Nouveau mot de passe</Label>
                <Input
                  id="pwd-new"
                  type="password"
                  autoComplete="new-password"
                  value={pwdNew}
                  onChange={(e) => setPwdNew(e.target.value)}
                  minLength={8}
                  required
                  data-testid="new-password-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pwd-new2">Confirmation</Label>
                <Input
                  id="pwd-new2"
                  type="password"
                  autoComplete="new-password"
                  value={pwdNew2}
                  onChange={(e) => setPwdNew2(e.target.value)}
                  minLength={8}
                  required
                  data-testid="new-password-confirm-input"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={pwdBusy}
              data-testid="change-password-submit"
            >
              {pwdBusy ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" /> Mise à jour…
                </>
              ) : (
                "Mettre à jour le mot de passe"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* -------- 2FA TOTP -------------------------------------------- */}
      <Card data-testid="totp-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {user.totp_enabled ? (
              <ShieldCheck className="size-4 text-emerald-500" />
            ) : (
              <ShieldAlert className="size-4 text-amber-500" />
            )}
            Double authentification (TOTP)
            {user.totp_enabled ? (
              <Badge
                variant="secondary"
                className="ml-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              >
                Activée
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-1">
                Désactivée
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Avec Google Authenticator, Authy, 1Password ou n'importe quelle app
            TOTP RFC 6238. Code à 6 chiffres demandé à chaque connexion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!user.totp_enabled && !setupData && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="totp-setup-pwd">Confirme ton mot de passe</Label>
                <Input
                  id="totp-setup-pwd"
                  type="password"
                  autoComplete="current-password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  data-testid="totp-setup-password-input"
                />
              </div>
              <Button
                onClick={onStartTotpSetup}
                disabled={totpBusy || !setupPassword}
                data-testid="totp-start-setup-button"
              >
                {totpBusy ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" /> Génération…
                  </>
                ) : (
                  <>
                    <QrCode className="size-4 mr-2" /> Activer le 2FA
                  </>
                )}
              </Button>
            </div>
          )}

          {!user.totp_enabled && setupData && (
            <div className="space-y-4" data-testid="totp-setup-pane">
              <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
                <div className="rounded-lg border border-border/70 bg-white p-3">
                  <img
                    src={`data:image/png;base64,${setupData.qr_png_base64}`}
                    alt="QR Code TOTP"
                    width={180}
                    height={180}
                    data-testid="totp-qr-image"
                  />
                </div>
                <div className="flex-1 space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Scanne ce QR code avec ton app TOTP, ou saisis ce secret
                    manuellement :
                  </p>
                  <div className="flex items-center gap-2 rounded-md border border-border/70 bg-secondary/30 px-3 py-2 font-mono text-xs break-all">
                    <span className="flex-1" data-testid="totp-secret-text">
                      {setupData.secret}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={copySecret}
                      className="h-7 px-2"
                      data-testid="totp-copy-secret-button"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              <form onSubmit={onConfirmTotp} className="space-y-3">
                <Label htmlFor="totp-confirm-code">
                  Saisis le code à 6 chiffres affiché par ton app pour
                  confirmer
                </Label>
                <Input
                  id="totp-confirm-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoFocus
                  value={confirmCode}
                  onChange={(e) =>
                    setConfirmCode(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="123456"
                  className="font-mono tracking-[0.4em] text-center text-lg max-w-xs"
                  data-testid="totp-confirm-code-input"
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={totpBusy || confirmCode.length < 6}
                    data-testid="totp-confirm-submit"
                  >
                    {totpBusy ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />{" "}
                        Vérification…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4 mr-2" />
                        Activer définitivement
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSetupData(null);
                      setConfirmCode("");
                    }}
                    data-testid="totp-cancel-setup"
                  >
                    Annuler
                  </Button>
                </div>
              </form>
            </div>
          )}

          {!!user.totp_enabled && (
            <form onSubmit={onDisableTotp} className="space-y-3" data-testid="totp-disable-form">
              <Alert>
                <ShieldCheck className="size-4" />
                <AlertTitle>2FA active sur ce compte</AlertTitle>
                <AlertDescription>
                  Pour désactiver, confirme ton mot de passe et un code TOTP en
                  cours.
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="totp-disable-pwd">Mot de passe</Label>
                  <Input
                    id="totp-disable-pwd"
                    type="password"
                    value={disablePwd}
                    onChange={(e) => setDisablePwd(e.target.value)}
                    data-testid="totp-disable-password-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="totp-disable-code">Code TOTP actuel</Label>
                  <Input
                    id="totp-disable-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={disableCode}
                    onChange={(e) =>
                      setDisableCode(e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="123456"
                    className="font-mono tracking-[0.3em] text-center"
                    data-testid="totp-disable-code-input"
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="destructive"
                disabled={totpBusy || !disablePwd || disableCode.length < 6}
                data-testid="totp-disable-submit"
              >
                {totpBusy ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Désactivation…
                  </>
                ) : (
                  "Désactiver la 2FA"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
