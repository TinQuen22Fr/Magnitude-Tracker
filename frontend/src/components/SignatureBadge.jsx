import { Sparkles } from "lucide-react";

/**
 * Badge de signature persistant en bas d'écran, dans l'esprit du
 * badge « Storm Monitor » de Quentin Dumont (autre projet).
 *
 * - Position fixed en bas-centre (visible sur toutes les pages)
 * - Fond sombre semi-opaque, coins arrondis, léger shadow
 * - Icône Sparkles (étoiles scintillantes → ciel étoilé / pollution lumineuse)
 * - Lien vers le dépôt GitHub du projet (ouvre dans un nouvel onglet)
 *
 * En mode nuit astronomique, on désature l'accent jaune pour préserver
 * la vision scotopique de l'observateur (pas de source blanche/jaune
 * intense dans le champ de vision).
 */
export default function SignatureBadge() {
  return (
    <a
      href="https://github.com/TinQuen22Fr/Magnitude-Tracker"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Build & Idea by Quentin Dumont — voir le dépôt GitHub"
      data-testid="signature-badge"
      className={[
        // Positionnement : fixé en bas-centre, safe area iOS incluse
        "fixed left-1/2 -translate-x-1/2 z-40",
        "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
        // Apparence : pilule sombre semi-opaque, blur, bordure discrète
        "inline-flex items-center gap-2 px-4 py-2 rounded-full",
        "bg-[#0d1117]/90 backdrop-blur-sm",
        "border border-white/10",
        "shadow-lg shadow-black/40",
        // Typo
        "text-sm font-medium text-white/90",
        // Interactions
        "transition-transform duration-200 ease-out",
        "hover:scale-[1.03] hover:border-white/20 hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--chart-1))]",
        // Anti-touch : on ne veut pas cacher le contenu de l'app
        "select-none",
      ].join(" ")}
    >
      <Sparkles
        className={[
          "size-4 shrink-0",
          // Jaune scintillant en mode jour, désaturé en rouge en mode nuit
          "text-yellow-400",
          "[.night-mode_&]:text-[hsl(0_60%_55%)]",
        ].join(" ")}
        aria-hidden
      />
      <span>Build &amp; Idea by Quentin Dumont</span>
    </a>
  );
}
