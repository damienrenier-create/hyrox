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
export type TeamPenalty = { teamId: string; level: number; index: number; reps: number; label: string; weight: number };
export function readPenalties(settings: unknown): TeamPenalty[] {
  const raw = (settings as { penalties?: unknown } | null)?.penalties;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is TeamPenalty => !!p && typeof p === "object" && typeof (p as TeamPenalty).teamId === "string" && typeof (p as TeamPenalty).level === "number" && typeof (p as TeamPenalty).index === "number" && typeof (p as TeamPenalty).reps === "number");
}
export type TeamCard = { card: FrozenCard; index: number; penalty: boolean };
// Fiches d'un niveau POUR UNE EQUIPE : celles de l'echelle, puis ses penalites sur ce niveau.
export function cardsForTeam(level: FrozenLevel, teamId: string, penalties: TeamPenalty[] = []): TeamCard[] {
  const base: TeamCard[] = activeCards(level).map((x) => ({ ...x, penalty: false }));
  const extra: TeamCard[] = penalties
    .filter((p) => p.teamId === teamId && p.level === level.number)
    .map((p) => ({ card: { exerciseId: "PENALTY", label: p.label, reps: p.reps, weight: p.weight }, index: p.index, penalty: true }));
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
const MIN_ZONE_S = 15;

export const zombieSpeedLevel = (levelNumber: number, losses: number) => Math.max(1, levelNumber - ZOMBIE_LOSS_PENALTY * losses);
export function zombieMarginS(speedLevel: number): number {
  const t = Math.min(1, Math.max(0, (speedLevel - 1) / 19));
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
export function zombieSim(
  level: FrozenLevel,
  cardsTotalSec: number,
  tickEvents: { atMs: number; sec: number }[], // fiches cochees de la tentative (ms depuis son depart, duree de la fiche)
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
  let walked = 0, eaten = 0, t = 0, doneSec = 0, catchAt: number | null = null;
  const advance = (until: number) => {
    // De t a until, avec le coeur a la fraction courante : marche puis repas.
    const target = arrivalFor(doneSec / total);
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
    doneSec += e.sec;
  }
  if (catchAt === null) advance(sinceMs);
  const frac = doneSec / total;
  const heart = 1 - ZOMBIE_ZONE + ZOMBIE_ZONE * Math.min(1, Math.max(0, frac));
  const target = arrivalFor(frac);
  const contact = catchAt === null && walked >= target - 1e-6;
  const bites = Math.min(HEART_BITES, Math.floor((eaten / eatMs) * HEART_BITES));
  const remainingMs = catchAt !== null ? 0 : Math.max(0, target - walked) + (eatMs - eaten);
  return { zombie: Math.max(0, Math.min(heart, posFor(walked))), heart, contact, bites, eatenMs: eaten, eatMs, catchAtMs: catchAt, remainingMs };
}
// Evenements de coche d'une tentative pour la simulation : fiches du niveau en cours cochees depuis le depart.
export function attemptEvents(level: FrozenLevel, teamId: string, ticks: Tick[], attemptStartMs: number, penalties: TeamPenalty[] = []): { atMs: number; sec: number }[] {
  const secOf = new Map(cardsForTeam(level, teamId, penalties).map((x) => [x.index, cardSeconds(x.card)]));
  return ticks
    .filter((t) => t.teamId === teamId && t.level === level.number && t.atMs >= attemptStartMs && secOf.has(t.card))
    .map((t) => ({ atMs: t.atMs - attemptStartMs, sec: secOf.get(t.card)! }));
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
export const zombieTier = (speedLevel: number) => Math.max(1, Math.min(10, Math.ceil(speedLevel / 2)));

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
};
export function emomProgress(levels: FrozenLevel[], teamId: string, ticks: Tick[], scores: Record<string, number>): EmomTeam {
  const mine = ticks.filter((t) => t.teamId === teamId);
  const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
  const doneByWave = levels.map((l) => activeCards(l).filter(({ index }) => done.has(`${l.number}_${index}`)).length);
  const wavesDone = levels.filter((l, i) => activeCards(l).length > 0 && doneByWave[i] === activeCards(l).length).length;
  return { teamId, wavesDone, doneByWave, score: scores[teamId] ?? null, lastTickMs: mine.length ? Math.max(...mine.map((t) => t.atMs)) : null };
}
// Prochaine fiche a decouvrir dans une vague (null = vague bouclee ou sans fiche).
export function emomNextCard(level: FrozenLevel, teamId: string, ticks: Tick[]): { card: FrozenCard; index: number } | null {
  const done = new Set(ticks.filter((t) => t.teamId === teamId && t.level === level.number).map((t) => t.card));
  return activeCards(level).find(({ index }) => !done.has(index)) ?? null;
}
// Classement du finisher : score (max de reps) puis vagues bouclees, puis la derniere coche la plus tot.
export function emomRank(list: EmomTeam[]): EmomTeam[] {
  return [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.wavesDone - a.wavesDone || (a.lastTickMs ?? Infinity) - (b.lastTickMs ?? Infinity));
}

// Libelle court d'un niveau pour les tuiles et les classements.
export function levelLabel(l: FrozenLevel | null | undefined): string {
  if (!l) return "🏁";
  return `${l.boss ? "BOSS " : "Niv. "}${l.number}`;
}
