"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWodEngine } from "@/lib/wod-engines";
import { elapsed, RaceContext } from "@/lib/wod-engines/templates/pyramide-engine";

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
  await requireGreffierAccess(sessionId);
  const existing = await db.orm.public.RaceState.where({ sessionId }).first();
  if (existing) return existing.id;
  const created = await db.orm.public.RaceState.create({ sessionId });
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

export type RaceContextBundle = {
  ctx: RaceContext;
  startedAtMs: number | null;
  endedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  teamNames: Record<string, string>;
  exerciseLabels: Record<string, string>;
  className: string;
};

// Construit le contexte de calcul pur a partir de l'etat persiste (source de verite = Postgres).
// Utilise a la fois par la page Greffier (rendu serveur initial) et par l'export CSV.
export async function buildRaceContext(sessionId: string): Promise<RaceContextBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const rawTeams = await db.orm.public.Team.where({ sessionId }).all();
  const teams = rawTeams.map((t) => ({ id: t.id, order: t.order ?? 0 })).sort((a, b) => a.order - b.order);
  const sortedExercises = [...getWodEngine(session.wodType).exercises].sort((a, b) => a.number - b.number);
  const exercises = sortedExercises.map((e) => ({ id: e.id, number: e.number }));
  const exerciseLabels: Record<string, string> = {};
  sortedExercises.forEach((e) => { exerciseLabels[e.id] = e.label; });

  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const teamNames: Record<string, string> = {};
  rawTeams.forEach((t) => { teamNames[t.id] = t.name; });

  const startOverride = new Map<string, string>();
  const endOverride = new Map<string, string | "NONE">();
  rawTeams.forEach((t) => {
    if (t.startExerciseId) startOverride.set(t.id, t.startExerciseId);
    if (t.endExerciseId) endOverride.set(t.id, t.endExerciseId === "NONE" ? "NONE" : t.endExerciseId);
  });

  if (!rs) {
    return {
      ctx: {
        settings: { rep0: 5, peak: 10, step: 1, capMin: 45, afterMin: 10, penMin: 1 },
        teams,
        exercises,
        noStartExerciseIds: new Set(),
        laps: [],
        cards: [],
        startOverride,
        endOverride,
      },
      startedAtMs: null,
      endedAtMs: null,
      pauses: [],
      teamNames,
      exerciseLabels,
      className: "",
    };
  }

  const startedAtMs = rs.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs.endedAt ? toMs(rs.endedAt) : null;
  const pausesRaw = await db.orm.public.RacePause.where({ raceStateId: rs.id }).all();
  const pauses = pausesRaw.map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));

  const rawLaps = await db.orm.public.Lap.where({ raceStateId: rs.id }).orderBy((l) => l.at.asc()).all();
  const rawCards = await db.orm.public.YellowCard.where({ raceStateId: rs.id }).all();

  const laps = rawLaps.map((l) => ({ teamId: l.teamId, at: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  const cards = rawCards.map((c) => ({ teamId: c.teamId, at: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 }));

  return {
    ctx: {
      settings: { rep0: rs.rep0, peak: rs.peak, step: rs.step, capMin: rs.capMin, afterMin: rs.afterMin, penMin: rs.penMin },
      teams,
      exercises,
      noStartExerciseIds: new Set((rs.noStartExerciseIds as string[]) ?? []),
      laps,
      cards,
      startOverride,
      endOverride,
    },
    startedAtMs,
    endedAtMs,
    pauses,
    teamNames,
    exerciseLabels,
    className: "",
  };
}
