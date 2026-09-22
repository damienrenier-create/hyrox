// Port fidele des fonctions de calcul de "compte-tours-wod Pyramide final.html" :
// pyramide, medailles, compte a rebours (timeline), classements, cartes jaunes.
// Toutes ces fonctions sont pures : elles ne lisent/n'ecrivent rien, tout l'etat leur est passe.
// Convention : tous les timestamps ("at", "lastAt", "finishAt", etc.) sont deja exprimes en
// millisecondes ECOULEES depuis le debut de la course (pauses deduites) — voir elapsed()/pausedBefore()
// pour convertir un timestamp absolu avant de construire un RaceContext.

export type RaceSettings = {
  rep0: number;
  peak: number;
  step: number;
  capMin: number;
  afterMin: number;
  penMin: number;
};

export type TeamRef = { id: string; order: number };
export type ExerciseRef = { id: string; number: number };

export type LapEvent = { teamId: string; at: number };
export type CardEvent = { teamId: string; at: number };

export type RaceContext = {
  settings: RaceSettings;
  teams: TeamRef[];
  exercises: ExerciseRef[]; // doit couvrir 1..N sans trou
  noStartExerciseIds: Set<string>;
  laps: LapEvent[]; // DOIT etre trie par 'at' croissant (ordre chronologique de validation)
  cards: CardEvent[];
  startOverride: Map<string, string>; // teamId -> exerciseId (depart force, sinon round-robin par defaut)
  endOverride: Map<string, string | "NONE">; // teamId -> exerciseId | "NONE" ("aucun exercice termine")
};

// ================= pauses / temps ecoule =================

export function pausedBefore(pauses: { from: number; to: number | null }[], ts: number): number {
  let s = 0;
  pauses.forEach((p) => {
    const end = p.to === null ? ts : Math.min(p.to, ts);
    if (end > p.from) s += end - p.from;
  });
  return s;
}

export function elapsed(startedAt: number | null, pauses: { from: number; to: number | null }[], at: number): number | null {
  if (startedAt === null) return null;
  return at - startedAt - pausedBefore(pauses, at);
}

// ================= depart par defaut (round-robin) =================

function N(ctx: RaceContext): number {
  return ctx.exercises.length;
}

function allowedStartNumbers(ctx: RaceContext): number[] {
  const a: number[] = [];
  ctx.exercises.forEach((ex) => {
    if (!ctx.noStartExerciseIds.has(ex.id)) a.push(ex.number);
  });
  return a.length ? a : [1];
}

function exerciseByNumber(ctx: RaceContext, n: number): ExerciseRef {
  return ctx.exercises.find((e) => e.number === n) ?? ctx.exercises[0];
}

export function defaultStart(ctx: RaceContext, team: TeamRef): ExerciseRef {
  const a = allowedStartNumbers(ctx);
  return exerciseByNumber(ctx, a[(team.order - 1) % a.length]);
}

export function startOf(ctx: RaceContext, team: TeamRef): ExerciseRef {
  const overrideId = ctx.startOverride.get(team.id);
  if (overrideId) {
    const ex = ctx.exercises.find((e) => e.id === overrideId);
    if (ex) return ex;
  }
  return defaultStart(ctx, team);
}

function orderFromNumber(ctx: RaceContext, startNumber: number): number[] {
  const n = N(ctx);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((startNumber - 1 + i) % n) + 1);
  return out;
}

export function exerciseSequenceFrom(ctx: RaceContext, team: TeamRef): ExerciseRef[] {
  return orderFromNumber(ctx, startOf(ctx, team).number).map((n) => exerciseByNumber(ctx, n));
}

// ================= pyramide =================

export function pyramid(s: RaceSettings): number[] {
  const up: number[] = [];
  if (s.step > 0 && s.peak > s.rep0) {
    for (let v = s.rep0; v <= s.peak; v += s.step) up.push(v);
  } else {
    up.push(s.rep0);
  }
  return up.concat(up.slice(0, -1).reverse());
}

export function total(s: RaceSettings): number {
  return pyramid(s).length;
}

export function peakIndex(s: RaceSettings): number {
  return Math.floor(total(s) / 2);
}

export function dirLabel(s: RaceSettings, n: number): "↑" | "sommet" | "↓" {
  const pk = peakIndex(s);
  return n < pk ? "↑" : n === pk ? "sommet" : "↓";
}

// ================= tours / cartes =================

export function lapsOf(ctx: RaceContext, teamId: string): number {
  return ctx.laps.filter((l) => l.teamId === teamId).length;
}

export function cardsOf(ctx: RaceContext, teamId: string): number {
  return ctx.cards.filter((c) => c.teamId === teamId).length;
}

export function levelOf(ctx: RaceContext, teamId: string): number | null {
  const p = pyramid(ctx.settings);
  const n = lapsOf(ctx, teamId);
  return n < p.length ? p[n] : null;
}

export function finishAt(ctx: RaceContext, teamId: string): number | null {
  const T = total(ctx.settings);
  const teamLaps = ctx.laps.filter((l) => l.teamId === teamId);
  return teamLaps.length >= T ? teamLaps[T - 1].at : null;
}

export function finishers(ctx: RaceContext): { teamId: string; at: number }[] {
  const out: { teamId: string; at: number }[] = [];
  ctx.teams.forEach((t) => {
    const at = finishAt(ctx, t.id);
    if (at !== null) out.push({ teamId: t.id, at });
  });
  out.sort((a, b) => a.at - b.at);
  return out;
}

export function arrivalRank(ctx: RaceContext, teamId: string): number {
  const f = finishers(ctx);
  const i = f.findIndex((x) => x.teamId === teamId);
  return i === -1 ? 0 : i + 1;
}

export function partialOf(ctx: RaceContext, team: TeamRef): number | null {
  if (finishAt(ctx, team.id) !== null) return null;
  const endVal = ctx.endOverride.get(team.id);
  if (endVal === undefined) return null;
  if (endVal === "NONE") return 0;
  const startEx = startOf(ctx, team);
  const endEx = ctx.exercises.find((e) => e.id === endVal);
  if (!endEx) return null;
  const n = N(ctx);
  return ((endEx.number - startEx.number + n) % n) + 1;
}

export function totalReps(ctx: RaceContext, team: TeamRef): number {
  const p = pyramid(ctx.settings);
  const n = Math.min(lapsOf(ctx, team.id), p.length);
  let sum = 0;
  for (let k = 0; k < n; k++) sum += p[k];
  const partial = n < p.length ? partialOf(ctx, team) ?? 0 : 0;
  return N(ctx) * sum + (n < p.length ? partial * p[n] : 0);
}

// ================= fin du WOD (compte a rebours / temps supplementaire) =================

export type Timeline = { end: number; late: Record<string, number>; count: number };

export function timeline(ctx: RaceContext): Timeline {
  const f = finishers(ctx);
  let end = ctx.settings.capMin * 60000;
  let count = 0;
  const late: Record<string, number> = {};
  const firstAt = f.length ? f[0].at : null;
  f.forEach((x) => {
    if (x.at > end) {
      late[x.teamId] = x.at - end;
      return;
    }
    count++;
    end = Math.min(
      (ctx.settings.capMin - count * ctx.settings.penMin) * 60000,
      (firstAt as number) + (ctx.settings.afterMin - (count - 1) * ctx.settings.penMin) * 60000
    );
  });
  return { end, late, count };
}

// ================= medailles =================

const TIERS = ["b", "s", "g", "p", "d"] as const;
export const MEDAL_NAMES = ["Bronze", "Argent", "Or", "Platine", "Diamant"];
export const TOP_RANKED = 5;

export function maxMedals(s: RaceSettings): number {
  return total(s);
}

export function tierSizes(s: RaceSettings): number[] {
  const T = maxMedals(s);
  const base = Math.floor(T / 5);
  const extra = T % 5;
  const out: number[] = [];
  for (let i = 0; i < 5; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}

export function medalInfo(s: RaceSettings, k: number): { tier: number; pos: number; size: number; variant: number } {
  const sz = tierSizes(s);
  let acc = 0;
  for (let i = 0; i < 5; i++) {
    if (k < acc + sz[i]) {
      const pos = k - acc;
      const n = sz[i];
      return { tier: i, pos, size: n, variant: n === 1 ? 2 : Math.round((pos * 2) / (n - 1)) };
    }
    acc += sz[i];
  }
  return { tier: 4, pos: 0, size: 1, variant: 2 };
}

export function medalClass(s: RaceSettings, k: number): string {
  const m = medalInfo(s, k);
  return TIERS[m.tier] + m.variant;
}

export function tierOf(s: RaceSettings, n: number): number {
  return n <= 0 ? 0 : medalInfo(s, Math.min(n, maxMedals(s)) - 1).tier + 1;
}

// ordre d'obtention de chaque medaille, par equipe : medalOrder[teamId][k] = { pos, at }
export function medalOrder(ctx: RaceContext): Record<string, { pos: number; at: number }[]> {
  const per: Record<string, { at: number; idx: number }[]> = {};
  ctx.laps.forEach((l, idx) => {
    (per[l.teamId] = per[l.teamId] || []).push({ at: l.at, idx });
  });
  const out: Record<string, { pos: number; at: number }[]> = {};
  const M = maxMedals(ctx.settings);
  for (let k = 0; k < M; k++) {
    const list: { teamId: string; at: number; idx: number }[] = [];
    Object.keys(per).forEach((teamId) => {
      if (per[teamId].length > k) list.push({ teamId, at: per[teamId][k].at, idx: per[teamId][k].idx });
    });
    list.sort((a, b) => a.at - b.at || a.idx - b.idx);
    list.forEach((e, i) => {
      (out[e.teamId] = out[e.teamId] || [])[k] = { pos: i + 1, at: e.at };
    });
  }
  return out;
}

// ================= classements =================

export type Standing = {
  team: TeamRef;
  n: number;
  done: boolean;
  finishAt: number | null;
  lastAt: number | null;
  yellowCards: number;
  sec: number | null;
  reps: number;
  known: boolean;
};

function tcmp(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

// A egalite : la regle d'or est toujours "le moins de cartes jaunes passe devant" (§ carte jaune du fichier d'origine).
export function standings(ctx: RaceContext, final: boolean): Standing[] {
  const arr: Standing[] = ctx.teams.map((team) => {
    const fa = finishAt(ctx, team.id);
    const teamLaps = ctx.laps.filter((l) => l.teamId === team.id);
    const lastAt = teamLaps.length ? teamLaps[teamLaps.length - 1].at : null;
    return {
      team,
      n: lapsOf(ctx, team.id),
      done: fa !== null,
      finishAt: fa,
      lastAt,
      yellowCards: cardsOf(ctx, team.id),
      sec: fa !== null ? Math.round(fa / 1000) : null,
      reps: totalReps(ctx, team),
      known: fa !== null || ctx.endOverride.get(team.id) !== undefined,
    };
  });

  arr.sort((a, b) => {
    if (a.done !== b.done) return a.done ? -1 : 1;
    if (a.done) {
      return (
        (a.sec as number) - (b.sec as number) ||
        a.yellowCards - b.yellowCards ||
        (a.finishAt as number) - (b.finishAt as number) ||
        a.team.order - b.team.order
      );
    }
    if (final) {
      return b.reps - a.reps || a.yellowCards - b.yellowCards || b.n - a.n || tcmp(a.lastAt, b.lastAt) || a.team.order - b.team.order;
    }
    return b.n - a.n || a.yellowCards - b.yellowCards || tcmp(a.lastAt, b.lastAt) || a.team.order - b.team.order;
  });
  return arr;
}

// ================= formatage temps (mm:ss) =================

export function fmt(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.round(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export function fmtDown(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export function fmtUp(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}
