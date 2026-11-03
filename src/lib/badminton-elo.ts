// Classement ELO du badminton (Sartay 03/11). Module PUR (importable cote client). Regles :
// - tout le monde part a 1000 (« c'est okay ») ;
// - un match compte s'il a un score et n'est ni conteste, ni annule, ni encore en direct : signe ou pas (« un match non
//   conteste compte, pas la peine qu'il soit signe ») ; un match LIBRE (hors cours) seulement une fois officiel : atteste
//   par 2 autres eleves, ou valide par un prof (isOfficial, src/lib/badminton.ts) ;
// - formule ELO classique : score attendu = 1 / (1 + 10^((Rb − Ra) / 400)) ; victoire 1, egalite 0,5, defaite 0 ;
// - K = 40 sur les 10 premiers matchs d'un eleve (son classement se place vite), puis 20 (plus stable) ;
// - ecart au score : ×1 pour un match serre, jusqu'a ×1,5 a 16 points d'ecart ou plus (un 21-5) ;
// - « provisoire » tant qu'un eleve a moins de 5 matchs ;
// - recalcule a chaque affichage dans l'ordre des matchs : rien n'est stocke, une correction ou une contestation se
//   repercute toute seule ;
// - un seul classement pour toutes les classes (inter-classes) ; l'eleve le voit dans l'onglet « Classement » de son
//   espace (pas sur chaque match), d'abord son groupe de cours.
import { swapSets, type BmResult, type BmSet } from "@/lib/badminton";

export const ELO_START = 1000;
export const ELO_PROVISIONAL_GAMES = 5;
const K_NEW = 40;
const K_SETTLED = 20;
const K_NEW_GAMES = 10;
const MARGIN_FULL = 16;

export type EloGame = { matchId: string; at: number; a: string; b: string; sets: BmSet[]; result: BmResult };
export type EloStep = { matchId: string; at: number; opponentId: string; outcome: "W" | "D" | "L"; sets: BmSet[]; before: number; after: number };
export type EloEntry = { id: string; rating: number; games: number; won: number; draws: number; lost: number; provisional: boolean; steps: EloStep[] };

export function marginFactor(r: BmResult): number {
  if (r.winner === "DRAW") return 1;
  return 1 + Math.min(MARGIN_FULL, Math.abs(r.points[0] - r.points[1])) / (2 * MARGIN_FULL);
}

export function computeElo(games: EloGame[]): Map<string, EloEntry> {
  const out = new Map<string, EloEntry>();
  const get = (id: string) => {
    let e = out.get(id);
    if (!e) out.set(id, (e = { id, rating: ELO_START, games: 0, won: 0, draws: 0, lost: 0, provisional: true, steps: [] }));
    return e;
  };
  for (const g of [...games].sort((x, y) => x.at - y.at)) {
    if (g.a === g.b) continue;
    const A = get(g.a);
    const B = get(g.b);
    const expectA = 1 / (1 + 10 ** ((B.rating - A.rating) / 400));
    const scoreA = g.result.winner === "A" ? 1 : g.result.winner === "DRAW" ? 0.5 : 0;
    const m = marginFactor(g.result);
    const kA = A.games < K_NEW_GAMES ? K_NEW : K_SETTLED;
    const kB = B.games < K_NEW_GAMES ? K_NEW : K_SETTLED;
    const afterA = A.rating + kA * m * (scoreA - expectA);
    const afterB = B.rating + kB * m * (1 - scoreA - (1 - expectA));
    const outA = scoreA === 1 ? "W" : scoreA === 0 ? "L" : "D";
    const outB = scoreA === 1 ? "L" : scoreA === 0 ? "W" : "D";
    A.steps.push({ matchId: g.matchId, at: g.at, opponentId: g.b, outcome: outA, sets: g.sets, before: A.rating, after: afterA });
    B.steps.push({ matchId: g.matchId, at: g.at, opponentId: g.a, outcome: outB, sets: swapSets(g.sets), before: B.rating, after: afterB });
    for (const [p, o, r] of [[A, outA, afterA], [B, outB, afterB]] as const) {
      p.rating = r;
      p.games++;
      if (o === "W") p.won++;
      else if (o === "L") p.lost++;
      else p.draws++;
      p.provisional = p.games < ELO_PROVISIONAL_GAMES;
    }
  }
  return out;
}

// Classement : ELO decroissant, puis le plus de matchs.
export const rankElo = <T extends { rating: number; games: number }>(list: T[]): T[] => [...list].sort((a, b) => b.rating - a.rating || b.games - a.games);
export const fmtElo = (r: number) => String(Math.round(r));
export const fmtDelta = (before: number, after: number) => { const d = Math.round(after - before); return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0"; };
