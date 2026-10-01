import { db } from "@/lib/db";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { toMs } from "@/lib/scheduling";
import { memberNames } from "@/lib/staff-names";
import { CINDY_KEY, readHXSettings, teamState, type HXContext, type HXTeam } from "@/lib/wod-engines/templates/hyrox-engine";

export type HXBundle = {
  ctx: HXContext;
  startedAtMs: number | null;
  endedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  finishedAbsMs: Record<string, number>; // teamId -> heure absolue de la fin du parcours (fenetre d'auto-evaluation)
  locked: boolean; // des pointages existent : stations et runs ne se modifient plus
};

// Contexte pur du moteur Hyrox a partir de Postgres : equipes + membres (identifiants permanents), pointages et cartes
// jaunes en ms ecoulees (pauses deduites via RaceState/RacePause), reglages de la seance. Requetes groupees : la page
// greffier est re-rendue a chaque rafraichissement.
export async function buildHXBundle(sessionId: string): Promise<HXBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const rawTeams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  const teamIds = rawTeams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const users = members.length ? await db.orm.public.User.where((u) => u.id.in([...new Set(members.map((m) => m.userId))])).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const teams: HXTeam[] = rawTeams.map((t) => ({
    id: t.id,
    order: t.order ?? 0,
    name: t.name,
    startStationId: t.startExerciseId ?? null,
    members: members
      .filter((m) => m.teamId === t.id)
      .flatMap((m) => {
        const u = userById.get(m.userId);
        return u ? [{ memberId: m.id, userId: u.id, name: memberNames(u).firstName || u.name }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  }));

  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs?.endedAt ? toMs(rs.endedAt) : null;
  const [pausesRaw, cardsRaw, rawEvents] = await Promise.all([
    rs ? db.orm.public.RacePause.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    rs ? db.orm.public.YellowCard.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    db.orm.public.StationEvent.where({ sessionId }).orderBy((e) => e.at.asc()).all(),
  ]);
  const pauses = pausesRaw.map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const events = rawEvents.map((e) => ({ id: e.id, teamId: e.teamId, key: e.stationId, at: elapsed(startedAtMs, pauses, toMs(e.at)) ?? 0 }));
  const cards = cardsRaw.map((c) => ({ id: c.id, teamId: c.teamId, at: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 }));

  const ctx: HXContext = { teams, settings: readHXSettings(session.settings), events, cards };
  const finishedAbsMs: Record<string, number> = {};
  for (const t of teams) {
    const st = teamState(ctx, t);
    if (st.finishedMs === null) continue;
    const last = rawEvents.filter((e) => e.teamId === t.id && e.stationId !== CINDY_KEY)[st.segments.length - 1];
    if (last) finishedAbsMs[t.id] = toMs(last.at);
  }
  return { ctx, startedAtMs, endedAtMs, pauses, finishedAbsMs, locked: rawEvents.length > 0 };
}
