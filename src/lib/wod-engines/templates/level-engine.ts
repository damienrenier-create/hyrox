// Moteur pur du WOD Level : aucune dependance serveur, importable cote client (constructeur de niveaux,
// ecran greffier) comme cote serveur (classements, records).

export const BOSS_EVERY = 5; // niveaux 5, 10, 15... = BOSS (un seul exercice, toute l'equipe dessus)
export const MAX_CARDS = 10; // fiches par niveau
export const MIN_TEAM = 1;
export const MAX_TEAM = 6;
export const DEFAULT_TEAM = 5;

export type LevelCard = { exerciseId: string; reps: number };
// Fiche resolue : la ponderation et le libelle sont figes avec elle (l'echelle d'une seance ne bouge plus).
export type FrozenCard = LevelCard & { label: string; weight: number };
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
      const k = c as { exerciseId?: unknown; reps?: unknown; label?: unknown; weight?: unknown };
      if (typeof k.exerciseId !== "string" || typeof k.reps !== "number" || typeof k.label !== "string" || typeof k.weight !== "number") continue;
      cards.push({ exerciseId: k.exerciseId, reps: k.reps, label: k.label, weight: k.weight });
    }
    out.push({ number: o.number, name: typeof o.name === "string" ? o.name : null, boss: isBoss(o.number), cards });
  }
  return out.sort((a, b) => a.number - b.number);
}

// Statistiques d'un lot de fiches : reps totales, temps theorique (somme reps x ponderation, en secondes)
// et intensite = ponderation moyenne par rep (fiche de pure corde = 1, de purs burpees = 7).
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

// ===== Progression d'une equipe =====
export type Tick = { teamId: string; level: number; card: number; atMs: number };
export type TeamProgress = {
  teamId: string;
  completedLevels: number; // niveaux entierement valides, dans l'ordre
  currentLevel: number | null; // niveau en cours (null = echelle terminee)
  currentDone: number; // fiches cochees dans le niveau en cours
  currentTotal: number;
  lastTickMs: number | null; // instant (chrono de course) de la derniere fiche cochee
  finishedMs: number | null; // instant ou l'echelle entiere a ete bouclee
  reps: number; // reps validees (fiches entieres), toutes fiches confondues
  weighted: number; // ponderation cumulee des fiches validees
  repsByExercise: Record<string, number>;
  doneCards: Set<string>; // `${level}_${card}`
};

// Une equipe avance niveau par niveau : le niveau N+1 n'est « en cours » que quand toutes les fiches de N
// sont cochees. Des coches orphelines (fiche d'un niveau plus loin) comptent dans les reps mais pas dans
// la progression : elles n'arrivent que par une annulation en arriere, et se resorbent d'elles-memes.
export function progressOf(levels: FrozenLevel[], teamId: string, ticks: Tick[]): TeamProgress {
  const mine = ticks.filter((t) => t.teamId === teamId);
  const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
  const atOf = new Map(mine.map((t) => [`${t.level}_${t.card}`, t.atMs]));
  let completed = 0;
  let current: FrozenLevel | null = null;
  let currentDone = 0;
  let finishedMs: number | null = null;
  for (const l of levels) {
    const n = l.cards.filter((_, i) => done.has(`${l.number}_${i}`)).length;
    if (n === l.cards.length && l.cards.length > 0) {
      completed++;
      continue;
    }
    current = l;
    currentDone = n;
    break;
  }
  if (!current && levels.length) {
    finishedMs = Math.max(...mine.map((t) => t.atMs));
  }
  let reps = 0;
  let weighted = 0;
  const repsByExercise: Record<string, number> = {};
  for (const l of levels) {
    l.cards.forEach((c, i) => {
      if (!done.has(`${l.number}_${i}`)) return;
      reps += c.reps;
      weighted += c.reps * c.weight;
      repsByExercise[c.exerciseId] = (repsByExercise[c.exerciseId] ?? 0) + c.reps;
    });
  }
  return {
    teamId,
    completedLevels: completed,
    currentLevel: current?.number ?? null,
    currentDone,
    currentTotal: current?.cards.length ?? 0,
    lastTickMs: mine.length ? Math.max(...mine.map((t) => t.atMs)) : null,
    finishedMs,
    reps,
    weighted,
    repsByExercise,
    doneCards: done,
  };
}

// Classement : niveaux bouclés, puis fiches cochees dans le niveau en cours, puis la derniere coche la plus
// tot (a egalite de travail, la plus rapide gagne). Une equipe sans aucune coche est derniere.
export function rankTeams(progress: TeamProgress[]): TeamProgress[] {
  return [...progress].sort(
    (a, b) =>
      b.completedLevels - a.completedLevels ||
      b.currentDone - a.currentDone ||
      (a.lastTickMs ?? Number.POSITIVE_INFINITY) - (b.lastTickMs ?? Number.POSITIVE_INFINITY)
  );
}
