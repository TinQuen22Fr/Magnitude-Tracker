import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/authContext";

/**
 * <RequireAuth role="admin">...</RequireAuth>
 *
 * - Affiche un loader pendant le check /auth/me initial.
 * - Redirige vers /login si non connecté (en conservant la destination).
 * - Renvoie 403 visuel si rôle insuffisant.
 */
export default function RequireAuth({ role, children }) {
  const { user, loading, isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-16 text-muted-foreground gap-2"
        data-testid="auth-loading"
      >
        <Loader2 className="size-4 animate-spin" />
        <span>Vérification de la session…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (role === "admin" && !isAdmin) {
    return (
      <div
        className="max-w-md mx-auto mt-12 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm"
        data-testid="auth-forbidden"
      >
        <div className="font-semibold text-destructive mb-1">
          Accès refusé
        </div>
        <p className="text-muted-foreground">
          Le compte <span className="font-medium">{user?.email}</span> n'a pas
          les privilèges administrateur requis pour accéder à cette page.
        </p>
      </div>
    );
  }

  return children;
}
