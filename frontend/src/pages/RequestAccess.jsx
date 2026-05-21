import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Telescope, Mail, User, MessageSquareHeart, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { requestInvitation } from "@/lib/invitationApi";

/**
 * Page publique : formulaire de demande d'accès.
 *
 * Anti-spam :
 *  • Honeypot : champ "website" caché en CSS (les bots le remplissent)
 *  • Le backend rate-limite par IP (3/heure)
 */
export default function RequestAccess() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [motivation, setMotivation] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await requestInvitation({
        email: email.trim(),
        displayName: displayName.trim(),
        motivation: motivation.trim(),
        website, // honeypot
      });
      setSubmitted(true);
      toast.success("Demande envoy\u00e9e ! V\u00e9rifiez votre bo\u00eete mail.");
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        "Impossible d'envoyer la demande. R\u00e9essayez dans quelques instants.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-md mx-auto" data-testid="request-access-success">
        <div className="flex flex-col items-center gap-2 mb-6 mt-4">
          <span className="flex items-center justify-center size-14 rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="size-7 text-emerald-400" />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Demande envoyée
          </h1>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm leading-relaxed">
              Merci pour votre demande d'accès à SQM Nightwatch. Un email de
              confirmation vient d'être envoyé à{" "}
              <strong className="text-foreground">{email}</strong>.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Un administrateur va examiner votre demande très prochainement.
              Vous recevrez un nouveau message dès qu'elle aura été traitée,
              avec un lien pour finaliser la création de votre compte.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/")}
                data-testid="request-access-back-home"
              >
                <ArrowLeft className="size-4 mr-2" />
                Retour au tableau de bord public
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto" data-testid="request-access-page">
      <div className="flex flex-col items-center gap-2 mb-6 mt-4">
        <span className="flex items-center justify-center size-12 rounded-xl border border-border/70 bg-secondary/40">
          <Telescope className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Demander un accès
        </h1>
        <p className="text-sm text-muted-foreground text-center">
          Rejoignez la communauté d'observation du ciel SQM Nightwatch
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4" /> Vos informations
          </CardTitle>
          <CardDescription>
            Votre demande sera examinée manuellement. Vous recevrez un email
            de confirmation immédiatement, puis un second avec le lien
            d'activation une fois la demande acceptée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Adresse email *</Label>
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
                  data-testid="request-access-email-input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="displayName">Nom / Pseudo (optionnel)</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="displayName"
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="pl-9"
                  placeholder="Quentin l'astronome"
                  data-testid="request-access-name-input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivation">
                Pourquoi souhaitez-vous un accès ? (optionnel)
              </Label>
              <div className="relative">
                <MessageSquareHeart className="absolute left-3 top-3 size-4 text-muted-foreground pointer-events-none" />
                <Textarea
                  id="motivation"
                  rows={4}
                  maxLength={1000}
                  value={motivation}
                  onChange={(e) => setMotivation(e.target.value)}
                  className="pl-9 resize-none"
                  placeholder="Je suis astronome amateur dans le Vercors et j'aimerais comparer mes mesures avec votre sonde…"
                  data-testid="request-access-motivation-input"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {motivation.length}/1000 caractères
              </p>
            </div>

            {/* Honeypot anti-bot : caché visuellement et aux a11y */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "-9999px",
                width: "1px",
                height: "1px",
                overflow: "hidden",
              }}
            >
              <label htmlFor="website">Site web (ne pas remplir)</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={busy || !email}
              data-testid="request-access-submit-button"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Envoi…
                </>
              ) : (
                "Envoyer ma demande"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 text-center text-xs text-muted-foreground space-y-2">
        <div>
          Déjà un compte ?{" "}
          <Link
            to="/login"
            className="hover:text-foreground underline-offset-4 hover:underline"
            data-testid="request-access-login-link"
          >
            Se connecter
          </Link>
        </div>
        <div>
          <Link
            to="/"
            className="hover:text-foreground underline-offset-4 hover:underline"
          >
            Retour au tableau de bord public
          </Link>
        </div>
      </div>
    </div>
  );
}
