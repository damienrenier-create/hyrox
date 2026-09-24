"use server";

import { getSession } from "@/lib/session-server";
import { buildPyramideRecords, type RecordFilters, type RecordsResult } from "@/lib/pyramide-records";
import { buildLevelRecords } from "@/lib/level-records";

// Les records balaient TOUTES les seances Pyramide : on ne les calcule qu'a la demande, quand l'onglet
// est ouvert, jamais au rendu de la page greffier qui tourne pendant la course.
export async function pyramideRecordsAction(filters: RecordFilters): Promise<RecordsResult> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) {
    return { boards: [], excluded: [], grades: [], teamsScanned: 0, sessionsScanned: 0 };
  }
  return buildPyramideRecords(filters);
}

export async function levelRecordsAction(filters: RecordFilters): Promise<RecordsResult> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) {
    return { boards: [], excluded: [], grades: [], teamsScanned: 0, sessionsScanned: 0 };
  }
  return buildLevelRecords(filters);
}

// ===== Invalidation d'un record (DAMZER seul) =====
// Un greffier qui a tape trop vite ou trop tard fausse un chrono sans fausser les tours. On ecarte alors
// l'equipe du palmares SANS toucher a ce que les eleves ont fait : la liste des equipes ecartees vit
// dans Session.settings.excludedFromRecords, aucune donnee n'est effacee, et c'est reversible.
async function setExcluded(sessionId: string, teamId: string, excluded: boolean): Promise<{ error: string } | { ok: true }> {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") return { error: "Réservé à DAMZER." };
  const { db } = await import("@/lib/db");
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const cur = new Set(Array.isArray(prev.excludedFromRecords) ? (prev.excludedFromRecords as string[]) : []);
  if (excluded) cur.add(teamId);
  else cur.delete(teamId);
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, excludedFromRecords: [...cur] } });
  return { ok: true };
}
export async function excludeFromRecordsAction(sessionId: string, teamId: string) {
  return setExcluded(sessionId, teamId, true);
}
export async function restoreToRecordsAction(sessionId: string, teamId: string) {
  return setExcluded(sessionId, teamId, false);
}
