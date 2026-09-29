"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { QUALITY_VALUES } from "@/lib/wod-engines/core/quality";
import { qualityFromCriteria, readCriteria } from "@/lib/level-criteria";

// Correction d'une evaluation a criteres (demineur) par le pupitre : on re-coche, l'appreciation suit.
export async function updateEvaluationCriteriaAction(evaluationId: string, reps: number, met: number[], liked = false): Promise<{ error: string } | { ok: true }> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return { error: "Accès refusé." };
  if (!Number.isInteger(reps) || reps < 0 || reps > 999) return { error: "Répétitions invalides." };
  const ev = await db.orm.public.Evaluation.where({ id: evaluationId }).first();
  if (!ev) return { error: "Évaluation introuvable." };
  const old = readCriteria((ev as { criteria?: unknown }).criteria);
  if (!old) return { error: "Cette évaluation n'a pas de critères." };
  const checks = old.map((c, i) => ({ label: c.label, met: met.includes(i) }));
  const note = qualityFromCriteria(checks.filter((c) => c.met).length, checks.length, liked === true);
  await db.orm.public.Evaluation.where({ id: ev.id }).update({ repsObserved: reps, note, criteria: JSON.parse(JSON.stringify(checks)) });
  return { ok: true };
}

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
