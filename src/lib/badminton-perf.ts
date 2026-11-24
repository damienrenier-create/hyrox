// Progression ELO d'un joueur de badminton, en vue de l'evaluation (Sartay 24/11 : « garder en memoire les top 10
// meilleures et pires perfs de chaque eleve, les exploits contre des ELO plus forts ou les contre-perfs contre des ELO
// moins forts, avec le suivi a la fin de l'evolution de l'ELO de l'adversaire, et garder une trace de l'evolution ELO du
// joueur afin de l'evaluer au mieux »). Module PUR (importable cote client). Rien n'est stocke : tout se relit sur le
// classement ELO, recalcule a chaque affichage a partir de tous les matchs qui comptent (une correction se repercute).
//
// - VALEUR d'une perf : (resultat − chances de gagner avant le match) × ecart au score × 20. C'est ce que le match aurait
//   rapporte a l'ELO avec un K fixe de 20 : on compare ainsi tous les matchs sur la meme echelle (le K de 40 des 10
//   premiers matchs ne gonfle pas les debuts). Gagner contre bien plus fort = grosse valeur ; perdre contre bien moins fort
//   = grosse valeur negative.
// - EXPLOIT : victoire (ou egalite) contre un joueur mieux classe d'au moins PERF_GAP au moment du match. CONTRE-PERF :
//   defaite (ou egalite) contre un joueur moins bien classe d'au moins PERF_GAP.
// - Les matchs d'un championnat a handicap (chances ramenees a 50/50 par l'avance) restent dans la courbe mais pas dans
//   les meilleures / moins bonnes perfs : l'ecart d'ELO n'y dit rien de l'exploit.
// - L'adversaire : son ELO au moment du match et son ELO d'aujourd'hui (s'il a progresse depuis, l'exploit n'en est que
//   plus beau ; s'il a chute, il etait peut-etre surclasse ce jour-la).
import { resultOf, type BmSet } from "@/lib/badminton";
import { ELO_START, expectedScore, marginFactor, type EloEntry } from "@/lib/badminton-elo";
import { THEME_ELO_WEIGHT } from "@/lib/badminton-themes";

export const PERF_TOP = 10;
// Ecart d'ELO minimal pour parler d'exploit ou de contre-perf (moins : match equilibre, ≈ 1 point par set).
export const PERF_GAP = 25;
const PERF_K = 20;
export type PerfRow = { matchId: string; at: number; opponentId: string; outcome: "W" | "D" | "L"; sets: BmSet[]; mine: number; theirs: number; gap: number; chance: number; value: number; delta: number; after: number; theirsNow: number | null; even: boolean; tag: "exploit" | "contre" | null };
export type PerfDay = { day: string; at: number; start: number; end: number; games: number; won: number; drawn: number; lost: number; exploits: number; contres: number };
export type PerfReport = { start: number; now: number; min: number; max: number; games: number; won: number; drawn: number; lost: number; exploits: number; contres: number; curve: { at: number; elo: number; matchId: string | null }[]; days: PerfDay[]; best: PerfRow[]; worst: PerfRow[]; rows: PerfRow[] };

const dayKey = (ms: number) => new Date(ms).toLocaleDateString("fr-CA", { timeZone: "Europe/Brussels" }); // AAAA-MM-JJ

// `entries` : tout le classement (pour l'ELO de l'adversaire au moment du match et aujourd'hui).
export function perfReport(me: EloEntry, entries: Map<string, EloEntry>): PerfReport {
  const rows: PerfRow[] = [];
  for (const s of me.steps) {
    const opp = entries.get(s.opponentId);
    const os = opp?.steps.find((x) => x.matchId === s.matchId);
    const theirs = os ? os.before : ELO_START;
    const chance = expectedScore(s.before, theirs);
    const score = s.outcome === "W" ? 1 : s.outcome === "D" ? 0.5 : 0;
    // Match a theme (24/11) : moitie de poids, sans l'ecart au score, comme a l'ELO.
    const value = Math.round((score - chance) * (s.themed ? THEME_ELO_WEIGHT : marginFactor(resultOf(s.sets))) * PERF_K);
    const gap = Math.round(theirs - s.before);
    const tag = s.even ? null : s.outcome !== "L" && gap >= PERF_GAP ? "exploit" : s.outcome !== "W" && gap <= -PERF_GAP ? "contre" : null;
    rows.push({ matchId: s.matchId, at: s.at, opponentId: s.opponentId, outcome: s.outcome, sets: s.sets, mine: Math.round(s.before), theirs: Math.round(theirs), gap, chance, value, delta: Math.round(s.after - s.before), after: Math.round(s.after), theirsNow: opp ? Math.round(opp.rating) : null, even: !!s.even, tag });
  }
  const ranked = rows.filter((r) => !r.even);
  const best = ranked.filter((r) => r.value > 0).sort((a, b) => b.value - a.value || b.gap - a.gap || b.at - a.at).slice(0, PERF_TOP);
  const worst = ranked.filter((r) => r.value < 0).sort((a, b) => a.value - b.value || a.gap - b.gap || b.at - a.at).slice(0, PERF_TOP);
  const start = me.steps.length ? Math.round(me.steps[0].before) : Math.round(me.rating);
  const curve = [{ at: me.steps[0]?.at ?? 0, elo: start, matchId: null as string | null }, ...rows.map((r) => ({ at: r.at, elo: r.after, matchId: r.matchId }))];
  const days: PerfDay[] = [];
  for (const r of rows) {
    const k = dayKey(r.at);
    let d = days.find((x) => x.day === k);
    if (!d) { d = { day: k, at: r.at, start: r.mine, end: r.after, games: 0, won: 0, drawn: 0, lost: 0, exploits: 0, contres: 0 }; days.push(d); }
    d.end = r.after;
    d.games++;
    if (r.outcome === "W") d.won++; else if (r.outcome === "D") d.drawn++; else d.lost++;
    if (r.tag === "exploit") d.exploits++; else if (r.tag === "contre") d.contres++;
  }
  const elos = curve.map((c) => c.elo);
  return {
    start, now: Math.round(me.rating), min: Math.min(...elos), max: Math.max(...elos),
    games: me.games, won: me.won, drawn: me.draws, lost: me.lost,
    exploits: rows.filter((r) => r.tag === "exploit").length, contres: rows.filter((r) => r.tag === "contre").length,
    curve, days, best, worst, rows,
  };
}
