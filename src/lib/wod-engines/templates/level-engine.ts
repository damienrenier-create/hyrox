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
export type FrozenLevel = { number: number; name: string | null; boss: boolean; cards: FrozenCard[] };

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
    const o = l as { number?: unknown; name?: unknown; cards?: unknown };
    if (typeof o.number !== "number") continue;
    const cards: FrozenCard[] = [];
    for (const c of Array.isArray(o.cards) ? o.cards : []) {
      const k = c as { exerciseId?: unknown; reps?: unknown; label?: unknown; weight?: unknown; off?: unknown };
      if (typeof k.exerciseId !== "string" || typeof k.reps !== "number" || typeof k.label !== "string" || typeof k.weight !== "number") continue;
      cards.push({ exerciseId: k.exerciseId, reps: k.reps, label: k.label, weight: k.weight, ...(k.off === true ? { off: true } : {}) });
    }
    out.push({ number: o.number, name: typeof o.name === "string" ? o.name : null, boss: isBoss(o.number), cards });
  }
  return out.sort((a, b) => a.number - b.number);
}

// ===== Parcours 1, 2 ou 3 etoiles (Sartay 25/09) =====
// Trois echelles vivent cote a cote : 1 etoile (peu de force et de technique), 2 etoiles (equilibree), 3 etoiles
// (force et cardio). Une seance fige les trois (settings.levels = 2 etoiles, settings.ladders = { "1": [...],
// "3": [...] }) et chaque equipe joue sur le parcours de settings.teamStars[teamId] (2 par defaut).
export type Stars = 1 | 2 | 3;
export const STARS: Stars[] = [1, 2, 3];
export const DEFAULT_STARS: Stars = 2;
export const starsLabel = (s: Stars) => "★".repeat(s) + "☆".repeat(3 - s);
export const starsName = (s: Stars) => (s === 1 ? "1 étoile" : `${s} étoiles`);
export function readTeamStars(settings: unknown): Record<string, Stars> {
  const raw = (settings as { teamStars?: unknown } | null)?.teamStars;
  const out: Record<string, Stars> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === 1 || v === 2 || v === 3) out[k] = v;
  return out;
}
export const teamStarsOf = (teamStars: Record<string, Stars>, teamId: string): Stars => teamStars[teamId] ?? DEFAULT_STARS;
// Echelles figees des parcours 1 et 3 etoiles (le 2 etoiles est settings.levels).
export function readLadders(settings: unknown): Partial<Record<Stars, FrozenLevel[]>> {
  const raw = (settings as { ladders?: unknown } | null)?.ladders;
  const out: Partial<Record<Stars, FrozenLevel[]>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const s of STARS) {
    const l = readFrozenLevels((raw as Record<string, unknown>)[String(s)]);
    if (l.length) out[s] = l;
  }
  return out;
}
// Echelle d'un parcours : celle du parcours si elle est figee, sinon l'echelle 2 etoiles.
export function ladderFor(levels: FrozenLevel[], ladders: Partial<Record<Stars, FrozenLevel[]>>, stars: Stars): FrozenLevel[] {
  return (stars === DEFAULT_STARS ? levels : ladders[stars]) ?? levels;
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

export const zombieSpeedLevel = (levelNumber: number, losses: number) => Math.max(1, levelNumber - ZOMBIE_LOSS_PENALTY * losses);
// La marge fond de +3 min (niveau 1) a -2 min (niveau 20) et CONTINUE de fondre jusqu'au niveau 25
// (« toujours plus difficile ») ; la bande garde son plancher (approche + 15 s).
export function zombieMarginS(speedLevel: number): number {
  const t = Math.max(0, (Math.min(speedLevel, ZOMBIE_TOP_LEVEL) - 1) / 19);
  return ZOMBIE_MARGIN_FIRST_S + t * (ZOMBIE_MARGIN_LAST_S - ZOMBIE_MARGIN_FIRST_S);
}
// Bande complete (ms de chrono) et approche : avec une seule fiche (BOSS), le zombie traverse tout d'un
// mouvement uniforme ; sinon il touche la premiere fiche a 1 min, puis la zone en (bande - 1 min).
export function zombieTimeline(level: FrozenLevel, speedLevel: number): { approachMs: number; bandMs: number; n: number } {
  const act = activeCards(level);
  const n = Math.max(1, act.length);
  const est = estimateSeconds(act.map(({ card }) => ({ reps: card.reps, weight: card.weight })), level.boss);
  const band = Math.max(est + zombieMarginS(speedLevel), ZOMBIE_APPROACH_S + MIN_ZONE_S) * 1000;
  return { approachMs: n > 1 ? ZOMBIE_APPROACH_S * 1000 : 0, bandMs: band, n };
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
export function zombieArrivalMs(level: FrozenLevel, frac: number, speedLevel = level.number, n = activeCards(level).length): number {
  const { approachMs, bandMs } = zombieTimeline(level, speedLevel);
  if (n <= 1) return bandMs;
  return approachMs + Math.min(1, Math.max(0, frac)) * (bandMs - approachMs);
}
// Rattrapage = arrivee + coeur entierement mange.
export function zombieDeadlineMs(level: FrozenLevel, frac: number, speedLevel = level.number, n = activeCards(level).length): number {
  return zombieArrivalMs(level, frac, speedLevel, n) + zombieEatMs(speedLevel);
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
  n = activeCards(level).length
): ZombieSim {
  const { approachMs, bandMs } = zombieTimeline(level, speedLevel);
  const eatMs = zombieEatMs(speedLevel);
  const total = Math.max(1, cardsTotalSec);
  const arrivalFor = (frac: number) => (n <= 1 ? bandMs : approachMs + Math.min(1, Math.max(0, frac)) * (bandMs - approachMs));
  const posFor = (walked: number) => {
    if (n <= 1) return (walked / bandMs) * (1 - ZOMBIE_ZONE);
    if (walked <= approachMs) return (walked / approachMs) * (1 - ZOMBIE_ZONE);
    return 1 - ZOMBIE_ZONE + (ZOMBIE_ZONE * (walked - approachMs)) / (bandMs - approachMs);
  };
  const events = [...tickEvents].filter((e) => e.atMs >= 0).sort((a, b) => a.atMs - b.atMs);
  let walked = 0, eaten = 0, t = 0, doneSec = 0, totalSec = total, catchAt: number | null = null;
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
  const bites = Math.min(HEART_BITES, Math.floor((eaten / eatMs) * HEART_BITES));
  const remainingMs = catchAt !== null ? 0 : Math.max(0, target - walked) + (eatMs - eaten);
  return { zombie: Math.max(0, Math.min(heart, posFor(walked))), heart, contact, bites, eatenMs: eaten, eatMs, catchAtMs: catchAt, remainingMs };
}
// Evenements d'une tentative pour la simulation : fiches du niveau en cours cochees depuis le depart, et
// penalites ajoutees pendant la tentative. Renvoie aussi la duree des fiches presentes AU DEPART.
export function attemptEvents(level: FrozenLevel, teamId: string, ticks: Tick[], attemptStartMs: number, penalties: TeamPenalty[] = []): { events: AttemptEvent[]; initialTotalSec: number } {
  const cards = cardsForTeam(level, teamId, penalties);
  const secOf = new Map(cards.map((x) => [x.index, cardSeconds(x.card)]));
  const mine = penalties.filter((p) => p.teamId === teamId && p.level === level.number);
  const later = mine.filter((p) => typeof p.atMs === "number" && p.atMs >= attemptStartMs);
  const initialTotalSec = cards.reduce((s, x) => s + cardSeconds(x.card), 0) - later.reduce((s, p) => s + p.reps * p.weight, 0);
  const events: AttemptEvent[] = [
    ...ticks.filter((t) => t.teamId === teamId && t.level === level.number && t.atMs >= attemptStartMs && secOf.has(t.card)).map((t): AttemptEvent => ({ atMs: t.atMs - attemptStartMs, sec: secOf.get(t.card)!, kind: "tick" })),
    ...later.map((p): AttemptEvent => ({ atMs: (p.atMs as number) - attemptStartMs, sec: p.reps * p.weight, kind: "penalty" })),
  ];
  return { events, initialTotalSec };
}

export type ZombieGeometry = { zombie: number; heart: number; remainingMs: number; contact: boolean; bites: number; eatMs: number };
// Positions (0..1 de la piste) du zombie et du coeur pour l'ecran, contact, morceaux manges, temps restant.
export function zombieGeometry(level: FrozenLevel, frac: number, sinceMs: number, speedLevel = level.number, n = activeCards(level).length): ZombieGeometry {
  const { approachMs, bandMs } = zombieTimeline(level, speedLevel);
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
export type Loss = { teamId: string; level: number; atMs: number };
export type TeamProgress = {
  teamId: string;
  completedLevels: number; // niveaux entierement valides, dans l'ordre
  currentLevel: number | null; // niveau en cours (null = echelle terminee)
  currentDone: number; // fiches cochees dans le niveau en cours
  currentTotal: number; // fiches en jeu dans le niveau en cours
  lastTickMs: number | null; // instant (chrono de course) de la derniere fiche cochee
  finishedMs: number | null; // instant ou l'echelle entiere a ete bouclee
  reps: number; // reps validees (fiches entieres), toutes fiches confondues
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
  let weighted = 0;
  const repsByExercise: Record<string, number> = {};
  const counted: number[] = [];
  for (const l of levels) {
    for (const { card, index } of cardsForTeam(l, teamId, penalties)) {
      if (!done.has(`${l.number}_${index}`)) continue;
      reps += card.reps;
      weighted += card.reps * card.weight;
      repsByExercise[card.label] = (repsByExercise[card.label] ?? 0) + card.reps;
      const t = mine.find((x) => x.level === l.number && x.card === index);
      if (t) counted.push(t.atMs);
    }
  }
  // Depart de la tentative en cours : derniere fiche d'un niveau boucle (ou derniere vie perdue) la plus tardive.
  const prevTicks = current ? mine.filter((t) => t.level < current.number).map((t) => t.atMs) : [];
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
export function emomSchedule(waveMinutes: number[]): EmomWave[] {
  let t = 0;
  return waveMinutes.map((m, i) => { const w = { wave: i + 1, startMs: t, endMs: t + m * 60_000 }; t += m * 60_000; return w; });
}
export const emomTotalMs = (waveMinutes: number[]) => waveMinutes.reduce((s, m) => s + m * 60_000, 0);
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
export const SEND_WORK_STEPS = [50, 100, 150, 200, 300]; // secondes de travail envoyees par la fusee
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
  const myLosses = losses.filter((l) => l.teamId === teamId).map((l) => l.atMs);
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
export type CoinEvent = { id: string; teamId: string; kind: "discount" | "rocket" | "send"; coins: number; at: number; toTeamId?: string; label?: string; reps?: number; giftId?: string; level?: number; index?: number };
export function readCoinEvents(settings: unknown): CoinEvent[] {
  const raw = (settings as { coinEvents?: unknown } | null)?.coinEvents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is CoinEvent => !!e && typeof e === "object" && typeof (e as CoinEvent).teamId === "string" && typeof (e as CoinEvent).coins === "number" && ["discount", "rocket", "send"].includes((e as CoinEvent).kind));
}
export function readCoinsCarry(settings: unknown): Record<string, number> {
  const raw = (settings as { coinsCarry?: unknown } | null)?.coinsCarry;
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && v >= 0) out[k] = Math.floor(v);
  return out;
}
export type CoinsState = { earned: number; carry: number; spent: number; bank: number; rockets: number; sends: number; stock: number; perLevel: CoinLevel[] };
export function coinsState(levels: FrozenLevel[], teamId: string, ticks: Tick[], losses: Loss[], extras: TeamPenalty[], events: CoinEvent[], carry: Record<string, number>, inPlay: (levelNumber: number) => number = coinsInPlay): CoinsState {
  const e = coinsEarned(levels, teamId, ticks, losses, extras, inPlay);
  const mine = events.filter((x) => x.teamId === teamId);
  const spent = mine.reduce((s, x) => s + x.coins, 0);
  const rockets = mine.filter((x) => x.kind === "rocket").length;
  const sends = mine.filter((x) => x.kind === "send").length;
  const c = carry[teamId] ?? 0;
  return { earned: e.total, carry: c, spent, bank: Math.max(0, e.total + c - spent), rockets, sends, stock: Math.max(0, rockets - sends), perLevel: e.perLevel };
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
export function rocketTargets<T extends { teamId: string; stars: Stars; rankInStars: number; groupSize: number; finished: boolean }>(fromTeamId: string, teams: T[]): T[] {
  const me = teams.find((t) => t.teamId === fromTeamId);
  if (!me) return [];
  const sameGroup = teams.filter((t) => t.stars === me.stars && t.teamId !== fromTeamId);
  const pool = sameGroup.length >= 2 ? sameGroup : teams.filter((t) => t.teamId !== fromTeamId);
  return pool.filter((t) => !t.finished && !(t.groupSize > 1 && t.rankInStars === t.groupSize));
}

// Libelle court d'un niveau pour les tuiles et les classements.
export function levelLabel(l: FrozenLevel | null | undefined): string {
  if (!l) return "🏁";
  return `${l.boss ? "BOSS " : "Niv. "}${l.number}`;
}
