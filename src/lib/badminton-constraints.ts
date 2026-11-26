// CONTRAINTES d'un match de badminton (Sartay 26/11 soir) : le prof coche, pour la lecon, des contraintes qui s'ajoutent
// aux matchs a theme (src/lib/badminton-themes.ts) :
// - ⚖️ HANDICAP (« le handicap doit etre un match a theme comme le coef ; je voudrais pouvoir mettre des handicaps meme
//   dans mes grands tableaux ou mes matchs par equipes ») : le moins bien classe commence chaque set avec des points
//   d'avance, selon l'ecart d'ELO (meme calcul que le championnat a handicap). L'ELO compte ce match comme entre egaux
//   (esperance ½) ; au tournoi par equipes, les points d'avance ne comptent pas et le coefficient d'ecart d'ELO vaut 1.
// - 🎯 MISE DE CERTITUDE (« chaque joueur peut encoder son coefficient de certitude de victoire, de 0 a 5 ; plus le coef
//   est risque, plus les points ELO sont augmentes ; 0 = ×0,8 · 1 = ×0,9 · 2 = ×1 · 3 = ×1,2 · 4 = ×1,5 · 5 = ×1,7 ») :
//   le multiplicateur s'applique aux points ELO GAGNES ET PERDUS (« mise a 5 rapporte beaucoup OU fait perdre
//   beaucoup ») ; il est un nouveau plafond, pas un plafond en plus. Il ne touche pas les points rapportes a l'equipe.
//   La mise est SECRETE jusqu'a ce que le match existe (l'arbitre le lance, ou le score est encode) ; l'arbitre peut alors
//   l'annoncer avant le premier point. Avant le match, elle est gardee dans les reglages de la seance (`settings.bets`,
//   liste ou l'on ajoute seulement) ; a la creation du match, la derniere mise de chaque joueur contre cet adversaire est
//   recopiee dans le match (ligne BET du journal) ; une mise posee apres ne compte plus.
// Module PUR.
import type { BmMatch, BmSet } from "@/lib/badminton";

export const BET_MULT = [0.8, 0.9, 1, 1.2, 1.5, 1.7] as const;
export const BET_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export const BET_TEXT = ["Pas sûr du tout", "Peu sûr", "Normal", "Plutôt sûr", "Très sûr", "Certain de gagner"] as const;
export type BmBets = [number | null, number | null]; // mise de A, mise de B (null = pas de mise : ×1)
export const readBet = (v: unknown): number | null => (Number.isInteger(Number(v)) && v !== null && v !== "" && Number(v) >= 0 && Number(v) <= 5 ? Number(v) : null);
export const betMult = (c: number | null | undefined): number => (c === null || c === undefined ? 1 : BET_MULT[c] ?? 1);
export const multText = (c: number) => `×${String(BET_MULT[c]).replace(".", ",")}`;

// ===== Reglages de la lecon (settings.handicap, settings.bet) =====
export type SessionConstraints = { handicap: { eloPerPoint: number } | null; bet: boolean };
export function readSessionConstraints(settings: unknown): SessionConstraints {
  const o = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const h = o.handicap && typeof o.handicap === "object" ? (o.handicap as Record<string, unknown>) : null;
  const epp = h ? Number(h.eloPerPoint) : NaN;
  return { handicap: h && h.on === true ? { eloPerPoint: Number.isInteger(epp) && epp >= 5 && epp <= 100 ? epp : 20 } : null, bet: o.bet === true };
}

// Points d'avance au debut de chaque set : [pour A, pour B], le moins bien classe seulement (au plus la moitie du set).
// points = objectif du set (15 par defaut ; au temps, 15 sert de reference).
export function headStartOf(eloA: number, eloB: number, eloPerPoint: number, points: number): BmSet {
  const p = points > 0 ? points : 15;
  const pts = Math.min(Math.floor(p / 2), Math.round((Math.abs(eloA - eloB) / eloPerPoint) * (p / 15)));
  return eloA >= eloB ? [0, pts] : [pts, 0];
}

// ===== Mises posees avant le match (settings.bets) =====
export type PendingBet = { pair: string; by: string; c: number; at: number };
export const betPair = (a: string, b: string) => [a, b].sort().join("|");
export function readPendingBets(settings: unknown): PendingBet[] {
  const raw = (settings && typeof settings === "object" ? (settings as Record<string, unknown>).bets : null) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    const c = o ? readBet(o.c) : null;
    return o && typeof o.pair === "string" && typeof o.by === "string" && c !== null && Number(o.at) > 0 ? [{ pair: o.pair, by: o.by, c, at: Number(o.at) }] : [];
  });
}
// Ma mise en cours contre un adversaire : la derniere posee apres `since` (creation du dernier match entre nous).
export function myPendingBet(list: PendingBet[], me: string, opp: string, since: number): number | null {
  const mine = list.filter((x) => x.pair === betPair(me, opp) && x.by === me && x.at > since).sort((x, y) => y.at - x.at)[0];
  return mine ? mine.c : null;
}
// Les mises d'un match au moment ou il est cree : [de A, de B].
export function betsAtCreation(list: PendingBet[], a: string, b: string, since: number): BmBets {
  return [myPendingBet(list, a, b, since), myPendingBet(list, b, a, since)];
}

// ===== Lu sur un match (lignes HANDICAP et BET du journal) =====
export function handicapOfMatch(m: Pick<BmMatch, "events">): BmSet | null {
  const e = m.events.find((x) => x.kind === "HANDICAP");
  const h = e?.data && typeof e.data === "object" ? ((e.data as { head?: unknown }).head as unknown) : null;
  return Array.isArray(h) && h.length === 2 && h.every((n) => Number.isInteger(n) && n >= 0 && n <= 30) ? [h[0], h[1]] : null;
}
export function betsOfMatch(m: Pick<BmMatch, "events">): BmBets | null {
  const e = m.events.find((x) => x.kind === "BET");
  const d = e?.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : null;
  if (!d) return null;
  const out: BmBets = [readBet(d.a), readBet(d.b)];
  return out[0] === null && out[1] === null ? null : out;
}

// « Ce que je risque » pour chaque mise, sur un match serre (sans l'ecart au score) : [si je gagne, si je perds].
// k = mon K (40 sur mes 10 premiers matchs, puis 20) ; expect = mes chances selon l'ELO (½ avec handicap) ; weight = ½ si
// match a theme.
export function betTable(k: number, expect: number, weight = 1): { c: number; win: number; lose: number }[] {
  return BET_LEVELS.map((c) => ({ c, win: Math.round(k * weight * (1 - expect) * betMult(c)), lose: Math.round(k * weight * expect * betMult(c)) }));
}
