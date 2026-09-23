"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { QUALITY_VALUES } from "@/lib/wod-engines/core/quality";

// Correction d'une evaluation d'arbitre par le pupitre (DAMZER, coachs, greffier) : un eleve qui a tape
// 55 reps au lieu de 5 et ne sait pas se corriger. Reps et appreciation seulement, le tir reste.
export async function updateEvaluationAction(evaluationId: string, reps: number, note: number): Promise<{ error: string } | { ok: true }> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return { error: "Accès refusé." };
  if (!Number.isInteger(reps) || reps < 0 || reps > 999) return { error: "Répétitions invalides." };
  if (!QUALITY_VALUES.includes(note)) return { error: "Appréciation invalide." };
  const ev = await db.orm.public.Evaluation.where({ id: evaluationId }).first();
  if (!ev) return { error: "Évaluation introuvable." };
  await db.orm.public.Evaluation.where({ id: ev.id }).update({ repsObserved: reps, note });
  return { ok: true };
}
