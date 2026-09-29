import Link from "next/link";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { cx, ui } from "@/lib/ui";

// Onglets de l'espace eleve (Sartay 29/09 nuit) : ses WOD, ses auto-evaluations.
export function EleveTabs({ active, todo = 0 }: { active: "wods" | "selfevals"; todo?: number }) {
  const tabs = [
    { id: "wods", href: "/eleve", label: "💪 Mes WOD" },
    { id: "selfevals", href: "/eleve/auto-evaluations", label: "📝 Mes auto-évaluations" },
  ] as const;
  return (
    <nav className={`${ui.segmented} w-full`}>
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} className={cx("flex-1 relative text-center text-sm font-bold py-2 rounded-lg transition", active === t.id ? ui.segOn : ui.segOff)}>
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
