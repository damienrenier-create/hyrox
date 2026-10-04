"use server";

import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { refereeAccess, type RefereeAccess } from "@/lib/referee-access";
import type { SessionPayload } from "@/lib/auth";
import { toMs } from "@/lib/scheduling";
import { qualityFromCriteria, type CriterionCheck } from "@/lib/level-criteria";
import { OBS_GRACE_MS } from "@/lib/observation-types";
import { activeStudentObservation, drawTarget, obsStations, participantsOf, staffObservation } from "@/lib/observations";

// Actions de l'arbitrage du WOD Eval (Sartay 04/10) : tirage au sort de l'eleve a suivre, series de reps horodatees,
// appreciation sur les criteres, cloture. Rien n'est jamais efface : une serie fausse est ANNULEE (voidedAt).

type Result = { error: string } | { ok: true };
type ObsRow = { id: string; sessionId: string; evaluatorId: string; targetUserId: string; teamId: string; mode: string; startedAt: unknown; endsAt: unknown | null; endedAt: unknown | null };

type Gate = { user: SessionPayload; session: { id: string; wodType: string; settings: unknown }; access: RefereeAccess; staff: boolean };

async function gate(sessionId: string): Promise<{ error: string } | Gate> {
  if (await inPreview()) return { error: PREVIEW_READ_ONLY };
  const user = await getSession();
  if (!user) return { error: "Non authentifié." };
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt || session.wodType !== "HYROX") return { error: "Séance introuvable." };
  const access = await refereeAccess(sessionId, user);
  if (!access.allowed) return { error: access.reason ?? "Arbitrage non autorisé." };
  return { user, session: { id: session.id, wodType: session.wodType, settings: session.settings }, access, staff: user.role !== "STUDENT" };
}

async function raceRunning(sessionId: string): Promise<string | null> {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt) return "Le WOD n'est pas encore lancé.";
  if (rs.endedAt) return "Le WOD est terminé.";
  return null;
}

// Le total de reps de l'appreciation suit les series (une serie ajoutee ou annulee apres coup).
async function syncReps(observationId: string, exerciseId: string) {
  const ev = await db.orm.public.Evaluation.where({ observationId, exerciseId }).first();
  if (!ev) return;
  const entries = await db.orm.public.RepEntry.where({ observationId, exerciseId }).all();
  const total = entries.filter((e) => e.voidedAt == null).reduce((n, e) => n + e.reps, 0);
  if (total !== ev.repsObserved) await db.orm.public.Evaluation.where({ id: ev.id }).update({ repsObserved: total });
}

// Observation sur laquelle l'arbitre ecrit : eleve = la sienne en cours ; prof = celle de l'eleve choisi (creee au besoin).
async function resolveObs(g: Gate, input: { observationId?: string | null; targetUserId?: string | null }, create: boolean): Promise<{ error: string } | { obs: ObsRow }> {
  if (!g.staff) {
    const obs = await activeStudentObservation(g.session.id, g.user.id);
    if (!obs || (input.observationId && obs.id !== input.observationId)) return { error: "Cette observation est terminée : tire un nouvel élève." };
    return { obs };
  }
  if (!input.targetUserId) return { error: "Choisis d'abord un élève." };
  const existing = await staffObservation(g.session.id, g.user.id, input.targetUserId);
  if (existing) return { obs: existing };
  const p = (await participantsOf(g.session.id)).find((x) => x.userId === input.targetUserId);
  if (!p) return { error: "Cet élève n'est dans aucune équipe de cette séance." };
  if (!create) return { error: "Aucune observation de cet élève." };
  const created = await db.orm.public.Observation.create({ sessionId: g.session.id, evaluatorId: g.user.id, targetUserId: p.userId, teamId: p.teamId, mode: "STAFF", startedAt: Temporal.Now.instant() });
  return { obs: created as ObsRow };
}

// Arbitre eleve : l'appli tire au sort l'eleve a suivre pendant 5 minutes.
export async function obsDrawAction(sessionId: string): Promise<Result> {
  const g = await gate(sessionId);
  if ("error" in g) return { error: g.error };
  if (g.staff) return { error: "Le tirage au sort est réservé aux élèves arbitres : un prof choisit qui il évalue." };
  const notRunning = await raceRunning(sessionId);
  if (notRunning) return { error: notRunning };
  const current = await activeStudentObservation(sessionId, g.user.id);
  if (current) {
    if (current.endsAt && Date.now() < toMs(current.endsAt)) return { ok: true }; // deja en cours : pas de second tirage
    return { error: "Termine d'abord ton observation précédente (appréciations), puis tire l'élève suivant." };
  }
  const res = await drawTarget(sessionId, g.user.id, g.access.teamId);
  return "error" in res ? res : { ok: true };
}

// Une serie de repetitions, horodatee a l'instant de la saisie.
export async function obsAddRepsAction(sessionId: string, input: { observationId?: string | null; targetUserId?: string | null; exerciseId: string; reps: number }): Promise<Result> {
  const g = await gate(sessionId);
  if ("error" in g) return { error: g.error };
  if (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > 999) return { error: "Nombre de répétitions invalide (1 à 999)." };
  if (!obsStations(g.session, "STUDENT").some((e) => e.id === input.exerciseId)) return { error: "Exercice inconnu." };
  const r = await resolveObs(g, input, true);
  if ("error" in r) return r;
  if (!g.staff) {
    if (r.obs.endsAt && Date.now() > toMs(r.obs.endsAt) + OBS_GRACE_MS) return { error: "Les 5 minutes sont écoulées : complète tes appréciations puis termine." };
  }
  await db.orm.public.RepEntry.create({ observationId: r.obs.id, sessionId, evaluatorId: g.user.id, targetUserId: r.obs.targetUserId, exerciseId: input.exerciseId, reps: input.reps, at: Temporal.Now.instant() });
  await syncReps(r.obs.id, input.exerciseId);
  return { ok: true };
}

// Annule la derniere serie saisie sur cet exercice (elle reste dans le compte rendu, barree).
export async function obsVoidLastAction(sessionId: string, input: { observationId?: string | null; targetUserId?: string | null; exerciseId: string }): Promise<Result> {
  const g = await gate(sessionId);
  if ("error" in g) return { error: g.error };
  const r = await resolveObs(g, input, false);
  if ("error" in r) return r;
  const entries = (await db.orm.public.RepEntry.where({ observationId: r.obs.id, exerciseId: input.exerciseId }).orderBy((e) => e.at.desc()).all()).filter((e) => e.voidedAt == null && e.evaluatorId === g.user.id);
  if (!entries.length) return { error: "Aucune série à annuler sur cet exercice." };
  await db.orm.public.RepEntry.where({ id: entries[0].id }).update({ voidedAt: Temporal.Now.instant() });
  await syncReps(r.obs.id, input.exerciseId);
  return { ok: true };
}

// Appreciation d'un exercice observe : criteres coches (4 pour un eleve, 6 pour un prof), l'appreciation en est deduite.
export async function obsAppreciateAction(sessionId: string, input: { observationId?: string | null; targetUserId?: string | null; exerciseId: string; met: number[] }): Promise<Result> {
  const g = await gate(sessionId);
  if ("error" in g) return { error: g.error };
  // La grille est celle que l'ecran a montree : stations et run, 4 criteres (eleve) ou 6 (prof).
  const ex = obsStations(g.session, g.staff ? "STAFF" : "STUDENT").find((e) => e.id === input.exerciseId);
  if (!ex) return { error: "Exercice inconnu." };
  if (!Array.isArray(input.met) || input.met.some((i) => !Number.isInteger(i) || i < 0 || i > 20)) return { error: "Critères invalides." };
  const r = await resolveObs(g, input, true);
  if ("error" in r) return r;
  const checks: CriterionCheck[] = ex.criteria.map((label, i) => ({ label, met: input.met.includes(i) }));
  const note = qualityFromCriteria(checks.filter((c) => c.met).length, checks.length);
  const entries = await db.orm.public.RepEntry.where({ observationId: r.obs.id, exerciseId: ex.id }).all();
  const repsObserved = entries.filter((e) => e.voidedAt == null).reduce((n, e) => n + e.reps, 0);
  const criteria = JSON.parse(JSON.stringify(checks));
  const existing = await db.orm.public.Evaluation.where({ observationId: r.obs.id, exerciseId: ex.id }).first();
  if (existing) await db.orm.public.Evaluation.where({ id: existing.id }).update({ note, criteria, repsObserved });
  else await db.orm.public.Evaluation.create({ sessionId, teamId: r.obs.teamId, evaluatorId: g.user.id, exerciseId: ex.id, repsObserved, note, targetUserId: r.obs.targetUserId, criteria, observationId: r.obs.id });
  return { ok: true };
}

// Fin de l'observation d'un eleve arbitre : apres les 5 minutes, et une fois chaque exercice observe apprecie.
export async function obsFinishAction(sessionId: string, observationId: string): Promise<Result> {
  const g = await gate(sessionId);
  if ("error" in g) return { error: g.error };
  if (g.staff) return { ok: true };
  const obs = await activeStudentObservation(sessionId, g.user.id);
  if (!obs || obs.id !== observationId) return { ok: true }; // deja cloturee
  const raceOver = (await raceRunning(sessionId)) !== null;
  if (!raceOver && obs.endsAt && Date.now() < toMs(obs.endsAt)) return { error: "Les 5 minutes ne sont pas terminées : continue à suivre ton élève." };
  const entries = (await db.orm.public.RepEntry.where({ observationId }).all()).filter((e) => e.voidedAt == null);
  const evals = await db.orm.public.Evaluation.where({ observationId }).all();
  const labelOf = new Map(obsStations(g.session, "STUDENT").map((e) => [e.id, e.label]));
  const missing = [...new Set(entries.map((e) => e.exerciseId))].filter((id) => !evals.some((ev) => ev.exerciseId === id));
  if (missing.length) return { error: `Il manque l'appréciation de : ${missing.map((id) => labelOf.get(id) ?? id).join(", ")}.` };
  await db.orm.public.Observation.where({ id: observationId }).update({ endedAt: Temporal.Now.instant() });
  return { ok: true };
}
