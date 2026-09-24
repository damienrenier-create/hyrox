"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { LEVEL_STAFF, listExercises, listLevels, seedDefaultExercises } from "@/lib/level";
import { PROPOSED_LEVELS } from "@/lib/level-proposal";

// Charge la proposition de 20 niveaux dans une echelle VIDE (jamais par-dessus un travail en cours).
// Les exercices manquants du listing sont importes au passage, par libelle.
export async function loadProposalAction(): Promise<{ ok: true; levels: number } | { error: string }> {
  const user = await getSession();
  if (!user || !(LEVEL_STAFF as readonly string[]).includes(user.role)) return { error: "Accès refusé." };
  if ((await listLevels()).length > 0) return { error: "L'échelle n'est pas vide : supprime les niveaux existants avant de charger la proposition." };
  await seedDefaultExercises(user.name);
  const byLabel = new Map((await listExercises()).map((e) => [e.label.trim().toUpperCase(), e.id]));
  for (const [i, l] of PROPOSED_LEVELS.entries()) {
    const cards = l.cards.map(([label, reps]) => {
      const id = byLabel.get(label);
      if (!id) throw new Error(`Exercice inconnu dans la proposition : ${label}`);
      return { exerciseId: id, reps };
    });
    await db.orm.public.Level.create({ number: i + 1, name: l.name, cards });
  }
  revalidatePath("/admin/level");
  return { ok: true, levels: PROPOSED_LEVELS.length };
}
