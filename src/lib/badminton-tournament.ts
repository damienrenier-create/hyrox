// Tournois de badminton (Sartay 09/11). Module PUR (importable cote client). Trois formats :
//
// POOLS — poules de niveau. « Je n'ai qu'a encoder les participants de la classe pour que l'application me genere le
// tournoi » ; « des poules par niveau dans lesquelles je peux regler le nombre de sets ; chaque joueur recoit le nom de
// son adversaire jusqu'a ce que tous les joueurs de la poule aient joue leur match, et ainsi de suite ».
// - Participants tries par ELO decroissant, coupes en poules de taille equilibree (poule A = les ELO les plus hauts) ;
//   nombre de poules = arrondi superieur (participants / taille voulue) ; taille 0 = une seule poule (toute la classe).
// - Chacun contre chacun, ronde par ronde (methode du polygone : le 1er reste fixe, les autres tournent ; nombre impair =
//   un joueur au repos a chaque ronde). Ronde 1 a 4 joueurs : 1-4, 2-3. La ronde suivante s'ouvre quand toute la poule a
//   joue la sienne.
// - Classement de poule : victoires (egalite = ½), puis difference de sets, puis difference de points, puis ELO de depart.
//
// BRACKET — grand tableau a classement integral. « Les tetes de serie (selon l'ELO) se partagent les differentes parties
// du tableau (1/32, 1/16…) ; les perdants continuent de jouer pour qu'a la fin j'aie le classement de tout le monde ».
// - Tableau de S places (puissance de 2 ≥ participants), tetes de serie placees comme dans un vrai tableau (1 contre S,
//   1 et 2 dans des moities opposees) ; les places vides (exempts) tombent sur les meilleures tetes de serie.
// - A chaque tour, dans chaque bloc de places (au depart 1 a S) : les gagnants vont jouer les places du haut du bloc, les
//   perdants celles du bas. Apres log2(S) tours, chaque joueur a sa place. Un match se joue des que ses deux joueurs sont
//   connus. Une egalite n'est pas un resultat : elle se departage (corriger le score).
//
// HANDICAP — chacun contre chacun (poules, ou toute la classe), avec handicap. « L'app definit un handicap pour
// desavantager celui qui a le meilleur ELO et rendre tous les matchs tendus ; les points obtenus tiennent compte du
// handicap. »
// - Le moins bien classe commence chaque set avec des points d'avance : 1 point par `eloPerPoint` d'ecart d'ELO (de depart)
//   pour un set de 15, proportionnellement pour 11 ou 21 ; au plus la moitie du set. Reglage par defaut : 20, d'apres
//   l'analyse de 515 matchs du 09/11 (≈ 5 points d'ecart par set pour 100 d'ELO).
// - A l'ELO, ces matchs comptent comme entre deux joueurs de meme niveau (esperance ½) : src/lib/badminton-elo.ts.
//
// Pour tous : les matchs sont des matchs ordinaires (signature, arbitre, ELO), rattaches au tournoi a la saisie quand les
// deux joueurs doivent s'y affronter. Une rencontre est « jouee » des qu'elle a un score non conteste (signe ou pas).
//
// RETARDATAIRES (10/11, « idealement il faudrait que je puisse y integrer d'eventuels retardataires ») :
// - poules / handicap : le retardataire (`late`) rejoint une poule sans changer les rondes des autres ; il joue contre
//   chacun des matchs de RATTRAPAGE, quand ses adversaires sont libres ; ils comptent au classement de la poule ;
// - grand tableau : il prend la derniere tete de serie (a la place d'un exempt), tant que le joueur qui devait profiter de
//   cet exempt n'a pas encore joue (voir lateBracketSeat).
import { matchState, swapSets, type BmMatch, type BmSet } from "@/lib/badminton";

export type TourKind = "POOLS" | "BRACKET" | "HANDICAP";
export const TOUR_KINDS: { id: TourKind; name: string }[] = [
  { id: "POOLS", name: "Poules de niveau" },
  { id: "BRACKET", name: "Grand tableau" },
  { id: "HANDICAP", name: "Championnat à handicap" },
];
// Retardataires d'un tournoi de poules (settings.late : leurs identifiants).
export const readLate = (settings: unknown): string[] => { const l = (settings as { late?: unknown } | null)?.late; return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : []; };
export const readTourKind = (v: unknown): TourKind => (v === "BRACKET" || v === "HANDICAP" ? v : "POOLS");

export type TourSettings = { sets: 1 | 2 | 3; points: number; poolSize: number; eloPerPoint: number };
export const TOUR_POOL_SIZES = [3, 4, 5, 6, 0] as const; // 0 = une seule poule (toute la classe)
export const TOUR_POINTS = [11, 15, 21] as const;
export const TOUR_ELO_PER_POINT = [10, 15, 20, 25, 30, 40, 50] as const;
export const HANDICAP_ELO_PER_POINT = 20;
export function readTourSettings(raw: unknown, kind: TourKind = "POOLS"): TourSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let sets: 1 | 2 | 3 = o.sets === 2 || o.sets === 3 ? o.sets : 1;
  if (kind === "BRACKET" && sets === 2) sets = 1; // un tableau a besoin d'un vainqueur : pas de match en 2 sets
  const points = TOUR_POINTS.includes(Number(o.points) as never) ? Number(o.points) : 15;
  const poolSize = TOUR_POOL_SIZES.includes(Number(o.poolSize) as never) ? Number(o.poolSize) : kind === "HANDICAP" ? 0 : 4;
  const eloPerPoint = TOUR_ELO_PER_POINT.includes(Number(o.eloPerPoint) as never) ? Number(o.eloPerPoint) : HANDICAP_ELO_PER_POINT;
  return { sets, points, poolSize, eloPerPoint };
}
// « 1 set de 15 points », « 2 sets de 11 points », « 2 sets gagnants (au meilleur des 3) de 21 points ».
export const formatText = (s: TourSettings) => `${s.sets === 1 ? "1 set" : s.sets === 2 ? "2 sets" : "2 sets gagnants (au meilleur des 3)"} de ${s.points} points`;

export type TourEntrant = { id: string; elo: number };
export type TourPlayer = { studentId: string; pool: string; seed: number; elo: number; late?: boolean };
const POOL_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const byElo = (a: TourEntrant, b: TourEntrant) => b.elo - a.elo || a.id.localeCompare(b.id);

export function makePools(entrants: TourEntrant[], poolSize: number): TourPlayer[] {
  const sorted = [...entrants].sort(byElo);
  const n = sorted.length;
  if (!n) return [];
  const count = poolSize <= 0 ? 1 : Math.max(1, Math.min(POOL_NAMES.length, Math.ceil(n / Math.max(2, poolSize))));
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
// Grand tableau : une seule liste, tete de serie 1 = meilleur ELO.
export const makeSeeds = (entrants: TourEntrant[]): TourPlayer[] => [...entrants].sort(byElo).map((e, i) => ({ studentId: e.id, pool: "T", seed: i + 1, elo: Math.round(e.elo) }));
export const makePlayers = (kind: TourKind, entrants: TourEntrant[], s: TourSettings): TourPlayer[] => (kind === "BRACKET" ? makeSeeds(entrants) : makePools(entrants, s.poolSize));

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

// Handicap : points d'avance au debut de chaque set, [pour a, pour b] (le moins bien classe seulement).
export function handicapOf(eloA: number, eloB: number, s: TourSettings): [number, number] {
  const gap = Math.abs(eloA - eloB);
  const pts = Math.min(Math.floor(s.points / 2), Math.round((gap / s.eloPerPoint) * (s.points / 15)));
  return eloA >= eloB ? [0, pts] : [pts, 0];
}

export type PairingStatus = "todo" | "live" | "played" | "disputed" | "bye" | "wait" | "tie";
// Une rencontre : `sets` toujours dans le sens a puis b ; `handicap` = points d'avance [a, b] (championnat a handicap).
export type TourPairing = { a: string; b: string | null; status: PairingStatus; matchId: string | null; sets: BmSet[] | null; winner: "A" | "B" | "DRAW" | null; handicap?: [number, number] };
export type TourRound = { n: number; pairings: TourPairing[] };
export type TourStanding = { id: string; rank: number; played: number; won: number; drawn: number; lost: number; score: number; setsFor: number; setsAgainst: number; pointsFor: number; pointsAgainst: number; elo: number };
export type TourPool = { name: string; players: string[]; rounds: TourRound[]; catchUp: TourPairing[]; current: number | null; done: boolean; standings: TourStanding[] };

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

export function poolsOf(players: TourPlayer[], matches: BmMatch[], handicap: TourSettings | null = null): TourPool[] {
  const names = [...new Set(players.map((p) => p.pool))].sort();
  const eloOf = new Map(players.map((p) => [p.studentId, p.elo]));
  return names.map((name) => {
    const members = players.filter((p) => p.pool === name).sort((a, b) => a.seed - b.seed);
    const ids = members.map((p) => p.studentId);
    const lateIds = members.filter((p) => p.late).map((p) => p.studentId);
    const withH = (a: string, b: string | null) => {
      const p = pairingOf(a, b, matches);
      return handicap && b ? { ...p, handicap: handicapOf(eloOf.get(a) ?? 0, eloOf.get(b) ?? 0, handicap) } : p;
    };
    // Rondes : les joueurs du depart seulement (un retardataire ne les change pas) ; puis ses matchs de rattrapage.
    const rounds = roundRobin(ids.filter((id) => !lateIds.includes(id))).map((pairs, i) => ({ n: i + 1, pairings: pairs.map(([a, b]) => withH(a, b)) }));
    const catchUp: TourPairing[] = [];
    lateIds.forEach((l, li) => { for (const o of ids) if (o !== l && !lateIds.slice(0, li).includes(o)) catchUp.push(withH(l, o)); });
    const open = rounds.find((r) => r.pairings.some((p) => p.status !== "played" && p.status !== "bye"));
    const table = new Map(members.map((p) => [p.studentId, { id: p.studentId, rank: 0, played: 0, won: 0, drawn: 0, lost: 0, score: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0, elo: p.elo }]));
    for (const p of [...rounds.flatMap((r) => r.pairings), ...catchUp]) {
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
    return { name, players: ids, rounds, catchUp, current: open?.n ?? null, done: !open && catchUp.every((p) => p.status === "played"), standings };
  });
}

// ===== Grand tableau =====
// Ordre des tetes de serie dans un tableau de `size` places : 1, size, size/2+… (1 et 2 dans des moities opposees).
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}
export const bracketSize = (n: number) => { let s = 2; while (s < n) s *= 2; return s; };

type Slot = string | null | undefined; // un joueur ; null = place vide (exempt) ; undefined = pas encore connu
export type BracketPairing = { a: Slot; b: Slot; status: PairingStatus; matchId: string | null; sets: BmSet[] | null; winner: "A" | "B" | null };
export type BracketGroup = { lo: number; hi: number; pairings: BracketPairing[] };
export type BracketRound = { n: number; groups: BracketGroup[] };
export type BracketRank = { id: string; seed: number; elo: number; lo: number; hi: number; rank: number | null; played: number; won: number };
export type Bracket = { size: number; rounds: BracketRound[]; ranks: BracketRank[]; done: boolean };

export function bracketOf(players: TourPlayer[], matches: BmMatch[]): Bracket {
  const size = bracketSize(Math.max(2, players.length));
  const bySeed = new Map(players.map((p) => [p.seed, p.studentId]));
  let groups: { lo: number; slots: Slot[] }[] = [{ lo: 1, slots: seedOrder(size).map((s) => bySeed.get(s) ?? null) }];
  const where = new Map<string, { lo: number; hi: number }>();
  const played = new Map<string, { played: number; won: number }>();
  const tally = (id: string, won: boolean) => { const t = played.get(id) ?? { played: 0, won: 0 }; t.played++; if (won) t.won++; played.set(id, t); };
  const rounds: BracketRound[] = [];
  for (let n = 1; size >> n >= 1; n++) {
    const next: { lo: number; slots: Slot[] }[] = [];
    const rg: BracketGroup[] = [];
    for (const g of groups) {
      const L = g.slots.length;
      const hi = g.lo + L - 1;
      for (const s of g.slots) if (s) where.set(s, { lo: g.lo, hi });
      const win: Slot[] = [];
      const lose: Slot[] = [];
      const pairings: BracketPairing[] = [];
      for (let i = 0; i < L; i += 2) {
        const a = g.slots[i];
        const b = g.slots[i + 1];
        if (a === undefined || b === undefined) {
          pairings.push({ a, b, status: "wait", matchId: null, sets: null, winner: null });
          win.push(undefined); lose.push(undefined);
        } else if (a === null || b === null) {
          pairings.push({ a, b, status: "bye", matchId: null, sets: null, winner: a === null ? (b === null ? null : "B") : "A" });
          win.push(a ?? b); lose.push(null);
        } else {
          const p = pairingOf(a, b, matches);
          const decided = p.status === "played" && (p.winner === "A" || p.winner === "B");
          const status: PairingStatus = p.status === "played" && !decided ? "tie" : p.status;
          pairings.push({ a, b, status, matchId: p.matchId, sets: p.sets, winner: decided ? (p.winner as "A" | "B") : null });
          if (decided) {
            win.push(p.winner === "A" ? a : b); lose.push(p.winner === "A" ? b : a);
            tally(a, p.winner === "A"); tally(b, p.winner === "B");
          } else { win.push(undefined); lose.push(undefined); }
        }
      }
      rg.push({ lo: g.lo, hi, pairings });
      next.push({ lo: g.lo, slots: win }, { lo: g.lo + L / 2, slots: lose });
    }
    rounds.push({ n, groups: rg });
    groups = next;
    if (L1(groups)) break;
  }
  for (const g of groups) if (g.slots[0]) where.set(g.slots[0], { lo: g.lo, hi: g.lo });
  const done = groups.every((g) => g.slots[0] !== undefined);
  // Classement final : les places des joueurs (sans les places vides), de 1 a N.
  const order = players.map((p) => ({ p, w: where.get(p.studentId) ?? { lo: 1, hi: size } })).sort((x, y) => x.w.lo - y.w.lo || x.p.seed - y.p.seed);
  const ranks = order.map(({ p, w }, i) => ({ id: p.studentId, seed: p.seed, elo: p.elo, lo: w.lo, hi: w.hi, rank: done ? i + 1 : null, played: played.get(p.studentId)?.played ?? 0, won: played.get(p.studentId)?.won ?? 0 }));
  return { size, rounds, ranks, done };
}
const L1 = (groups: { slots: Slot[] }[]) => groups.every((g) => g.slots.length <= 1);

// ===== Rattachement d'un match saisi, et ce qu'un joueur voit =====
// Le match a-b est-il une rencontre du tournoi encore a jouer ?
export function pendingPairing(kind: TourKind, players: TourPlayer[], matches: BmMatch[], a: string, b: string): boolean {
  if (kind === "BRACKET") {
    return bracketOf(players, matches).rounds.some((r) => r.groups.some((g) => g.pairings.some((p) => ((p.a === a && p.b === b) || (p.a === b && p.b === a)) && (p.status === "todo" || p.status === "disputed"))));
  }
  const pa = players.find((p) => p.studentId === a);
  const pb = players.find((p) => p.studentId === b);
  if (!pa || !pb || pa.pool !== pb.pool) return false;
  const st = pairingOf(a, b, matches).status;
  return st === "todo" || st === "disputed";
}

// Poules / handicap : ma poule, la ronde en cours et ma rencontre dans cette ronde ; un retardataire : son prochain match
// de rattrapage. `extra` : les matchs de rattrapage qu'un retardataire doit encore jouer contre moi.
export type TourMine = { pool: TourPool; round: TourRound | null; pairing: TourPairing | null; rank: number; of: number; late: boolean; extra: TourPairing[] };
export function mineOf(pools: TourPool[], studentId: string): TourMine | null {
  const pool = pools.find((p) => p.players.includes(studentId));
  if (!pool) return null;
  const rank = pool.standings.find((s) => s.id === studentId)?.rank ?? 0;
  const pending = (p: TourPairing) => p.status !== "played" && p.status !== "bye";
  const late = pool.catchUp.some((p) => p.a === studentId) && !pool.rounds.some((r) => r.pairings.some((p) => p.a === studentId || p.b === studentId));
  if (late) {
    const pairing = pool.catchUp.find((p) => (p.a === studentId || p.b === studentId) && pending(p)) ?? null;
    return { pool, round: null, pairing, rank, of: pool.players.length, late, extra: [] };
  }
  const round = pool.current ? pool.rounds[pool.current - 1] : null;
  const pairing = round?.pairings.find((p) => p.a === studentId || p.b === studentId) ?? null;
  const extra = pool.catchUp.filter((p) => p.b === studentId && pending(p));
  return { pool, round, pairing, rank, of: pool.players.length, late, extra };
}

// Grand tableau : un retardataire prend la tete de serie N+1 (la place d'un exempt) si le tableau a encore une place vide
// et que le joueur qu'elle affronte au 1er tour (tete de serie S+1-(N+1)) n'a encore joue aucun match du tableau.
export function lateBracketSeat(players: TourPlayer[], matches: BmMatch[]): { ok: true; seed: number } | { ok: false; reason: string } {
  const n = players.length;
  const size = bracketSize(Math.max(2, n));
  if (n + 1 > size) return { ok: false, reason: "Le tableau est complet : plus de place libre pour un retardataire." };
  const facing = players.find((p) => p.seed === size + 1 - (n + 1));
  if (facing && matches.some((m) => (m.playerAId === facing.studentId || m.playerBId === facing.studentId) && matchState(m).status !== "CANCELLED")) {
    return { ok: false, reason: "Trop tard pour le tableau : le joueur qui aurait affronté le retardataire a déjà joué." };
  }
  return { ok: true, seed: n + 1 };
}

// Poule d'un retardataire : la seule poule, ou celle dont l'ELO moyen est le plus proche du sien.
export function latePool(players: TourPlayer[], elo: number): string {
  const names = [...new Set(players.map((p) => p.pool))].sort();
  const mean = (n: string) => { const ps = players.filter((p) => p.pool === n); return ps.reduce((s, p) => s + p.elo, 0) / Math.max(1, ps.length); };
  return names.sort((x, y) => Math.abs(mean(x) - elo) - Math.abs(mean(y) - elo))[0] ?? "A";
}

// Grand tableau : mon prochain match (le premier non joue ou les deux joueurs sont connus), ou j'attends, ou j'ai fini.
export type BracketMine = { round: number; rounds: number; lo: number; hi: number; pairing: BracketPairing | null; finished: boolean; rank: number | null; of: number };
export function bracketMineOf(b: Bracket, studentId: string): BracketMine | null {
  const me = b.ranks.find((r) => r.id === studentId);
  if (!me) return null;
  for (const r of b.rounds) for (const g of r.groups) for (const p of g.pairings) {
    if (p.a !== studentId && p.b !== studentId) continue;
    if (p.status === "played" || p.status === "bye") continue;
    return { round: r.n, rounds: b.rounds.length, lo: g.lo, hi: g.hi, pairing: p, finished: false, rank: null, of: b.ranks.length };
  }
  // Pas de match en vue : soit j'ai fini, soit mon prochain adversaire n'est pas encore connu.
  const waiting = b.rounds.find((r) => r.groups.some((g) => g.pairings.some((p) => p.status === "wait" && (p.a === studentId || p.b === studentId))));
  if (waiting) {
    const g = waiting.groups.find((x) => x.pairings.some((p) => p.a === studentId || p.b === studentId))!;
    return { round: waiting.n, rounds: b.rounds.length, lo: g.lo, hi: g.hi, pairing: g.pairings.find((p) => p.a === studentId || p.b === studentId) ?? null, finished: false, rank: null, of: b.ranks.length };
  }
  return { round: b.rounds.length, rounds: b.rounds.length, lo: me.lo, hi: me.hi, pairing: null, finished: true, rank: me.rank, of: b.ranks.length };
}
