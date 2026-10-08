// Moteur « AMRAP » (Sartay 08/10 : « un petit WOD AMRAP de 20 minutes : 20 equipes, le plus de tours par equipe possible
// en 20 minutes ; les eleves viennent [a l'ordi] a la fin de chaque tour »). Le circuit (10 exercices) est une INFO pour
// les eleves : l'ordi ne compte que les TOURS, un clic du greffier par tour (table Lap, comme la Pyramide). Classement :
// le plus de tours avant la fin, puis le plus tot a les avoir boucles. A la fin du temps, le tour en cours ne compte pas.
// Depart decale par defaut (chaque equipe commence a SON exercice, puis suit l'ordre) : 20 equipes sur 10 exercices,
// deux par exercice au depart, pas de bouchon. Module PUR : temps en ms ECOULEES de course (pauses deduites).

export type AmrapExercise = { id: string; label: string; reps: number; unit: string };
export type AmrapSettings = {
  capMin: number; // duree du WOD : a cet instant la course s'arrete toute seule
  exercises: AmrapExercise[];
  staggered: boolean; // depart decale : l'equipe n commence a l'exercice ((n - 1) mod N) + 1
};

export const AMRAP_UNITS = ["rép.", "A/R", "m", "s"] as const;
export const AMRAP_MIN_EXERCISES = 1;
export const AMRAP_MAX_EXERCISES = 12;
export const AMRAP_MIN_CAP = 5;
export const AMRAP_MAX_CAP = 60;
// Ecart minimal entre deux tours d'une meme equipe : en dessous, c'est un double clic du greffier, pas un tour.
export const AMRAP_MIN_LAP_MS = 60_000;

// Les 10 exercices de Sartay (08/10), dans son ordre. Les quantites sont un premier reglage (un tour d'environ 5 minutes
// pour une equipe de 2-3), a ajuster dans ⚙️ Reglages avant le depart : elles comptent pour toute l'equipe, qui se
// repartit le travail, comme a l'Eval.
export const AMRAP_DEFAULT_EXERCISES: AmrapExercise[] = [
  { id: "ex1", label: "Run", reps: 2, unit: "A/R" },
  { id: "ex2", label: "Burpees", reps: 10, unit: "rép." },
  { id: "ex3", label: "Jump squats", reps: 20, unit: "rép." },
  { id: "ex4", label: "Fentes", reps: 20, unit: "rép." },
  { id: "ex5", label: "Pompages", reps: 20, unit: "rép." },
  { id: "ex6", label: "Crawling", reps: 1, unit: "A/R" },
  { id: "ex7", label: "Commando", reps: 20, unit: "rép." },
  { id: "ex8", label: "Monkey slide", reps: 20, unit: "rép." },
  { id: "ex9", label: "Hélico", reps: 20, unit: "rép." },
  { id: "ex10", label: "Cordes", reps: 60, unit: "rép." },
];
export const AMRAP_DEFAULTS: AmrapSettings = { capMin: 20, exercises: AMRAP_DEFAULT_EXERCISES, staggered: true };

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

// Reglages d'une seance (Session.settings.amrap), valides ; sinon les reglages par defaut.
export function readAmrapSettings(settings: unknown): AmrapSettings {
  const raw = (settings as { amrap?: unknown } | null)?.amrap as Partial<Record<keyof AmrapSettings, unknown>> | undefined;
  if (!raw || typeof raw !== "object") return AMRAP_DEFAULTS;
  const list = Array.isArray(raw.exercises) ? raw.exercises : [];
  const exercises: AmrapExercise[] = list
    .map((e, i) => {
      const x = (e ?? {}) as Partial<AmrapExercise>;
      const label = typeof x.label === "string" ? x.label.trim().slice(0, 40) : "";
      const unit = typeof x.unit === "string" && (AMRAP_UNITS as readonly string[]).includes(x.unit) ? x.unit : "rép.";
      return { id: `ex${i + 1}`, label, reps: clampInt(x.reps, 1, 999, 10), unit };
    })
    .filter((e) => e.label)
    .slice(0, AMRAP_MAX_EXERCISES);
  return {
    capMin: clampInt(raw.capMin, AMRAP_MIN_CAP, AMRAP_MAX_CAP, AMRAP_DEFAULTS.capMin),
    exercises: exercises.length >= AMRAP_MIN_EXERCISES ? exercises.map((e, i) => ({ ...e, id: `ex${i + 1}` })) : AMRAP_DEFAULT_EXERCISES,
    staggered: typeof raw.staggered === "boolean" ? raw.staggered : AMRAP_DEFAULTS.staggered,
  };
}

export type AmrapMember = { userId: string; name: string };
export type AmrapTeam = { id: string; order: number; name: string; members: AmrapMember[] };
export type AmrapLap = { id: string; teamId: string; at: number; abs: number | null }; // at : ms ecoulees ; abs : heure reelle
export type AmrapContext = { settings: AmrapSettings; teams: AmrapTeam[]; laps: AmrapLap[] };

export const amrapCapMs = (s: AmrapSettings) => s.capMin * 60_000;

// Exercice de depart d'une equipe (index dans la liste) : decale selon son numero, ou le 1er pour tout le monde.
export function startIndexOf(settings: AmrapSettings, team: { order: number }): number {
  const n = settings.exercises.length;
  if (!settings.staggered || n === 0) return 0;
  return (Math.max(1, team.order) - 1) % n;
}
// L'ordre des exercices d'un tour pour cette equipe : depuis son depart, puis on boucle.
export function lapOrder(settings: AmrapSettings, team: { order: number }): AmrapExercise[] {
  const s = startIndexOf(settings, team);
  return settings.exercises.map((_, i) => settings.exercises[(s + i) % settings.exercises.length]);
}

export type AmrapTeamState = {
  team: AmrapTeam;
  startIndex: number;
  laps: number; // tours boucles avant la fin du temps
  times: number[]; // fin de chaque tour (ms ecoulees)
  splits: number[]; // duree de chaque tour
  lastMs: number | null; // fin du dernier tour compte
  bestMs: number | null; // tour le plus rapide
  avgMs: number | null; // tour moyen
};

export function teamState(ctx: AmrapContext, team: AmrapTeam): AmrapTeamState {
  const cap = amrapCapMs(ctx.settings);
  const times = ctx.laps.filter((l) => l.teamId === team.id && l.at <= cap).map((l) => l.at).sort((a, b) => a - b);
  const splits = times.map((t, i) => t - (i ? times[i - 1] : 0));
  return {
    team,
    startIndex: startIndexOf(ctx.settings, team),
    laps: times.length,
    times,
    splits,
    lastMs: times.length ? times[times.length - 1] : null,
    bestMs: splits.length ? Math.min(...splits) : null,
    avgMs: splits.length ? splits.reduce((a, b) => a + b, 0) / splits.length : null,
  };
}

// Classement : le plus de tours, puis le plus tot a les avoir boucles (a egalite de tours, la plus rapide), puis le
// numero d'equipe. Une equipe sans tour est classee apres, dans l'ordre des numeros.
export function rankRows(ctx: AmrapContext): AmrapTeamState[] {
  return ctx.teams
    .map((t) => teamState(ctx, t))
    .sort((a, b) => b.laps - a.laps || (a.lastMs ?? Infinity) - (b.lastMs ?? Infinity) || a.team.order - b.team.order);
}
// Rangs avec ex aequo (memes tours a la meme seconde) : 1, 2, 2, 4…
export function ranks(rows: AmrapTeamState[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    out.push(prev && prev.laps === r.laps && prev.lastMs !== null && r.lastMs !== null && Math.floor(prev.lastMs / 1000) === Math.floor(r.lastMs / 1000) ? out[i - 1] : i + 1);
  });
  return out;
}

export function fmt(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
// « 20 rép. », « 2 A/R » ; en toutes lettres pour les dias : « 2 allers-retours ».
export const amountText = (e: AmrapExercise) => `${e.reps} ${e.unit}`;
export const amountWords = (e: AmrapExercise) =>
  e.unit === "A/R" ? `${e.reps} ${e.reps > 1 ? "allers-retours" : "aller-retour"}` : e.unit === "rép." ? `${e.reps} ${e.reps > 1 ? "répétitions" : "répétition"}` : `${e.reps} ${e.unit}`;

// Export Excel (CSV, ;) : classement et temps de chaque tour.
export function amrapCsv(ctx: AmrapContext, liveMs: number, status: string): string {
  const rows = rankRows(ctx);
  const rk = ranks(rows);
  const maxLaps = Math.max(0, ...rows.map((r) => r.laps));
  const L: string[] = [];
  L.push(["WOD AMRAP", `${ctx.settings.capMin} min`, `statut : ${status}`, `chrono : ${fmt(liveMs)}`].join(";"));
  L.push(["Circuit", ctx.settings.exercises.map((e, i) => `${i + 1}. ${e.label} ${amountText(e)}`).join(" / ")].join(";"));
  L.push("");
  L.push(["Rang", "Equipe", "Eleves", "Depart", "Tours", "Fin du dernier tour", "Tour moyen", "Meilleur tour", ...Array.from({ length: maxLaps }, (_, i) => `Tour ${i + 1}`)].join(";"));
  rows.forEach((r, i) => {
    L.push([r.laps ? rk[i] : "", r.team.name, r.team.members.map((m) => m.name).join(", "), `${r.startIndex + 1}. ${ctx.settings.exercises[r.startIndex]?.label ?? ""}`, r.laps, fmt(r.lastMs), fmt(r.avgMs), fmt(r.bestMs), ...r.splits.map(fmt)].join(";"));
  });
  return "﻿" + L.join("\r\n");
}
