import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut, User as UserIcon, ShieldCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/authContext";

function initials(email) {
  if (!email) return "?";
  const [name] = email.split("@");
  return (name[0] || "?").toUpperCase();
}

export default function AuthMenu() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div
        className="h-9 sm:h-8 w-9 sm:w-8 rounded-md border border-border/60 bg-secondary/20 animate-pulse"
        aria-hidden
      />
    );
  }

  if (!user) {
    return (
      <Link to="/login" data-testid="auth-menu-login-link">
        <Button
          variant="outline"
          size="sm"
          className="h-9 sm:h-8 gap-1.5"
          aria-label="Se connecter"
        >
          <LogIn className="size-4 sm:size-3.5" />
          <span className="hidden sm:inline">Connexion</span>
        </Button>
      </Link>
    );
  }

  async function onLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 sm:h-8 px-1.5 sm:px-2 gap-2"
          aria-label="Menu compte"
          data-testid="auth-menu-trigger"
        >
          <Avatar className="size-6 text-[10px]">
            <AvatarFallback className="bg-secondary/60 text-foreground/90">
              {initials(user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground max-w-[140px] truncate">
            {user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm">{user.email}</span>
          <span className="flex items-center gap-1.5">
            {user.is_admin ? (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              >
                <ShieldCheck className="size-3 mr-1" /> Admin
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                Utilisateur
              </Badge>
            )}
            {user.totp_enabled ? (
              <span className="text-[10px] text-muted-foreground">
                · 2FA activée
              </span>
            ) : (
              <span className="text-[10px] text-amber-400">· 2FA inactive</span>
            )}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate("/account")}
          data-testid="auth-menu-account-item"
        >
          <UserIcon className="size-4 mr-2" /> Mon compte
        </DropdownMenuItem>
        {!user.totp_enabled && (
          <DropdownMenuItem
            onClick={() => navigate("/account")}
            data-testid="auth-menu-enable-2fa-item"
          >
            <KeyRound className="size-4 mr-2" /> Activer le 2FA
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          className="text-destructive focus:text-destructive"
          data-testid="auth-menu-logout-item"
        >
          <LogOut className="size-4 mr-2" /> Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
