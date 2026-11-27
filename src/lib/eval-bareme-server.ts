import { db } from "@/lib/db";

// L'onglet « Baremes » de l'espace eleve n'apparait que pour un eleve concerne par le WOD Eval : il en a deja un a son
// nom (`hasEval`), ou sa classe est dans le cycle en cours et ce cycle a une seance-type Eval. Les 1res et les 2es,
// qui ne font pas ce cycle, ne le voient donc pas.
// 27/11 (Sartay : « les eleves ont encore un onglet bareme, en lien avec les WOD d'Hyrox, alors qu'on est en badminton ») :
// seulement pendant un cycle qui a un WOD Hyrox ; avoir fait l'Eval ne suffit plus a garder l'onglet (hasEval ignore).
export async function evalBaremeVisible(className: string | null | undefined, hasEval = false): Promise<boolean> {
  void hasEval;
  if (!className) return false;
  const cycle = await db.orm.public.Cycle.where({ isCurrent: true }).first();
  if (!cycle) return false;
  // Cycle.classes : null ou vide = toutes les classes.
  const allowed = Array.isArray(cycle.classes) ? (cycle.classes as unknown[]).filter((c): c is string => typeof c === "string") : [];
  if (allowed.length && !allowed.includes(className)) return false;
  return !!(await db.orm.public.CyclePlan.where({ cycleId: cycle.id, wodType: "HYROX" }).first());
}
