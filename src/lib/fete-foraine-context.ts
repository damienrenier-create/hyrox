import { db } from "@/lib/db";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { exercisesFor } from "@/lib/session-exercises";
import { FF_COLORS, FF_STATIONS, FF_UNITS, type FFColor, type FFContext, type FFSettings, type FFTeam } from "@/lib/wod-engines/templates/fete-foraine-engine";
import { toMs } from "@/lib/scheduling";

export type FFBundle = {
  ctx: FFContext;
  startedAtMs: number | null;
  endedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  finAbsMs: Record<string, number>; // teamId -> heure absolue de "Fin du WOD" (auto-evaluation)
};

export function readFFSettings(settings: unknown): FFSettings {
  const s = (settings as { ff?: { unit?: unknown; mode?: unknown } } | null)?.ff;
  const unit = typeof s?.unit === "number" && FF_UNITS.includes(s.unit) ? s.unit : 60;
  const mode = s?.mode === "sum" ? "sum" : "avg";
  return { unit, mode };
}

// Contexte pur du moteur Fete Foraine a partir de Postgres : equipes (+ coureurs = membres par identifiant),
// pointages en ms ecoulees (pauses deduites via RaceState/RacePause, comme la Pyramide), reglages.
export async function buildFFBundle(sessionId: string): Promise<FFBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const rawTeams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const teams: FFTeam[] = [];
  for (const t of rawTeams) {
    const members = await db.orm.public.TeamMember.where({ teamId: t.id }).all();
    const runners = [];
    for (const m of members) {
      const u = await db.orm.public.User.where({ id: m.userId }).first();
      if (u) runners.push({ memberId: m.id, userId: u.id, name: u.firstName || u.name, points: m.finisherPoints ?? 0 });
    }
    runners.sort((a, b) => a.name.localeCompare(b.name));
    teams.push({
      id: t.id,
      order: t.order ?? 0,
      name: t.name,
      color: t.color && (FF_COLORS as readonly string[]).includes(t.color) ? (t.color as FFColor) : null,
      penalties: t.penalties ?? 0,
      runners,
    });
  }

  const exercises = exercisesFor(session)
    .filter((e) => e.id !== "corde")
    .map((e) => {
      const base = FF_STATIONS.find((s) => s.id === e.id);
      return { id: e.id, label: e.label, reps: base?.reps ?? 0, n: base?.n };
    });

  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs?.endedAt ? toMs(rs.endedAt) : null;
  const pauses = rs ? (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })) : [];

  const rawEvents = await db.orm.public.StationEvent.where({ sessionId }).orderBy((e) => e.at.asc()).all();
  const finAbsMs: Record<string, number> = {};
  const events = rawEvents.map((e) => {
    const abs = toMs(e.at);
    if (e.stationId === "fin") finAbsMs[e.teamId] = abs;
    return { teamId: e.teamId, stationId: e.stationId, at: elapsed(startedAtMs, pauses, abs) ?? 0 };
  });

  return { ctx: { teams, exercises, events, settings: readFFSettings(session.settings) }, startedAtMs, endedAtMs, pauses, finAbsMs };
}
