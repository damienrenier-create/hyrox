"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { LEVEL_STAFF, listExercises, listLevels, seedDefaultExercises } from "@/lib/level";
import { materialize, proposalByKey } from "@/lib/level-proposals";
import { DEFAULT_STARS, type Stars } from "@/lib/wod-engines/templates/level-engine";

// Charge une proposition de 25 niveaux (A a F) dans une echelle VIDE. Avec `replace`, DAMZER (seul)
// remplace l'echelle existante : les seances deja lancees gardent leur copie figee dans
// Session.settings.levels. Les exercices manquants du listing sont importes au passage, par libelle.
export async function loadProposalAction(key: string, replace = false, stars: Stars = DEFAULT_STARS): Promise<{ ok: true; levels: number } | { error: string }> {
  const user = await getSession();
  if (!user || !(LEVEL_STAFF as readonly string[]).includes(user.role)) return { error: "Accès refusé." };
  const proposal = proposalByKey(key);
  if (!proposal) return { error: "Proposition inconnue." };
  if (stars !== 1 && stars !== 2 && stars !== 3) return { error: "Parcours inconnu." };
  const existing = await listLevels(stars);
  if (existing.length > 0) {
    if (!replace) return { error: "L'échelle n'est pas vide : supprime les niveaux existants avant de charger une proposition." };
    if (user.role !== "MASTER_ADMIN") return { error: "Remplacer l'échelle est réservé à DAMZER." };
  }
  await seedDefaultExercises(user.name);
  const byLabel = new Map((await listExercises()).map((e) => [e.label.trim().toUpperCase(), e.id]));
  const levels = materialize(proposal).map((l, i) => ({
    stars,
    number: i + 1,
    name: l.name,
    cards: l.cards.map(([label, reps]) => {
      const id = byLabel.get(label);
      if (!id) throw new Error(`Exercice inconnu dans la proposition : ${label}`);
      return { exerciseId: id, reps };
    }),
  }));
  await db.transaction(async (tx) => {
    for (const l of existing) await tx.orm.public.Level.where({ id: l.id }).delete();
    for (const l of levels) await tx.orm.public.Level.create(l);
  });
  revalidatePath("/admin/level");
  return { ok: true, levels: levels.length };
}
