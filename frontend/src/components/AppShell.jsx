import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Telescope,
  Settings2,
  Github,
  SlidersHorizontal,
  Moon,
  Sun,
  Zap,
  Menu as MenuIcon,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReceptionStatus from "@/components/ReceptionStatus";
import AuthMenu from "@/components/AuthMenu";
import SignatureBadge from "@/components/SignatureBadge";
import { useNightMode } from "@/lib/nightMode";
import { APP_VERSION } from "@/lib/version";

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSetup = location.pathname.startsWith("/setup");
  const isSettings = location.pathname.startsWith("/settings");
  const isFlasher = location.pathname.startsWith("/flasher");
  const { isNight, toggleManual } = useNightMode();

  return (
    <div className="min-h-screen text-foreground">
      <header
        className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
        data-testid="app-header"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-4">
          <Link
            to="/"
            className="flex items-center gap-2.5 group min-w-0"
            data-testid="main-nav-dashboard-link"
          >
            <span
              className="flex items-center justify-center size-8 rounded-md border border-border/70 bg-secondary/40 text-foreground/90 shrink-0"
              aria-hidden
            >
              <Telescope className="size-4" />
            </span>
            <span className="flex flex-col leading-tight min-w-0">
              <span className="font-display text-sm font-semibold tracking-tight truncate">
                SQM Nightwatch
              </span>
              <span className="hidden sm:inline text-[11px] text-muted-foreground truncate">
                Capteur SQM-LE DIY
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <ReceptionStatus />

            {/* Toggle Mode Nuit Astronomique : visible partout */}
            <Button
              variant={isNight ? "secondary" : "ghost"}
              size="sm"
              className="h-9 sm:h-8 w-9 sm:w-9 p-0"
              onClick={toggleManual}
              aria-label={isNight ? "Désactiver le mode nuit" : "Activer le mode nuit astronomique"}
              title={isNight ? "Désactiver le mode nuit" : "Mode nuit astronomique (rouge)"}
              data-testid="night-mode-toggle"
            >
              {isNight ? (
                <Sun className="size-4 sm:size-3.5" />
              ) : (
                <Moon className="size-4 sm:size-3.5" />
              )}
            </Button>

            {/* Boutons inline visibles UNIQUEMENT en >= sm (tablette/desktop) */}
            <Link to="/settings" data-testid="main-nav-settings-link" className="hidden sm:inline-flex">
              <Button
                variant={isSettings ? "secondary" : "ghost"}
                size="sm"
                className="h-9 sm:h-8 w-9 sm:w-9 p-0"
                aria-label="Réglages"
              >
                <SlidersHorizontal className="size-4 sm:size-3.5" />
              </Button>
            </Link>
            <Link to="/flasher" data-testid="main-nav-flasher-link" className="hidden sm:inline-flex">
              <Button
                variant={isFlasher ? "secondary" : "ghost"}
                size="sm"
                className="h-9 sm:h-8 w-9 sm:w-9 p-0"
                aria-label="Flasher le firmware ESP en ligne"
                title="Flasher le firmware ESP en ligne"
              >
                <Zap className="size-4 sm:size-3.5" />
              </Button>
            </Link>
            <Link
              to={isSetup ? "/" : "/setup"}
              data-testid="main-nav-setup-link"
              className="hidden sm:inline-flex"
            >
              <Button
                variant={isSetup ? "secondary" : "outline"}
                size="sm"
                className="h-9 sm:h-8"
                aria-label={isSetup ? "Aller au tableau de bord" : "Configuration ESP8266"}
              >
                <Settings2 className="size-4 sm:size-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">
                  {isSetup ? "Tableau de bord" : "Configuration ESP8266"}
                </span>
              </Button>
            </Link>

            {/* Menu hamburger : visible UNIQUEMENT en mobile (< sm).
                Regroupe Réglages / Flasher / Configuration ESP8266 pour
                éviter le débordement de la barre sur écrans étroits. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 sm:hidden"
                  aria-label="Menu de navigation"
                  data-testid="mobile-nav-menu-trigger"
                >
                  <MenuIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Navigation
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => navigate(isSetup ? "/" : "/setup")}
                  data-testid="mobile-nav-setup-item"
                >
                  {isSetup ? (
                    <LayoutDashboard className="size-4 mr-2" />
                  ) : (
                    <Settings2 className="size-4 mr-2" />
                  )}
                  {isSetup ? "Tableau de bord" : "Configuration ESP8266"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate("/settings")}
                  data-testid="mobile-nav-settings-item"
                >
                  <SlidersHorizontal className="size-4 mr-2" />
                  Réglages
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate("/flasher")}
                  data-testid="mobile-nav-flasher-item"
                >
                  <Zap className="size-4 mr-2" />
                  Flasher le firmware
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <AuthMenu />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-border/60 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            SQM Nightwatch v{APP_VERSION} — Récepteur autonome pour capteur SQM-LE DIY
          </span>
          <span className="flex items-center gap-1.5">
            <Github className="size-3.5" /> Auto-hébergé · Données locales
          </span>
        </div>
      </footer>

      {/* Signature persistante « Build & Idea by Quentin Dumont » */}
      <SignatureBadge />
    </div>
  );
}
