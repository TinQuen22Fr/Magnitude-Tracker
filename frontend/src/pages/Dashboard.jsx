import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LatestCard from "@/components/LatestCard";
import BortleIndicator from "@/components/BortleIndicator";
import MagnitudeChart from "@/components/MagnitudeChart";
import BatteryChart from "@/components/BatteryChart";
import SensorStatusCard from "@/components/SensorStatusCard";
import StatsPanel from "@/components/StatsPanel";
import PeriodSelector, {
  PERIOD_OPTIONS,
  periodSinceIso,
} from "@/components/PeriodSelector";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";
import {
  fetchHistory,
  fetchLatest,
  fetchStats,
  downloadCsvUrl,
} from "@/lib/sqmApi";
import { fmtTime } from "@/lib/format";
import { toast } from "sonner";

const REFRESH_MS = 30000;

export default function Dashboard() {
  const [period, setPeriod] = useState("24h");
  const [latest, setLatest] = useState({ data: null, count: 0 });
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const periodOpt = useMemo(
    () => PERIOD_OPTIONS.find((o) => o.value === period) || PERIOD_OPTIONS[2],
    [period]
  );

  const load = useCallback(
    async (showSpinner = false) => {
      const since = periodSinceIso(period);
      if (showSpinner) setRefreshing(true);
      try {
        const [lat, hist, st] = await Promise.all([
          fetchLatest(),
          fetchHistory({ since: since || undefined, limit: 5000 }),
          fetchStats({ since: since || undefined }),
        ]);
        setLatest(lat);
        setHistory(hist?.data || []);
        setStats(st);
        setLastSync(new Date().toISOString());
        setError(null);
      } catch (e) {
        const msg =
          e?.response?.data?.detail || e?.message || "Erreur réseau";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period]
  );

  useEffect(() => {
    load(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => load(false), REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const handleManualRefresh = async () => {
    await load(true);
    toast.success("Données actualisées");
  };

  const handleExport = () => {
    const since = periodSinceIso(period);
    const url = downloadCsvUrl(since);
    window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Title + controls */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1
            className="font-display text-3xl sm:text-4xl font-semibold tracking-tight"
            data-testid="page-title"
          >
            Tableau de bord
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Réception en direct du capteur SQM-LE · mise à jour automatique
            toutes les 30 s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={refreshing}
            data-testid="manual-refresh-button"
          >
            <RefreshCw
              className={
                "size-3.5 mr-1.5 " + (refreshing ? "animate-spin" : "")
              }
            />
            Rafraîchir
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            data-testid="export-csv-button"
          >
            <Download className="size-3.5 mr-1.5" /> CSV
          </Button>
        </div>
      </div>

      {/* auto-refresh indicator */}
      <div
        className="flex items-center justify-between text-[11px] text-muted-foreground -mt-3"
        data-testid="auto-refresh-indicator"
      >
        <span>MAJ auto : 30 s</span>
        <span data-testid="last-sync-timestamp">
          Dernière synchro : {lastSync ? fmtTime(lastSync) : "—"}
        </span>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
          data-testid="error-banner"
        >
          Erreur : {error}
        </div>
      )}

      {/* Top row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <div className="lg:col-span-7">
          <LatestCard
            data={latest?.data}
            count={latest?.count}
            loading={loading}
          />
        </div>
        <div className="lg:col-span-5">
          <BortleIndicator mag={latest?.data?.mag} />
        </div>
      </div>

      {/* Sensor status (battery / weather / GPS) - only if extended fields present */}
      <SensorStatusCard data={latest?.data} />

      {/* Period selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="font-display text-base font-medium text-foreground/90">
          Évolution sur {periodOpt.label}
        </h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Chart */}
      <MagnitudeChart
        history={history}
        loading={loading}
        periodLabel={`Période : ${periodOpt.label}`}
      />

      {/* Battery chart (only if any battery data present in period) */}
      <BatteryChart
        history={history}
        periodLabel={`Période : ${periodOpt.label}`}
      />

      {/* Stats */}
      <StatsPanel stats={stats} />
    </div>
  );
}
