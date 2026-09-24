import { db } from "@/lib/db";
import { readFrozenFromSettings } from "@/lib/level";
import { memberNames } from "@/lib/staff-names";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { activeCards, progressOf, type Tick } from "@/lib/wod-engines/templates/level-engine";

// Demineur des arbitres (WOD Level), version « deux listes » (Sartay, 24/09 soir) :
//   1. l'arbitre choisit un eleve qui joue, puis un exercice (liste alphabetique limitee aux niveaux en cours
//      des equipes et au suivant), 2. il encode reps observees + qualite, 3. il tire sur une case d'une grille
//      classique (les cases ne sont plus liees a un eleve ni a un exercice), 4. resultat 3 s, retour au menu.
// Grille telephone : 8 colonnes x 12 lignes = 96 cases, 14 bombes (~15 %, entre debutant 12 % et
// intermediaire 16 % du jeu d'origine). Un zero ouvre ses voisins en cascade, comme dans le vrai jeu.
// Meme disposition pour tous les arbitres (une des 4 cartes de la seance), chacun revele ses propres cases.
// Quand un arbitre a trouve les 14 bombes, une nouvelle carte (manche suivante) s'ouvre pour lui ; les cases
// sont rangees par manche dans MineReveal.row (row = manche x 100 + ligne). Score = bombes trouvees.

export const MINE_ROWS = 12;
export const MINE_COLS = 8;
export const MINE_COUNT = 14;
export const MINE_LAYOUTS = 4;
export const ROUND_STRIDE = 100;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Disposition des bombes d'une manche : deterministe (seance + carte tiree au sort parmi 4 + manche).
export function layoutForRound(sessionId: string, round: number): boolean[][] {
  const pick = hash32(`${sessionId}#pick`) % MINE_LAYOUTS;
  const rnd = mulberry32(hash32(`${sessionId}#${pick}#round${round}`));
  const all: [number, number][] = [];
  for (let r = 0; r < MINE_ROWS; r++) for (let c = 0; c < MINE_COLS; c++) all.push([r, c]);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const mines = Array.from({ length: MINE_ROWS }, () => Array<boolean>(MINE_COLS).fill(false));
  for (const [r, c] of all.slice(0, MINE_COUNT)) mines[r][c] = true;
  return mines;
}

export function numbersOf(mines: boolean[][]): number[][] {
  const R = mines.length;
  const C = R ? mines[0].length : 0;
  return mines.map((row, r) =>
    row.map((_, c) => {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < R && cc >= 0 && cc < C && mines[rr][cc]) n++;
      }
      return n;
    })
  );
}

// Cases ouvertes en cascade a partir d'un zero (la case de depart comprise), sans jamais ouvrir une bombe.
export function floodFrom(mines: boolean[][], numbers: number[][], r0: number, c0: number, already: Set<string>): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>(already);
  const stack: [number, number][] = [[r0, c0]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    const k = `${r}_${c}`;
    if (seen.has(k) || mines[r][c]) continue;
    seen.add(k);
    out.push([r, c]);
    if (numbers[r][c] !== 0) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < MINE_ROWS && cc >= 0 && cc < MINE_COLS) stack.push([rr, cc]);
    }
  }
  return out;
}

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

type Reveal = { refereeId: string; row: number; col: number; evaluationId: string | null };

// Manche en cours d'un arbitre = la premiere manche dont il n'a pas encore trouve toutes les bombes.
export function roundsOf(sessionId: string, reveals: Reveal[]): { round: number; found: number; foundInRound: number; revealed: number } {
  let round = 0;
  let found = 0;
  let foundInRound = 0;
  for (;;) {
    const mines = layoutForRound(sessionId, round);
    const mine = reveals.filter((x) => Math.floor(x.row / ROUND_STRIDE) === round);
    const f = mine.filter((x) => mines[x.row % ROUND_STRIDE]?.[x.col]).length;
    found += f;
    if (f < MINE_COUNT) {
      foundInRound = f;
      break;
    }
    round++;
    if (round > 50) break; // garde-fou
  }
  return { round, found, foundInRound, revealed: reveals.length };
}

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
  for (const t of teams) {
    const p = progressOf(levels, t.id, ticks);
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
