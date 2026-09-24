import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { freezeLevels, listExercises, readFrozenFromSettings } from "@/lib/level";
import { memberNames } from "@/lib/staff-names";
import { progressOf, rankTeams, type FrozenLevel, type TeamProgress } from "@/lib/wod-engines/templates/level-engine";

// Etat complet d'une seance Level a partir de Postgres, pour l'ecran greffier, l'espace eleve et les
// classements. Module serveur sans "use server" : importe par les pages et les actions, jamais expose.

export type LevelTeam = { id: string; name: string; order: number; members: { id: string; name: string }[] };
export type LevelTickRow = { id: string; teamId: string; level: number; card: number; atMs: number; absMs: number; by: string };
export type LevelBundle = {
  levels: FrozenLevel[];
  frozen: boolean; // true = echelle figee dans la seance (course lancee) ; false = echelle vive de l'atelier
  teams: LevelTeam[];
  ticks: LevelTickRow[];
  yellowCards: { id: string; teamId: string; atMs: number }[];
  startedAtMs: number | null;
  endedAtMs: number | null;
  raceEndedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  catalog: { id: string; label: string; weight: number; active: boolean }[];
};

export async function buildLevelBundle(sessionId: string): Promise<LevelBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const frozenLevels = readFrozenFromSettings(session.settings);
  const frozen = frozenLevels.length > 0;
  const [levels, catalog, rawTeams, rs] = await Promise.all([
    frozen ? Promise.resolve(frozenLevels) : freezeLevels(),
    listExercises(),
    db.orm.public.Team.where({ sessionId }).all(),
    db.orm.public.RaceState.where({ sessionId }).first(),
  ]);

  const teamIds = rawTeams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const teams: LevelTeam[] = rawTeams
    .map((t) => ({
      id: t.id,
      name: t.name,
      order: t.order ?? 0,
      members: members
        .filter((m) => m.teamId === t.id)
        .map((m) => userById.get(m.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ id: u.id, name: memberNames(u).firstName || u.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    }))
    .sort((a, b) => a.order - b.order);

  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs?.endedAt ? toMs(rs.endedAt) : null;
  const pauses = rs ? (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })) : [];
  const [rawTicks, rawCards] = await Promise.all([
    db.orm.public.LevelTick.where({ sessionId }).orderBy((t) => t.at.asc()).all(),
    rs ? db.orm.public.YellowCard.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
  ]);
  const ticks: LevelTickRow[] = rawTicks.map((t) => {
    const abs = toMs(t.at);
    return { id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, abs) ?? 0, absMs: abs, by: t.by };
  });
  const yellowCards = rawCards.map((c) => ({ id: c.id, teamId: c.teamId, atMs: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 }));

  return {
    levels,
    frozen,
    teams,
    ticks,
    yellowCards,
    startedAtMs,
    endedAtMs,
    raceEndedAtMs: session.raceEndedAt ? toMs(session.raceEndedAt) : null,
    pauses,
    catalog: catalog.map((e) => ({ id: e.id, label: e.label, weight: e.weight, active: e.active })),
  };
}

// Progression de chaque equipe, classee. Meme calcul pour le greffier, l'espace eleve et les records.
export function levelStandings(bundle: LevelBundle): TeamProgress[] {
  return rankTeams(bundle.teams.map((t) => progressOf(bundle.levels, t.id, bundle.ticks)));
}

// Heure absolue a laquelle une equipe a boucle l'echelle (fenetre d'auto-evaluation), sinon null.
export function teamFinishedAbsMs(bundle: LevelBundle, p: TeamProgress): number | null {
  if (p.finishedMs === null) return null;
  const last = bundle.ticks.filter((t) => t.teamId === p.teamId).sort((a, b) => b.absMs - a.absMs)[0];
  return last ? last.absMs : null;
}
