import { db } from "@/lib/db";
import { readFrozenFromSettings } from "@/lib/level";
import { memberNames } from "@/lib/staff-names";
import { toMs } from "@/lib/scheduling";

// Demineur des arbitres (WOD Level). Une carte par seance : lignes = eleves des equipes, colonnes = exercices
// de l'echelle figee, mines tirees au sort (une des 4 cartes possibles de la seance). Tous les arbitres
// cherchent les memes mines, chacun avec ses propres cases revelees ; chaque case revelee est une evaluation
// individuelle (reps observees + qualite) encodee juste avant le « feu ».

export const MINE_DENSITY = 0.14; // « comme dans le vrai jeu, niveau moyen-facile » (debutant 12 %, intermediaire 16 %)
export const MINE_LAYOUTS = 4;

export type MineRow = { userId: string; name: string; teamId: string; teamName: string };
export type MineCol = { exerciseId: string; label: string };
export type MineBoardData = { rows: MineRow[]; cols: MineCol[]; mines: boolean[][]; numbers: number[][]; total: number };

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

// Disposition des mines pour une graine : nombre = densite x cases (au moins une), positions tirees sans remise.
export function layoutMines(rows: number, cols: number, seed: string): [number, number][] {
  const n = Math.max(1, Math.round(rows * cols * MINE_DENSITY));
  const rnd = mulberry32(hash32(seed));
  const all: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push([r, c]);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(n, all.length));
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

function parseBoard(row: { rows: unknown; cols: unknown; mines: unknown }): MineBoardData {
  const rows = (Array.isArray(row.rows) ? row.rows : []) as MineRow[];
  const cols = (Array.isArray(row.cols) ? row.cols : []) as MineCol[];
  const list = (Array.isArray(row.mines) ? row.mines : []) as [number, number][];
  const mines = rows.map(() => cols.map(() => false));
  for (const [r, c] of list) if (mines[r] && c < cols.length) mines[r][c] = true;
  return { rows, cols, mines, numbers: numbersOf(mines), total: list.length };
}

// La carte de la seance, creee au premier passage d'un arbitre une fois l'echelle figee (les colonnes
// viennent de l'echelle de la seance, les lignes des equipes du moment). null = pas encore possible.
export async function ensureMineBoard(sessionId: string): Promise<MineBoardData | null> {
  const existing = await db.orm.public.MineBoard.where({ sessionId }).first();
  if (existing) return parseBoard(existing);

  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return null;
  const levels = readFrozenFromSettings(session.settings);
  if (!levels.length) return null;
  const cols: MineCol[] = [];
  for (const l of levels) for (const c of l.cards) if (!c.off && !cols.some((x) => x.exerciseId === c.exerciseId)) cols.push({ exerciseId: c.exerciseId, label: c.label });

  const teams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const rows: MineRow[] = [];
  for (const t of teams) {
    const names = members
      .filter((m) => m.teamId === t.id)
      .map((m) => userById.get(m.userId))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => { const n = memberNames(u); return { userId: u.id, name: `${n.firstName} ${n.lastName.charAt(0)}.`.trim(), teamId: t.id, teamName: t.name }; })
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    rows.push(...names);
  }
  if (!rows.length || !cols.length) return null;

  // « Parmi l'une des 4 cartes au hasard » : quatre dispositions possibles, une tiree au sort par seance.
  const pick = hash32(`${sessionId}#pick`) % MINE_LAYOUTS;
  const seed = `${sessionId}#${pick}`;
  const mines = layoutMines(rows.length, cols.length, seed);
  try {
    await db.orm.public.MineBoard.create({ sessionId, rows, cols, mines, seed });
  } catch {
    /* deux arbitres en meme temps : la carte de l'autre gagne */
  }
  const created = await db.orm.public.MineBoard.where({ sessionId }).first();
  return created ? parseBoard(created) : null;
}

export type MineCell = null | { mine: boolean; n: number };
export type MineLeader = { refereeId: string; name: string; found: number; revealed: number };
export type MineRecent = { id: string; teamName: string; exerciseLabel: string; reps: number; note: number; atMs: number };
export type MineView = {
  rows: MineRow[];
  cols: MineCol[];
  total: number;
  cells: MineCell[][]; // mon plateau : null = cachee
  found: number;
  revealed: number;
  leaderboard: MineLeader[];
  recent: MineRecent[];
};

export async function mineViewFor(sessionId: string, refereeId: string): Promise<MineView | null> {
  const board = await ensureMineBoard(sessionId);
  if (!board) return null;
  const reveals = await db.orm.public.MineReveal.where({ sessionId }).all();
  const cells: MineCell[][] = board.rows.map(() => board.cols.map(() => null));
  let found = 0, revealed = 0;
  for (const r of reveals) {
    if (r.refereeId !== refereeId || !board.mines[r.row] || r.col >= board.cols.length) continue;
    const mine = board.mines[r.row][r.col];
    cells[r.row][r.col] = { mine, n: board.numbers[r.row][r.col] };
    revealed++;
    if (mine) found++;
  }
  const refIds = [...new Set(reveals.map((r) => r.refereeId))];
  const users = refIds.length ? await db.orm.public.User.where((u) => u.id.in(refIds)).all() : [];
  const nameOf = new Map(users.map((u) => [u.id, memberNames(u).firstName || u.name]));
  const agg = new Map<string, MineLeader>();
  for (const r of reveals) {
    const a = agg.get(r.refereeId) ?? { refereeId: r.refereeId, name: nameOf.get(r.refereeId) ?? "?", found: 0, revealed: 0 };
    a.revealed++;
    if (board.mines[r.row]?.[r.col]) a.found++;
    agg.set(r.refereeId, a);
  }
  const leaderboard = [...agg.values()].sort((a, b) => b.found - a.found || a.revealed - b.revealed || a.name.localeCompare(b.name));

  const evalIds = reveals.filter((r) => r.refereeId === refereeId && r.evaluationId).map((r) => r.evaluationId as string);
  const evals = evalIds.length ? await db.orm.public.Evaluation.where((e) => e.id.in(evalIds)).all() : [];
  const labelOf = new Map(board.cols.map((c) => [c.exerciseId, c.label]));
  const rowOf = new Map(board.rows.map((r) => [r.userId, r]));
  const recent: MineRecent[] = evals
    .map((e) => ({ id: e.id, teamName: e.targetUserId ? rowOf.get(e.targetUserId)?.name ?? "?" : "?", exerciseLabel: labelOf.get(e.exerciseId) ?? e.exerciseId, reps: e.repsObserved, note: e.note, atMs: toMs(e.createdAt) }))
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, 5);

  return { rows: board.rows, cols: board.cols, total: board.total, cells, found, revealed, leaderboard, recent };
}
