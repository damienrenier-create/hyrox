"use server";

import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { refereeAccess, type RefereeAccess } from "@/lib/referee-access";
import type { SessionPayload } from "@/lib/auth";
import { toMs } from "@/lib/scheduling";
import { qualityFromCriteria, type CriterionCheck, evalTechChecks } from "@/lib/level-criteria";
import { CARD_REASONS, OBS_GRACE_MS, OBS_MINUTES } from "@/lib/observation-types";
import { currentObservation, drawTarget, obsStations, participantsOf, staffObservation, studentObservations } from "@/lib/observations";
import { hxCapState } from "@/lib/hyrox-context";

// Actions de l'arbitrage du WOD Eval (Sartay 04/10) : annonce du prochain eleve a suivre, series de reps horodatees,
// appreciation sur les criteres. Rien n'est jamais efface : une serie fausse est ANNULEE (voidedAt).
// Arbitre eleve : cycle automatique. Une observation = 1 minute d'annonce puis une fenetre de 5 minutes ; on n'ecrit
// dedans que pendant la fenetre, et elle se ferme toute seule (plus de bouton « Terminer »).

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

// Pourquoi on ne peut pas annoncer un nouvel eleve maintenant (null = le WOD tourne).
async function raceBlocked(sessionId: string): Promise<string | null> {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt) return "Le WOD n'est pas encore lancé.";
  if (rs.endedAt) return "Le WOD est terminé.";
  if ((await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).some((p) => p.to == null)) return "Le WOD est en pause : le prochain élève arrive à la reprise.";
  // Limite de temps atteinte : plus de nouvel eleve, meme si l'ecran du greffier n'a pas encore clos la course.
  if ((await hxCapState(sessionId))?.reached) return "Le WOD est terminé.";
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

// Observation sur laquelle l'arbitre ecrit.
// Eleve : celle que son ecran lui a ouverte, et seulement pendant sa fenetre de 5 minutes (ni pendant l'annonce, ni
// apres la fermeture). Prof : celle de l'eleve choisi, creee au besoin, sans limite de temps.
async function resolveObs(g: Gate, input: { observationId?: string | null; targetUserId?: string | null }, create: boolean): Promise<{ error: string } | { obs: ObsRow }> {
  if (!g.staff) {
    const obs = input.observationId ? (await studentObservations(g.session.id, g.user.id)).find((o) => o.id === input.observationId) : null;
    if (!obs) return { error: "Cette observation n'existe plus : attends le prochain élève." };
    const now = Date.now();
    if (now < toMs(obs.startedAt)) return { error: "L'observation n'a pas encore commencé : repère d'abord ton élève." };
    if (obs.endsAt && now > toMs(obs.endsAt) + OBS_GRACE_MS) return { error: `Les ${OBS_MINUTES} minutes sont écoulées : la fenêtre de cet élève est fermée.` };
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

// Arbitre eleve : annonce le prochain eleve a suivre (1 minute pour le reperer, puis 5 minutes d'observation). Appelee
// par « Commencer », puis par l'ecran a la fin de chaque fenetre. `soft` = attente normale (WOD pas lance, en pause,
// termine) : l'ecran l'affiche comme un etat, pas comme une erreur.
export async function obsDrawAction(sessionId: string): Promise<{ error: string; soft?: true } | { ok: true }> {
  const g = await gate(sessionId);
  if ("error" in g) return { error: g.error };
  if (g.staff) return { error: "Le tirage au sort est réservé aux élèves arbitres : un prof choisit qui il évalue." };
  const blocked = await raceBlocked(sessionId);
  if (blocked) return { error: blocked, soft: true };
  if (currentObservation(await studentObservations(sessionId, g.user.id), Date.now())) return { ok: true }; // deja un eleve annonce ou en cours
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
// Arbitre eleve : envoyee a chaque coche (la fenetre se ferme toute seule) ; prof : au bouton.
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
  // La ligne « implication de l'equipe » du prof est enregistree, mais la note de technique se calcule sans elle.
  const tech = evalTechChecks(checks);
  const note = qualityFromCriteria(tech.filter((c) => c.met).length, tech.length);
  const entries = await db.orm.public.RepEntry.where({ observationId: r.obs.id, exerciseId: ex.id }).all();
  const repsObserved = entries.filter((e) => e.voidedAt == null).reduce((n, e) => n + e.reps, 0);
  const criteria = JSON.parse(JSON.stringify(checks));
  const existing = await db.orm.public.Evaluation.where({ observationId: r.obs.id, exerciseId: ex.id }).first();
  if (existing) await db.orm.public.Evaluation.where({ id: existing.id }).update({ note, criteria, repsObserved });
  else await db.orm.public.Evaluation.create({ sessionId, teamId: r.obs.teamId, evaluatorId: g.user.id, exerciseId: ex.id, repsObserved, note, targetUserId: r.obs.targetUserId, criteria, observationId: r.obs.id });
  return { ok: true };
}

// Carte jaune donnee par un arbitre a l'equipe de l'eleve qu'il suit (Sartay 06/10 : « rendre l'acces aux cartes jaunes
// plus facile pour le greffier et les arbitres »). Eleve : seulement pendant sa fenetre d'observation ; prof : l'eleve
// choisi. Qui l'a donnee et pourquoi sont enregistres ; le greffier la voit et peut la retirer.
export async function obsCardAction(sessionId: string, input: { observationId?: string | null; targetUserId?: string | null; reason: string }): Promise<{ error: string } | { ok: true; teamName: string }> {
  const g = await gate(sessionId);
  if ("error" in g) return g;
  if (!(CARD_REASONS as readonly string[]).includes(input.reason)) return { error: "Choisis un motif." };
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt) return { error: "Le WOD n'est pas encore lancé." };
  if (rs.endedAt) return { error: "Le WOD est terminé." };
  let teamId: string | null;
  if (g.staff) {
    if (!input.targetUserId) return { error: "Choisis d'abord un élève." };
    teamId = (await participantsOf(sessionId)).find((p) => p.userId === input.targetUserId)?.teamId ?? null;
  } else {
    const r = await resolveObs(g, input, false);
    if ("error" in r) return r;
    teamId = r.obs.teamId;
  }
  if (!teamId) return { error: "Cet élève n'est dans aucune équipe de cette séance." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  // Double appui : une seule carte du meme arbitre a la meme equipe en 30 s.
  const mine = await db.orm.public.YellowCard.where({ raceStateId: rs.id, teamId }).all();
  if (mine.some((c) => c.givenById === g.user.id && Date.now() - toMs(c.at) < 30_000)) return { error: "Tu viens déjà de donner une carte à cette équipe." };
  await db.orm.public.YellowCard.create({ raceStateId: rs.id, teamId, at: Temporal.Now.instant(), givenById: g.user.id, reason: input.reason });
  return { ok: true, teamName: team.name };
}
