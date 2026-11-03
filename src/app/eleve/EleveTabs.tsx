import Link from "next/link";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { cx, ui } from "@/lib/ui";

// Onglets de l'espace eleve (Sartay 29/09 nuit) : ses WOD, ses auto-evaluations ; et, pour les classes qui font le WOD
// Eval, les baremes (05/10 : « ajouter un onglet dans l'app pour expliquer les baremes ») ; pour le badminton, le
// classement ELO (03/11 : « dans un onglet de leur profil »).
export function EleveTabs({ active, todo = 0, bareme = false, classement = false }: { active: "wods" | "selfevals" | "bareme" | "classement"; todo?: number; bareme?: boolean; classement?: boolean }) {
  const compact = bareme || classement;
  const tabs = [
    { id: "wods", href: "/eleve", label: "💪 Mes WOD" },
    { id: "selfevals", href: "/eleve/auto-evaluations", label: compact ? "📝 Auto-évaluations" : "📝 Mes auto-évaluations" },
    ...(bareme ? [{ id: "bareme", href: "/eleve/baremes", label: "🎯 Barèmes" }] : []),
    ...(classement ? [{ id: "classement", href: "/eleve/classement", label: "🏸 Classement" }] : []),
  ];
  return (
    <nav className={`${ui.segmented} w-full`}>
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} className={cx("flex-1 relative flex items-center justify-center text-center font-bold py-2 rounded-lg transition leading-tight", bareme && classement ? "text-xs px-0.5" : compact ? "text-[13px] px-1" : "text-sm", active === t.id ? ui.segOn : ui.segOff)}>
          {t.label}
          {t.id === "selfevals" && todo > 0 && <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-accent" title="Auto-évaluation à remplir" />}
        </Link>
      ))}
    </nav>
  );
}

// Code d'appreciation colore (TI..E).
export function QualityCodeTag({ code, small = false }: { code: unknown; small?: boolean }) {
  const l = QUALITY_LEVELS.find((x) => x.code === code);
  return l ? <b className={cx(l.color, small && "text-xs")} title={l.label}>{l.code}</b> : <span className="text-ink-3">—</span>;
}
