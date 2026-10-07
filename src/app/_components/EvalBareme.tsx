import { EVAL_DEFAULT_STARS, EVAL_GROUPS, EVAL_LEVELS, EVAL_NOTE_MAX, evalGroupDefaultStars, evalNote, noteText, starsText, type EvalGroup } from "@/lib/eval-bareme";
import { cx, ui } from "@/lib/ui";

// Bareme de la perf du WOD Eval (Sartay 05/10) : une ligne par parcours (les memes repetitions pour tout le monde), une
// colonne par groupe avec les points sur 20 si le WOD est boucle avant la fin officielle. `groups` limite les colonnes
// (l'espace eleve ne montre que les annees de l'eleve), `big` grossit le tableau pour l'ecran projete du greffier.
export function EvalBaremeTable({ groups, big = false }: { groups?: EvalGroup[]; big?: boolean }) {
  const cols = EVAL_GROUPS.filter((g) => !groups || groups.includes(g.key));
  return (
    <div className={`${ui.card} overflow-auto`}>
      <table className={cx("w-full border-collapse text-center tabular-nums", big ? "text-lg" : "text-sm")}>
        <thead>
          <tr>
            <th className={ui.th}>Parcours</th>
            <th className={`${ui.th} text-right`}>Rép.</th>
            {cols.map((g) => (
              <th key={g.key} className={cx(ui.th, "text-center")}>
                {g.years}
                <span className="block normal-case tracking-normal font-semibold">{g.team}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...EVAL_LEVELS].reverse().map((l) => {
            const def = l.stars === EVAL_DEFAULT_STARS;
            return (
              <tr key={l.stars} className={cx("border-b border-line/70", def ? "bg-accent-soft/60" : "odd:bg-paper/60")}>
                <td className="p-2 text-left font-bold text-accent-ink whitespace-nowrap">
                  {starsText(l.stars)}
                  {def && <span className="ml-1.5 text-[11px] font-semibold text-ink-2">par défaut</span>}
                </td>
                <td className="p-2 text-right font-display font-extrabold">{l.reps}</td>
                {cols.map((g) => {
                  const n = evalNote(g.key, l.stars);
                  // Parcours par defaut propre a ce groupe (filles de 3e-4e : 2★), s'il differe de celui de tout le monde.
                  const gd = !def && l.stars === evalGroupDefaultStars(g.key);
                  return (
                    <td key={g.key} className={cx("p-2 font-display font-extrabold", n >= EVAL_NOTE_MAX ? "text-success-ink" : "text-ink", gd && "bg-accent-soft/60")}>
                      {noteText(n)}
                      <span className="text-ink-3 font-sans font-semibold text-xs">/{EVAL_NOTE_MAX}</span>
                      {gd && <span className="block text-[11px] font-sans font-semibold text-ink-2">par défaut</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
