// Tournois de badminton (Sartay 09/11). Module PUR (importable cote client). Format livre en premier : POULES DE NIVEAU.
// « Je n'ai qu'a encoder les participants de la classe pour que l'application me genere le tournoi » ; « des poules par
// niveau dans lesquelles je peux regler le nombre de sets ; chaque joueur recoit le nom de son adversaire jusqu'a ce que
// tous les joueurs de la poule aient joue leur match, et ainsi de suite ».
// - Poules : participants tries par ELO decroissant, coupes en poules de taille equilibree (poule A = les ELO les plus
//   hauts). Le nombre de poules = arrondi superieur (participants / taille voulue).
// - Chacun contre chacun, ronde par ronde (methode du polygone : le 1er reste fixe, les autres tournent ; nombre impair =
//   un joueur au repos a chaque ronde). Ronde 1 a 4 joueurs : 1-4, 2-3.
// - Un joueur ne voit que la ronde en cours de sa poule : la suivante s'ouvre quand tous les matchs de la ronde sont joues.
// - Les matchs sont des matchs ordinaires (signature, arbitre, ELO) rattaches au tournoi a la saisie. Une rencontre est
//   « jouee » des qu'elle a un score non conteste (signe ou pas, comme pour l'ELO).
// - Classement de poule : victoires (egalite = ½), puis difference de sets, puis difference de points, puis ELO de depart.
import { matchState, swapSets, type BmMatch, type BmSet } from "@/lib/badminton";

export type TourSettings = { sets: 1 | 2 | 3; points: number; poolSize: number };
export const TOUR_POOL_SIZES = [3, 4, 5, 6] as const;
export const TOUR_POINTS = [11, 15, 21] as const;
export function readTourSettings(raw: unknown): TourSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sets = o.sets === 2 || o.sets === 3 ? o.sets : 1;
  const points = TOUR_POINTS.includes(Number(o.points) as never) ? Number(o.points) : 15;
  const poolSize = TOUR_POOL_SIZES.includes(Number(o.poolSize) as never) ? Number(o.poolSize) : 4;
  return { sets, points, poolSize };
}
// « 1 set de 15 points », « 2 sets de 11 points », « 2 sets gagnants (au meilleur des 3) de 21 points ».
export const formatText = (s: TourSettings) => `${s.sets === 1 ? "1 set" : s.sets === 2 ? "2 sets" : "2 sets gagnants (au meilleur des 3)"} de ${s.points} points`;

export type TourEntrant = { id: string; elo: number };
export type TourPlayer = { studentId: string; pool: string; seed: number; elo: number };
const POOL_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function makePools(entrants: TourEntrant[], poolSize: number): TourPlayer[] {
  const sorted = [...entrants].sort((a, b) => b.elo - a.elo || a.id.localeCompare(b.id));
  const n = sorted.length;
  if (!n) return [];
  const count = Math.max(1, Math.min(POOL_NAMES.length, Math.ceil(n / Math.max(2, poolSize))));
  const base = Math.floor(n / count);
  const extra = n % count; // les premieres poules ont un joueur de plus
  const out: TourPlayer[] = [];
  let i = 0;
  for (let p = 0; p < count; p++) {
    const size = base + (p < extra ? 1 : 0);
    for (let s = 0; s < size; s++, i++) out.push({ studentId: sorted[i].id, pool: POOL_NAMES[p], seed: s + 1, elo: Math.round(sorted[i].elo) });
  }
  return out;
}

// Chacun contre chacun (methode du polygone). `null` = repos.
export function roundRobin(ids: string[]): [string, string | null][][] {
  const arr: (string | null)[] = [...ids];
  if (arr.length < 2) return [];
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds: [string, string | null][][] = [];
  let cur = arr;
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = cur[i];
      const y = cur[n - 1 - i];
      if (x === null && y === null) continue;
      pairs.push(x === null ? [y as string, null] : [x, y]);
    }
    rounds.push(pairs);
    cur = [cur[0], cur[n - 1], ...cur.slice(1, n - 1)];
  }
  return rounds;
}

export type PairingStatus = "todo" | "live" | "played" | "disputed" | "bye";
// Une rencontre de la poule : `sets` toujours dans le sens a puis b.
export type TourPairing = { a: string; b: string | null; status: PairingStatus; matchId: string | null; sets: BmSet[] | null; winner: "A" | "B" | "DRAW" | null };
export type TourRound = { n: number; pairings: TourPairing[] };
export type TourStanding = { id: string; rank: number; played: number; won: number; drawn: number; lost: number; score: number; setsFor: number; setsAgainst: number; pointsFor: number; pointsAgainst: number; elo: number };
export type TourPool = { name: string; players: string[]; rounds: TourRound[]; current: number | null; done: boolean; standings: TourStanding[] };

const samePair = (m: BmMatch, a: string, b: string) => (m.playerAId === a && m.playerBId === b) || (m.playerAId === b && m.playerBId === a);

// La rencontre a-b dans les matchs du tournoi : le dernier match non annule entre eux.
function pairingOf(a: string, b: string | null, matches: BmMatch[]): TourPairing {
  if (b === null) return { a, b, status: "bye", matchId: null, sets: null, winner: null };
  const m = [...matches].filter((x) => samePair(x, a, b) && matchState(x).status !== "CANCELLED").sort((x, y) => y.createdAt - x.createdAt)[0];
  if (!m) return { a, b, status: "todo", matchId: null, sets: null, winner: null };
  const st = matchState(m);
  const flip = m.playerAId !== a;
  const sets = st.sets ? (flip ? swapSets(st.sets) : st.sets) : null;
  const w = st.result?.winner ?? null;
  const winner = w === null || w === "DRAW" ? w : (w === "A") !== flip ? "A" : "B";
  const status: PairingStatus = st.status === "LIVE" ? "live" : st.status === "DISPUTED" ? "disputed" : st.status === "VALIDATED" || st.status === "PENDING" ? "played" : "todo";
  return { a, b, status, matchId: m.id, sets, winner: status === "played" ? winner : null };
}

export function poolsOf(players: TourPlayer[], matches: BmMatch[]): TourPool[] {
  const names = [...new Set(players.map((p) => p.pool))].sort();
  return names.map((name) => {
    const members = players.filter((p) => p.pool === name).sort((a, b) => a.seed - b.seed);
    const ids = members.map((p) => p.studentId);
    const rounds = roundRobin(ids).map((pairs, i) => ({ n: i + 1, pairings: pairs.map(([a, b]) => pairingOf(a, b, matches)) }));
    const open = rounds.find((r) => r.pairings.some((p) => p.status !== "played" && p.status !== "bye"));
    const table = new Map(members.map((p) => [p.studentId, { id: p.studentId, rank: 0, played: 0, won: 0, drawn: 0, lost: 0, score: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0, elo: p.elo }]));
    for (const r of rounds) for (const p of r.pairings) {
      if (p.status !== "played" || !p.b || !p.sets) continue;
      const A = table.get(p.a)!;
      const B = table.get(p.b)!;
      for (const [x, y] of p.sets) {
        A.pointsFor += x; A.pointsAgainst += y; B.pointsFor += y; B.pointsAgainst += x;
        if (x > y) { A.setsFor++; B.setsAgainst++; } else if (y > x) { B.setsFor++; A.setsAgainst++; }
      }
      A.played++; B.played++;
      if (p.winner === "A") { A.won++; B.lost++; A.score += 1; } else if (p.winner === "B") { B.won++; A.lost++; B.score += 1; } else { A.drawn++; B.drawn++; A.score += 0.5; B.score += 0.5; }
    }
    const standings = [...table.values()].sort((x, y) => y.score - x.score || (y.setsFor - y.setsAgainst) - (x.setsFor - x.setsAgainst) || (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) || y.elo - x.elo);
    standings.forEach((s, i) => (s.rank = i + 1));
    return { name, players: ids, rounds, current: open?.n ?? null, done: !open, standings };
  });
}

// Saisie d'un match a-b pendant le tournoi : il lui est rattache si a et b sont dans la meme poule et n'ont pas encore de
// rencontre jouee (ni en cours) entre eux.
export function pendingPairing(players: TourPlayer[], matches: BmMatch[], a: string, b: string): boolean {
  const pa = players.find((p) => p.studentId === a);
  const pb = players.find((p) => p.studentId === b);
  if (!pa || !pb || pa.pool !== pb.pool) return false;
  const st = pairingOf(a, b, matches).status;
  return st === "todo" || st === "disputed";
}

// Ce qu'un joueur voit : sa poule, la ronde en cours et sa rencontre dans cette ronde.
export type TourMine = { pool: TourPool; round: TourRound | null; pairing: TourPairing | null; rank: number; of: number };
export function mineOf(pools: TourPool[], studentId: string): TourMine | null {
  const pool = pools.find((p) => p.players.includes(studentId));
  if (!pool) return null;
  const round = pool.current ? pool.rounds[pool.current - 1] : null;
  const pairing = round?.pairings.find((p) => p.a === studentId || p.b === studentId) ?? null;
  return { pool, round, pairing, rank: pool.standings.find((s) => s.id === studentId)?.rank ?? 0, of: pool.players.length };
}
