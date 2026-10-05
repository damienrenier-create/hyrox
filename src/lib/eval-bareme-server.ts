import { db } from "@/lib/db";

// L'onglet « Baremes » de l'espace eleve n'apparait que pour un eleve concerne par le WOD Eval : il en a deja un a son
// nom (`hasEval`), ou sa classe est dans le cycle en cours et ce cycle a une seance-type Eval. Les 1res et les 2es,
// qui ne font pas ce cycle, ne le voient donc pas.
export async function evalBaremeVisible(className: string | null | undefined, hasEval = false): Promise<boolean> {
  if (hasEval) return true;
  if (!className) return false;
  const cycle = await db.orm.public.Cycle.where({ isCurrent: true }).first();
  if (!cycle) return false;
  // Cycle.classes : null ou vide = toutes les classes.
  const allowed = Array.isArray(cycle.classes) ? (cycle.classes as unknown[]).filter((c): c is string => typeof c === "string") : [];
  if (allowed.length && !allowed.includes(className)) return false;
  return !!(await db.orm.public.CyclePlan.where({ cycleId: cycle.id, wodType: "HYROX" }).first());
}
