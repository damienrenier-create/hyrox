import { db } from "@/lib/db";
import { readFrozenFromSettings } from "@/lib/level";
import { memberNames } from "@/lib/staff-names";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { activeCards, orderedLevels, progressOf, readLevelOrder, readPenalties, type Tick } from "@/lib/wod-engines/templates/level-engine";

// Demineur des arbitres (WOD Level), version « deux listes » (Sartay, 24/09 soir) :
//   1. l'arbitre choisit un eleve qui joue, puis un exercice (liste alphabetique limitee aux niveaux en cours
//      des equipes et au suivant), 2. il encode reps observees + qualite, 3. il tire sur une case d'une grille
//      classique (les cases ne sont plus liees a un eleve ni a un exercice), 4. resultat 3 s, retour au menu.
// Grille telephone : 8 colonnes x 12 lignes = 96 cases, 14 bombes (~15 %, entre debutant 12 % et
// intermediaire 16 % du jeu d'origine). Un zero ouvre ses voisins en cascade, comme dans le vrai jeu.
// Meme disposition pour tous les arbitres (une des 4 cartes de la seance), chacun revele ses propres cases.
// Quand un arbitre a trouve les 14 bombes, une nouvelle carte (manche suivante) s'ouvre pour lui ; les cases
// sont rangees par manche dans MineReveal.row (row = manche x 100 + ligne). Score = bombes trouvees.

export * from "@/lib/mine-core";
import { MINE_COLS, MINE_COUNT, MINE_ROWS, ROUND_STRIDE, layoutForRound, numbersOf, roundsOf, type Reveal } from "@/lib/mine-core";

export type MineStudent = { userId: string; name: string; teamId: string; teamName: string };
export type MineExercise = { exerciseId: string; label: string; suggested: boolean };
export type MineCell = null | { mine: boolean; n: number };
export type MineLeader = { refereeId: string; name: string; found: number; revealed: number };
export type MineRecent = { id: string; teamName: string; exerciseLabel: string; reps: number; note: number; atMs: number };
export type MineView = {
  students: MineStudent[];
  exercises: MineExercise[];
  lastTeamId: string | null; // equipe de ma derniere evaluation : exclue tant qu'il y a d'autres equipes
  teamsCount: number;
  round: number;
  cells: MineCell[][]; // ma grille de la manche en cours
  foundInRound: number;
  found: number; // toutes manches confondues
  revealed: number;
  leaderboard: MineLeader[];
  recent: MineRecent[];
};



export async function mineViewFor(sessionId: string, refereeId: string): Promise<MineView | null> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return null;
  const levels = readFrozenFromSettings(session.settings);
  if (!levels.length) return null;

  const teams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const students: MineStudent[] = [];
  for (const t of teams) {
    students.push(
      ...members
        .filter((m) => m.teamId === t.id)
        .map((m) => userById.get(m.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => { const n = memberNames(u); return { userId: u.id, name: `${n.firstName} ${n.lastName.charAt(0)}.`.trim(), teamId: t.id, teamName: t.name }; })
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    );
  }

  // Exercices : ceux des niveaux en cours des equipes et du niveau suivant sont « suggeres » ; les autres de
  // l'echelle restent accessibles derriere « tous ».
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const pauses = rs ? (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })) : [];
  const ticks: Tick[] = (await db.orm.public.LevelTick.where({ sessionId }).all()).map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
  const shown = new Set<number>();
  const order = readLevelOrder(session.settings);
  const penalties = readPenalties(session.settings);
  for (const t of teams) {
    const p = progressOf(orderedLevels(levels, order?.[t.id]), t.id, ticks, [], penalties);
    if (p.currentLevel !== null) { shown.add(p.currentLevel); shown.add(p.currentLevel + 1); }
  }
  if (!shown.size) { shown.add(1); shown.add(2); }
  const suggestedIds = new Set<string>();
  const all = new Map<string, string>();
  for (const l of levels) for (const { card } of activeCards(l)) {
    all.set(card.exerciseId, card.label);
    if (shown.has(l.number)) suggestedIds.add(card.exerciseId);
  }
  const exercises: MineExercise[] = [...all.entries()].map(([exerciseId, label]) => ({ exerciseId, label, suggested: suggestedIds.has(exerciseId) })).sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const reveals = await db.orm.public.MineReveal.where({ sessionId }).all();
  const mine = reveals.filter((r) => r.refereeId === refereeId);
  const { round, found, foundInRound, revealed } = roundsOf(sessionId, mine);
  const mines = layoutForRound(sessionId, round);
  const numbers = numbersOf(mines);
  const cells: MineCell[][] = Array.from({ length: MINE_ROWS }, () => Array<MineCell>(MINE_COLS).fill(null));
  for (const r of mine) {
    if (Math.floor(r.row / ROUND_STRIDE) !== round) continue;
    const rr = r.row % ROUND_STRIDE;
    if (rr < MINE_ROWS && r.col < MINE_COLS) cells[rr][r.col] = { mine: mines[rr][r.col], n: numbers[rr][r.col] };
  }

  // Classement : bombes trouvees, toutes manches confondues.
  const byRef = new Map<string, Reveal[]>();
  for (const r of reveals) byRef.set(r.refereeId, [...(byRef.get(r.refereeId) ?? []), r]);
  const refIds = [...byRef.keys()];
  const refUsers = refIds.length ? await db.orm.public.User.where((u) => u.id.in(refIds)).all() : [];
  const nameOf = new Map(refUsers.map((u) => [u.id, memberNames(u).firstName || u.name]));
  const leaderboard: MineLeader[] = refIds
    .map((id) => { const s = roundsOf(sessionId, byRef.get(id)!); return { refereeId: id, name: nameOf.get(id) ?? "?", found: s.found, revealed: s.revealed }; })
    .sort((a, b) => b.found - a.found || a.revealed - b.revealed || a.name.localeCompare(b.name));

  // Mes evaluations (via les cases tirees) : derniere equipe arbitree + 5 dernieres, corrigeables.
  const evalIds = mine.filter((r) => r.evaluationId).map((r) => r.evaluationId as string);
  const evals = evalIds.length ? await db.orm.public.Evaluation.where((e) => e.id.in(evalIds)).all() : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const studentName = new Map(students.map((s) => [s.userId, s.name]));
  const sorted = evals.map((e) => ({ e, at: toMs(e.createdAt) })).sort((a, b) => b.at - a.at);
  const lastTeamId = sorted[0]?.e.teamId ?? null;
  const recent: MineRecent[] = sorted.slice(0, 5).map(({ e, at }) => ({
    id: e.id,
    teamName: `${e.targetUserId ? studentName.get(e.targetUserId) ?? "?" : "?"} · ${teamName.get(e.teamId) ?? "?"}`,
    exerciseLabel: all.get(e.exerciseId) ?? e.exerciseId,
    reps: e.repsObserved,
    note: e.note,
    atMs: at,
  }));

  return { students, exercises, lastTeamId, teamsCount: teams.length, round, cells, foundInRound, found, revealed, leaderboard, recent };
}
