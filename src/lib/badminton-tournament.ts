// Tournois de badminton (Sartay 09/11). Module PUR (importable cote client). Trois formats :
//
// POOLS — poules de niveau. « Je n'ai qu'a encoder les participants de la classe pour que l'application me genere le
// tournoi » ; « des poules par niveau dans lesquelles je peux regler le nombre de sets ; chaque joueur recoit le nom de
// son adversaire jusqu'a ce que tous les joueurs de la poule aient joue leur match, et ainsi de suite ».
// - Participants tries par ELO decroissant, coupes en poules de taille equilibree (poule A = les ELO les plus hauts) ;
//   nombre de poules = arrondi superieur (participants / taille voulue) ; taille 0 = une seule poule (toute la classe).
// - Chacun contre chacun, ronde par ronde (methode du polygone : le 1er reste fixe, les autres tournent ; nombre impair =
//   un joueur au repos a chaque ronde). Ronde 1 a 4 joueurs : 1-4, 2-3. PAS d'attente de fin de ronde (Sartay 10/11 :
//   « donne juste l'ordre, que tous les joueurs de la poule puissent le consulter et s'organiser » ; 2 terrains pour une
//   poule de 6) : chacun voit son prochain match (le premier pas encore joue dans l'ordre des rondes) et l'ordre de la poule.
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
import { isOfficial, matchState, swapSets, themeOf, type BmMatch, type BmSet } from "@/lib/badminton";
import { K_NEW_GAMES, computeElo, type EloGame } from "@/lib/badminton-elo";

export type TourKind = "POOLS" | "BRACKET" | "HANDICAP" | "TEAMS";
export const TOUR_KINDS: { id: TourKind; name: string }[] = [
  { id: "POOLS", name: "Poules de niveau" },
  { id: "BRACKET", name: "Grand tableau" },
  { id: "HANDICAP", name: "Championnat à handicap" },
  { id: "TEAMS", name: "Tournoi par équipes" },
];

// ===== Tournoi PAR EQUIPES (Sartay 24/11 : « les meilleurs ELO sont nommes coachs ; equipes du meme nombre de joueurs,
// total ELO le plus proche possible ; les tetes de serie de chaque equipe s'affrontent ; chaque joueur rapporte a son
// equipe les points ELO gagnes ») : reglages propres (settings.team). Les regles sont dans src/lib/badminton-teams.ts.
// format : LEAGUE = championnat entre equipes (chacune contre chacune, en `groups` poules d'equipes), BRACKET = tableau
// (1/8, 1/4, 1/2, finale ; les perdants jouent les places suivantes). mode : POINTS = au score (sets / points du
// tournoi), TIME = au temps (chrono de `minutes` lance par le prof : tous les matchs de la ronde commencent et finissent
// ensemble). draw : HALF = a egalite, chacun rapporte la moitie de ce qu'une victoire lui aurait rapporte ; ELO = ce que
// l'ELO donne vraiment (le moins bien classe gagne un peu, l'autre 0). coaches : lettre d'equipe → coach (sinon la tete
// de serie). timer : le chrono en cours (ronde, vague 1 = matchs des tetes de serie, 2 = matchs en plus quand les equipes
// n'ont pas le meme nombre de joueurs). roundStarts : 1er coup de sifflet de chaque ronde. lateAt : arrivee d'un
// retardataire ; away : absences (depart → retour, null = toujours parti). Tout en millisecondes.
export type TeamFormat = "LEAGUE" | "BRACKET";
export type TeamMode = "POINTS" | "TIME";
export type TeamDraw = "HALF" | "ELO";
export type TeamTimer = { round: number; wave: number; startedAt: number; endsAt: number; stoppedAt: number | null };
// subs (26/11, Sartay : « un joueur d'une autre poule, du meme niveau, peut-il remplacer un joueur parti ? ») : a partir de
// la ronde `round`, `in` joue a la place de `out` (parti) dans les rencontres de l'equipe de `out` ; ses points vont a cette
// equipe. La derniere entree pour un meme `out` compte (in vide = plus de remplacant). Voir teamsOf (badminton-teams.ts).
export type TeamSub = { out: string; in: string | null; round: number; at: number };
// ready (26/11, Sartay : « c'est moi qui lance, mais si tout le monde est pret alors ca lance ; quoi qu'il arrive, si je lance,
// ca lance ») : les joueurs qui ont dit « pret » pour la ronde / vague du prochain coup de sifflet (au temps).
export type TeamReady = { round: number; wave: number; ids: string[] };
export type TeamSettings = { count: number; format: TeamFormat; groups: number; mode: TeamMode; minutes: number; draw: TeamDraw; coaches: Record<string, string>; timer: TeamTimer | null; roundStarts: Record<string, number>; lateAt: Record<string, number>; away: Record<string, [number, number | null][]>; subs: TeamSub[]; ready: TeamReady | null };
export const TEAM_COUNTS = [2, 3, 4, 5, 6, 8] as const;
export const TEAM_GROUPS = [1, 2, 3, 4] as const;
export const TEAM_MINUTES = [3, 4, 5, 6, 7, 8, 10, 12, 15] as const;
const numMap = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(v && typeof v === "object" ? (v as Record<string, unknown>) : {}).filter(([, n]) => Number.isFinite(Number(n))).map(([k, n]) => [k, Number(n)]));
export function readTeamSettings(raw: unknown): TeamSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const count = Number.isInteger(Number(o.count)) && Number(o.count) >= 2 && Number(o.count) <= 26 ? Number(o.count) : 4;
  const groups = Number.isInteger(Number(o.groups)) && Number(o.groups) >= 1 && Number(o.groups) <= 8 ? Number(o.groups) : 1;
  const minutes = Number.isFinite(Number(o.minutes)) && Number(o.minutes) >= 1 && Number(o.minutes) <= 30 ? Number(o.minutes) : 6;
  const c = o.coaches && typeof o.coaches === "object" ? (o.coaches as Record<string, unknown>) : {};
  const coaches = Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const tm = o.timer && typeof o.timer === "object" ? (o.timer as Record<string, unknown>) : null;
  const timer = tm && Number(tm.round) >= 1 && Number(tm.endsAt) > 0 ? { round: Number(tm.round), wave: Number(tm.wave) === 2 ? 2 : 1, startedAt: Number(tm.startedAt) || 0, endsAt: Number(tm.endsAt), stoppedAt: Number(tm.stoppedAt) > 0 ? Number(tm.stoppedAt) : null } : null;
  const aw = o.away && typeof o.away === "object" ? (o.away as Record<string, unknown>) : {};
  const away = Object.fromEntries(Object.entries(aw).map(([k, v]) => [k, (Array.isArray(v) ? v : []).filter((x): x is unknown[] => Array.isArray(x) && Number(x[0]) > 0).map((x) => [Number(x[0]), Number(x[1]) > 0 ? Number(x[1]) : null] as [number, number | null])]).filter(([, v]) => (v as unknown[]).length));
  const subs = (Array.isArray(o.subs) ? o.subs : []).flatMap((x): TeamSub[] => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    return r && typeof r.out === "string" && Number(r.round) >= 1 ? [{ out: r.out, in: typeof r.in === "string" && r.in ? r.in : null, round: Math.round(Number(r.round)), at: Number(r.at) || 0 }] : [];
  });
  const rd = o.ready && typeof o.ready === "object" ? (o.ready as Record<string, unknown>) : null;
  const ready = rd && Number(rd.round) >= 1 ? { round: Number(rd.round), wave: Number(rd.wave) === 2 ? 2 : 1, ids: Array.isArray(rd.ids) ? [...new Set(rd.ids.filter((x): x is string => typeof x === "string"))] : [] } : null;
  return { count, format: o.format === "BRACKET" ? "BRACKET" : "LEAGUE", groups, mode: o.mode === "TIME" ? "TIME" : "POINTS", minutes, draw: o.draw === "ELO" ? "ELO" : "HALF", coaches, timer, roundStarts: numMap(o.roundStarts), lateAt: numMap(o.lateAt), away, subs, ready };
}
// Retardataires d'un tournoi de poules (settings.late : leurs identifiants).
// Joueurs partis avant la fin du tournoi (settings.gone, 12/11 : « il part seulement avant la fin du tournoi ») : leurs
// matchs pas encore joues sortent de l'ordre (statut « gone », plus personne ne les attend ; au tableau, l'adversaire
// passe), leurs matchs joues restent ; on peut les remettre s'ils reviennent.
export const readGone = (settings: unknown): string[] => { const l = (settings as { gone?: unknown } | null)?.gone; return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : []; };
export const readLate = (settings: unknown): string[] => { const l = (settings as { late?: unknown } | null)?.late; return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : []; };
export const readTourKind = (v: unknown): TourKind => (v === "BRACKET" || v === "HANDICAP" || v === "TEAMS" ? v : "POOLS");

// poolCount (12/11, « je veux pouvoir choisir le nombre de poules, en plus du nombre de joueurs dans chaque poule ») :
// s'il est donne (> 0), il l'emporte sur poolSize.
// Score final (12/11 : « par defaut, tous les matchs d'un tournoi ont le meme objectif final ; il faut pouvoir, par poule,
// changer le score final, et meme pour certains matchs ; par defaut pas de 2 points d'ecart, le premier au score gagne ;
// option 2 points d'ecart, eventuellement plafonnee ») : points = objectif par defaut ; poolPoints[poule] et
// matchPoints[paire] le remplacent ; deuce = 2 points d'ecart ; cap = plafond (0 = sans).
export type TourSettings = { sets: 1 | 2 | 3; points: number; poolSize: number; poolCount: number; eloPerPoint: number; deuce: boolean; cap: number; poolPoints: Record<string, number>; matchPoints: Record<string, number>; calibration: HandicapCalibration | null; matchHandicap: Record<string, MatchHandicap>; launchGames: Record<string, number>; poolLegs: Record<string, number>; team: TeamSettings | null };
// Avance IMPOSEE par le prof pour une rencontre (13/11 : « changer l'ecart pour des matchs en particulier ») : `id` = celui
// qui commence avec `pts` points d'avance ; pts 0 = aucune avance. Cle = pairKey.
export type MatchHandicap = { id: string; pts: number };
export const TOUR_CAPS = [13, 15, 17, 21, 25, 30] as const;
export const TOUR_POOL_SIZES = [3, 4, 5, 6, 0] as const; // 0 = une seule poule (toute la classe)
export const TOUR_POOL_COUNTS = [2, 3, 4, 5, 6, 8] as const;
export const TOUR_POINTS = [11, 13, 15, 21] as const; // 13 : Sartay 10/11
export const TOUR_ELO_PER_POINT = [10, 15, 20, 25, 30, 40, 50] as const;
export const HANDICAP_ELO_PER_POINT = 20;
export function readTourSettings(raw: unknown, kind: TourKind = "POOLS"): TourSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let sets: 1 | 2 | 3 = o.sets === 2 || o.sets === 3 ? o.sets : 1;
  if (kind === "BRACKET" && sets === 2) sets = 1; // un tableau a besoin d'un vainqueur : pas de match en 2 sets
  const team = kind === "TEAMS" ? readTeamSettings(o.team) : null;
  if (team?.mode === "TIME") sets = 1; // au temps : un seul set, le score au coup de sifflet
  const points = TOUR_POINTS.includes(Number(o.points) as never) ? Number(o.points) : 15;
  const poolSize = TOUR_POOL_SIZES.includes(Number(o.poolSize) as never) ? Number(o.poolSize) : kind === "HANDICAP" ? 0 : 4;
  // Bareme du handicap : un entier de 5 a 100 (calcule au lancement depuis le 13/11, ou choisi a la main).
  const eloPerPoint = Number.isInteger(Number(o.eloPerPoint)) && Number(o.eloPerPoint) >= 5 && Number(o.eloPerPoint) <= 100 ? Number(o.eloPerPoint) : HANDICAP_ELO_PER_POINT;
  const cal = o.calibration && typeof o.calibration === "object" ? (o.calibration as Record<string, unknown>) : null;
  const calibration = cal && Number(cal.all) > 0 ? { eloPerPoint, near: Number(cal.near) || 0, all: Number(cal.all), lo: Number(cal.lo) || 0, hi: Number(cal.hi) || 0 } : null;
  const poolCount = TOUR_POOL_COUNTS.includes(Number(o.poolCount) as never) ? Number(o.poolCount) : 0;
  const deuce = o.deuce === true;
  const cap = deuce && TOUR_CAPS.includes(Number(o.cap) as never) && Number(o.cap) > points ? Number(o.cap) : 0;
  const pointsMap = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(v && typeof v === "object" ? (v as Record<string, unknown>) : {}).filter(([, n]) => TOUR_POINTS.includes(Number(n) as never)).map(([k, n]) => [k, Number(n)]));
  const mh = o.matchHandicap && typeof o.matchHandicap === "object" ? (o.matchHandicap as Record<string, unknown>) : {};
  const matchHandicap = Object.fromEntries(Object.entries(mh).flatMap(([k, v]) => {
    const x = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    return x && typeof x.id === "string" && Number.isInteger(Number(x.pts)) && Number(x.pts) >= 0 && Number(x.pts) <= 30 ? [[k, { id: x.id, pts: Number(x.pts) }]] : [];
  }));
  // Nombre de matchs de chacun a son entree dans le tournoi (13/11) : fixe son K (40 sur ses 10 premiers matchs, puis 20).
  const lg = o.launchGames && typeof o.launchGames === "object" ? (o.launchGames as Record<string, unknown>) : {};
  const launchGames = Object.fromEntries(Object.entries(lg).filter(([, n]) => Number.isInteger(Number(n)) && Number(n) >= 0).map(([k, n]) => [k, Number(n)]));
  // Matchs retour (13/11) : poolLegs[poule] = 2 → chaque paire de la poule se rencontre deux fois ; 1 (16/11) = un seul
  // match, choisi par le prof (pas de revanche automatique) ; absent = automatique (revanches quand la poule a fini).
  const pl = o.poolLegs && typeof o.poolLegs === "object" ? (o.poolLegs as Record<string, unknown>) : {};
  const poolLegs = Object.fromEntries(Object.entries(pl).filter(([, n]) => Number(n) === 2 || Number(n) === 1).map(([k, n]) => [k, Number(n)]));
  return { sets, points, poolSize, poolCount, eloPerPoint, deuce, cap, poolPoints: pointsMap(o.poolPoints), matchPoints: pointsMap(o.matchPoints), calibration, matchHandicap, launchGames, poolLegs, team };
}

// ===== Bareme du handicap calcule sur les matchs joues (Sartay 13/11 : « calcul automatique au moment de lancer le
// championnat » ; « est-ce que le bareme change en fonction du nombre de points dans le set ? ») =====
// Regression sans constante de l'ecart de points d'un set sur l'ecart d'ELO avant le match, sur les sets JOUES D'UNE
// LONGUEUR PROCHE de l'objectif (objectif ± 3 points : la proportion « set 2 fois plus long = ecart 2 fois plus grand »
// ne se verifie pas dans les matchs joues). Avec moins de CALIBRATION_ENOUGH sets proches, l'estimation est completee
// par TOUS les sets ramenes a la longueur de l'objectif, au prorata (45 sets proches = 45 % du poids). Le resultat est
// exprime pour un set de 15, comme le reglage manuel (handicapOf le ramene a l'objectif).
export const CALIBRATION_ENOUGH = 100;
export type HandicapSample = { gap: number; margin: number; len: number };
export type HandicapCalibration = { eloPerPoint: number; near: number; all: number; lo: number; hi: number };
function slope(rows: HandicapSample[], margin: (s: HandicapSample) => number): number | null {
  const den = rows.reduce((t, s) => t + s.gap * s.gap, 0);
  return den > 0 ? rows.reduce((t, s) => t + s.gap * margin(s), 0) / den : null; // points d'ecart par point d'ELO
}
export function calibrateHandicap(samples: HandicapSample[], target: number): HandicapCalibration | null {
  const lo = target - 3, hi = target + 3;
  const near = samples.filter((s) => s.len >= lo && s.len <= hi);
  const kAll = samples.length >= 20 ? slope(samples, (s) => (s.margin * target) / Math.max(5, s.len)) : null;
  const kNear = near.length >= 20 ? slope(near, (s) => s.margin) : null;
  const w = kNear === null ? 0 : kAll === null ? 1 : Math.min(1, near.length / CALIBRATION_ENOUGH);
  const k = w === 0 ? kAll : w === 1 ? kNear : w * kNear! + (1 - w) * kAll!;
  if (k === null || !(k > 0)) return null;
  const eloPerPoint = Math.max(5, Math.min(100, Math.round(target / (15 * k))));
  return { eloPerPoint, near: w > 0 ? near.length : 0, all: samples.length, lo, hi };
}
export function calibrationText(c: HandicapCalibration, target: number): string {
  if (c.near >= CALIBRATION_ENOUGH) return `d'après ${c.near} sets de ${c.lo} à ${c.hi} points`;
  if (c.near > 0) return `d'après ${c.near} sets de ${c.lo} à ${c.hi} points, complétés par les ${c.all} sets joués ramenés à ${target}`;
  return `d'après les ${c.all} sets joués, ramenés à ${target} points`;
}
// Regle de fin de set d'une rencontre : son objectif (match, sinon poule, sinon tournoi), 2 points d'ecart ou pas, plafond.
export type TourRule = { points: number; deuce: boolean; cap: number; sets: 1 | 2 | 3 };
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
export function ruleFor(s: TourSettings, players: TourPlayer[], a: string, b: string): TourRule {
  const pool = players.find((p) => p.studentId === a)?.pool;
  const points = s.matchPoints[pairKey(a, b)] ?? (pool && s.poolPoints[pool]) ?? s.points;
  return { points, deuce: s.deuce, cap: s.deuce && s.cap > points ? s.cap : 0, sets: s.sets };
}
export const ruleText = (r: TourRule) => (r.deuce ? `${r.points} points, 2 points d'écart${r.cap ? ` (max ${r.cap})` : ""}` : `${r.points} points, le premier à ${r.points} gagne`);
// « 1 set de 15 points », « 2 sets de 11 points, 2 points d'écart (max 15) », « 2 sets gagnants (au meilleur des 3) de 21 points ».
export const formatText = (s: TourSettings, points = s.points) => `${s.sets === 1 ? "1 set" : s.sets === 2 ? "2 sets" : "2 sets gagnants (au meilleur des 3)"} de ${points} points${s.deuce ? `, 2 points d'écart${s.cap > points ? ` (max ${s.cap})` : ""}` : ""}`;

export type TourEntrant = { id: string; elo: number };
export type TourPlayer = { studentId: string; pool: string; seed: number; elo: number; late?: boolean; gone?: boolean };
export const POOL_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const byElo = (a: TourEntrant, b: TourEntrant) => b.elo - a.elo || a.id.localeCompare(b.id);

export function makePools(entrants: TourEntrant[], poolSize: number, poolCount = 0): TourPlayer[] {
  const sorted = [...entrants].sort(byElo);
  const n = sorted.length;
  if (!n) return [];
  // Nombre de poules impose (au moins 2 joueurs par poule), sinon deduit de la taille voulue.
  const count = poolCount > 0 ? Math.max(1, Math.min(poolCount, Math.floor(n / 2))) : poolSize <= 0 ? 1 : Math.max(1, Math.min(POOL_NAMES.length, Math.ceil(n / Math.max(2, poolSize))));
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
// Poules faites A LA MAIN par le prof avant le lancement (Sartay 20/11 : « le tournoi via le classement ELO n'est pas
// toujours la solution la plus adaptee ; je voudrais deplacer des noms dans d'autres poules, que la poule la plus nombreuse
// soit une autre, intervertir deux joueurs »). groups = les joueurs de chaque poule, dans l'ordre des poules (A, B, C…) ;
// une poule vide est ignoree. Dans une poule, la tete de serie suit l'ELO (1 = le meilleur), comme pour les poules automatiques.
export const groupsOfPlayers = (players: TourPlayer[]): string[][] => {
  const names = [...new Set(players.map((p) => p.pool))].sort();
  return names.map((n) => players.filter((p) => p.pool === n).sort((a, b) => a.seed - b.seed).map((p) => p.studentId));
};
export function checkManualPools(groups: string[][], ids: string[]): string | null {
  const g = groups.filter((p) => p.length);
  if (!g.length) return "Aucune poule.";
  if (g.length > POOL_NAMES.length) return `${POOL_NAMES.length} poules au maximum.`;
  const seen = new Set<string>();
  for (const p of g) for (const id of p) {
    if (seen.has(id)) return "Un joueur est dans deux poules.";
    seen.add(id);
  }
  const want = new Set(ids);
  if (seen.size !== want.size || [...want].some((id) => !seen.has(id))) return "Les poules ne correspondent pas aux participants cochés : rechargez la page.";
  if (g.some((p) => p.length < 2)) return "Chaque poule a besoin d'au moins 2 joueurs.";
  return null;
}
export function makeManualPools(groups: string[][], eloOf: (id: string) => number): TourPlayer[] {
  return groups
    .filter((p) => p.length)
    .flatMap((p, i) => p.map((id) => ({ id, elo: eloOf(id) })).sort(byElo).map((e, s) => ({ studentId: e.id, pool: POOL_NAMES[i], seed: s + 1, elo: Math.round(e.elo) })));
}
// Poules modifiees, puis participants coches ou decoches : un decoche quitte sa poule ; un nouveau coche rejoint la poule
// dont l'ELO moyen est le plus proche du sien (comme un retardataire).
export function reconcileGroups(groups: string[][], chosen: TourEntrant[]): string[][] {
  const ids = new Set(chosen.map((c) => c.id));
  const elo = new Map(chosen.map((c) => [c.id, c.elo]));
  const out = groups.map((p) => p.filter((id) => ids.has(id)));
  const placed = new Set(out.flat());
  for (const c of [...chosen].sort(byElo)) {
    if (placed.has(c.id)) continue;
    let best = 0, gap = Infinity;
    out.forEach((p, i) => {
      if (!p.length) return;
      const d = Math.abs(p.reduce((s, id) => s + (elo.get(id) ?? 0), 0) / p.length - c.elo);
      if (d < gap) { gap = d; best = i; }
    });
    if (!out.length) out.push([]);
    out[best] = [...out[best], c.id];
    placed.add(c.id);
  }
  return out;
}

// Grand tableau : une seule liste, tete de serie 1 = meilleur ELO.
export const makeSeeds = (entrants: TourEntrant[]): TourPlayer[] => [...entrants].sort(byElo).map((e, i) => ({ studentId: e.id, pool: "T", seed: i + 1, elo: Math.round(e.elo) }));
export const makePlayers = (kind: TourKind, entrants: TourEntrant[], s: TourSettings): TourPlayer[] => (kind === "BRACKET" ? makeSeeds(entrants) : makePools(entrants, s.poolSize, s.poolCount));

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

// ELO DU MOMENT au championnat a handicap (Sartay 13/11 : « si c'est facile d'adapter le handicap apres chaque match joue,
// c'est mieux ») : un joueur ne change d'ELO que quand IL joue ; son ELO du moment = son ELO a l'entree dans le tournoi +
// ses matchs du championnat deja comptes, avec la regle du classement (match a handicap = esperance ½, K 40 sur ses 10
// premiers matchs puis 20, ecart au score). Calcule sur les seuls matchs du tournoi (deja charges partout) : leger, et le
// meme pour le tableau du prof, la carte de l'eleve et l'ouverture du direct. Tournoi sans launchGames (avant le 13/11) :
// K 20 pour tous.
export function playersNow(players: TourPlayer[], matches: BmMatch[], s: TourSettings): TourPlayer[] {
  const ids = new Set(players.map((p) => p.studentId));
  const start = new Map(players.map((p) => [p.studentId, { rating: p.elo, games: s.launchGames[p.studentId] ?? K_NEW_GAMES }]));
  const games: EloGame[] = matches.flatMap((m) => {
    if (!ids.has(m.playerAId) || !ids.has(m.playerBId)) return [];
    const st = matchState(m);
    return isOfficial(m, st) ? [{ matchId: m.id, at: m.createdAt, a: m.playerAId, b: m.playerBId, sets: st.sets!, result: st.result!, even: true, themed: !!themeOf(m) }] : [];
  });
  if (!games.length) return players;
  const now = computeElo(games, start);
  return players.map((p) => ({ ...p, elo: Math.round(now.get(p.studentId)?.rating ?? p.elo) }));
}

// Avance d'une rencontre du championnat : celle que le bareme donne (ELO du joueur passe par playersNow, objectif de CETTE rencontre)…
export function autoHandicap(s: TourSettings, players: TourPlayer[], a: string, b: string): [number, number] {
  const elo = (id: string) => players.find((p) => p.studentId === id)?.elo ?? 0;
  return handicapOf(elo(a), elo(b), { ...s, points: ruleFor(s, players, a, b).points });
}
// … sauf si le prof l'a imposee pour ce match.
export function handicapFor(s: TourSettings, players: TourPlayer[], a: string, b: string): [number, number] {
  const o = s.matchHandicap[pairKey(a, b)];
  if (o && (o.id === a || o.id === b)) return o.pts === 0 ? [0, 0] : o.id === a ? [o.pts, 0] : [0, o.pts];
  return autoHandicap(s, players, a, b);
}
// Regle d'un match de tournoi pour l'arbitre en direct (reprise comprise) ; `head` = score de depart de CHAQUE set au
// championnat a handicap : celui pose a l'ouverture du match (1er instantane en direct), sinon le handicap actuel.
// Tournoi par equipes au temps (24/11) : pas d'objectif (le score au coup de sifflet), et la fin du chrono en cours.
export function liveRuleOf(t: { kind: TourKind; settings: TourSettings; players: TourPlayer[] }, m: BmMatch): TourRule & { target: number; head?: BmSet; endsAt?: number } {
  const tm = t.settings.team;
  if (t.kind === "TEAMS" && tm?.mode === "TIME") return { points: 0, deuce: false, cap: 0, sets: 1, target: 0, ...(tm.timer && !tm.timer.stoppedAt ? { endsAt: tm.timer.endsAt } : {}) };
  const r = ruleFor(t.settings, t.players, m.playerAId, m.playerBId);
  if (t.kind !== "HANDICAP") return { ...r, target: r.points };
  const first = [...m.events].filter((e) => e.kind === "LIVE" && e.sets?.length).sort((x, y) => x.at - y.at)[0];
  const head: BmSet = first?.sets ? [first.sets[0][0], first.sets[0][1]] : handicapFor(t.settings, t.players, m.playerAId, m.playerBId);
  return { ...r, target: r.points, head };
}

export type PairingStatus = "todo" | "live" | "played" | "disputed" | "bye" | "wait" | "tie" | "gone";
// Une rencontre : `sets` toujours dans le sens a puis b ; `handicap` = points d'avance [a, b] (championnat a handicap).
export type TourPairing = { a: string; b: string | null; status: PairingStatus; matchId: string | null; sets: BmSet[] | null; winner: "A" | "B" | "DRAW" | null; handicap?: [number, number]; handicapForced?: boolean };
export type TourRound = { n: number; pairings: TourPairing[] };
export type TourStanding = { id: string; gone?: boolean; rank: number; played: number; won: number; drawn: number; lost: number; score: number; setsFor: number; setsAgainst: number; pointsFor: number; pointsAgainst: number; elo: number };
// twice : la poule se joue en aller-retour ; auto : parce que son aller est fini (revanches automatiques, 16/11).
export type TourPool = { name: string; players: string[]; rounds: TourRound[]; catchUp: TourPairing[]; current: number | null; done: boolean; standings: TourStanding[]; twice: boolean; auto: boolean };

const samePair = (m: BmMatch, a: string, b: string) => (m.playerAId === a && m.playerBId === b) || (m.playerAId === b && m.playerBId === a);

// La rencontre a-b dans les matchs du tournoi : le dernier match non annule entre eux. leg (matchs retour, 13/11) :
// 0 = le 1er match non annule entre eux (aller), 1 = le 2e (retour) ; null = une seule rencontre (regle d'avant).
export function pairingOf(a: string, b: string | null, matches: BmMatch[], leg: number | null = null): TourPairing {
  if (b === null) return { a, b, status: "bye", matchId: null, sets: null, winner: null };
  const all = [...matches].filter((x) => samePair(x, a, b) && matchState(x).status !== "CANCELLED");
  const m = leg === null ? all.sort((x, y) => y.createdAt - x.createdAt)[0] : all.sort((x, y) => x.createdAt - y.createdAt)[leg];
  if (!m) return { a, b, status: "todo", matchId: null, sets: null, winner: null };
  const st = matchState(m);
  const flip = m.playerAId !== a;
  const sets = st.sets ? (flip ? swapSets(st.sets) : st.sets) : null;
  const w = st.result?.winner ?? null;
  const winner = w === null || w === "DRAW" ? w : (w === "A") !== flip ? "A" : "B";
  const status: PairingStatus = st.status === "LIVE" ? "live" : st.status === "DISPUTED" ? "disputed" : st.status === "VALIDATED" || st.status === "PENDING" ? "played" : "todo";
  return { a, b, status, matchId: m.id, sets, winner: status === "played" ? winner : null };
}

// legs : poolLegs des reglages (poule → 2 = matchs retour : les rondes sont rejouees une 2e fois, a la suite ; 1 = un seul
// match). REVANCHES AUTOMATIQUES (16/11, Sartay : « pour les poules qui sont terminees, permets toujours une revanche s'il
// reste du temps ») : sans choix du prof, une poule dont l'aller est fini passe d'elle-meme en aller-retour. `auto` false
// (tournoi clos) : on montre la poule telle qu'elle a ete jouee.
export function poolsOf(players: TourPlayer[], matches: BmMatch[], handicap: TourSettings | null = null, legs: Record<string, number> = {}, auto = true): TourPool[] {
  const names = [...new Set(players.map((p) => p.pool))].sort();
  const settled = (p: TourPairing) => p.status === "played" || p.status === "bye" || p.status === "gone";
  return names.map((name) => {
    if (legs[name] === 2 || legs[name] === 1) return poolOf(players, matches, handicap, name, legs[name] === 2, false);
    const single = poolOf(players, matches, handicap, name, false, false);
    if (!single.rounds.some((r) => r.pairings.some((p) => p.b))) return single;
    // L'aller se lit sur le PREMIER match de chaque paire (une revanche en direct ne le defait pas) ; une revanche deja
    // jouee garde la poule en aller-retour (tournoi clos compris).
    const twice = poolOf(players, matches, handicap, name, true, true);
    const half = twice.rounds.length / 2;
    const allerDone = twice.rounds.slice(0, half).every((r) => r.pairings.every(settled)) && twice.catchUp.every(settled);
    const replayed = twice.rounds.slice(half).some((r) => r.pairings.some((p) => p.b && p.status !== "todo" && p.status !== "gone"));
    return (auto && allerDone) || replayed ? twice : single;
  });
}
function poolOf(players: TourPlayer[], matches: BmMatch[], handicap: TourSettings | null, name: string, twice: boolean, autoTwice: boolean): TourPool {
    const members = players.filter((p) => p.pool === name).sort((a, b) => a.seed - b.seed);
    const ids = members.map((p) => p.studentId);
    const lateIds = members.filter((p) => p.late).map((p) => p.studentId);
    const goneIds = new Set(members.filter((p) => p.gone).map((p) => p.studentId));
    const withH = (a: string, b: string | null, leg: number | null = null) => {
      const raw = pairingOf(a, b, matches, leg);
      // Joueur parti : sa rencontre pas encore jouee (ni en cours) sort de l'ordre.
      const p: TourPairing = b && (goneIds.has(a) || goneIds.has(b)) && (raw.status === "todo" || raw.status === "disputed") ? { ...raw, status: "gone" } : raw;
      // Handicap proportionnel a l'objectif de CETTE rencontre (poule ou match a part).
      return handicap && b ? { ...p, handicap: handicapFor(handicap, players, a, b), ...(handicap.matchHandicap[pairKey(a, b)] ? { handicapForced: true } : {}) } : p;
    };
    // Rondes : les joueurs du depart seulement (un retardataire ne les change pas) ; puis ses matchs de rattrapage.
    const base = roundRobin(ids.filter((id) => !lateIds.includes(id)));
    const rounds = (twice ? [0, 1] : [null]).flatMap((leg) => base.map((pairs, i) => ({ n: (leg ?? 0) * base.length + i + 1, pairings: pairs.map(([a, b]) => withH(a, b, leg)) })));
    const catchUp: TourPairing[] = [];
    lateIds.forEach((l, li) => { for (const o of ids) if (o !== l && !lateIds.slice(0, li).includes(o)) catchUp.push(withH(l, o)); });
    const open = rounds.find((r) => r.pairings.some((p) => p.status !== "played" && p.status !== "bye" && p.status !== "gone"));
    const table = new Map(members.map((p) => [p.studentId, { id: p.studentId, gone: !!p.gone, rank: 0, played: 0, won: 0, drawn: 0, lost: 0, score: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0, elo: p.elo }]));
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
    // Un joueur parti est classe apres les autres (il n a pas fini la poule).
    const standings = [...table.values()].sort((x, y) => Number(x.gone) - Number(y.gone) || y.score - x.score || (y.setsFor - y.setsAgainst) - (x.setsFor - x.setsAgainst) || (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) || y.elo - x.elo);
    standings.forEach((s, i) => (s.rank = i + 1));
    return { name, players: ids, rounds, catchUp, current: open?.n ?? null, done: !open && catchUp.every((p) => p.status === "played" || p.status === "gone"), standings, twice, auto: autoTwice };
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
  const gone = new Set(players.filter((p) => p.gone).map((p) => p.studentId));
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
          // Joueur parti, match pas encore joue : son adversaire passe (le parti va vers le bas du tableau).
          const forfeit = !decided && p.status !== "live" && (gone.has(a) || gone.has(b));
          const status: PairingStatus = forfeit ? "gone" : p.status === "played" && !decided ? "tie" : p.status;
          const winner: "A" | "B" | null = decided ? (p.winner as "A" | "B") : forfeit ? (gone.has(a) && !gone.has(b) ? "B" : "A") : null;
          pairings.push({ a, b, status, matchId: p.matchId, sets: p.sets, winner });
          if (decided) {
            win.push(p.winner === "A" ? a : b); lose.push(p.winner === "A" ? b : a);
            tally(a, p.winner === "A"); tally(b, p.winner === "B");
          } else if (forfeit) {
            win.push(winner === "A" ? a : b); lose.push(winner === "A" ? b : a);
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
export function pendingPairing(kind: TourKind, players: TourPlayer[], matches: BmMatch[], a: string, b: string, legs: Record<string, number> = {}): boolean {
  if (kind === "BRACKET") {
    return bracketOf(players, matches).rounds.some((r) => r.groups.some((g) => g.pairings.some((p) => ((p.a === a && p.b === b) || (p.a === b && p.b === a)) && (p.status === "todo" || p.status === "disputed"))));
  }
  const pa = players.find((p) => p.studentId === a);
  const pb = players.find((p) => p.studentId === b);
  if (!pa || !pb || pa.pool !== pb.pool) return false;
  if (pa.gone || pb.gone) return false; // un joueur parti n'a plus de rencontre a jouer
  // Les rencontres de la poule telles que les voient le prof et les eleves (matchs retour, choisis ou automatiques,
  // rattrapages des retardataires) : la paire doit encore jouer tant qu'une de ses rencontres n'est pas jouee.
  const pool = poolsOf(players, matches, null, legs).find((p) => p.name === pa.pool);
  if (!pool) return false;
  return [...pool.rounds.flatMap((r) => r.pairings), ...pool.catchUp].some((p) => ((p.a === a && p.b === b) || (p.a === b && p.b === a)) && (p.status === "todo" || p.status === "disputed"));
}

// Poules / handicap : ma poule, la ronde en cours et ma rencontre dans cette ronde ; un retardataire : son prochain match
// de rattrapage. `extra` : les matchs de rattrapage qu'un retardataire doit encore jouer contre moi.
export type TourMine = { pool: TourPool; round: TourRound | null; pairing: TourPairing | null; rank: number; of: number; late: boolean; extra: TourPairing[] };
export function mineOf(pools: TourPool[], studentId: string): TourMine | null {
  const pool = pools.find((p) => p.players.includes(studentId));
  if (!pool) return null;
  const rank = pool.standings.find((s) => s.id === studentId)?.rank ?? 0;
  const pending = (p: TourPairing) => p.status !== "played" && p.status !== "bye" && p.status !== "gone";
  const late = pool.catchUp.some((p) => p.a === studentId) && !pool.rounds.some((r) => r.pairings.some((p) => p.a === studentId || p.b === studentId));
  if (late) {
    const pairing = pool.catchUp.find((p) => (p.a === studentId || p.b === studentId) && pending(p)) ?? null;
    return { pool, round: null, pairing, rank, of: pool.players.length, late, extra: [] };
  }
  // Mon prochain match : le premier pas encore joue, dans l'ordre des rondes (sans attendre la fin de la ronde).
  const next = pool.rounds.flatMap((r) => r.pairings.filter((p) => p.a === studentId || p.b === studentId).map((p) => ({ r, p }))).find((x) => pending(x.p));
  const extra = pool.catchUp.filter((p) => p.b === studentId && pending(p));
  return { pool, round: next?.r ?? null, pairing: next?.p ?? null, rank, of: pool.players.length, late, extra };
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
    if (p.status === "played" || p.status === "bye" || p.status === "gone") continue;
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
