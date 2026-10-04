"use client";

import { cx } from "@/lib/ui";
import { criterionEmoji } from "@/lib/level-criteria";

// Criteres de realisation a cocher (arbitre du demineur, corrections) : gros boutons tactiles, dans l'ordre
// d'importance. L'appreciation n'est jamais choisie : elle se deduit du nombre de criteres coches.
// Grille de 4 (29/09) : 3 criteres techniques puis ⚡ l'intensite ; quand les 4 sont coches, un ❤️ « coup de coeur »
// s'ajoute (les 4 sont vraiment tres bien faits).
// Arbitrage de l'Eval (Sartay 04/10) : une ligne de plus, « Aucun critere n'est respecte » (`onNone`), pour dire
// explicitement qu'on a regarde et que rien n'y etait — sinon l'exercice reste « sans appreciation » au compte rendu.
export function CriteriaChecklist({ labels, met, onToggle, compact = false, liked = false, onLike, none = false, onNone }: { labels: string[]; met: boolean[]; onToggle: (i: number) => void; compact?: boolean; liked?: boolean; onLike?: () => void; none?: boolean; onNone?: () => void }) {
  const all = labels.length > 0 && labels.every((_, i) => !!met[i]);
  const intensity = labels.length === 4 ? 3 : -1;
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
          <span className="flex items-start gap-1.5"><span className={cx("leading-none flex-shrink-0 w-6 text-center", compact ? "text-base" : "text-xl")} aria-hidden>{criterionEmoji(label) ?? (i === intensity ? "⚡" : `${i + 1}.`)}</span><span>{label}</span></span>
        </button>
      ))}
      {onNone && (
        <button
          type="button"
          onClick={onNone}
          aria-pressed={none}
          data-none
          className={cx(
            "w-full text-left rounded-xl border flex items-start gap-2 transition",
            compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
            none ? "bg-danger-soft border-danger/50 text-danger-ink font-bold" : "bg-card border-dashed border-line-2 text-ink-2 hover:border-danger/60"
          )}
        >
          <span className={cx("mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 font-black text-xs", none ? "bg-danger border-danger text-white" : "border-line-2 text-transparent")}>✓</span>
          <span className="flex items-start gap-1.5"><span className={cx("leading-none flex-shrink-0 w-6 text-center", compact ? "text-base" : "text-xl")} aria-hidden>🚫</span><span>Aucun critère n&apos;est respecté</span></span>
        </button>
      )}
      {onLike && (
        <button
          type="button"
          onClick={onLike}
          disabled={!all}
          aria-pressed={all && liked}
          className={cx(
            "w-full rounded-xl border-2 flex items-center justify-center gap-2 font-bold transition disabled:opacity-40",
            compact ? "px-2 py-1 text-xs" : "px-3 py-2.5 text-sm",
            all && liked ? "bg-danger-soft border-danger text-danger-ink" : "bg-card border-dashed border-line-2 text-ink-2 hover:border-danger/60"
          )}
          title={all ? "Les 4 critères sont vraiment très bien faits" : "Coche d'abord les 4 critères"}
        >
          <span className={cx("text-xl leading-none", !(all && liked) && "grayscale")}>❤️</span>
          {all ? (liked ? "Coup de cœur : les 4 sont vraiment très bien faits" : "Les 4 sont vraiment très bien faits ? Ajoute un cœur") : "Coup de cœur possible quand les 4 sont cochés"}
        </button>
      )}
    </div>
  );
}
