import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Globe2, Save, RotateCcw, CheckCircle2, XCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  getBackendUrl,
  setBackendUrl,
  resetBackendUrl,
  getDefaultBackendUrl,
  pingRoot,
} from "@/lib/sqmApi";

export default function Settings() {
  const [currentUrl, setCurrentUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [defaultUrl, setDefaultUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok: bool, info?: any, error?: string }
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const u = getBackendUrl();
    setCurrentUrl(u);
    setInputUrl(u);
    setDefaultUrl(getDefaultBackendUrl());
  }, []);

  const isValid = (url) => {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  const handleTest = async () => {
    if (!isValid(inputUrl)) {
      toast.error("URL invalide (http:// ou https:// requis)");
      return;
    }
    setTesting(true);
    setTestResult(null);
    // On teste l'URL saisie sans modifier le storage. On utilise fetch direct.
    try {
      const r = await fetch(`${inputUrl.replace(/\/$/, "")}/api/`, {
        method: "GET",
        cache: "no-store",
      });
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const data = await r.json();
      setTestResult({ ok: true, info: data });
      toast.success(`Connexion OK — v${data.version || "?"}`);
    } catch (e) {
      setTestResult({ ok: false, error: e.message || "Échec" });
      toast.error("Connexion KO : " + (e.message || "réseau"));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!isValid(inputUrl)) {
      toast.error("URL invalide (http:// ou https:// requis)");
      return;
    }
    setBackendUrl(inputUrl);
    setSaved(true);
    toast.success("URL enregistrée — rechargement…");
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  const handleReset = () => {
    resetBackendUrl();
    toast.success("URL réinitialisée — rechargement…");
    setTimeout(() => {
      window.location.reload();
    }, 600);
  };

  const isOverridden =
    currentUrl && defaultUrl && currentUrl !== defaultUrl;

  return (
    <div className="flex flex-col gap-6" data-testid="settings-page">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          Réglages
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configuration de l'application — utile sur l'APK Android ou pour
          pointer vers un autre serveur.
        </p>
      </div>

      <Card
        className="border-border/70 bg-card/80 backdrop-blur"
        data-testid="settings-backend-card"
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
              <Globe2 className="size-4" /> URL du serveur backend
            </CardTitle>
            {isOverridden && (
              <Badge
                variant="outline"
                className="font-mono text-[10px]"
                data-testid="settings-override-badge"
              >
                Override actif
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              <span className="text-muted-foreground/80">URL actuelle :</span>{" "}
              <code
                className="font-mono text-foreground break-all"
                data-testid="settings-current-url"
              >
                {currentUrl || "(vide)"}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground/80">URL par défaut (build) :</span>{" "}
              <code
                className="font-mono text-foreground/70 break-all"
                data-testid="settings-default-url"
              >
                {defaultUrl || "(vide)"}
              </code>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="backend-url" className="text-xs">
              Nouvelle URL
            </Label>
            <Input
              id="backend-url"
              type="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              placeholder="https://sqm.votre-domaine.tld"
              value={inputUrl}
              onChange={(e) => { setInputUrl(e.target.value); setTestResult(null); }}
              className="font-mono text-sm h-11"
              data-testid="settings-url-input"
              disabled={saved}
            />
            <p className="text-[11px] text-muted-foreground">
              Sans <code>/</code> final, sans <code>/api</code>. Ex: <code>https://sqm.example.com</code>
            </p>
          </div>

          {/* Résultat du test de connexion */}
          {testResult && (
            <div
              className={
                "rounded-md border p-3 text-xs flex items-start gap-2 " +
                (testResult.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-destructive/40 bg-destructive/10 text-destructive-foreground")
              }
              data-testid="settings-test-result"
            >
              {testResult.ok ? (
                <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="size-4 shrink-0 mt-0.5" />
              )}
              {testResult.ok ? (
                <div>
                  Connexion OK — {testResult.info?.app || "backend"} v{testResult.info?.version || "?"}
                </div>
              ) : (
                <div>Connexion KO — {testResult.error}</div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing || saved || !inputUrl}
              className="h-11 sm:h-9 flex-1 sm:flex-initial"
              data-testid="settings-test-button"
            >
              {testing ? "Test en cours…" : "Tester la connexion"}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={!inputUrl || inputUrl === currentUrl || saved}
              className="h-11 sm:h-9 flex-1 sm:flex-initial gap-1.5"
              data-testid="settings-save-button"
            >
              <Save className="size-3.5" />
              Enregistrer
            </Button>
            {isOverridden && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={saved}
                className="h-11 sm:h-9 flex-1 sm:flex-initial gap-1.5"
                data-testid="settings-reset-button"
              >
                <RotateCcw className="size-3.5" />
                Réinitialiser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-sm font-medium text-muted-foreground tracking-wide uppercase flex items-center gap-2">
            <Smartphone className="size-4" /> Application Android (APK)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            Une version Android (APK) embarquant cette interface est
            générée automatiquement depuis la branche
            {" "}<code className="font-mono text-foreground">magnitude-tracker-android</code>{" "}
            du dépôt GitHub via GitHub Actions.
          </p>
          <p>
            Téléchargez le dernier APK dans la section
            {" "}<strong className="text-foreground">Actions</strong> ou{" "}
            <strong className="text-foreground">Releases</strong> du dépôt,
            puis installez-le sur votre téléphone (autoriser « Sources
            inconnues » dans les paramètres Android).
          </p>
          <p>
            Au 1ʳ démarrage, ouvrez cet écran Réglages depuis l'app pour
            saisir l'URL de votre serveur (s'il est différent de celui
            compilé par défaut).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
