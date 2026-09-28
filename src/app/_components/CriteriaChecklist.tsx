"use client";

import { cx } from "@/lib/ui";

// Criteres de realisation a cocher (arbitre du demineur, corrections) : gros boutons tactiles, dans l'ordre
// d'importance. L'appreciation n'est jamais choisie : elle se deduit du nombre de criteres coches.
export function CriteriaChecklist({ labels, met, onToggle, compact = false }: { labels: string[]; met: boolean[]; onToggle: (i: number) => void; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {labels.map((label, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onToggle(i)}
          aria-pressed={!!met[i]}
          className={cx(
            "w-full text-left rounded-xl border flex items-start gap-2 transition",
            compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
            met[i] ? "bg-success-soft border-success/50" : "bg-card border-line-2 hover:border-brand"
          )}
        >
          <span className={cx("mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 font-black text-xs", met[i] ? "bg-success border-success text-white" : "border-line-2 text-transparent")}>✓</span>
          <span><span className="text-ink-3 font-bold mr-1">{i + 1}.</span>{label}</span>
        </button>
      ))}
    </div>
  );
}
