import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Eraser, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getBackendUrl } from "@/lib/sqmApi";
import { useAuth } from "@/lib/authContext";

const STORAGE_API_KEY = "sqm_admin_api_key";

/**
 * Convertit une chaîne "YYYY-MM-DDTHH:mm" (datetime-local, sans tz) en
 * ISO UTC. Les datetime-local sont naïves (= heure locale du navigateur).
 */
function localToUtcIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Retourne maintenant - delta_minutes au format "YYYY-MM-DDTHH:mm"
 * (compatible <input type="datetime-local">), en heure LOCALE.
 */
function relativeLocalIso(deltaMinutes = 0) {
  const d = new Date(Date.now() - deltaMinutes * 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const QUICK_RANGES = [
  { label: "Cette nuit (22h → maintenant)", from: "tonight" },
  { label: "Dernière heure", from: 60, to: 0 },
  { label: "Dernières 6 heures", from: 360, to: 0 },
  { label: "Aujourd'hui", from: "today" },
];

export default function AdminCleanupDialog({ onAfterDelete }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMemorized, setApiKeyMemorized] = useState(false);
  const [startLocal, setStartLocal] = useState(() => relativeLocalIso(60));
  const [endLocal, setEndLocal] = useState(() => relativeLocalIso(0));
  const [deviceId, setDeviceId] = useState("__all__");
  const [devices, setDevices] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const backend = getBackendUrl() || "";

  // Si admin connecté → on utilise la session cookie. Sinon → fallback X-API-Key.
  const useSessionAuth = isAdmin;

  // Charger la clé API mémorisée + la liste des sondes à l'ouverture
  useEffect(() => {
    if (!open) return;
    try {
      const k = window.localStorage.getItem(STORAGE_API_KEY);
      if (k) {
        setApiKey(k);
        setApiKeyMemorized(true);
      }
    } catch (_) {
      /* ignore */
    }
    // Liste des sondes
    fetch(`${backend}/api/devices`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.devices)) setDevices(d.devices);
      })
      .catch(() => {
        /* silencieux : on garde le mode "Toutes" si l'API ne répond pas */
      });
  }, [open, backend]);

  const startIsoUtc = useMemo(() => localToUtcIso(startLocal), [startLocal]);
  const endIsoUtc = useMemo(() => localToUtcIso(endLocal), [endLocal]);

  const canSubmit =
    (useSessionAuth || !!apiKey) &&
    !!startIsoUtc &&
    !!endIsoUtc &&
    startIsoUtc <= endIsoUtc;

  const handleQuick = (q) => {
    const now = new Date();
    if (q.from === "tonight") {
      const start = new Date(now);
      start.setHours(22, 0, 0, 0);
      // Si on est entre 00h et 22h, "cette nuit" = la nuit dernière
      if (now.getHours() < 22 && now.getHours() >= 6) {
        start.setDate(start.getDate() - 1);
      }
      const pad = (n) => String(n).padStart(2, "0");
      setStartLocal(
        `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`
      );
      setEndLocal(relativeLocalIso(0));
    } else if (q.from === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const pad = (n) => String(n).padStart(2, "0");
      setStartLocal(
        `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T00:00`
      );
      setEndLocal(relativeLocalIso(0));
    } else {
      setStartLocal(relativeLocalIso(q.from));
      setEndLocal(relativeLocalIso(q.to));
    }
    setPreview(null);
  };

  const runPreview = async () => {
    if (!canSubmit) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const url = new URL(
        `${backend}/api/admin/measurements/preview_delete_range`
      );
      url.searchParams.set("start_ts", startIsoUtc);
      url.searchParams.set("end_ts", endIsoUtc);
      if (deviceId && deviceId !== "__all__")
        url.searchParams.set("device_id", deviceId);
      const r = await fetch(url, {
        credentials: useSessionAuth ? "include" : "omit",
        headers: useSessionAuth ? {} : { "X-API-Key": apiKey },
      });
      if (r.status === 401) {
        toast.error(
          useSessionAuth
            ? "Session expirée — reconnectez-vous."
            : "Clé API admin invalide"
        );
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setPreview(data);
      // Mémoriser la clé si l'utilisateur a coché
      if (apiKeyMemorized) {
        try {
          window.localStorage.setItem(STORAGE_API_KEY, apiKey);
        } catch (_) {
          /* ignore */
        }
      }
    } catch (err) {
      toast.error("Erreur preview", { description: String(err) });
    } finally {
      setPreviewing(false);
    }
  };

  const runDelete = async () => {
    if (!preview || preview.matched === 0) {
      toast.warning("Rien à supprimer dans cette plage");
      return;
    }
    if (
      !window.confirm(
        `Supprimer définitivement ${preview.matched} mesure${preview.matched > 1 ? "s" : ""} ?\n\nCette action est irréversible.`
      )
    )
      return;
    setDeleting(true);
    try {
      const r = await fetch(
        `${backend}/api/admin/measurements/delete_range`,
        {
          method: "POST",
          credentials: useSessionAuth ? "include" : "omit",
          headers: {
            ...(useSessionAuth ? {} : { "X-API-Key": apiKey }),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            start_ts: startIsoUtc,
            end_ts: endIsoUtc,
            device_id: deviceId !== "__all__" ? deviceId : null,
          }),
        }
      );
      if (r.status === 401) {
        toast.error(
          useSessionAuth
            ? "Session expirée — reconnectez-vous."
            : "Clé API admin invalide"
        );
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      toast.success(`${data.deleted} mesure(s) supprimée(s)`, {
        description: `Total restant : ${data.stats.total_measurements}`,
      });
      setOpen(false);
      setPreview(null);
      if (typeof onAfterDelete === "function") onAfterDelete();
    } catch (err) {
      toast.error("Erreur suppression", { description: String(err) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid="admin-cleanup-trigger"
          title="Outils d'administration"
        >
          <Eraser className="size-3.5 mr-1.5" />
          Nettoyer
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-w-2xl"
        data-testid="admin-cleanup-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[hsl(var(--chart-1))]" />
            Nettoyage des mesures
          </DialogTitle>
          <DialogDescription>
            Supprimer définitivement les mesures dans une plage horaire (ex :
            tests réalisés volontairement et inutiles pour la base
            scientifique).{" "}
            {useSessionAuth
              ? "Authentifié en tant qu'administrateur via votre session."
              : "Action protégée par votre clé API admin."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Clé API admin — masquée si session admin active */}
          {!useSessionAuth && (
            <div className="space-y-1.5">
              <Label htmlFor="adm-key">Clé API admin</Label>
              <Input
                id="adm-key"
                type="password"
                placeholder="X-API-Key du backend"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                data-testid="admin-key-input"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={apiKeyMemorized}
                  onChange={(e) => {
                    setApiKeyMemorized(e.target.checked);
                    if (!e.target.checked) {
                      try {
                        window.localStorage.removeItem(STORAGE_API_KEY);
                      } catch (_) {
                        /* ignore */
                      }
                    }
                  }}
                  data-testid="admin-key-memorize"
                />
                Mémoriser sur ce navigateur (localStorage)
              </label>
            </div>
          )}

          {/* Sonde concernée */}
          <div className="space-y-1.5">
            <Label htmlFor="adm-device">Sonde concernée</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger id="adm-device" data-testid="admin-device-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  Toutes les sondes
                </SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d.device_id} value={d.device_id}>
                    {d.display_name || d.device_id}
                    <span className="text-muted-foreground ml-2">
                      ({d.total_measurements})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Plage horaire */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="adm-start">Début (heure locale)</Label>
              <Input
                id="adm-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => {
                  setStartLocal(e.target.value);
                  setPreview(null);
                }}
                data-testid="admin-start-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adm-end">Fin (heure locale)</Label>
              <Input
                id="adm-end"
                type="datetime-local"
                value={endLocal}
                onChange={(e) => {
                  setEndLocal(e.target.value);
                  setPreview(null);
                }}
                data-testid="admin-end-input"
              />
            </div>
          </div>

          {/* Raccourcis */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RANGES.map((q) => (
              <Button
                key={q.label}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleQuick(q)}
              >
                {q.label}
              </Button>
            ))}
          </div>

          {/* Preview */}
          {preview && (
            <div
              className="rounded-md border border-[hsl(var(--chart-1))]/40 bg-[hsl(var(--chart-1))]/5 p-3 text-xs space-y-1"
              data-testid="admin-preview"
            >
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-3.5 text-[hsl(var(--chart-1))]" />
                <span>
                  <Badge variant="outline" className="mr-1 font-mono">
                    {preview.matched}
                  </Badge>
                  mesure(s) trouvée(s) dans la plage
                </span>
              </div>
              {preview.matched > 0 && preview.sample_first?.[0] && (
                <div className="text-muted-foreground">
                  Première : {preview.sample_first[0].ts} · mag={" "}
                  {preview.sample_first[0].mag}
                </div>
              )}
              {preview.matched > 0 && preview.sample_last?.[0] && (
                <div className="text-muted-foreground">
                  Dernière : {preview.sample_last[0].ts} · mag={" "}
                  {preview.sample_last[0].mag}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={runPreview}
            disabled={!canSubmit || previewing}
            data-testid="admin-preview-btn"
          >
            {previewing ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : null}
            Aperçu
          </Button>
          <Button
            variant="destructive"
            onClick={runDelete}
            disabled={
              !preview ||
              preview.matched === 0 ||
              deleting
            }
            data-testid="admin-delete-btn"
          >
            {deleting ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Eraser className="size-3.5 mr-1.5" />
            )}
            Supprimer {preview?.matched ? `(${preview.matched})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
