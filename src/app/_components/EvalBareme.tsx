import { HX_LEVELS, starsText } from "@/lib/wod-engines/templates/hyrox-engine";
import { EVAL_GROUPS, EVAL_NOTE_MAX, evalMaxNote, noteText, type EvalGroup } from "@/lib/eval-bareme";
import { cx, ui } from "@/lib/ui";

// Bareme de l'intensite du WOD Eval (Sartay 05/10) : une ligne par niveau, du plus haut au plus bas, une colonne par
// groupe. `groups` limite les colonnes (l'espace eleve ne montre que les annees de l'eleve), `highlight` met un groupe
// en avant, `big` grossit le tableau pour l'ecran projete du greffier. Sans etat : sert au greffier et a l'espace eleve.
export function EvalBaremeTable({ groups, highlight = null, big = false }: { groups?: EvalGroup[]; highlight?: EvalGroup | null; big?: boolean }) {
  const cols = EVAL_GROUPS.filter((g) => !groups || groups.includes(g.key));
  return (
    <div className={`${ui.card} overflow-auto`}>
      <table className={cx("w-full border-collapse text-center tabular-nums", big ? "text-lg" : "text-sm")}>
        <thead>
          <tr>
            <th className={ui.th}>Niveau</th>
            <th className={`${ui.th} text-right`}>Rép.</th>
            {cols.map((g) => (
              <th key={g.key} className={cx(ui.th, "text-center", highlight === g.key && "bg-brand-soft text-brand-ink")}>
                {g.years}
                <span className="block normal-case tracking-normal font-semibold">{g.team}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...HX_LEVELS].reverse().map((l) => (
            <tr key={l.stars} className={ui.tr}>
              <td className="p-2 text-left font-bold text-accent-ink whitespace-nowrap">{starsText(l.stars)}</td>
              <td className="p-2 text-right font-display font-extrabold">{l.reps}</td>
              {cols.map((g) => {
                const n = evalMaxNote(g.key, l.reps);
                return (
                  <td key={g.key} className={cx("p-2 font-display font-extrabold", highlight === g.key && "bg-brand-soft/60", n >= EVAL_NOTE_MAX ? "text-success-ink" : "text-ink")}>
                    {noteText(n)}
                    <span className="text-ink-3 font-sans font-semibold text-xs">/{EVAL_NOTE_MAX}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
