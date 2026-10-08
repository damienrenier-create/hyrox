import { db } from "@/lib/db";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { toMs } from "@/lib/scheduling";
import { memberNames } from "@/lib/staff-names";
import { amrapCapMs, readAmrapSettings, type AmrapContext, type AmrapTeam } from "@/lib/wod-engines/templates/amrap-engine";

export type AmrapBundle = {
  ctx: AmrapContext;
  startedAtMs: number | null;
  endedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  finishedAbsMs: Record<string, number>; // fin de course (heure reelle) pour chaque equipe : ouvre l'auto-evaluation
};

// Contexte pur du moteur AMRAP a partir de Postgres : equipes + membres, tours (table Lap) en ms ecoulees (pauses
// deduites), reglages de la seance. Requetes groupees : la page greffier est re-rendue a chaque rafraichissement.
export async function buildAmrapBundle(sessionId: string): Promise<AmrapBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");
  const rawTeams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  const teamIds = rawTeams.map((t) => t.id);
  const [members, rs] = await Promise.all([
    teamIds.length ? db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : Promise.resolve([]),
    db.orm.public.RaceState.where({ sessionId }).first(),
  ]);
  const users = members.length ? await db.orm.public.User.where((u) => u.id.in([...new Set(members.map((m) => m.userId))])).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs?.endedAt ? toMs(rs.endedAt) : session.raceEndedAt ? toMs(session.raceEndedAt) : null;
  const [pausesRaw, lapsRaw] = rs
    ? await Promise.all([db.orm.public.RacePause.where({ raceStateId: rs.id }).all(), db.orm.public.Lap.where({ raceStateId: rs.id }).orderBy((l) => l.at.asc()).all()])
    : [[], []];
  const pauses = pausesRaw.map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const teams: AmrapTeam[] = rawTeams.map((t) => ({
    id: t.id,
    order: t.order ?? 0,
    name: t.name,
    members: members
      .filter((m) => m.teamId === t.id)
      .flatMap((m) => {
        const u = userById.get(m.userId);
        if (!u) return [];
        const n = memberNames(u);
        return [{ userId: u.id, name: `${n.firstName} ${n.lastName}`.trim() || u.name }];
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  }));
  const laps = lapsRaw.map((l) => ({ id: l.id, teamId: l.teamId, at: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0, abs: toMs(l.at) }));
  const finishedAbsMs: Record<string, number> = {};
  if (endedAtMs !== null) for (const t of teams) finishedAbsMs[t.id] = endedAtMs;
  return { ctx: { settings: readAmrapSettings(session.settings), teams, laps }, startedAtMs, endedAtMs, pauses, finishedAbsMs };
}

// Fin du temps (Sartay : « le plus de tours possible en 20 minutes ») : a cet instant de course (pauses deduites), plus
// aucun tour n'est accepte et la course se termine toute seule, datee de l'instant exact de la fin.
export type AmrapCap = { started: boolean; ended: boolean; paused: boolean; elapsedMs: number; capMs: number; reached: boolean; capAtMs: number | null };
export async function amrapCapState(sessionId: string): Promise<AmrapCap | null> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "AMRAP") return null;
  const capMs = amrapCapMs(readAmrapSettings(session.settings));
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt) return { started: false, ended: false, paused: false, elapsedMs: 0, capMs, reached: false, capAtMs: null };
  const pauses = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const now = Date.now();
  const elapsedMs = elapsed(toMs(rs.startedAt), pauses, rs.endedAt ? toMs(rs.endedAt) : now) ?? 0;
  const reached = elapsedMs >= capMs;
  return { started: true, ended: !!rs.endedAt || !!session.raceEndedAt, paused: pauses.some((p) => p.to === null), elapsedMs, capMs, reached, capAtMs: reached && !rs.endedAt ? now - (elapsedMs - capMs) : null };
}
