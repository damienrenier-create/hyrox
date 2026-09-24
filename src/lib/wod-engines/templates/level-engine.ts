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

// Fiches encore en jeu d'un niveau, avec leur index d'origine (les coches referencent cet index).
export const activeCards = (l: FrozenLevel) => l.cards.map((c, i) => ({ card: c, index: i })).filter((x) => !x.card.off);

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

// ===== Mode zombies =====
export const ZOMBIE_GRACE_S = 180; // le zombie met « duree estimee du niveau + 3 min » a atteindre le coeur
// Delai (ms de chrono) entre le depart d'une tentative et le rattrapage : chaque fiche cochee eloigne le
// coeur d'un cran (les fiches occupent la moitie droite de la piste, une fiche = 1/n de cette moitie).
export function zombieDeadlineMs(level: FrozenLevel, done: number): number {
  const act = activeCards(level);
  const base = (estimateSeconds(act.map(({ card }) => ({ reps: card.reps, weight: card.weight })), level.boss) + ZOMBIE_GRACE_S) * 1000;
  return act.length ? base * (1 + done / act.length) : base;
}
// Position du zombie (0..1 de la piste) et du coeur pour l'ecran : la moitie gauche de la piste est
// parcourue en « base » ms ; le coeur part au milieu et recule d'une demi-fiche par fiche cochee.
export function zombieGeometry(level: FrozenLevel, done: number, sinceMs: number): { zombie: number; heart: number; remainingMs: number } {
  const act = activeCards(level);
  const n = Math.max(1, act.length);
  const base = zombieDeadlineMs(level, 0);
  const heart = 0.5 + (0.5 * done) / n;
  const zombie = Math.min(heart, base > 0 ? (0.5 * sinceMs) / base : 0);
  return { zombie, heart, remainingMs: zombieDeadlineMs(level, done) - sinceMs };
}
export const zombieTier = (levelNumber: number) => Math.max(1, Math.min(10, Math.ceil(levelNumber / 2)));

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
};

// Une equipe avance niveau par niveau : le niveau N+1 n'est « en cours » que quand toutes les fiches en jeu
// de N sont cochees. Un niveau sans aucune fiche en jeu est franchi d'office. Des coches orphelines (fiche
// d'un niveau plus loin, ou fiche retiree) comptent dans rien : elles n'arrivent que par une annulation en
// arriere ou un retrait de fiche, et se resorbent d'elles-memes.
export function progressOf(levels: FrozenLevel[], teamId: string, ticks: Tick[], losses: Loss[] = []): TeamProgress {
  const mine = ticks.filter((t) => t.teamId === teamId);
  const myLosses = losses.filter((l) => l.teamId === teamId);
  const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
  let completed = 0;
  let current: FrozenLevel | null = null;
  let currentDone = 0;
  let currentTotal = 0;
  for (const l of levels) {
    const act = activeCards(l);
    const n = act.filter(({ index }) => done.has(`${l.number}_${index}`)).length;
    if (n === act.length) {
      completed++;
      continue;
    }
    current = l;
    currentDone = n;
    currentTotal = act.length;
    break;
  }
  const finished = !current && levels.length > 0;
  let reps = 0;
  let weighted = 0;
  const repsByExercise: Record<string, number> = {};
  const counted: number[] = [];
  for (const l of levels) {
    for (const { card, index } of activeCards(l)) {
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
  };
}

// Classement : niveaux boucles, puis le moins de vies perdues, puis fiches cochees dans le niveau en cours,
// puis la derniere coche la plus tot (a egalite de travail, la plus rapide gagne).
export function rankTeams(progress: TeamProgress[]): TeamProgress[] {
  return [...progress].sort(
    (a, b) =>
      b.completedLevels - a.completedLevels ||
      a.losses - b.losses ||
      b.currentDone - a.currentDone ||
      (a.lastTickMs ?? Number.POSITIVE_INFINITY) - (b.lastTickMs ?? Number.POSITIVE_INFINITY)
  );
}

// Libelle court d'un niveau pour les tuiles et les classements.
export function levelLabel(l: FrozenLevel | null | undefined): string {
  if (!l) return "🏁";
  return `${l.boss ? "BOSS " : "Niv. "}${l.number}`;
}
