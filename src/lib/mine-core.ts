// Partie PURE du demineur (importable cote client) : dimensions, disposition des bombes, voisinage, cascade,
// manches. La partie serveur (lecture de la base) vit dans src/lib/mine.ts.
//
// Grille telephone : 8 colonnes x 12 lignes = 96 cases, 14 bombes (~15 %, entre debutant 12 % et
// intermediaire 16 % du jeu d'origine). Meme disposition pour tous les arbitres (une des 4 cartes de la
// seance), chacun revele ses propres cases. Quand un arbitre a trouve les 14 bombes, une nouvelle carte
// (manche suivante) s'ouvre pour lui ; ses cases sont rangees par manche dans MineReveal.row
// (row = manche x 100 + ligne). Score = bombes trouvees.

export const MINE_ROWS = 12;
export const MINE_COLS = 8;
export const MINE_COUNT = 14;
export const MINE_LAYOUTS = 4;
export const ROUND_STRIDE = 100;

export function hash32(s: string): number {
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

export type Reveal = { refereeId: string; row: number; col: number; evaluationId: string | null };

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
