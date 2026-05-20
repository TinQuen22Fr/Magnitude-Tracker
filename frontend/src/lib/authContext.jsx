import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchMe, logout as apiLogout } from "@/lib/authApi";

const AuthContext = createContext(null);

/**
 * Provider d'authentification.
 *
 * État :
 *  - `user`   : objet utilisateur (ou null si non connecté)
 *  - `loading`: vrai pendant le check initial /auth/me
 *  - `refresh()` : force le re-fetch de /auth/me (ex : après login, changement mdp)
 *  - `logout()`  : invalide la session côté backend + reset state
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchMe();
      setUser(data?.authenticated ? data.user : null);
      return data;
    } catch (_e) {
      setUser(null);
      return { authenticated: false };
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (_e) {
      // ignore — on reset l'état côté front quand même
    }
    setUser(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: !!user,
      isAdmin: !!(user && user.is_admin),
      refresh,
      logout: handleLogout,
      setUser,
    }),
    [user, loading, refresh, handleLogout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth doit être utilisé dans un <AuthProvider>");
  }
  return ctx;
}
