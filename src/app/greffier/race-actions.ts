"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { getWodEngine } from "@/lib/wod-engines";

async function requireGreffierAccess(sessionId: string) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");
  return { user, session };
}

function toMs(v: unknown): number {
  return new Date(String(v)).getTime();
}

export async function ensureRaceStateAction(sessionId: string): Promise<string> {
  const { session } = await requireGreffierAccess(sessionId);
  // Ateliers ou personne ne commence : valeur par defaut du WOD (Pyramide : Helicoptere et Corde a sauter).
  const noStart = getWodEngine(session.wodType).noStartExerciseIds ?? [];

  const existing = await db.orm.public.RaceState.where({ sessionId }).first();
  if (existing) {
    // Seance pas encore lancee et liste jamais renseignee : on applique le defaut du WOD (rattrapage des
    // seances creees avant que ce reglage existe). Une course demarree n'est jamais modifiee.
    const current = (existing.noStartExerciseIds as string[] | null) ?? [];
    if (!existing.startedAt && current.length === 0 && noStart.length > 0) {
      await db.orm.public.RaceState.where({ id: existing.id }).update({ noStartExerciseIds: noStart });
    }
    return existing.id;
  }
  const created = await db.orm.public.RaceState.create({ sessionId, noStartExerciseIds: noStart });
  return created.id;
}

export async function startRaceAction(sessionId: string): Promise<{ error: string } | { ok: true }> {
  await requireGreffierAccess(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) return { error: "État de course manquant." };
  if (rs.startedAt) return { ok: true };
  await db.orm.public.RaceState.where({ id: rs.id }).update({ startedAt: Temporal.Now.instant() });
  return { ok: true };
}

export async function togglePauseAction(sessionId: string): Promise<{ error: string } | { ok: true }> {
  await requireGreffierAccess(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt || rs.endedAt) return { error: "Course non démarrée ou déjà terminée." };
  const pauses = await db.orm.public.RacePause.where({ raceStateId: rs.id }).all();
  const open = pauses.find((p) => p.to === null);
  if (open) {
    await db.orm.public.RacePause.where({ id: open.id }).update({ to: Temporal.Now.instant() });
  } else {
    await db.orm.public.RacePause.create({ raceStateId: rs.id, from: Temporal.Now.instant() });
  }
  return { ok: true };
}

export async function validateLapAction(sessionId: string, teamId: string): Promise<{ error: string } | { ok: true }> {
  await requireGreffierAccess(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt || rs.endedAt) return { error: "Course non démarrée ou déjà terminée." };
  const pauses = await db.orm.public.RacePause.where({ raceStateId: rs.id }).all();
  if (pauses.some((p) => p.to === null)) return { error: "Course en pause." };
  await db.orm.public.Lap.create({ raceStateId: rs.id, teamId, at: Temporal.Now.instant() });
  return { ok: true };
}

export async function giveCardAction(sessionId: string, teamId: string): Promise<{ error: string } | { ok: true }> {
  await requireGreffierAccess(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) return { error: "État de course manquant." };
  await db.orm.public.YellowCard.create({ raceStateId: rs.id, teamId, at: Temporal.Now.instant() });
  return { ok: true };
}

export async function undoLastAction(sessionId: string): Promise<{ error: string } | { ok: true }> {
  await requireGreffierAccess(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) return { error: "État de course manquant." };

  const laps = await db.orm.public.Lap.where({ raceStateId: rs.id }).orderBy((l) => l.at.desc()).all();
  const cards = await db.orm.public.YellowCard.where({ raceStateId: rs.id }).orderBy((c) => c.at.desc()).all();
  const lastLap = laps[0];
  const lastCard = cards[0];
  if (!lastLap && !lastCard) return { error: "Rien à annuler." };

  if (lastCard && (!lastLap || toMs(lastCard.at) >= toMs(lastLap.at))) {
    await db.orm.public.YellowCard.where({ id: lastCard.id }).delete();
  } else {
    await db.orm.public.Lap.where({ id: lastLap.id }).delete();
  }
  return { ok: true };
}

export async function setTeamStartAction(teamId: string, exerciseId: string | null): Promise<{ ok: true }> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  await db.orm.public.Team.where({ id: teamId }).update({ startExerciseId: exerciseId });
  return { ok: true };
}

export async function setTeamEndAction(teamId: string, value: string | null): Promise<{ ok: true }> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  await db.orm.public.Team.where({ id: teamId }).update({ endExerciseId: value });
  return { ok: true };
}

// buildRaceContext vit dans src/lib/race-context.ts (module serveur non expose comme action) :
// il est partage par la page Greffier, l'espace eleve et l'auto-evaluation.
