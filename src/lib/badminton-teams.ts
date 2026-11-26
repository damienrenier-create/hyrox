// Tournoi de badminton PAR EQUIPES, « tournoi des coachs » (Sartay 24/11). Module PUR (importable cote client).
//
// « Les meilleurs ELO sont nommes capitaine / coach en fonction du nombre d'equipes ; les equipes sont remplies de
// maniere a ce que 1. elles comportent le meme nombre de joueurs, 2. le total ELO entre les equipes soit le plus proche
// possible. L'appli designe les matchs : les tetes de serie de chaque equipe s'affrontent et ainsi de suite ; si les
// equipes n'ont pas le meme nombre de joueurs, l'app designe le joueur le plus proche en ELO. Le but de chaque coach est
// de remporter le plus de points possible avec son equipe ; chaque joueur (coach compris) joue au moins un match et
// rapporte des points a son equipe : les points ELO gagnes pendant le match ; une defaite ne rapporte rien (ni n'enleve). »
//
// - EQUIPES : les `count` meilleurs ELO sont les coachs (un par equipe). Les autres joueurs sont repartis pour que les
//   equipes aient le meme nombre de joueurs (a un pres) et la meme moyenne d'ELO (= le meme total quand elles ont le meme
//   nombre de joueurs) : du plus fort au plus faible, chacun va dans l'equipe la plus faible qui a encore de la place,
//   puis des echanges de joueurs (jamais les coachs) tant qu'ils rapprochent les equipes. Le prof peut tout changer avant
//   le lancement (glisser-deposer, coach a la main).
// - RENCONTRE entre deux equipes : les joueurs de chaque equipe sont ranges par ELO (au lancement) ; le 1er affronte le
//   1er, le 2e le 2e… (vague 1). Equipe plus nombreuse : chaque joueur « en trop » affronte le joueur de l'autre equipe le
//   plus proche de lui en ELO, qui joue donc deux fois (vague 2, apres la vague 1 : au temps, un 2e coup de sifflet).
// - POINTS rapportes par un match : ce que le gagnant gagne a l'ELO (meme formule que le classement : K 40 sur ses 10
//   premiers matchs puis 20, ecart au score ×1 a ×1,5, ELO du moment dans le tournoi) ; le perdant ne rapporte rien.
//   Egalite (matchs au temps) : reglage `draw` — HALF : chacun rapporte la moitie de ce qu'une victoire lui aurait
//   rapporte (le moins bien classe un peu plus) ; ELO : ce que l'ELO donne vraiment (le moins bien classe gagne un peu,
//   l'autre rien). Arrondi au point par match.
//   (Remarque : avec ces regles, un match equilibre rapporte en moyenne autant aux deux equipes ; ce qui fait gagner une
//   equipe, c'est que ses joueurs fassent mieux que ce que leur ELO annonce.)
// - Rencontre gagnee : l'equipe qui a le plus de points, puis le plus de matchs gagnes ; sinon egalite (championnat) ou,
//   au tableau, la plus grande difference de points joues, puis l'equipe la moins bien classee (moyenne d'ELO).
// - FORMATS : championnat (LEAGUE, chacune contre chacune, eventuellement en poules d'equipes ; classement aux points,
//   puis rencontres gagnees, puis matchs gagnes) ou tableau (BRACKET, 1/8, 1/4, 1/2, finale ; les perdants jouent les
//   places suivantes, chacun joue tous les tours).
// - RETARDATAIRE : il rejoint l'equipe qui a le moins de joueurs presents et joue a partir de la prochaine rencontre de
//   son equipe pas encore commencee. JOUEUR PARTI : il sort des rencontres pas encore commencees ; dans une rencontre
//   commencee, ses matchs pas encore joues ne rapportent rien (« parti »). Une rencontre commence a son 1er match encode,
//   ou au 1er coup de sifflet de sa ronde (au temps).
import { isOfficial, matchState, themeOf, type BmMatch, type BmSet } from "@/lib/badminton";
import { THEME_ELO_WEIGHT } from "@/lib/badminton-themes";
import { K_NEW_GAMES, expectedScore, kFactor, marginFactor } from "@/lib/badminton-elo";
import { POOL_NAMES, bracketSize, pairingOf, readTeamSettings, roundRobin, seedOrder, type PairingStatus, type TeamSettings, type TeamSub, type TeamTimer, type TourEntrant, type TourPlayer, type TourSettings } from "@/lib/badminton-tournament";

const byElo = (a: TourEntrant, b: TourEntrant) => b.elo - a.elo || a.id.localeCompare(b.id);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// ===== Composition des equipes =====
// Ecart entre les equipes : variance des moyennes d'ELO (meme chose que les totaux quand les tailles sont egales).
function spread(teams: TourEntrant[][]): number {
  const avgs = teams.filter((t) => t.length).map((t) => mean(t.map((e) => e.elo)));
  const m = mean(avgs);
  return avgs.reduce((s, a) => s + (a - m) ** 2, 0);
}
export function makeTeams(entrants: TourEntrant[], count: number): string[][] {
  const sorted = [...entrants].sort(byElo);
  const n = sorted.length;
  if (!n) return [];
  const k = Math.max(1, Math.min(count, n));
  const base = Math.floor(n / k);
  const extra = n % k; // nombre d'equipes qui auront un joueur de plus
  const teams: TourEntrant[][] = sorted.slice(0, k).map((e) => [e]); // les coachs
  const total = (t: TourEntrant[]) => t.reduce((s, e) => s + e.elo, 0);
  let big = 0;
  for (const e of sorted.slice(k)) {
    let best = -1;
    for (let i = 0; i < k; i++) {
      const len = teams[i].length;
      if (!(len < base || (len === base && big < extra))) continue;
      if (best < 0 || total(teams[i]) < total(teams[best]) || (total(teams[i]) === total(teams[best]) && len < teams[best].length)) best = i;
    }
    if (teams[best].length === base) big++;
    teams[best].push(e);
  }
  // Echanges (jamais le coach, en tete de chaque equipe) et deplacements entre une equipe a n+1 et une a n, tant que ca
  // rapproche les equipes.
  for (let pass = 0; pass < 200; pass++) {
    let cur = spread(teams);
    let move: (() => void) | null = null;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      if (i === j) continue;
      for (let p = 1; p < teams[i].length; p++) {
        if (i < j) for (let q = 1; q < teams[j].length; q++) {
          const ti = teams[i].map((e, x) => (x === p ? teams[j][q] : e));
          const tj = teams[j].map((e, x) => (x === q ? teams[i][p] : e));
          const c = spread(teams.map((t, x) => (x === i ? ti : x === j ? tj : t)));
          if (c < cur - 1e-9) { cur = c; move = () => { teams[i] = ti; teams[j] = tj; }; }
        }
        if (teams[i].length === teams[j].length + 1) {
          const ti = teams[i].filter((_, x) => x !== p);
          const tj = [...teams[j], teams[i][p]];
          const c = spread(teams.map((t, x) => (x === i ? ti : x === j ? tj : t)));
          if (c < cur - 1e-9) { cur = c; move = () => { teams[i] = ti; teams[j] = tj; }; }
        }
      }
    }
    if (!move) break;
    move();
  }
  return teams.map((t) => [t[0], ...t.slice(1).sort(byElo)].map((e) => e.id));
}
// Equipes modifiees a la main, puis participants coches ou decoches : un decoche quitte son equipe ; un nouveau coche
// rejoint l'equipe qui a le moins de joueurs (puis le plus petit total d'ELO).
export function reconcileTeams(groups: string[][], chosen: TourEntrant[]): string[][] {
  const ids = new Set(chosen.map((c) => c.id));
  const elo = new Map(chosen.map((c) => [c.id, c.elo]));
  const out = groups.map((t) => t.filter((id) => ids.has(id)));
  const placed = new Set(out.flat());
  if (!out.length) out.push([]);
  for (const c of [...chosen].sort(byElo)) {
    if (placed.has(c.id)) continue;
    const tot = (t: string[]) => t.reduce((s, id) => s + (elo.get(id) ?? 0), 0);
    let best = 0;
    out.forEach((t, i) => { if (t.length < out[best].length || (t.length === out[best].length && tot(t) < tot(out[best]))) best = i; });
    out[best] = [...out[best], c.id];
    placed.add(c.id);
  }
  return out;
}
// Equipes faites ou modifiees a la main : chaque equipe a au moins un joueur, personne deux fois, exactement les coches.
export function checkTeams(groups: string[][], ids: string[]): string | null {
  const g = groups.filter((t) => t.length);
  if (g.length < 2) return "Il faut au moins 2 équipes.";
  if (g.length > POOL_NAMES.length) return `${POOL_NAMES.length} équipes au maximum.`;
  const seen = new Set<string>();
  for (const t of g) for (const id of t) {
    if (seen.has(id)) return "Un joueur est dans deux équipes.";
    seen.add(id);
  }
  const want = new Set(ids);
  if (seen.size !== want.size || [...want].some((id) => !seen.has(id))) return "Les équipes ne correspondent pas aux participants cochés : rechargez la page.";
  return null;
}
// Joueurs du tournoi : equipe = lettre (colonne `pool`), tete de serie = rang d'ELO dans l'equipe.
export function teamPlayers(groups: string[][], eloOf: (id: string) => number): TourPlayer[] {
  return groups
    .filter((t) => t.length)
    .flatMap((t, i) => t.map((id) => ({ id, elo: eloOf(id) })).sort(byElo).map((e, s) => ({ studentId: e.id, pool: POOL_NAMES[i], seed: s + 1, elo: Math.round(e.elo) })));
}
// Coach d'une equipe : celui choisi par le prof s'il est dans l'equipe, sinon sa tete de serie.
export function coachOf(ts: TeamSettings, letter: string, members: TourPlayer[]): string {
  const c = ts.coaches[letter];
  if (c && members.some((p) => p.studentId === c)) return c;
  return [...members].sort((a, b) => b.elo - a.elo || a.seed - b.seed)[0]?.studentId ?? "";
}

// ===== Points rapportes par chaque match =====
export type MatchPts = { a: string; b: string; pa: number; pb: number };
// Tous les matchs officiels du tournoi, dans l'ordre : ELO du moment (ELO au lancement + matchs du tournoi), K selon le
// nombre de matchs de chacun au lancement.
export function teamMatchPoints(players: TourPlayer[], matches: BmMatch[], s: TourSettings): Map<string, MatchPts> {
  const ids = new Set(players.map((p) => p.studentId));
  const rating = new Map(players.map((p) => [p.studentId, p.elo]));
  const games = new Map(players.map((p) => [p.studentId, s.launchGames[p.studentId] ?? K_NEW_GAMES]));
  const draw = s.team?.draw ?? "HALF";
  const out = new Map<string, MatchPts>();
  for (const m of [...matches].sort((x, y) => x.createdAt - y.createdAt)) {
    const a = m.playerAId, b = m.playerBId;
    if (!ids.has(a) || !ids.has(b) || a === b) continue;
    const st = matchState(m);
    if (!isOfficial(m, st) || !st.result) continue;
    const ra = rating.get(a)!, rb = rating.get(b)!;
    const ea = expectedScore(ra, rb), eb = 1 - ea;
    const themed = !!themeOf(m); // match a theme (24/11) : moitie de poids, sans l'ecart au score
    const ka = kFactor(games.get(a)!) * (themed ? THEME_ELO_WEIGHT : 1), kb = kFactor(games.get(b)!) * (themed ? THEME_ELO_WEIGHT : 1);
    const mg = themed ? 1 : marginFactor(st.result);
    const sa = st.result.winner === "A" ? 1 : st.result.winner === "DRAW" ? 0.5 : 0;
    let pa = 0, pb = 0;
    if (sa === 1) pa = ka * mg * (1 - ea);
    else if (sa === 0) pb = kb * mg * (1 - eb);
    else if (draw === "HALF") { pa = (ka * (1 - ea)) / 2; pb = (kb * (1 - eb)) / 2; }
    else { pa = Math.max(0, ka * (0.5 - ea)); pb = Math.max(0, kb * (0.5 - eb)); }
    out.set(m.id, { a, b, pa: Math.round(pa), pb: Math.round(pb) });
    rating.set(a, ra + ka * mg * (sa - ea));
    rating.set(b, rb + kb * mg * (1 - sa - eb));
    games.set(a, games.get(a)! + 1);
    games.set(b, games.get(b)! + 1);
  }
  return out;
}

// ===== Ce que se joue dans MON prochain match (Sartay 26/11 : « expliquer aux eleves, au bas de leur horaire, la maniere
// dont sont calcules les points rapportes a l'equipe, pour comprendre ce qui se joue, ce qu'ils doivent faire ou le score
// a atteindre pour sauver l'equipe ») : avec l'ELO du moment dans le tournoi et le vrai K de chacun (meme calcul que
// teamMatchPoints). win = ce que je rapporte si je gagne [score serre, 16 points d'ecart ou plus] ; lose = ce que mon
// adversaire rapporte a son equipe s'il gagne ; draw = au temps, ce que chacun rapporte sur une egalite.
export type TeamStakes = { win: [number, number]; lose: [number, number]; draw: [number, number] | null; chance: number; base: number; themed: boolean };
export function teamStakes(players: TourPlayer[], matches: BmMatch[], s: TourSettings, me: string, opp: string, themed: boolean): TeamStakes {
  const rating = new Map(players.map((p) => [p.studentId, p.elo]));
  const games = new Map(players.map((p) => [p.studentId, s.launchGames[p.studentId] ?? K_NEW_GAMES]));
  for (const m of [...matches].sort((x, y) => x.createdAt - y.createdAt)) {
    const a = m.playerAId, b = m.playerBId;
    if (!rating.has(a) || !rating.has(b) || a === b) continue;
    const st = matchState(m);
    if (!isOfficial(m, st) || !st.result) continue;
    const ra = rating.get(a)!, rb = rating.get(b)!, ea = expectedScore(ra, rb);
    const th = !!themeOf(m);
    const ka = kFactor(games.get(a)!) * (th ? THEME_ELO_WEIGHT : 1), kb = kFactor(games.get(b)!) * (th ? THEME_ELO_WEIGHT : 1);
    const mg = th ? 1 : marginFactor(st.result);
    const sa = st.result.winner === "A" ? 1 : st.result.winner === "DRAW" ? 0.5 : 0;
    rating.set(a, ra + ka * mg * (sa - ea));
    rating.set(b, rb + kb * mg * (1 - sa - (1 - ea)));
    games.set(a, games.get(a)! + 1);
    games.set(b, games.get(b)! + 1);
  }
  const em = expectedScore(rating.get(me) ?? 1000, rating.get(opp) ?? 1000);
  const w = themed ? THEME_ELO_WEIGHT : 1;
  const km = kFactor(games.get(me) ?? K_NEW_GAMES) * w, ko = kFactor(games.get(opp) ?? K_NEW_GAMES) * w;
  const top = themed ? 1 : 1.5; // ecart au score : x1 (serre) a x1,5 (16 points d'ecart ou plus) ; theme : sans ecart
  const base = km * (1 - em);
  const draw = s.team?.mode === "TIME" ? ((s.team?.draw ?? "HALF") === "HALF" ? [Math.round(base / 2), Math.round((ko * em) / 2)] as [number, number] : [Math.round(Math.max(0, km * (0.5 - em))), Math.round(Math.max(0, ko * (em - 0.5)))] as [number, number]) : null;
  return { win: [Math.round(base), Math.round(base * top)], lose: [Math.round(ko * em), Math.round(ko * em * top)], draw, chance: em, base, themed };
}
// Ecart minimal au score pour rapporter au moins `need` points (null : impossible, meme a 16 points d'ecart).
export function marginFor(st: TeamStakes, need: number): number | null {
  if (need <= Math.round(st.base)) return 0;
  if (st.themed) return null;
  for (let m = 1; m <= 16; m++) if (Math.round(st.base * (1 + m / 32)) >= need) return m;
  return null;
}

// ===== Rencontres =====
// a = joueur de l'equipe x, b = joueur de l'equipe y ; pts = [points rapportes par a, par b].
export type TeamPairing = { a: string; b: string; wave: 1 | 2; status: PairingStatus; matchId: string | null; sets: BmSet[] | null; winner: "A" | "B" | "DRAW" | null; pts: [number, number] };
export type RencontreStatus = "todo" | "live" | "done" | "bye" | "wait";
export type Rencontre = { key: string; round: number; x: string | null | undefined; y: string | null | undefined; stage: string; matches: TeamPairing[]; pts: [number, number]; wins: [number, number]; status: RencontreStatus; winner: "X" | "Y" | "DRAW" | null; begun: number | null };
export type TeamRound = { n: number; label: string; rencontres: Rencontre[] };
export type TeamMember = { id: string; seed: number; elo: number; pts: number; played: number; won: number; drawn: number; lost: number; late: boolean; away: boolean };
export type TeamRow = { letter: string; coach: string; members: TeamMember[]; total: number; avg: number; pts: number; played: number; won: number; drawn: number; lost: number; matchesWon: number; group: number; rank: number | null; lo: number; hi: number };
export type TeamsState = { format: TeamSettings["format"]; teams: TeamRow[]; rounds: TeamRound[]; groups: number; done: boolean; next: { round: number; wave: 1 | 2; matches: number } | null };

const awayAt = (iv: [number, number | null][], t: number) => iv.some(([f, to]) => f <= t && (to === null || to > t));
const awayNow = (iv: [number, number | null][]) => iv.some(([, to]) => to === null);
const settled = (p: TeamPairing) => p.status === "played" || p.status === "gone";
const sortByElo = (xs: TourPlayer[]) => [...xs].sort((a, b) => b.elo - a.elo || a.seed - b.seed || a.studentId.localeCompare(b.studentId));

// Les matchs d'une rencontre (voir en tete) : 1er contre 1er… puis chaque joueur en trop contre le plus proche en ELO.
export function pairUp(xs: TourPlayer[], ys: TourPlayer[]): { a: string; b: string; wave: 1 | 2 }[] {
  const sx = sortByElo(xs), sy = sortByElo(ys);
  const n = Math.min(sx.length, sy.length);
  const out: { a: string; b: string; wave: 1 | 2 }[] = [];
  for (let i = 0; i < n; i++) out.push({ a: sx[i].studentId, b: sy[i].studentId, wave: 1 });
  if (!n) return out;
  const xBig = sx.length > sy.length;
  const big = xBig ? sx : sy, small = xBig ? sy : sx;
  const uses = new Map(small.map((p) => [p.studentId, 1]));
  for (const e of big.slice(n)) {
    const pick = [...small].sort((p, q) => uses.get(p.studentId)! - uses.get(q.studentId)! || Math.abs(p.elo - e.elo) - Math.abs(q.elo - e.elo) || q.elo - p.elo)[0];
    uses.set(pick.studentId, uses.get(pick.studentId)! + 1);
    out.push(xBig ? { a: e.studentId, b: pick.studentId, wave: 2 } : { a: pick.studentId, b: e.studentId, wave: 2 });
  }
  return out;
}

const STAGES: Record<number, string> = { 2: "Finale", 4: "1/2 finale", 8: "1/4 de finale", 16: "1/8 de finale", 32: "1/16 de finale" };
const stageOf = (lo: number, size: number) => (lo === 1 ? STAGES[size] ?? `Places 1 à ${size}` : size === 2 ? `Match pour la ${lo}e place` : `Places ${lo} à ${lo + size - 1}`);

export function teamsOf(players: TourPlayer[], matches: BmMatch[], s: TourSettings): TeamsState {
  const ts = s.team ?? readTeamSettings(null);
  const letters = [...new Set(players.map((p) => p.pool))].sort();
  const members = (l: string) => players.filter((p) => p.pool === l);
  // Parti sans date (settings.gone seul) : absent maintenant, sans toucher aux rencontres commencees.
  const ivOf = (id: string, p?: TourPlayer) => { const iv = ts.away[id] ?? []; return iv.length || !p?.gone ? iv : ([[Number.MAX_SAFE_INTEGER, null]] as [number, number | null][]); };
  const isAwayNow = (id: string) => awayNow(ivOf(id, players.find((p) => p.studentId === id)));
  // Les joueurs d'une equipe pour une rencontre commencee a `t` (null : pas encore commencee = ceux qui sont la).
  const membersAt = (l: string, t: number | null) => members(l).filter((p) => {
    const iv = ivOf(p.studentId, p);
    if (t === null) return !awayNow(iv);
    const late = ts.lateAt[p.studentId];
    return !(late && late > t) && !awayAt(iv, t);
  });
  const initial = (l: string) => members(l).filter((p) => !ts.lateAt[p.studentId]);
  const avg0 = (l: string) => mean(initial(l).map((p) => p.elo));
  // Remplacants (26/11) : a partir de sa ronde, le remplacant prend la place du joueur parti dans les rencontres de son
  // equipe (meme ELO de depart, donc meme adversaire) ; ses points vont a cette equipe.
  const subFor = (out: string, round: number): string | null => {
    const list = ts.subs.filter((x) => x.out === out && x.round <= round).sort((p, q) => p.at - q.at);
    return list.length ? list[list.length - 1].in : null;
  };
  const subsOf = (l: string, round: number, busy: Set<string>) => members(l).flatMap((p) => {
    if (!isAwayNow(p.studentId)) return [];
    const by = subFor(p.studentId, round);
    return by && !busy.has(by) ? [{ out: p, by }] : [];
  });
  const withSubs = (l: string, xs: TourPlayer[], subs: { out: TourPlayer; by: string }[]): TourPlayer[] => {
    let list = xs;
    for (const { out, by } of subs) {
      const virt = { ...out, studentId: by, pool: l, gone: false };
      list = list.some((q) => q.studentId === out.studentId) ? list.map((q) => (q.studentId === out.studentId ? virt : q)) : [...list, virt];
    }
    return list;
  };
  const pointsOf = teamMatchPoints(players, matches, s);
  const live = matches.filter((m) => matchState(m).status !== "CANCELLED");

  const rencontre = (x: string | null | undefined, y: string | null | undefined, round: number, stage: string, needWinner: boolean): Rencontre => {
    const key = `${round}:${x ?? "?"}-${y ?? "?"}`;
    if (x === undefined || y === undefined) return { key, round, x, y, stage, matches: [], pts: [0, 0], wins: [0, 0], status: "wait", winner: null, begun: null };
    if (x === null || y === null) return { key, round, x, y, stage, matches: [], pts: [0, 0], wins: [0, 0], status: "bye", winner: x === null ? (y === null ? null : "Y") : "X", begun: null };
    const busy = new Set([...members(x), ...members(y)].map((p) => p.studentId)); // un remplacant n'est jamais de ces deux equipes
    const sx = subsOf(x, round, busy), sy = subsOf(y, round, busy);
    const xi = new Set([...members(x).map((p) => p.studentId), ...sx.map((z) => z.by)]), yi = new Set([...members(y).map((p) => p.studentId), ...sy.map((z) => z.by)]);
    const times = live.filter((m) => (xi.has(m.playerAId) && yi.has(m.playerBId)) || (yi.has(m.playerAId) && xi.has(m.playerBId))).map((m) => m.createdAt);
    const start = ts.roundStarts[String(round)];
    if (start) times.push(start);
    const begun = times.length ? Math.min(...times) : null;
    const xs = withSubs(x, membersAt(x, begun), sx), ys = withSubs(y, membersAt(y, begun), sy);
    const list: TeamPairing[] = pairUp(xs, ys).map(({ a, b, wave }) => {
      const raw = pairingOf(a, b, matches);
      const status: PairingStatus = (isAwayNow(a) || isAwayNow(b)) && (raw.status === "todo" || raw.status === "disputed") ? "gone" : raw.status;
      const pp = raw.status === "played" && raw.matchId ? pointsOf.get(raw.matchId) : undefined;
      const pts: [number, number] = pp ? (pp.a === a ? [pp.pa, pp.pb] : [pp.pb, pp.pa]) : [0, 0];
      return { a, b, wave, status, matchId: raw.matchId, sets: raw.sets, winner: status === "played" ? raw.winner : null, pts };
    });
    const pts: [number, number] = [list.reduce((t, p) => t + p.pts[0], 0), list.reduce((t, p) => t + p.pts[1], 0)];
    const wins: [number, number] = [list.filter((p) => p.winner === "A").length, list.filter((p) => p.winner === "B").length];
    // Une equipe sans joueur present : forfait, l'autre gagne.
    if (!list.length) return { key, round, x, y, stage, matches: [], pts, wins, status: "done", winner: xs.length ? "X" : ys.length ? "Y" : needWinner ? "X" : "DRAW", begun };
    const status: RencontreStatus = list.every(settled) ? "done" : list.some((p) => p.status === "live") ? "live" : "todo";
    let winner: Rencontre["winner"] = null;
    if (status === "done") {
      winner = pts[0] !== pts[1] ? (pts[0] > pts[1] ? "X" : "Y") : wins[0] !== wins[1] ? (wins[0] > wins[1] ? "X" : "Y") : "DRAW";
      if (winner === "DRAW" && needWinner) {
        const diff = list.reduce((t, p) => t + (p.sets ?? []).reduce((u, [i, j]) => u + i - j, 0), 0);
        winner = diff ? (diff > 0 ? "X" : "Y") : avg0(x) !== avg0(y) ? (avg0(x) < avg0(y) ? "X" : "Y") : x < y ? "X" : "Y";
      }
    }
    return { key, round, x, y, stage, matches: list, pts, wins, status, winner, begun };
  };

  const rounds: TeamRound[] = [];
  const places = new Map<string, { lo: number; hi: number }>();
  const groupOf = new Map<string, number>();
  let groups = 1;
  if (ts.format === "BRACKET") {
    // Tableau : tetes de serie = moyenne d'ELO au lancement ; les places vides (exempts) vont aux meilleures.
    const seeds = [...letters].sort((p, q) => avg0(q) - avg0(p) || p.localeCompare(q));
    const size = bracketSize(Math.max(2, seeds.length));
    type Slot = string | null | undefined;
    let blocks: { lo: number; slots: Slot[] }[] = [{ lo: 1, slots: seedOrder(size).map((n) => seeds[n - 1] ?? null) }];
    for (let n = 1; size >> n >= 1; n++) {
      const next: { lo: number; slots: Slot[] }[] = [];
      const list: Rencontre[] = [];
      for (const g of blocks) {
        const L = g.slots.length;
        for (const sl of g.slots) if (sl) places.set(sl, { lo: g.lo, hi: g.lo + L - 1 });
        const win: Slot[] = [], lose: Slot[] = [];
        for (let i = 0; i < L; i += 2) {
          const r = rencontre(g.slots[i], g.slots[i + 1], n, stageOf(g.lo, L), true);
          if (r.status !== "bye" || r.x || r.y) list.push(r);
          const decided = (r.status === "done" || r.status === "bye") && r.winner;
          win.push(decided ? (r.winner === "X" ? r.x : r.y) : r.status === "bye" ? null : undefined);
          lose.push(decided ? (r.status === "bye" ? null : r.winner === "X" ? r.y : r.x) : r.status === "bye" ? null : undefined);
        }
        next.push({ lo: g.lo, slots: win }, { lo: g.lo + L / 2, slots: lose });
      }
      rounds.push({ n, label: `Tour ${n}`, rencontres: list });
      blocks = next;
      if (blocks.every((g) => g.slots.length <= 1)) break;
    }
    for (const g of blocks) if (g.slots[0]) places.set(g.slots[0], { lo: g.lo, hi: g.lo });
  } else {
    // Championnat : chacune contre chacune, dans `groups` poules d'equipes (equipe 1 → poule 1, 2 → 2…).
    groups = Math.max(1, Math.min(ts.groups, Math.floor(letters.length / 2)));
    letters.forEach((l, i) => groupOf.set(l, i % groups));
    const per = Array.from({ length: groups }, (_, g) => roundRobin(letters.filter((l) => groupOf.get(l) === g)));
    const count = Math.max(0, ...per.map((r) => r.length));
    for (let n = 1; n <= count; n++) {
      const list = per.flatMap((r, g) => (r[n - 1] ?? []).map(([x, y]) => rencontre(x, y, n, groups > 1 ? `Poule ${g + 1}` : "", false)));
      rounds.push({ n, label: `Ronde ${n}`, rencontres: list });
    }
  }

  // Equipes : points, rencontres, joueurs.
  const all = rounds.flatMap((r) => r.rencontres);
  const teams: TeamRow[] = letters.map((l) => {
    const ms = members(l);
    const here = ms.filter((p) => !isAwayNow(p.studentId));
    const mine = all.filter((r) => (r.x === l || r.y === l) && r.status !== "bye" && r.status !== "wait");
    const side = (r: Rencontre) => (r.x === l ? 0 : 1);
    const done = mine.filter((r) => r.status === "done");
    const memberRows: TeamMember[] = sortByElo(ms).map((p) => {
      const mm = mine.flatMap((r) => r.matches.filter((x) => (side(r) === 0 ? x.a : x.b) === p.studentId).map((x) => ({ x, me: side(r) })));
      const played = mm.filter(({ x }) => x.status === "played");
      return {
        id: p.studentId, seed: p.seed, elo: p.elo,
        pts: mm.reduce((t, { x, me }) => t + x.pts[me], 0),
        played: played.length,
        won: played.filter(({ x, me }) => x.winner === (me === 0 ? "A" : "B")).length,
        drawn: played.filter(({ x }) => x.winner === "DRAW").length,
        lost: played.filter(({ x, me }) => x.winner === (me === 0 ? "B" : "A")).length,
        late: !!ts.lateAt[p.studentId], away: isAwayNow(p.studentId),
      };
    });
    const pl = places.get(l) ?? { lo: 1, hi: letters.length };
    return {
      // Coach parti : le meilleur ELO encore present prend la couronne (le coach choisi la reprend s'il revient).
      letter: l, coach: coachOf(ts, l, here.length ? here : ms), members: memberRows,
      total: here.reduce((t, p) => t + p.elo, 0), avg: Math.round(mean(here.map((p) => p.elo))),
      pts: mine.reduce((t, r) => t + r.pts[side(r)], 0),
      played: done.length,
      won: done.filter((r) => r.winner === (side(r) === 0 ? "X" : "Y")).length,
      drawn: done.filter((r) => r.winner === "DRAW").length,
      lost: done.filter((r) => r.winner === (side(r) === 0 ? "Y" : "X")).length,
      matchesWon: mine.reduce((t, r) => t + r.wins[side(r)], 0),
      group: groupOf.get(l) ?? 0, rank: null, lo: pl.lo, hi: pl.hi,
    };
  });
  const done = all.every((r) => r.status === "done" || r.status === "bye");
  if (ts.format === "BRACKET") {
    const order = [...teams].sort((p, q) => p.lo - q.lo || avg0(q.letter) - avg0(p.letter));
    order.forEach((t, i) => (t.rank = done ? i + 1 : t.lo === t.hi ? t.lo : null));
  } else {
    for (let g = 0; g < groups; g++) {
      const list = teams.filter((t) => t.group === g).sort((p, q) => q.pts - p.pts || q.won + q.drawn / 2 - (p.won + p.drawn / 2) || q.matchesWon - p.matchesWon || p.letter.localeCompare(q.letter));
      list.forEach((t, i) => (t.rank = i + 1));
    }
  }
  // Prochain coup de sifflet (au temps) : la 1re ronde pas finie, sa vague 1 puis sa vague 2.
  let next: TeamsState["next"] = null;
  for (const r of rounds) {
    const open = r.rencontres.filter((x) => x.status === "todo" || x.status === "live");
    if (!open.length) { if (r.rencontres.some((x) => x.status === "wait")) break; continue; }
    const pend = (w: 1 | 2) => open.flatMap((x) => x.matches).filter((p) => p.wave === w && !settled(p)).length;
    next = pend(1) ? { round: r.n, wave: 1, matches: pend(1) } : { round: r.n, wave: 2, matches: pend(2) };
    break;
  }
  return { format: ts.format, teams, rounds, groups, done, next };
}

// Le match a-b est-il un match d'une rencontre, encore a jouer ?
export function pendingTeamPairing(st: TeamsState, a: string, b: string): boolean {
  return st.rounds.some((r) => r.rencontres.some((x) => x.matches.some((p) => ((p.a === a && p.b === b) || (p.a === b && p.b === a)) && (p.status === "todo" || p.status === "disputed"))));
}

// Ce que voit un joueur : son equipe, son prochain match (ou le match en cours), la rencontre et la ronde.
export type TeamMine = { team: TeamRow; round: TeamRound | null; rencontre: Rencontre | null; pairing: TeamPairing | null; side: 0 | 1; waiting: boolean; resting: boolean; finished: boolean; sub?: boolean };
export function teamMineOf(st: TeamsState, studentId: string): TeamMine | null {
  const team = st.teams.find((t) => t.members.some((m) => m.id === studentId));
  if (!team) return null;
  // Remplacant (26/11) : un match a jouer pour une AUTRE equipe passe d'abord (il a deja joue le sien dans cette ronde).
  for (const r of st.rounds) for (const x of r.rencontres) {
    if (x.x === team.letter || x.y === team.letter || (x.status !== "todo" && x.status !== "live")) continue;
    const p = x.matches.find((m) => (m.a === studentId || m.b === studentId) && !settled(m));
    if (!p) continue;
    const side: 0 | 1 = p.a === studentId ? 0 : 1;
    const host = st.teams.find((t) => t.letter === (side === 0 ? x.x : x.y));
    if (host) return { team: host, round: r, rencontre: x, pairing: p, side, waiting: false, resting: false, finished: false, sub: true };
  }
  for (const r of st.rounds) for (const x of r.rencontres) {
    if (x.x !== team.letter && x.y !== team.letter) continue;
    const side: 0 | 1 = x.x === team.letter ? 0 : 1;
    if (x.status === "wait") return { team, round: r, rencontre: x, pairing: null, side, waiting: true, resting: false, finished: false };
    // Equipe au repos pendant une ronde qui se joue encore : on le dit (pas le match de la ronde suivante, dont
    // l'adversaire joue peut-etre en ce moment).
    if (x.status === "bye") {
      if (r.rencontres.some((y) => y.status === "todo" || y.status === "live")) return { team, round: r, rencontre: x, pairing: null, side, waiting: false, resting: true, finished: false };
      continue;
    }
    const p = x.matches.find((m) => (side === 0 ? m.a : m.b) === studentId && !settled(m));
    if (p) return { team, round: r, rencontre: x, pairing: p, side, waiting: false, resting: false, finished: false };
  }
  // Plus rien a jouer : son equipe joue encore (ou se repose) dans la ronde en cours, ou tout est fini.
  const cur = st.next ? st.rounds.find((r) => r.n === st.next!.round) ?? null : null;
  const here = cur?.rencontres.find((x) => x.x === team.letter || x.y === team.letter) ?? null;
  return { team, round: cur, rencontre: here, pairing: null, side: here?.y === team.letter ? 1 : 0, waiting: false, resting: !!cur && (!here || here.status === "bye"), finished: !st.next };
}

// Chrono en cours (au temps) : fin prevue, s'il tourne.
export const runningTimer = (ts: TeamSettings | null | undefined, now = Date.now()): TeamTimer | null => (ts?.timer && !ts.timer.stoppedAt && ts.timer.endsAt > now - 10 * 60_000 ? ts.timer : null);
export const teamFormatText = (s: TourSettings, teams: number) => {
  const ts = s.team ?? readTeamSettings(null);
  const fmt = ts.format === "BRACKET" ? "tableau" : ts.groups > 1 && teams >= 4 ? `championnat en ${Math.min(ts.groups, Math.floor(teams / 2))} poules` : "championnat";
  const play = ts.mode === "TIME" ? `matchs de ${ts.minutes} min au chrono` : `${s.sets === 1 ? "1 set" : s.sets === 2 ? "2 sets" : "2 sets gagnants"} de ${s.points} points${s.deuce ? ", 2 points d'écart" : ""}`;
  return `${teams} équipes · ${fmt} · ${play}`;
};

// ===== Remplacant d'un joueur parti (Sartay 26/11 : « un joueur d'une autre poule, du meme niveau, peut-il le remplacer ?
// il faut quelqu'un qui n'est pas dans la meme partie du tableau, et qui a deja joue son match, pour ne pas l'attendre ») =====
// round : la ronde a partir de laquelle il remplace (la 1re ronde de l'equipe pas encore finie) ; candidats : ni de cette
// equipe ni de son adversaire, present, dans une autre partie du tableau (places possibles qui ne se croisent pas) ou une
// autre poule d'equipes, pas deja remplacant ; ceux qui ont deja joue leur match de la ronde d'abord, puis l'ELO le plus proche.
export type SubCandidate = { id: string; team: string; elo: number; played: boolean };
export function subCandidates(st: TeamsState, players: TourPlayer[], subs: TeamSub[], out: string): { round: number | null; current: string | null; list: SubCandidate[] } {
  const me = players.find((p) => p.studentId === out);
  if (!me) return { round: null, current: null, list: [] };
  const l = me.pool;
  const host = st.teams.find((t) => t.letter === l);
  let round: number | null = null, opp: string | null | undefined = null;
  for (const r of st.rounds) {
    const x = r.rencontres.find((y) => (y.x === l || y.y === l) && y.status !== "done" && y.status !== "bye");
    if (x) { round = r.n; opp = x.x === l ? x.y : x.x; break; }
  }
  const mine = [...subs].filter((x) => x.out === out).sort((p, q) => p.at - q.at);
  const current = mine.length ? mine[mine.length - 1].in : null;
  if (round === null || !host) return { round, current, list: [] };
  const taken = new Set(subs.filter((x) => x.out !== out).map((x) => x.in).filter((x): x is string => !!x));
  const rr = st.rounds.find((r) => r.n === round);
  const pendingIn = (id: string) => (rr?.rencontres ?? []).some((x) => x.matches.some((m) => (m.a === id || m.b === id) && m.status !== "played" && m.status !== "gone"));
  // Jamais quelqu'un qui a deja joue contre un joueur de l'equipe adverse : leur ancien match serait repris comme s'il etait
  // celui de la rencontre (un meme duel ne se joue qu'une fois dans le tournoi).
  const oppIds = new Set(st.teams.find((t) => t.letter === opp)?.members.map((m) => m.id) ?? []);
  const met = new Set(st.rounds.flatMap((r) => r.rencontres.flatMap((x) => x.matches.filter((m) => m.status !== "todo" && m.status !== "gone").flatMap((m) => (oppIds.has(m.a) ? [m.b] : oppIds.has(m.b) ? [m.a] : [])))));
  const list: SubCandidate[] = [];
  for (const t of st.teams) {
    if (t.letter === l || t.letter === opp) continue;
    if (st.format === "BRACKET" ? !(t.hi < host.lo || t.lo > host.hi) : st.groups > 1 && t.group === host.group) continue;
    for (const m of t.members) if (!m.away && !taken.has(m.id) && !met.has(m.id)) list.push({ id: m.id, team: t.letter, elo: m.elo, played: !pendingIn(m.id) });
  }
  list.sort((p, q) => Number(q.played) - Number(p.played) || Math.abs(p.elo - me.elo) - Math.abs(q.elo - me.elo));
  return { round, current, list };
}
