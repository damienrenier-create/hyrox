import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";
import { elapsed, RaceContext } from "@/lib/wod-engines/templates/pyramide-engine";

function toMs(v: unknown): number {
  return new Date(String(v)).getTime();
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
// Module serveur sans directive "use server" : il n'est PAS expose comme endpoint, seulement importe
// par les pages/actions qui en ont besoin (greffier, espace eleve, export).
export async function buildRaceContext(sessionId: string): Promise<RaceContextBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const rawTeams = await db.orm.public.Team.where({ sessionId }).all();
  const teams = rawTeams.map((t) => ({ id: t.id, order: t.order ?? 0 })).sort((a, b) => a.order - b.order);
  const sortedExercises = exercisesFor(session);
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
        settings: { rep0: 5, peak: 10, step: 1, capMin: 40, afterMin: 10, penMin: 1 },
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

// Heure absolue (epoch ms) a laquelle une equipe a termine, ou null.
export function teamFinishedAtMs(bundle: RaceContextBundle, finishAtElapsedMs: number | null): number | null {
  if (finishAtElapsedMs === null || bundle.startedAtMs === null) return null;
  // On re-ajoute les pauses ecoulees avant l'arrivee pour retrouver l'heure reelle.
  let abs = bundle.startedAtMs + finishAtElapsedMs;
  for (const p of bundle.pauses) {
    if (p.to !== null && p.from < abs) abs += p.to - p.from;
  }
  return abs;
}
