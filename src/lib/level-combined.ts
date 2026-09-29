import { db } from "@/lib/db";
import { twinGroup } from "@/lib/session-twins";
import { buildLevelBundle, levelPointsOf, levelStandings, levelsForTeam, readChild } from "@/lib/level-context";
import { coinsInPlay, coinsState, rankGlobal, teamStarsOf, type Stars, type TeamProgress } from "@/lib/wod-engines/templates/level-engine";

// Classement combine des ecrans jumeaux (Sartay 29/09 nuit : « puisque le WOD est envoye, on peut faire un classement
// combine des deux ecrans ») : toutes les equipes des ecrans dont le WOD est termine (donc envoye), dans le meme
// classement commun que chaque ecran (points = niveau x etoiles, puis reps, vies, pieces, rapidite).
export type CombinedRow = {
  rank: number;
  teamId: string;
  teamName: string;
  sessionId: string;
  screen: string; // « écran 1 », « écran 2 »
  stars: Stars;
  points: number;
  levels: number;
  reps: number;
  losses: number;
};
export type CombinedStandings = { rows: CombinedRow[]; pending: string[] }; // pending = ecrans pas encore termines

export async function combinedTwinStandings(sessionId: string): Promise<CombinedStandings | null> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "LEVEL" || readChild(session.settings)) return null;
  const group = await twinGroup(session);
  if (group.length < 2) return null;
  const all = await db.orm.public.Session.where((s) => s.id.in(group.map((g) => g.id))).all();
  const screenName = (label: string | null, i: number) => /écran \d+$/.exec(label ?? "")?.[0] ?? `écran ${i + 1}`;
  const ended = group.map((g, i) => ({ g, i, row: all.find((s) => s.id === g.id) })).filter((x) => x.row?.raceEndedAt);
  const pending = group.map((g, i) => ({ g, i })).filter(({ g }) => !ended.some((e) => e.g.id === g.id)).map(({ g, i }) => screenName(g.label, i));
  if (!ended.length) return { rows: [], pending };
  const progress: TeamProgress[] = [];
  const meta = new Map<string, Omit<CombinedRow, "rank" | "levels" | "reps" | "losses"> & { coins: number }>();
  for (const { g, i } of ended) {
    const b = await buildLevelBundle(g.id);
    for (const p of levelStandings(b)) {
      const t = b.teams.find((x) => x.id === p.teamId);
      // Equipe vide qui n'a rien coche : pas au classement (une equipe qui a joue y est, meme sans eleve encode).
      if (!t || (!t.members.length && p.completedLevels === 0 && p.currentDone === 0)) continue;
      progress.push(p);
      meta.set(p.teamId, {
        teamId: p.teamId,
        teamName: t.name,
        sessionId: g.id,
        screen: screenName(g.label, i),
        stars: teamStarsOf(b.teamStars, p.teamId),
        points: levelPointsOf(b, p),
        coins: coinsState(levelsForTeam(b, p.teamId), p.teamId, b.ticks, b.losses, b.penalties, b.coinEvents, b.coinsCarry, coinsInPlay).score,
      });
    }
  }
  const ranked = rankGlobal(progress, (id) => meta.get(id)?.points ?? 0, (id) => meta.get(id)?.coins ?? 0);
  const rows = ranked.map((p, i) => {
    const m = meta.get(p.teamId)!;
    return { rank: i + 1, teamId: m.teamId, teamName: m.teamName, sessionId: m.sessionId, screen: m.screen, stars: m.stars, points: m.points, levels: p.completedLevels, reps: p.workReps, losses: p.losses };
  });
  return { rows, pending };
}
