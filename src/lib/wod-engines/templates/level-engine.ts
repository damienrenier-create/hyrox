// Moteur pur du WOD Level : aucune dependance serveur, importable cote client (constructeur de niveaux,
// ecran greffier) comme cote serveur (classements, records).

export const BOSS_EVERY = 5; // niveaux 5, 10, 15... = BOSS (un seul exercice, toute l'equipe dessus)
export const MAX_CARDS = 10; // fiches par niveau
export const MIN_TEAM = 1;
export const MAX_TEAM = 6;
export const DEFAULT_TEAM = 5;

export type LevelCard = { exerciseId: string; reps: number };
// Fiche figee dans une seance : la ponderation et le libelle sont copies avec elle (l'echelle d'une seance ne
// depend plus du catalogue). `off` = fiche retiree par le greffier en cours de WOD : elle ne compte plus,
// sans decaler les index des fiches voisines (les coches y font reference par index).
export type FrozenCard = LevelCard & { label: string; weight: number; off?: boolean };
// `zombieRef` (Sartay 28/09) : fiches de REFERENCE pour le temps du zombie, quand les fiches jouees ont ete
// allegees sans vouloir changer ce temps (echauffement divise par 2 ou 3, zombie inchange).
export type FrozenLevel = { number: number; name: string | null; boss: boolean; cards: FrozenCard[]; zombieRef?: { reps: number; weight: number }[] };

export const isBoss = (number: number) => number > 0 && number % BOSS_EVERY === 0;

export function readCards(raw: unknown): LevelCard[] {
  if (!Array.isArray(raw)) return [];
  const out: LevelCard[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as { exerciseId?: unknown; reps?: unknown };
    if (typeof o.exerciseId !== "string" || typeof o.reps !== "number" || !Number.isFinite(o.reps) || o.reps <= 0) continue;
    out.push({ exerciseId: o.exerciseId, reps: Math.round(o.reps) });
  }
  return out.slice(0, MAX_CARDS);
}

export function readFrozenLevels(raw: unknown): FrozenLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: FrozenLevel[] = [];
  for (const l of raw) {
    if (!l || typeof l !== "object") continue;
    const o = l as { number?: unknown; name?: unknown; cards?: unknown; zombieRef?: unknown };
    if (typeof o.number !== "number") continue;
    const cards: FrozenCard[] = [];
    for (const c of Array.isArray(o.cards) ? o.cards : []) {
      const k = c as { exerciseId?: unknown; reps?: unknown; label?: unknown; weight?: unknown; off?: unknown };
      if (typeof k.exerciseId !== "string" || typeof k.reps !== "number" || typeof k.label !== "string" || typeof k.weight !== "number") continue;
      cards.push({ exerciseId: k.exerciseId, reps: k.reps, label: k.label, weight: k.weight, ...(k.off === true ? { off: true } : {}) });
    }
    const ref = Array.isArray(o.zombieRef) ? (o.zombieRef as { reps?: unknown; weight?: unknown }[]).filter((r) => typeof r?.reps === "number" && typeof r?.weight === "number").map((r) => ({ reps: r.reps as number, weight: r.weight as number })) : [];
    out.push({ number: o.number, name: typeof o.name === "string" ? o.name : null, boss: isBoss(o.number), cards, ...(ref.length ? { zombieRef: ref } : {}) });
  }
  return out.sort((a, b) => a.number - b.number);
}

// ===== Parcours 1 a 5 etoiles (Sartay 25/09 ; CINQ parcours depuis le 29/09 soir) =====
// Cinq echelles vivent cote a cote, de 1 etoile (peu de force et de technique) a 5 etoiles (force et cardio) ; le 3
// etoiles (ancien 2 etoiles) est l'echelle centrale. Une seance les fige toutes (settings.levels = 3 etoiles,
// settings.ladders = { "1", "2", "4", "5", et les formats m1..m5, s1..s5 }) et chaque equipe joue sur le parcours de
// settings.teamStars[teamId] (3 par defaut). Les parcours servent a rendre le jeu equitable : le classement est
// commun a tout l'ecran (niveau x etoiles), et une equipe est reorientee selon ses performances.
// Les seances d'avant le 29/09 (3 parcours) ont ete migrees : 1 -> 1, 2 -> 3, 3 -> 5.
export type Stars = 1 | 2 | 3 | 4 | 5;
export const STARS: Stars[] = [1, 2, 3, 4, 5];
export const MAX_STARS = 5;
export const DEFAULT_STARS: Stars = 3;
export const isStars = (v: unknown): v is Stars => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
export const starsLabel = (s: Stars) => "★".repeat(s) + "☆".repeat(MAX_STARS - s);
export const starsName = (s: Stars) => (s === 1 ? "1 étoile" : `${s} étoiles`);
export function readTeamStars(settings: unknown): Record<string, Stars> {
  const raw = (settings as { teamStars?: unknown } | null)?.teamStars;
  const out: Record<string, Stars> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isStars(v)) out[k] = v;
  return out;
}
export const teamStarsOf = (teamStars: Record<string, Stars>, teamId: string): Stars => teamStars[teamId] ?? DEFAULT_STARS;
// Echelles figees des parcours 1 et 3 etoiles (le 2 etoiles est settings.levels).
// ===== Format d'equipe (Sartay 27/09) =====
// Deux types de parcours : « big » (equipes de 4, 5 et plus : l'echelle de reference) et « small » (equipes de
// 1 a 3 : reps divisees par 1,7, 2 a 5 fiches par niveau, meme travail par personne). Chaque type a ses trois
// parcours 1, 2, 3 etoiles ; les echelles small d'une seance vivent dans settings.ladders sous "s1", "s2", "s3".
// 28/09 : troisieme format « mid » pour les equipes de 4 (reps ÷ 1,25, entre celles de 3 et de 5) ; ses echelles
// vivent sous "m1", "m2", "m3".
export type Format = "big" | "mid" | "small";
export const FORMATS: Format[] = ["big", "mid", "small"];
export const DEFAULT_FORMAT: Format = "big";
export const SMALL_MAX_MEMBERS = 3; // 1 a 3 membres -> petit format par defaut
export const SMALL_TEAM = 3; // taille de reference du petit format (estimations, zombie)
export const SMALL_RATIO = 1.7;
export const SMALL_MAX_CARDS = 5;
export const MID_TEAM = 4; // equipes de 4
export const MID_RATIO = 1.25; // 5 / 4
export const formatLabel = (f: Format) => (f === "small" ? "1-3" : f === "mid" ? "4" : "5+");
export const formatName = (f: Format) => (f === "small" ? "équipes de 1 à 3" : f === "mid" ? "équipes de 4" : "équipes de 5 et plus");
export const teamSizeOf = (f: Format) => (f === "small" ? SMALL_TEAM : f === "mid" ? MID_TEAM : DEFAULT_TEAM);
export type LadderKey = Stars | `s${Stars}` | `m${Stars}`;
export const LADDER_KEYS: LadderKey[] = [1, 2, 3, 4, 5, "m1", "m2", "m3", "m4", "m5", "s1", "s2", "s3", "s4", "s5"];
export const ladderKey = (stars: Stars, format: Format = DEFAULT_FORMAT): LadderKey => (format === "small" ? `s${stars}` : format === "mid" ? `m${stars}` : stars);
export const formatOfLadderKey = (k: LadderKey): Format => (typeof k === "number" ? "big" : k.startsWith("s") ? "small" : "mid");
export const starsOfLadderKey = (k: LadderKey): Stars => (typeof k === "number" ? k : (Number(k.slice(1)) as Stars));
// Groupe de classement (une equipe se compare a celles du meme parcours ET du meme format).
export const parcoursKey = (stars: Stars, format: Format = DEFAULT_FORMAT) => `${format}-${stars}`;
export type Ladders = Partial<Record<LadderKey, FrozenLevel[]>>;
export function readTeamFormats(settings: unknown): Record<string, Format> {
  const raw = (settings as { teamFormat?: unknown } | null)?.teamFormat;
  const out: Record<string, Format> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === "big" || v === "mid" || v === "small") out[k] = v;
  return out;
}
// Format d'une equipe : celui fixe dans les reglages, sinon d'apres son effectif (1 a 3 -> small, 4 -> mid), sinon big.
export function teamFormatOf(formats: Record<string, Format>, teamId: string, memberCount?: number): Format {
  if (formats[teamId]) return formats[teamId];
  if (memberCount === undefined || memberCount <= 0) return DEFAULT_FORMAT;
  return memberCount <= SMALL_MAX_MEMBERS ? "small" : memberCount === MID_TEAM ? "mid" : DEFAULT_FORMAT;
}
export function readLadders(settings: unknown): Ladders {
  const raw = (settings as { ladders?: unknown } | null)?.ladders;
  const out: Ladders = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const k of LADDER_KEYS) {
    if (k === DEFAULT_STARS) continue; // le 3 etoiles big vit dans settings.levels
    const l = readFrozenLevels((raw as Record<string, unknown>)[String(k)]);
    if (l.length) out[k] = l;
  }
  return out;
}
// Echelle d'un parcours. Petit format : son echelle, sinon le petit 2 etoiles, sinon (seance figee avant le
// petit format) l'echelle big ; un parcours 1 ou 3 etoiles absent retombe sur le 2 etoiles.
// Descente de categorie (Sartay 28/09) : a 3 vies perdues au WOD principal, une equipe descend d'une categorie.
// Elle garde son niveau : elle finit le niveau en cours sur l'ancienne echelle, et joue la nouvelle a partir du
// niveau suivant (`fromLevel`). settings.starSwitch[teamId] ; settings.teamStars porte deja la nouvelle categorie.
export const DEMOTE_AT_LOSSES = 3;
// Changement de categorie d'une equipe en cours de WOD : descente a la 3e vie perdue (28/09), montee quand elle est
// 1re de sa categorie sur tout un BOSS (29/09). Plusieurs changements s'enchainent par `prev` (le plus recent en tete) :
// l'echelle de l'equipe = celle de `from` (elle-meme composee avec `prev`) avant `fromLevel`, celle de `to` ensuite.
export type StarSwitch = { from: Stars; to: Stars; fromLevel: number; prev?: StarSwitch };
function readSwitch(v: unknown, depth = 0): StarSwitch | null {
  const o = v as { from?: unknown; to?: unknown; fromLevel?: unknown; prev?: unknown } | null;
  if (!o || depth > 60 || !isStars(o.from) || !isStars(o.to) || typeof o.fromLevel !== "number") return null;
  const prev = o.prev ? readSwitch(o.prev, depth + 1) : null;
  return { from: o.from as Stars, to: o.to as Stars, fromLevel: o.fromLevel, ...(prev ? { prev } : {}) };
}
export function readStarSwitches(settings: unknown): Record<string, StarSwitch> {
  const raw = (settings as { starSwitch?: unknown } | null)?.starSwitch;
  const out: Record<string, StarSwitch> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const sw = readSwitch(v);
    if (sw) out[k] = sw;
  }
  return out;
}
// Changements d'une equipe, du plus ancien au plus recent.
export function switchChain(sw: StarSwitch | null | undefined): StarSwitch[] {
  const out: StarSwitch[] = [];
  for (let s = sw ?? undefined; s; s = s.prev) out.unshift(s);
  return out;
}
export const hasDemotion = (sw: StarSwitch | null | undefined) => switchChain(sw).some((s) => s.to < s.from);
// Parcours joue par l'equipe a un niveau donne (`current` = son parcours actuel).
export function starsAtLevel(sw: StarSwitch | null | undefined, current: Stars, level: number): Stars {
  if (!sw) return current;
  return level >= sw.fromLevel ? sw.to : starsAtLevel(sw.prev, sw.from, level);
}
// ===== Reorientation (Sartay 29/09 soir : « on ne perd jamais de niveau !! on descend seulement de parcours si on
// perd trop de vies ») — seances lancees depuis (settings.levelRules = 2) =====
// - toutes les vies du WOD principal sont douces (fiches gardees, coeur neuf) ;
// - descente d'un parcours a la 2e vie perdue, puis a la 4e, la 7e, la 11e, la 16e... (2 coeurs, puis 2 de plus,
//   puis 3, puis 4 ; decale d'une vie le 29/09 soir : « commence la descente apres la 2e vie perdue ») ; jamais sous 1 etoile ;
// - montee d'un parcours (jamais au-dessus de 5) quand l'equipe est 1re de son parcours (au moins deux equipes) en
//   bouclant 3 niveaux de suite, quand elle l'est sur tout un BOSS (entree et sortie), ou quand elle boucle 5 niveaux
//   de suite avec plus de 50 % du temps restant (le % affiche avec les pieces ; Sartay 29/09 nuit, a la place de
//   « 3 niveaux nettement plus vite que la moyenne ») : seule voie pour une equipe seule dans son parcours. Toujours
//   a partir du niveau suivant, sans perdre son niveau.
export const REORIENT_RULES = 2;
export const DEFAULT_CAP_MIN = 60; // « le WOD se joue en 60 minutes » : temps impose au coup d envoi, sauf choix contraire
export function readReorient(settings: unknown): boolean {
  const v = (settings as { levelRules?: unknown } | null)?.levelRules;
  return typeof v === "number" && v >= REORIENT_RULES;
}
export const PROMOTE_LEAD_STREAK = 3;
// Sur les 35 equipes deja jouees : plus de 50 % restant 5 fois de suite -> 11 equipes montent (plus de 20 % : 31).
export const PROMOTE_QUICK_STREAK = 5;
export const PROMOTE_QUICK_PCT = 50; // % du temps restant (coinsEarned.perLevel.pct) strictement au-dessus
// Descente a la n-ieme vie perdue quand n - 1 est triangulaire : 2, 4, 7, 11, 16... (1, 3, 6, 10, 15 decales d'une vie).
export const DEMOTE_OFFSET = 1;
export function demotesAtLoss(n: number): boolean {
  const m = n - DEMOTE_OFFSET;
  for (let k = 1, t = 1; t <= m; k++, t += k) if (t === m) return true;
  return false;
}
// Series en cours d'une equipe : niveaux boucles de suite en tete de son parcours (lead), et avec plus de 50 % du
// temps restant (fast). Remises a zero a chaque changement de parcours. settings.streaks[teamId].
export type Streak = { lead: number; fast: number; last: number }; // last = dernier niveau compte (jamais deux fois)
export function readStreaks(settings: unknown): Record<string, Streak> {
  const raw = (settings as { streaks?: unknown } | null)?.streaks;
  const out: Record<string, Streak> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as { lead?: unknown; fast?: unknown; last?: unknown } | null;
    if (o && typeof o.lead === "number" && typeof o.fast === "number") out[k] = { lead: o.lead, fast: o.fast, last: typeof o.last === "number" ? o.last : -1 };
  }
  return out;
}

// Montee de categorie : equipe 1re de sa categorie en entrant dans un BOSS (`first`), relevee a l'entree.
export type BossEntry = { level: number; first: boolean };
export function readBossEntry(settings: unknown): Record<string, BossEntry> {
  const raw = (settings as { bossEntry?: unknown } | null)?.bossEntry;
  const out: Record<string, BossEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as { level?: unknown; first?: unknown } | null;
    if (o && typeof o.level === "number" && typeof o.first === "boolean") out[k] = { level: o.level, first: o.first };
  }
  return out;
}
export function ladderFor(levels: FrozenLevel[], ladders: Ladders, stars: Stars, format: Format = DEFAULT_FORMAT, sw?: StarSwitch | null): FrozenLevel[] {
  if (sw) {
    const before = ladderFor(levels, ladders, sw.from, format, sw.prev ?? null).filter((l) => l.number < sw.fromLevel);
    const after = ladderFor(levels, ladders, sw.to, format).filter((l) => l.number >= sw.fromLevel);
    return [...before, ...after];
  }
  if (format === "small") {
    const s = ladders[`s${stars}`] ?? ladders[`s${DEFAULT_STARS}`];
    if (s?.length) return s;
  }
  if (format === "mid") {
    const m = ladders[`m${stars}`] ?? ladders[`m${DEFAULT_STARS}`];
    if (m?.length) return m;
  }
  return (stars === DEFAULT_STARS ? levels : ladders[stars]) ?? levels;
}

// Suggestion de parcours d'apres l'echauffement (Sartay 27/09) : boucle en 80 % de l'estimation ou moins -> 3
// etoiles ; dans les 120 % -> 2 ; au-dela -> 1. Echauffement pas boucle : 2 etoiles si au moins trois quarts
// des series, sinon 1.
// Cinq parcours (29/09 soir) : <= 75 % -> 5, <= 90 % -> 4, <= 110 % -> 3, <= 130 % -> 2, au-dela -> 1.
export function suggestStars(finishMs: number | null, levelsDone: number, levelsTotal: number, estimateMs: number): Stars {
  if (finishMs !== null && estimateMs > 0) {
    const r = finishMs / estimateMs;
    return r <= 0.75 ? 5 : r <= 0.9 ? 4 : r <= 1.1 ? 3 : r <= 1.3 ? 2 : 1;
  }
  return levelsTotal > 0 && levelsDone / levelsTotal >= 0.75 ? 2 : 1;
}

// Ordre des niveaux propre a une equipe (echauffement en differe) : les numeros manquants sont ajoutes a la fin.
export function orderedLevels(levels: FrozenLevel[], order?: number[] | null): FrozenLevel[] {
  if (!order || !order.length) return levels;
  const by = new Map(levels.map((l) => [l.number, l]));
  const out: FrozenLevel[] = [];
  for (const n of order) { const l = by.get(n); if (l && !out.includes(l)) out.push(l); }
  for (const l of levels) if (!out.includes(l)) out.push(l);
  return out;
}
export type LevelOrder = Record<string, number[]>;
export function readLevelOrder(settings: unknown): LevelOrder | null {
  const raw = (settings as { levelOrder?: unknown } | null)?.levelOrder;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: LevelOrder = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.filter((n): n is number => typeof n === "number");
  return out;
}
// Vitesse de zombie imposee (echauffement : palier 1 pour tout le monde), null = regle normale.
export function readFixedZombie(settings: unknown): number | null {
  const v = (settings as { zombieSpeed?: unknown } | null)?.zombieSpeed;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.round(v) : null;
}

// Fiches encore en jeu d'un niveau, avec leur index d'origine (les coches referencent cet index).
export const activeCards = (l: FrozenLevel) => l.cards.map((c, i) => ({ card: c, index: i })).filter((x) => !x.card.off);

// Cartes jaunes (Sartay) : chaque carte ajoute une fiche de penalite a l'equipe sur son niveau en cours, de
// plus en plus lourde : 10 cordes, 20, 30, 40, 50, 100, 200, 300, 400, 500 puis 1000. Elles vivent dans
// Session.settings.penalties et portent un index >= 100 (jamais en collision avec les fiches de l'echelle).
export const PENALTY_STEPS = [10, 20, 30, 40, 50, 100, 200, 300, 400, 500, 1000];
export const PENALTY_INDEX0 = 100;
// Un « extra » de niveau propre a une equipe (Sartay 25-26/09) :
// - penalty : fiche de penalite d'une carte jaune (index >= 100) ;
// - gift : fiche recue d'une fusee adverse (index >= 200), rattachee au niveau que l'equipe atteint apres l'envoi ;
// - discount : allegement paye en pieces sur une fiche de l'echelle (reps NEGATIVES, appliquees a la fiche index).
// at = epoch ms, atMs = chrono de course (derive). Les trois vivent dans settings.penalties / gifts / discounts et
// sont lus ensemble par readPenalties, pour que tout le moteur (progression, zombie, records) les voie.
export type ExtraKind = "penalty" | "gift" | "discount";
export type TeamPenalty = { teamId: string; level: number; index: number; reps: number; label: string; weight: number; at?: number; atMs?: number; kind?: ExtraKind; id?: string; fromTeamId?: string; exerciseId?: string; void?: boolean };
const isExtra = (p: unknown): p is TeamPenalty => !!p && typeof p === "object" && typeof (p as TeamPenalty).teamId === "string" && typeof (p as TeamPenalty).level === "number" && typeof (p as TeamPenalty).index === "number" && typeof (p as TeamPenalty).reps === "number";
export function readPenalties(settings: unknown): TeamPenalty[] {
  const s = settings as { penalties?: unknown; gifts?: unknown; discounts?: unknown } | null;
  const pen = (Array.isArray(s?.penalties) ? s!.penalties : []).filter(isExtra).map((p) => ({ ...p, kind: "penalty" as const }));
  const gifts = (Array.isArray(s?.gifts) ? s!.gifts : []).filter(isExtra).filter((g) => !g.void).map((g) => ({ ...g, kind: "gift" as const }));
  const disc = (Array.isArray(s?.discounts) ? s!.discounts : []).filter(isExtra).map((d) => ({ ...d, kind: "discount" as const }));
  return [...pen, ...gifts, ...disc];
}
// Toutes les fiches recues (y compris annulees) : pour l'historique et l'ecran.
export function readGifts(settings: unknown): TeamPenalty[] {
  const raw = (settings as { gifts?: unknown } | null)?.gifts;
  return (Array.isArray(raw) ? raw : []).filter(isExtra).map((g) => ({ ...g, kind: "gift" as const }));
}
export type TeamCard = { card: FrozenCard; index: number; penalty: boolean; kind: "base" | "penalty" | "gift" };
// Fiches d'un niveau POUR UNE EQUIPE : celles de l'echelle (allegees de ses achats, jamais sous 1 rep), puis ses
// penalites et ses fiches recues sur ce niveau.
export function cardsForTeam(level: FrozenLevel, teamId: string, penalties: TeamPenalty[] = []): TeamCard[] {
  const mine = penalties.filter((p) => p.teamId === teamId && p.level === level.number);
  const base: TeamCard[] = activeCards(level).map((x) => {
    const off = mine.filter((p) => p.kind === "discount" && p.index === x.index).reduce((s, p) => s + p.reps, 0);
    return { card: off ? { ...x.card, reps: Math.max(1, x.card.reps + off) } : x.card, index: x.index, penalty: false, kind: "base" as const };
  });
  const extra: TeamCard[] = mine
    .filter((p) => p.kind !== "discount")
    .map((p) => ({ card: { exerciseId: p.exerciseId ?? "PENALTY", label: p.label, reps: p.reps, weight: p.weight }, index: p.index, penalty: true, kind: p.kind === "gift" ? ("gift" as const) : ("penalty" as const) }));
  return [...base, ...extra];
}
export const cardSeconds = (c: { reps: number; weight: number }) => c.reps * c.weight;

// Statistiques d'un lot de fiches : reps totales, travail (somme reps x ponderation, en secondes), intensite
// (ponderation moyenne par rep : pure corde = 1, purs burpees = 7) et duree critique (la fiche la plus longue).
export type CardStats = { reps: number; weighted: number; intensity: number; critical: number };
export function statsOf(cards: { reps: number; weight: number }[]): CardStats {
  const reps = cards.reduce((s, c) => s + c.reps, 0);
  const weighted = cards.reduce((s, c) => s + c.reps * c.weight, 0);
  const critical = cards.reduce((m, c) => Math.max(m, c.reps * c.weight), 0);
  return { reps, weighted, intensity: reps > 0 ? weighted / reps : 0, critical };
}

// Duree reelle estimee d'un niveau (regle de Sartay) : les membres travaillent EN PARALLELE, en relais sur
// les exos, donc le niveau dure le temps de sa fiche la plus longue, ou du travail total partage entre les
// membres s'il y a plus de fiches que de bras. Un BOSS (tous sur le meme exo en meme temps) = travail / equipe.
export function estimateSeconds(cards: { reps: number; weight: number }[], boss: boolean, team = DEFAULT_TEAM): number {
  const { weighted, critical } = statsOf(cards);
  if (team <= 0) return weighted;
  return boss ? weighted / team : Math.max(critical, weighted / team);
}

export const fmtIntensity = (x: number) => (Math.round(x * 100) / 100).toFixed(2).replace(".", ",");
// Temps theorique en secondes -> « 4 min 20 s » (un niveau se lit en minutes, pas en secondes brutes).
export function fmtTheoretical(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${String(r).padStart(2, "0")} s` : `${m} min`;
}

// ===== Mode zombies (regles de Sartay, 24/09) =====
// - Le zombie atteint la premiere fiche en 1 minute (ZOMBIE_APPROACH_S), puis traverse la zone des fiches de
//   sorte que la bande complete lui prenne « duree estimee du niveau + marge ».
// - La marge fond avec le niveau : +3 min au niveau 1, -2 min au niveau 20 (lineaire).
// - Une vie perdue fait redescendre la vitesse du zombie de 3 paliers (niveau de vitesse = niveau - 3 x vies).
// - Les fiches occupent les 62 % droits de la piste (ZOMBIE_ZONE) ; le coeur est devant la premiere restante.
export const ZOMBIE_APPROACH_S = 60;
export const ZOMBIE_ZONE = 0.62;
export const ZOMBIE_MARGIN_FIRST_S = 180;
export const ZOMBIE_MARGIN_LAST_S = -120;
export const ZOMBIE_LOSS_PENALTY = 3;
export const ZOMBIE_TOP_LEVEL = 25; // dernier palier de l'echelle (bloc 21-24 + BOSS 25, Sartay 25/09)
export const ZOMBIE_TIERS = 13; // sprites z01..z13 (palier = ceil(niveau / 2))
const MIN_ZONE_S = 15;
// Temps en plus avant le zombie (Sartay 28/09, en pleine seance) : +1 min a TOUS les niveaux, et encore +2 min
// au niveau 1, +1 min 30 au niveau 2, +1 min au niveau 3. Le zombie marche plus lentement jusqu a la premiere
// fiche : l arrivee au coeur recule d autant, quelle que soit l avance de l equipe.
export const ZOMBIE_BONUS_S = 60;
export const ZOMBIE_EARLY_BONUS_S: Record<number, number> = { 1: 120, 2: 90, 3: 60 };
export const zombieBonusS = (levelNumber: number) => ZOMBIE_BONUS_S + (ZOMBIE_EARLY_BONUS_S[levelNumber] ?? 0);
export const ZOMBIE_REAL_FACTOR = 2.5;
export const ZOMBIE_CARD_S = 25;
export const ZOMBIE_BOSS_FACTOR = 1.9;

export const zombieSpeedLevel = (levelNumber: number, losses: number) => Math.max(1, levelNumber - ZOMBIE_LOSS_PENALTY * losses);
// La marge fond de +3 min (niveau 1) a -2 min (niveau 20) et CONTINUE de fondre jusqu'au niveau 25
// (« toujours plus difficile ») ; la bande garde son plancher (approche + 15 s).
export function zombieMarginS(speedLevel: number): number {
  const t = Math.max(0, (Math.min(speedLevel, ZOMBIE_TOP_LEVEL) - 1) / 19);
  return ZOMBIE_MARGIN_FIRST_S + t * (ZOMBIE_MARGIN_LAST_S - ZOMBIE_MARGIN_FIRST_S);
}
// Bande complete (ms de chrono) et approche : avec une seule fiche (BOSS), le zombie traverse tout d'un
// mouvement uniforme ; sinon il touche la premiere fiche a 1 min, puis la zone en (bande - 1 min).
// `team` = effectif de reference (5, ou 3 pour le petit format) : l'estimation du niveau en depend.
// `cards` = fiches REELLEMENT en jeu pour l'equipe (fiches recues et penalites comprises). Bug corrige le 29/09 : un
// BOSS qui recevait une fiche (fusee, carte jaune) comptait 2 fiches pour le coeur mais 1 pour la marche (approche
// nulle) -> zombie colle au coeur des le depart, une vie perdue toutes les 25-30 s.
export function zombieTimeline(level: FrozenLevel, speedLevel: number, team = DEFAULT_TEAM, cards = activeCards(level).length): { approachMs: number; bandMs: number; n: number } {
  const act = activeCards(level);
  const n = Math.max(1, cards);
  const est = estimateSeconds(level.zombieRef?.length ? level.zombieRef : act.map(({ card }) => ({ reps: card.reps, weight: card.weight })), level.boss, team);
  const bonus = zombieBonusS(level.number) * 1000;
  // Recalage du 29/09 (Sartay : « trop de gens meurent ») sur le rythme REEL de 8 seances : 85 % des equipes bouclent un
  // niveau en ~2,4 x le temps theorique, plus ~20-25 s par fiche au-dela de 4 (relais, deplacements). Le zombie ne passe
  // jamais sous 2,5 x le theorique + 25 s par fiche au-dela de 4 (BOSS : 1,9 x) : au plus ~10 % des equipes rattrapees
  // sur un niveau d apres les temps reels (au lieu de 25 a 65 %), tendu mais jouable jusqu au niveau 15 et plus. Une
  // vie perdue le ralentit encore (+10 % par vie, via le palier).
  const lossesBack = Math.max(0, level.number - speedLevel) / ZOMBIE_LOSS_PENALTY;
  const realistic = (level.boss || n <= 1 ? ZOMBIE_BOSS_FACTOR * est : ZOMBIE_REAL_FACTOR * est + ZOMBIE_CARD_S * Math.max(0, n - 4)) * (1 + 0.1 * lossesBack);
  const band = Math.max(Math.max(est + zombieMarginS(speedLevel), ZOMBIE_APPROACH_S + MIN_ZONE_S) * 1000 + bonus, realistic * 1000);
  return { approachMs: n > 1 ? ZOMBIE_APPROACH_S * 1000 + bonus : 0, bandMs: band, n };
}
// Le coeur a trois morceaux : arrive dessus, le zombie se colle et le mange en ZOMBIE_EAT (30 s au palier 1,
// 10 s au palier 20). L'equipe ne retombe qu'une fois les trois morceaux manges ; si elle eloigne le coeur
// entre-temps (fiche cochee), le zombie repart et le coeur se ressoude.
export const ZOMBIE_EAT_FIRST_S = 30;
export const ZOMBIE_EAT_LAST_S = 10;
export const HEART_BITES = 3;
export function zombieEatMs(speedLevel: number): number {
  const t = Math.min(1, Math.max(0, (speedLevel - 1) / 19));
  return (ZOMBIE_EAT_FIRST_S + t * (ZOMBIE_EAT_LAST_S - ZOMBIE_EAT_FIRST_S)) * 1000;
}
// Le coeur avance avec la DUREE des fiches cochees (`frac` = duree cochee / duree totale du niveau pour
// l'equipe, penalites comprises) : une longue fiche eloigne plus le coeur, une penalite le rapproche.
// Arrivee du zombie au coeur (ms depuis le depart de la tentative).
export function zombieArrivalMs(level: FrozenLevel, frac: number, speedLevel = level.number, n = activeCards(level).length, team = DEFAULT_TEAM): number {
  const { approachMs, bandMs } = zombieTimeline(level, speedLevel, team, n);
  if (n <= 1) return bandMs;
  return approachMs + Math.min(1, Math.max(0, frac)) * (bandMs - approachMs);
}
// Rattrapage = arrivee + coeur entierement mange.
export function zombieDeadlineMs(level: FrozenLevel, frac: number, speedLevel = level.number, n = activeCards(level).length, team = DEFAULT_TEAM): number {
  return zombieArrivalMs(level, frac, speedLevel, n, team) + zombieEatMs(speedLevel);
}
// Simulation d'une tentative (regle de Sartay : le coeur RESTE croque). Le zombie marche vers le coeur ; au
// contact il mange ; si une fiche cochee eloigne le coeur, il repart marcher et reprend le repas ou il en
// etait. Chute quand le temps de repas cumule atteint zombieEatMs. Deterministe a partir des coches.
export type ZombieSim = {
  zombie: number; // position 0..1
  heart: number;
  contact: boolean;
  bites: number; // morceaux manges (0..3)
  eatenMs: number; // temps de repas cumule
  eatMs: number; // repas complet
  catchAtMs: number | null; // instant (depuis le depart de la tentative) de la chute, s'il est deja passe ou fixe
  remainingMs: number; // avant la chute si le coeur n'est plus eloigne (marche restante + repas restant)
};
export type AttemptEvent = { atMs: number; sec: number; kind: "tick" | "penalty" }; // ms depuis le depart de la tentative
export function zombieSim(
  level: FrozenLevel,
  cardsTotalSec: number, // duree totale des fiches PRESENTES au depart de la tentative
  tickEvents: AttemptEvent[], // fiches cochees (doneSec augmente) et penalites ajoutees (total augmente)
  sinceMs: number,
  speedLevel = level.number,
  n = activeCards(level).length,
  team = DEFAULT_TEAM,
  startBites = 0 // morceaux deja manges au niveau precedent (le coeur reste croque, Sartay 27/09)
): ZombieSim {
  const { approachMs, bandMs } = zombieTimeline(level, speedLevel, team, n);
  const eatMs = zombieEatMs(speedLevel);
  const carried = Math.max(0, Math.min(HEART_BITES - 1, Math.floor(startBites)));
  const total = Math.max(1, cardsTotalSec);
  const arrivalFor = (frac: number) => (n <= 1 ? bandMs : approachMs + Math.min(1, Math.max(0, frac)) * (bandMs - approachMs));
  const posFor = (walked: number) => {
    if (n <= 1) return (walked / bandMs) * (1 - ZOMBIE_ZONE);
    if (walked <= approachMs) return (walked / approachMs) * (1 - ZOMBIE_ZONE);
    return 1 - ZOMBIE_ZONE + (ZOMBIE_ZONE * (walked - approachMs)) / (bandMs - approachMs);
  };
  const events = [...tickEvents].filter((e) => e.atMs >= 0).sort((a, b) => a.atMs - b.atMs);
  let walked = 0, eaten = (carried * eatMs) / HEART_BITES, t = 0, doneSec = 0, totalSec = total, catchAt: number | null = null;
  const advance = (until: number) => {
    // De t a until, avec le coeur a la fraction courante : marche puis repas.
    const target = arrivalFor(doneSec / Math.max(1, totalSec));
    let dt = Math.max(0, until - t);
    if (walked < target) { const w = Math.min(dt, target - walked); walked += w; dt -= w; }
    if (dt > 0 && catchAt === null) {
      const need = eatMs - eaten;
      if (dt >= need) { catchAt = until - (dt - need); eaten = eatMs; }
      else eaten += dt;
    }
    t = until;
  };
  for (const e of events) {
    if (e.atMs > sinceMs) break;
    advance(e.atMs);
    if (catchAt !== null) break;
    if (e.kind === "penalty") totalSec += e.sec; // le coeur recule : si le zombie est deja la, il mange tout de suite
    else doneSec += e.sec;
  }
  if (catchAt === null) advance(sinceMs);
  const frac = doneSec / Math.max(1, totalSec);
  const heart = 1 - ZOMBIE_ZONE + ZOMBIE_ZONE * Math.min(1, Math.max(0, frac));
  const target = arrivalFor(frac);
  const contact = catchAt === null && walked >= target - 1e-6;
  const bites = Math.min(HEART_BITES, Math.floor((eaten / eatMs) * HEART_BITES + 1e-9));
  const remainingMs = catchAt !== null ? 0 : Math.max(0, target - walked) + (eatMs - eaten);
  return { zombie: Math.max(0, Math.min(heart, posFor(walked))), heart, contact, bites, eatenMs: eaten, eatMs, catchAtMs: catchAt, remainingMs };
}

// Coeur croque d'un niveau a l'autre (Sartay 27/09 : « le coeur doit rester en l'etat au niveau suivant, sauf si
// l'equipe perd le niveau »). Rejoue, dans l'ordre de l'equipe, chaque niveau boucle depuis la derniere vie
// perdue : les morceaux manges au moment ou le niveau est boucle passent au suivant. Une vie perdue remet un
// coeur neuf. Renvoie les morceaux (0 a 2) deja manges au depart de la tentative en cours. Deterministe : le
// serveur (rattrapages) et l'ecran (affichage) obtiennent le meme coeur.
export function heartCarryBites(
  levels: FrozenLevel[],
  teamId: string,
  ticks: Tick[],
  losses: Loss[] = [],
  penalties: TeamPenalty[] = [],
  speedOf: (level: FrozenLevel, lossesBefore: number) => number = (l, k) => zombieSpeedLevel(l.number, k),
  team = DEFAULT_TEAM
): number {
  const mine = ticks.filter((t) => t.teamId === teamId);
  const lossTimes = losses.filter((l) => l.teamId === teamId).map((l) => l.atMs);
  const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
  let bites = 0;
  let prevEnd = 0; // fin (chrono) du niveau boucle precedent
  for (const l of levels) {
    const act = cardsForTeam(l, teamId, penalties);
    if (!act.length) continue;
    if (!act.every(({ index }) => done.has(`${l.number}_${index}`))) break; // niveau en cours : fin du rejeu
    const idx = new Set(act.map((a) => a.index));
    const end = Math.max(0, ...mine.filter((t) => t.level === l.number && idx.has(t.card)).map((t) => t.atMs));
    const lastLoss = Math.max(-Infinity, ...lossTimes.filter((x) => x <= end));
    if (lastLoss >= prevEnd) bites = 0; // une vie perdue depuis le niveau precedent : coeur neuf
    const start = Math.max(0, prevEnd, lastLoss);
    const ev = attemptEvents(l, teamId, ticks, start, penalties);
    const sim = zombieSim(l, ev.initialTotalSec, ev.events, Math.max(0, end - start), speedOf(l, lossTimes.filter((x) => x <= start).length), act.length, team, bites);
    // Rattrapage que le serveur n'a pas enregistre (zombies coupes a ce moment-la, par ex.) : on ne punit pas deux fois.
    bites = sim.catchAtMs !== null ? 0 : sim.bites;
    prevEnd = end;
  }
  if (lossTimes.some((x) => x >= prevEnd && x > 0)) return 0; // chute depuis le dernier niveau boucle : coeur neuf
  return Math.min(HEART_BITES - 1, bites);
}
// Evenements d'une tentative pour la simulation : fiches du niveau en cours cochees depuis le depart, et
// penalites ajoutees pendant la tentative. Renvoie aussi la duree des fiches presentes AU DEPART.
export function attemptEvents(level: FrozenLevel, teamId: string, ticks: Tick[], attemptStartMs: number, penalties: TeamPenalty[] = []): { events: AttemptEvent[]; initialTotalSec: number } {
  const cards = cardsForTeam(level, teamId, penalties);
  const secOf = new Map(cards.map((x) => [x.index, cardSeconds(x.card)]));
  const mine = penalties.filter((p) => p.teamId === teamId && p.level === level.number);
  const later = mine.filter((p) => typeof p.atMs === "number" && p.atMs >= attemptStartMs);
  const initialTotalSec = cards.reduce((s, x) => s + cardSeconds(x.card), 0) - later.reduce((s, p) => s + p.reps * p.weight, 0);
  // Fiches deja cochees AVANT le depart de la tentative (vie perdue « douce » : l'equipe garde son niveau et ses
  // fiches) : elles comptent des le depart, le coeur est deja eloigne d'autant.
  const doneBefore = ticks.filter((t) => t.teamId === teamId && t.level === level.number && t.atMs < attemptStartMs && secOf.has(t.card)).reduce((s, t) => s + secOf.get(t.card)!, 0);
  const events: AttemptEvent[] = [
    ...(doneBefore > 0 ? [{ atMs: 0, sec: doneBefore, kind: "tick" } as AttemptEvent] : []),
    ...ticks.filter((t) => t.teamId === teamId && t.level === level.number && t.atMs >= attemptStartMs && secOf.has(t.card)).map((t): AttemptEvent => ({ atMs: t.atMs - attemptStartMs, sec: secOf.get(t.card)!, kind: "tick" })),
    ...later.map((p): AttemptEvent => ({ atMs: (p.atMs as number) - attemptStartMs, sec: p.reps * p.weight, kind: "penalty" })),
  ];
  return { events, initialTotalSec };
}

export type ZombieGeometry = { zombie: number; heart: number; remainingMs: number; contact: boolean; bites: number; eatMs: number };
// Positions (0..1 de la piste) du zombie et du coeur pour l'ecran, contact, morceaux manges, temps restant.
export function zombieGeometry(level: FrozenLevel, frac: number, sinceMs: number, speedLevel = level.number, n = activeCards(level).length): ZombieGeometry {
  const { approachMs, bandMs } = zombieTimeline(level, speedLevel, DEFAULT_TEAM, n);
  const f = Math.min(1, Math.max(0, frac));
  const heart = 1 - ZOMBIE_ZONE + ZOMBIE_ZONE * f;
  let zombie: number;
  if (n <= 1) zombie = (sinceMs / bandMs) * (1 - ZOMBIE_ZONE);
  else if (sinceMs <= approachMs) zombie = (sinceMs / approachMs) * (1 - ZOMBIE_ZONE);
  else zombie = 1 - ZOMBIE_ZONE + (ZOMBIE_ZONE * (sinceMs - approachMs)) / (bandMs - approachMs);
  const arrival = zombieArrivalMs(level, f, speedLevel, n);
  const eatMs = zombieEatMs(speedLevel);
  const contact = sinceMs >= arrival;
  const bites = contact ? Math.min(HEART_BITES, Math.floor(((sinceMs - arrival) / eatMs) * HEART_BITES)) : 0;
  return { zombie: Math.max(0, Math.min(heart, zombie)), heart, remainingMs: arrival + eatMs - sinceMs, contact, bites, eatMs };
}
export const zombieTier = (speedLevel: number) => Math.max(1, Math.min(ZOMBIE_TIERS, Math.ceil(speedLevel / 2)));

// ===== Progression d'une equipe =====
export type Tick = { teamId: string; level: number; card: number; atMs: number };
// `soft` (Sartay 28/09) : vie perdue sans descente de niveau (les 5 premieres du WOD principal) ; les fiches
// cochees restent, seul le zombie repart du debut (coeur neuf).
export type Loss = { teamId: string; level: number; atMs: number; soft?: boolean };
export const SOFT_LOSSES = 5;
export const ZOMBIE_COIN_LOSS = 0.5; // part des pieces en banque perdue a chaque vie perdue (WOD principal)
// Regles du 29/09 soir (Sartay : « qu on ne perde plus de pieces avant la 3e vie perdue ») : les 2 premieres vies
// perdues ne coutent aucune piece ; a partir de la 3e, la moitie de la banque a chaque fois.
export const FREE_COIN_LOSSES = 2;
export type TeamProgress = {
  teamId: string;
  completedLevels: number; // niveaux entierement valides, dans l'ordre
  currentLevel: number | null; // niveau en cours (null = echelle terminee)
  currentDone: number; // fiches cochees dans le niveau en cours
  currentTotal: number; // fiches en jeu dans le niveau en cours
  lastTickMs: number | null; // instant (chrono de course) de la derniere fiche cochee
  finishedMs: number | null; // instant ou l'echelle entiere a ete bouclee
  reps: number; // reps validees (fiches entieres), toutes fiches confondues
  workReps: number; // reps validees hors penalites (cordes des cartes jaunes) : departage du classement commun
  weighted: number; // travail cumule (reps x ponderation) des fiches validees
  repsByExercise: Record<string, number>; // par libelle d'exercice
  doneCards: Set<string>; // `${level}_${card}`
  losses: number; // vies perdues (mode zombies)
  attemptStartMs: number; // chrono : depart de la tentative du niveau en cours (fin du precedent ou derniere vie perdue)
  currentDoneSec: number; // duree (s theoriques) des fiches cochees du niveau en cours, penalites comprises
  currentTotalSec: number; // duree totale des fiches du niveau en cours pour l'equipe
  currentFrac: number; // currentDoneSec / currentTotalSec (0 si vide)
};

// Une equipe avance niveau par niveau : le niveau N+1 n'est « en cours » que quand toutes les fiches en jeu
// de N sont cochees. Un niveau sans aucune fiche en jeu est franchi d'office. Des coches orphelines (fiche
// d'un niveau plus loin, ou fiche retiree) comptent dans rien : elles n'arrivent que par une annulation en
// arriere ou un retrait de fiche, et se resorbent d'elles-memes.
export function progressOf(levels: FrozenLevel[], teamId: string, ticks: Tick[], losses: Loss[] = [], penalties: TeamPenalty[] = []): TeamProgress {
  const mine = ticks.filter((t) => t.teamId === teamId);
  const myLosses = losses.filter((l) => l.teamId === teamId);
  const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
  let completed = 0;
  let current: FrozenLevel | null = null;
  let currentDone = 0;
  let currentTotal = 0;
  let currentDoneSec = 0;
  let currentTotalSec = 0;
  for (const l of levels) {
    const act = cardsForTeam(l, teamId, penalties);
    const doneCards = act.filter(({ index }) => done.has(`${l.number}_${index}`));
    if (doneCards.length === act.length) {
      completed++;
      continue;
    }
    current = l;
    currentDone = doneCards.length;
    currentTotal = act.length;
    currentDoneSec = doneCards.reduce((s, x) => s + cardSeconds(x.card), 0);
    currentTotalSec = act.reduce((s, x) => s + cardSeconds(x.card), 0);
    break;
  }
  const finished = !current && levels.length > 0;
  let reps = 0;
  let workReps = 0;
  let weighted = 0;
  const repsByExercise: Record<string, number> = {};
  const counted: number[] = [];
  for (const l of levels) {
    for (const { card, index, kind } of cardsForTeam(l, teamId, penalties)) {
      if (!done.has(`${l.number}_${index}`)) continue;
      reps += card.reps;
      if (kind !== "penalty") workReps += card.reps;
      weighted += card.reps * card.weight;
      repsByExercise[card.label] = (repsByExercise[card.label] ?? 0) + card.reps;
      const t = mine.find((x) => x.level === l.number && x.card === index);
      if (t) counted.push(t.atMs);
    }
  }
  // Depart de la tentative en cours : derniere fiche d'un niveau boucle (ou derniere vie perdue) la plus tardive.
  // Les niveaux « precedents » sont ceux d'avant dans l'ORDRE de l'equipe, pas ceux de plus petit numero :
  // a l'echauffement en differe (3, 4, 6, 1, 2), la serie 1 commence a la fin de la 6, pas au coup d'envoi
  // (bug corrige le 27/09 : le zombie croyait la tentative commencee depuis le debut et devorait l'equipe).
  const before = current ? new Set(levels.slice(0, levels.indexOf(current)).map((l) => l.number)) : new Set<number>();
  const prevTicks = current ? mine.filter((t) => before.has(t.level)).map((t) => t.atMs) : [];
  const attemptStartMs = Math.max(0, ...prevTicks, ...myLosses.map((l) => l.atMs));
  return {
    teamId,
    completedLevels: completed,
    currentLevel: current?.number ?? null,
    currentDone,
    currentTotal,
    lastTickMs: counted.length ? Math.max(...counted) : null,
    finishedMs: finished && counted.length ? Math.max(...counted) : null,
    reps,
    workReps,
    weighted,
    repsByExercise,
    doneCards: done,
    losses: myLosses.length,
    attemptStartMs,
    currentDoneSec,
    currentTotalSec,
    currentFrac: currentTotalSec > 0 ? currentDoneSec / currentTotalSec : 0,
  };
}

// Classement commun du WOD principal (Sartay 29/09 soir : « le classement se fait dorenavant non plus par parcours
// mais sur l'ensemble des equipes du greffier ») : points = somme, sur les niveaux boucles, de (numero du niveau x
// etoiles du parcours ou il a ete boucle) ; puis les reps faites (penalites exclues) ; puis le moins de vies perdues,
// les pieces gagnees, et la derniere coche la plus tot.
export function levelPoints(levels: FrozenLevel[], p: Pick<TeamProgress, "completedLevels">, current: Stars, sw?: StarSwitch | null): number {
  return levels.slice(0, p.completedLevels).reduce((s, l) => s + l.number * starsAtLevel(sw, current, l.number), 0);
}
export function rankGlobal(progress: TeamProgress[], pointsOf: (teamId: string) => number, coinsOf?: (teamId: string) => number): TeamProgress[] {
  const c = (p: TeamProgress) => coinsOf?.(p.teamId) ?? 0;
  const pts = new Map(progress.map((p) => [p.teamId, pointsOf(p.teamId)]));
  return [...progress].sort(
    (a, b) =>
      pts.get(b.teamId)! - pts.get(a.teamId)! ||
      b.workReps - a.workReps ||
      a.losses - b.losses ||
      c(b) - c(a) ||
      (a.lastTickMs ?? Number.POSITIVE_INFINITY) - (b.lastTickMs ?? Number.POSITIVE_INFINITY)
  );
}

// Classement : niveaux boucles, puis le moins de vies perdues, puis le plus de pieces gagnees (Sartay 26/09,
// echauffement compris, depenses ou non), puis fiches cochees dans le niveau en cours, puis la derniere coche
// la plus tot (a egalite de travail, la plus rapide gagne).
export function rankTeams(progress: TeamProgress[], coinsOf?: (teamId: string) => number): TeamProgress[] {
  const c = (p: TeamProgress) => coinsOf?.(p.teamId) ?? 0;
  return [...progress].sort(
    (a, b) =>
      b.completedLevels - a.completedLevels ||
      a.losses - b.losses ||
      c(b) - c(a) ||
      b.currentDone - a.currentDone ||
      (a.lastTickMs ?? Number.POSITIVE_INFINITY) - (b.lastTickMs ?? Number.POSITIVE_INFINITY)
  );
}

// ===== EMOM (finisher, Sartay 24/09) =====
// Vagues cadencees par le chrono : la vague k dure waveMinutes[k] minutes et commence quand la precedente se
// termine, que l'equipe ait fini ou non. Dans une vague les fiches se decouvrent UNE A UNE (la suivante
// apparait quand la precedente est cochee). La derniere vague est un « maximum de reps » saisi par le
// greffier : c'est le score final. Les coches restent des LevelTick (niveau = vague).
export type EmomSettings = { waveMinutes: number[] };
export function readEmom(settings: unknown): EmomSettings | null {
  const raw = (settings as { emom?: { waveMinutes?: unknown } } | null)?.emom;
  if (!raw || !Array.isArray(raw.waveMinutes)) return null;
  const waveMinutes = raw.waveMinutes.filter((n): n is number => typeof n === "number" && n > 0);
  return waveMinutes.length ? { waveMinutes } : null;
}
export function readEmomScores(settings: unknown): Record<string, number> {
  const raw = (settings as { emomScores?: unknown } | null)?.emomScores;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && v >= 0) out[k] = v;
  return out;
}
export type EmomWave = { wave: number; startMs: number; endMs: number };
// Durees arrondies a la milliseconde : les vagues de 40 s sont stockees en fractions de minute (2/3, 4/3...).
export function emomSchedule(waveMinutes: number[]): EmomWave[] {
  let t = 0;
  return waveMinutes.map((m, i) => { const d = Math.round(m * 60_000); const w = { wave: i + 1, startMs: t, endMs: t + d }; t += d; return w; });
}
export const emomTotalMs = (waveMinutes: number[]) => waveMinutes.reduce((s, m) => s + Math.round(m * 60_000), 0);
// Duree d'une vague pour l'ecran : « 40 s », « 1'20 », « 2' ».
export function fmtWaveMin(minutes: number): string {
  const s = Math.round(minutes * 60);
  if (s < 60) return `${s} s`;
  return s % 60 ? `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}` : `${s / 60}'`;
}
// Vague en cours a un instant du chrono ; null = EMOM termine.
export function emomWaveAt(waveMinutes: number[], raceMs: number): EmomWave | null {
  return emomSchedule(waveMinutes).find((w) => raceMs >= w.startMs && raceMs < w.endMs) ?? null;
}
export type EmomTeam = {
  teamId: string;
  wavesDone: number; // vagues entierement bouclees (hors vague « max »)
  doneByWave: number[]; // fiches cochees par vague
  score: number | null; // reps de la vague « max »
  lastTickMs: number | null;
  losses: number; // vagues perdues (zombie du finisher)
};
export function emomProgress(levels: FrozenLevel[], teamId: string, ticks: Tick[], scores: Record<string, number>, losses: Loss[] = []): EmomTeam {
  const mine = ticks.filter((t) => t.teamId === teamId);
  const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
  const doneByWave = levels.map((l) => activeCards(l).filter(({ index }) => done.has(`${l.number}_${index}`)).length);
  const wavesDone = levels.filter((l, i) => activeCards(l).length > 0 && doneByWave[i] === activeCards(l).length).length;
  return { teamId, wavesDone, doneByWave, score: scores[teamId] ?? null, lastTickMs: mine.length ? Math.max(...mine.map((t) => t.atMs)) : null, losses: losses.filter((l) => l.teamId === teamId).length };
}
// Prochaine fiche a decouvrir dans une vague (null = vague bouclee ou sans fiche).
export function emomNextCard(level: FrozenLevel, teamId: string, ticks: Tick[]): { card: FrozenCard; index: number } | null {
  const done = new Set(ticks.filter((t) => t.teamId === teamId && t.level === level.number).map((t) => t.card));
  return activeCards(level).find(({ index }) => !done.has(index)) ?? null;
}
// Classement du finisher : score (max de reps) puis vagues bouclees, puis le moins de vagues perdues, puis la
// derniere coche la plus tot.
export function emomRank(list: EmomTeam[]): EmomTeam[] {
  return [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.wavesDone - a.wavesDone || a.losses - b.losses || (a.lastTickMs ?? Infinity) - (b.lastTickMs ?? Infinity));
}

// ===== Zombies du finisher (Sartay 25/09) : un zombie du palier 10 par vague =====
// Le zombie part de la gauche au debut de chaque vague et atteint le coeur `eatMs` avant la fin de la
// vague ; il le devore (vie perdue, LevelLoss niveau = vague) si l'equipe n'a pas coche toutes les fiches
// de la vague quand elle se termine. Une vague bouclee fige le zombie sur place. La vague « max » n'a pas de
// fiche : le zombie se contente d'arriver au coeur a la fin, sans mordre. Chaque fiche cochee eloigne le
// coeur (fraction par duree), comme dans le WOD principal.
export const EMOM_ZOMBIE_SPEED = 20; // palier 10 (zombieTier(20) = 10)
export type EmomZombieSim = { zombie: number; heart: number; contact: boolean; bites: number; eatMs: number; eatenMs: number; catchAtMs: number | null; done: boolean; remainingMs: number };
export function emomWaveEvents(level: FrozenLevel, teamId: string, ticks: Tick[], wave: EmomWave): { atMs: number; sec: number }[] {
  const secOf = new Map(activeCards(level).map((x) => [x.index, cardSeconds(x.card)]));
  return ticks
    .filter((t) => t.teamId === teamId && t.level === level.number && t.atMs >= wave.startMs && t.atMs <= wave.endMs && secOf.has(t.card))
    .map((t) => ({ atMs: t.atMs - wave.startMs, sec: secOf.get(t.card)! }))
    .sort((a, b) => a.atMs - b.atMs);
}
export function emomZombieSim(waveMs: number, n: number, totalSec: number, events: { atMs: number; sec: number }[], sinceMs: number, speedLevel = EMOM_ZOMBIE_SPEED): EmomZombieSim {
  const eatMs = zombieEatMs(speedLevel);
  const since = Math.max(0, Math.min(sinceMs, waveMs));
  const seen = [...events].sort((a, b) => a.atMs - b.atMs).filter((e) => e.atMs <= since);
  const doneSec = seen.reduce((s, e) => s + e.sec, 0);
  const done = n > 0 && seen.length >= n;
  const doneAt = done ? seen[n - 1].atMs : null;
  const arrival = n === 0 ? waveMs : Math.max(0, waveMs - eatMs);
  const stopAt = doneAt !== null ? Math.min(since, doneAt) : since;
  const walked = Math.min(stopAt, arrival);
  const frac = totalSec > 0 ? Math.min(1, doneSec / totalSec) : 0;
  const heart = 1 - ZOMBIE_ZONE + ZOMBIE_ZONE * frac;
  const zombie = arrival > 0 ? (walked / arrival) * heart : heart;
  const contact = !done && n > 0 && since >= arrival;
  const eaten = contact ? Math.min(eatMs, since - arrival) : 0;
  const bites = Math.min(HEART_BITES, Math.floor((eaten / eatMs) * HEART_BITES));
  const catchAt = !done && n > 0 && sinceMs >= waveMs ? waveMs : null;
  return { zombie, heart, contact, bites, eatMs, eatenMs: eaten, catchAtMs: catchAt, done, remainingMs: done ? Infinity : Math.max(0, waveMs - since) };
}

// ===== Pieces et fusees (Sartay 26/09) =====
// Boucler un niveau rapporte des pieces selon le TEMPS RESTANT par rapport au temps theorique du niveau
// (somme reps x ponderation, en secondes, fiches de l'equipe comprises) : 90-100 % restants = 100 % des
// pieces, 80-89 % = 90 %, ... 0-9 % = 10 %, temps depasse = 0. Pieces en jeu = 10 x numero du niveau
// (echauffement : 10 par serie, 20 au BOSS). Gains arrondis vers le bas. Les pieces gagnees ne baissent jamais
// (elles comptent au classement) ; la banque = gagnees + report de l'echauffement - depenses.
export const ROCKET_PRICE = 100;
export const MASTERY_COUNT = 3; // un exercice fait 3 fois (3 fiches cochees) devient envoyable
export const DISCOUNT_STEPS = [5, 10, 25, 50, 100]; // reps retirees d'un coup a la fiche la plus a droite
export const SEND_WORK_STEPS = [50, 100, 150, 200, 300]; // secondes de travail envoyees par la fusee (ancien menu manuel)
// ===== Fusee automatique (Sartay 28/09) =====
// Plus de menu : des qu'elle est construite, la fusee decolle toute seule vers une equipe tiree au sort dans le
// top 4 de son parcours (jamais elle-meme, jamais l'equipe touchee par la fusee precedente). Charge : un exercice
// que l'equipe maitrise, d'autant plus « gros » (pondere) qu'elle a de pieces, et d'autant moins de reps qu'il
// est gros : ~150 s de travail, entre 5 et 50 reps, multiples de 5.
export const ROCKET_TOP = 4;
export const ROCKET_WORK_S = 150;
export const ROCKET_RICH_SPAN = 800; // pieces (score) au-dela du prix de la fusee pour atteindre l'exercice le plus lourd
export function rocketPayload(mastered: Mastered[], score: number): (Mastered & { reps: number }) | null {
  if (!mastered.length) return null;
  const sorted = [...mastered].sort((a, b) => a.weight - b.weight || a.label.localeCompare(b.label, "fr"));
  const f = Math.max(0, Math.min(1, (score - ROCKET_PRICE) / ROCKET_RICH_SPAN));
  const pick = sorted[Math.round(f * (sorted.length - 1))];
  const reps = Math.max(5, Math.min(50, Math.round(ROCKET_WORK_S / Math.max(0.1, pick.weight) / 5) * 5));
  return { ...pick, reps };
}
// Cible d'une fusee (Sartay 28/09, la fusee part au clic) : 1) le concurrent direct (top 4 : l'equipe juste devant,
// le premier vise le deuxieme ; au-dela : la plus proche hors top 4, jamais la derniere) ; 2) sinon le top 4 en partant du
// premier ; 3) sinon au hasard (jamais la derniere). Toujours : ni soi, ni l'equipe touchee par la fusee
// precedente du parcours, ni une equipe arrivee au bout ou sur son dernier niveau. Parcours avec moins de deux
// adversaires : toutes les equipes.
export function pickRocketTarget<T extends { teamId: string; group: string; rankInGroup: number; groupSize: number; finished: boolean; hasNext: boolean }>(fromTeamId: string, teams: T[], sendTargets: string[], random: () => number = Math.random): { target: T; why: "rival" | "top" | "random" } | null {
  const me = teams.find((t) => t.teamId === fromTeamId);
  if (!me) return null;
  const same = teams.filter((t) => t.group === me.group && t.teamId !== fromTeamId);
  const base = same.length >= 2 ? same : teams.filter((t) => t.teamId !== fromTeamId);
  const ids = new Set(base.map((t) => t.teamId));
  const last = [...sendTargets].reverse().find((id) => ids.has(id)) ?? null;
  const ok = (t: T) => !t.finished && t.hasNext && t.teamId !== last;
  const isLast = (t: T) => t.groupSize > 1 && t.rankInGroup === t.groupSize;
  // Concurrent direct. Top 4 (Sartay 28/09) : l equipe juste devant (4 sur 3, 3 sur 2, 2 sur 1), le premier sur le
  // deuxieme. Au-dela du top 4 : l equipe la plus proche hors top 4, jamais la derniere (a egalite, celle de devant).
  const rival = me.rankInGroup <= ROCKET_TOP
    ? base.filter((t) => t.group === me.group).find((t) => t.rankInGroup === (me.rankInGroup === 1 ? 2 : me.rankInGroup - 1) && ok(t) && !isLast(t))
    : base
        .filter((t) => ok(t) && t.rankInGroup > ROCKET_TOP && !isLast(t))
        .sort((a, b) => Math.abs(a.rankInGroup - me.rankInGroup) - Math.abs(b.rankInGroup - me.rankInGroup) || a.rankInGroup - b.rankInGroup)[0];
  if (rival) return { target: rival, why: "rival" };
  const top = base.filter((t) => ok(t) && t.rankInGroup <= ROCKET_TOP && !isLast(t)).sort((a, b) => a.rankInGroup - b.rankInGroup)[0];
  if (top) return { target: top, why: "top" };
  const rest = base.filter((t) => ok(t) && !isLast(t));
  return rest.length ? { target: rest[Math.floor(random() * rest.length)], why: "random" } : null;
}

// Cibles possibles : le top 4 du parcours de l'expediteur (tout le monde s'il y a moins de deux adversaires),
// sans lui-meme, sans l'equipe touchee par la fusee precedente, sans les equipes arrivees au bout ou sur leur
// dernier niveau (la fiche recue arrive au niveau suivant). `sendTargets` : cibles des fusees, dans l'ordre.
export function autoRocketPool<T extends { teamId: string; group: string; rankInGroup: number; finished: boolean; hasNext: boolean }>(fromTeamId: string, teams: T[], sendTargets: string[]): T[] {
  const me = teams.find((t) => t.teamId === fromTeamId);
  if (!me) return [];
  const same = teams.filter((t) => t.group === me.group && t.teamId !== fromTeamId);
  const base = same.length >= 2 ? same : teams.filter((t) => t.teamId !== fromTeamId);
  const ids = new Set(base.map((t) => t.teamId));
  const last = [...sendTargets].reverse().find((id) => ids.has(id)) ?? null;
  return [...base]
    .sort((a, b) => a.rankInGroup - b.rankInGroup)
    .slice(0, ROCKET_TOP)
    .filter((t) => t.teamId !== last && !t.finished && t.hasNext);
}
// Finisher : cordes de la derniere vague saisies joueur par joueur (tout le monde en meme temps).
export function readEmomPlayerScores(settings: unknown): Record<string, Record<string, number>> {
  const raw = (settings as { emomPlayerScores?: unknown } | null)?.emomPlayerScores;
  const out: Record<string, Record<string, number>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [teamId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const m: Record<string, number> = {};
    for (const [uid, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === "number" && Number.isInteger(n) && n >= 0) m[uid] = n;
    out[teamId] = m;
  }
  return out;
}
export const coinsInPlay = (levelNumber: number) => 10 * levelNumber;
export const warmupCoinsInPlay = (levelNumber: number) => (isBoss(levelNumber) ? 20 : 10);
export const coinsPct = (remaining: number) => (remaining <= 0 ? 0 : Math.min(100, Math.ceil(remaining * 10 - 1e-9) * 10));
export type CoinLevel = { level: number; coins: number; pct: number; elapsedMs: number; workMs: number };
export type CoinsEarned = { total: number; perLevel: CoinLevel[] };
// Pieces gagnees par une equipe, deduites des coches (rien a stocker) : pour chaque niveau boucle, dans l'ordre
// de l'equipe, le temps entre le depart de sa tentative (fin du niveau precedent ou derniere vie perdue) et sa
// derniere coche, rapporte au temps theorique du niveau tel qu'elle l'a joue.
export function coinsEarned(levels: FrozenLevel[], teamId: string, ticks: Tick[], losses: Loss[] = [], extras: TeamPenalty[] = [], inPlay: (levelNumber: number) => number = coinsInPlay): CoinsEarned {
  const mine = ticks.filter((t) => t.teamId === teamId);
  // Seule une vie perdue AVEC descente relance le chrono des pieces d'un niveau : apres une vie « douce », l'equipe
  // continue le meme niveau, son temps court toujours depuis la fin du niveau precedent.
  const myLosses = losses.filter((l) => l.teamId === teamId && !l.soft).map((l) => l.atMs);
  const perLevel: CoinLevel[] = [];
  let prevEnd = 0;
  let total = 0;
  for (const l of levels) {
    const cards = cardsForTeam(l, teamId, extras);
    if (!cards.length) continue;
    const ticked = cards.map(({ index }) => mine.find((t) => t.level === l.number && t.card === index)).filter((t): t is Tick => !!t);
    if (ticked.length < cards.length) break;
    const lastTick = Math.max(...ticked.map((t) => t.atMs));
    const start = Math.max(prevEnd, ...myLosses.filter((a) => a < lastTick));
    const elapsedMs = Math.max(0, lastTick - start);
    const workMs = cards.reduce((s, x) => s + cardSeconds(x.card), 0) * 1000;
    const pct = coinsPct(workMs > 0 ? (workMs - elapsedMs) / workMs : 0);
    const coins = Math.floor((inPlay(l.number) * pct) / 100);
    perLevel.push({ level: l.number, coins, pct, elapsedMs, workMs });
    total += coins;
    prevEnd = lastTick;
  }
  return { total, perLevel };
}
// « zombie » (Sartay 28/09) : la moitie des pieces en banque perdue a chaque vie perdue au WOD principal (id = la
// vie perdue, pour ne jamais la compter deux fois).
export type CoinEvent = { id: string; teamId: string; kind: "discount" | "rocket" | "send" | "zombie"; coins: number; at: number; toTeamId?: string; label?: string; reps?: number; giftId?: string; level?: number; index?: number };
export function readCoinEvents(settings: unknown): CoinEvent[] {
  const raw = (settings as { coinEvents?: unknown } | null)?.coinEvents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is CoinEvent => !!e && typeof e === "object" && typeof (e as CoinEvent).teamId === "string" && typeof (e as CoinEvent).coins === "number" && ["discount", "rocket", "send", "zombie"].includes((e as CoinEvent).kind));
}
export function readCoinsCarry(settings: unknown): Record<string, number> {
  const raw = (settings as { coinsCarry?: unknown } | null)?.coinsCarry;
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && v >= 0) out[k] = Math.floor(v);
  return out;
}
// `lost` = pieces mangees par le zombie (vies perdues) : elles sortent de la banque ET du score de classement
// (`score` = gagnees + report - perdues ; les pieces depensees, elles, comptent toujours au classement).
export type CoinsState = { earned: number; carry: number; spent: number; lost: number; score: number; bank: number; rockets: number; sends: number; stock: number; perLevel: CoinLevel[] };
export function coinsState(levels: FrozenLevel[], teamId: string, ticks: Tick[], losses: Loss[], extras: TeamPenalty[], events: CoinEvent[], carry: Record<string, number>, inPlay: (levelNumber: number) => number = coinsInPlay): CoinsState {
  const e = coinsEarned(levels, teamId, ticks, losses, extras, inPlay);
  const mine = events.filter((x) => x.teamId === teamId);
  const spent = mine.filter((x) => x.kind !== "zombie").reduce((s, x) => s + x.coins, 0);
  const lost = mine.filter((x) => x.kind === "zombie").reduce((s, x) => s + x.coins, 0);
  const rockets = mine.filter((x) => x.kind === "rocket").length;
  const sends = mine.filter((x) => x.kind === "send").length;
  const c = carry[teamId] ?? 0;
  return { earned: e.total, carry: c, spent, lost, score: Math.max(0, e.total + c - lost), bank: Math.max(0, e.total + c - spent - lost), rockets, sends, stock: Math.max(0, rockets - sends), perLevel: e.perLevel };
}
// Reps « rondes » pour une duree de travail : dizaines (ponderation <= 3), multiples de 5 (4 a 8), unites au-dela.
export function roundRepsFor(weight: number, seconds: number): number {
  const step = weight <= 3 ? 10 : weight <= 8 ? 5 : 1;
  return Math.max(step, Math.round(seconds / weight / step) * step);
}
// Exercices maitrises par une equipe : au moins MASTERY_COUNT fiches cochees de cet exercice (echelle et fiches recues).
export type Mastered = { exerciseId: string; label: string; weight: number; count: number };
export function masteredExercises(levels: FrozenLevel[], teamId: string, ticks: Tick[], extras: TeamPenalty[] = []): Mastered[] {
  const mine = new Set(ticks.filter((t) => t.teamId === teamId).map((t) => `${t.level}_${t.card}`));
  const m = new Map<string, Mastered>();
  for (const l of levels) for (const { card, index, kind } of cardsForTeam(l, teamId, extras)) {
    if (kind === "penalty" || !mine.has(`${l.number}_${index}`)) continue;
    const cur = m.get(card.label) ?? { exerciseId: card.exerciseId, label: card.label, weight: card.weight, count: 0 };
    cur.count++;
    m.set(card.label, cur);
  }
  return [...m.values()].filter((x) => x.count >= MASTERY_COUNT).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}
// Choix d'envoi pour un exercice : reps rondes par palier de travail, avec leur prix (reps x ponderation).
export const sendOptions = (weight: number) => [...new Set(SEND_WORK_STEPS.map((w) => roundRepsFor(weight, w)))].map((reps) => ({ reps, price: reps * weight }));
// La fiche la plus a droite de la ligne = la fiche de l'echelle restante la plus longue (les penalites et les
// fiches recues sont a gauche, juste derriere le coeur) : c'est elle que les pieces allegent.
export function rightmostCard(level: FrozenLevel, teamId: string, extras: TeamPenalty[], doneCards: Set<string>): TeamCard | null {
  return cardsForTeam(level, teamId, extras)
    .filter((x) => x.kind === "base" && !doneCards.has(`${level.number}_${x.index}`) && x.card.reps > 1)
    .sort((a, b) => cardSeconds(b.card) - cardSeconds(a.card) || b.card.reps - a.card.reps || a.index - b.index)[0] ?? null;
}
// Cibles d'une fusee : meme parcours que l'expediteur (sauf s'il y a moins de deux adversaires dans ce parcours :
// tout le monde), jamais la derniere equipe de son parcours, jamais soi-meme, jamais une equipe arrivee au bout.
// `group` = parcours + format (parcoursKey) : une fusee vise d'abord son propre groupe.
export function rocketTargets<T extends { teamId: string; group: string; rankInGroup: number; groupSize: number; finished: boolean }>(fromTeamId: string, teams: T[]): T[] {
  const me = teams.find((t) => t.teamId === fromTeamId);
  if (!me) return [];
  const sameGroup = teams.filter((t) => t.group === me.group && t.teamId !== fromTeamId);
  const pool = sameGroup.length >= 2 ? sameGroup : teams.filter((t) => t.teamId !== fromTeamId);
  // La derniere equipe d'un parcours est intouchable, meme si elle y est seule (elle est alors aussi la derniere).
  return pool.filter((t) => !t.finished && t.rankInGroup !== t.groupSize);
}

// Libelle court d'un niveau pour les tuiles et les classements.
export function levelLabel(l: FrozenLevel | null | undefined): string {
  if (!l) return "🏁";
  return `${l.boss ? "BOSS " : "Niv. "}${l.number}`;
}
