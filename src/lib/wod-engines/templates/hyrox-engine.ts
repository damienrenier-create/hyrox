// Moteur « Hyrox » (Sartay 01/10) : equipes de 2, 8 stations avec un run entre chaque, depart decale (chaque equipe
// commence a SA station et tourne), temps limite 50 min ; une fois les 8 stations faites, Cindy (5 tractions, 10 pompes,
// 15 squats) en AMRAP jusqu'au temps limite. Chaque run et chaque station sont valides a l'ordi : un pointage date par
// segment -> temps par station, par run, total ; deux classements separes (temps du WOD, tours de Cindy), bareme de
// bonus a fixer par Sartay. Module PUR : temps en ms ECOULEES de course (pauses deduites), comme la Fete Foraine.

export const HX_STATIONS = 8;
export type HXStation = { id: string; label: string; reps: number; unit: string };
export const HX_UNITS = ["rép.", "m", "A/R", "s"] as const;
// Les stations sont des EMPLACEMENTS fixes st1..st8 (Team.startExerciseId, Touche-Coule) ; libelles et reps se reglent
// avant le depart (Sartay : « je te donnerai la liste des exos plus tard »).
export const HX_DEFAULT_STATIONS: HXStation[] = [
  { id: "st1", label: "Burpees broad jump", reps: 20, unit: "rép." },
  { id: "st2", label: "Farmer carry", reps: 100, unit: "m" },
  { id: "st3", label: "Fentes marchées", reps: 50, unit: "rép." },
  { id: "st4", label: "Sarneige pull", reps: 50, unit: "m" },
  { id: "st5", label: "Wall ball shot", reps: 50, unit: "rép." },
  { id: "st6", label: "Corde à sauter", reps: 150, unit: "rép." },
  { id: "st7", label: "Pompes", reps: 40, unit: "rép." },
  { id: "st8", label: "Squats", reps: 80, unit: "rép." },
];

export type HXSettings = {
  stations: HXStation[];
  runLabel: string;
  // Un run se valide en plusieurs parties (Sartay 02/10 : « RUN 1 A, RUN 1 B, RUN 1 C » = un aller-retour eleve 1,
  // un eleve 2, un a deux) : une validation a l'ordi par partie. 1 a 4 parties, nommees.
  runParts: string[];
  runAfterLast: boolean; // un run apres la 8e station aussi (sinon : 7 runs, entre les stations)
  capMin: number; // temps limite du WOD (Cindy comprise)
  penSec: number; // secondes ajoutees au temps par carte jaune
  cindyLabel: string;
};
export const HX_MAX_RUN_PARTS = 4;
export const HX_PART_LETTERS = ["A", "B", "C", "D"];
export const HX_DEFAULTS: HXSettings = {
  stations: HX_DEFAULT_STATIONS,
  runLabel: "Run",
  runParts: ["Élève 1", "Élève 2", "À deux"],
  runAfterLast: false,
  capMin: 50,
  penSec: 60,
  cindyLabel: "Cindy : 5 tractions · 10 pompes · 15 squats",
};

const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

// Reglages de la seance (Session.settings.hyrox) par-dessus les valeurs par defaut, bornes comprises.
export function readHXSettings(settings: unknown): HXSettings {
  const h = (settings as { hyrox?: Partial<HXSettings> } | null)?.hyrox;
  const raw = Array.isArray(h?.stations) ? (h!.stations as Partial<HXStation>[]) : [];
  const stations = HX_DEFAULT_STATIONS.map((d, i) => {
    const s = raw[i];
    return { id: d.id, label: str(s?.label, d.label), reps: num(s?.reps, d.reps, 0, 100000), unit: str(s?.unit, d.unit) };
  });
  const parts = Array.isArray(h?.runParts) ? (h!.runParts as unknown[]).filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()).slice(0, HX_MAX_RUN_PARTS) : [];
  return {
    stations,
    runLabel: str(h?.runLabel, HX_DEFAULTS.runLabel),
    runParts: parts.length ? parts : HX_DEFAULTS.runParts,
    runAfterLast: h?.runAfterLast === true,
    capMin: num(h?.capMin, HX_DEFAULTS.capMin, 5, 180),
    penSec: num(h?.penSec, HX_DEFAULTS.penSec, 0, 600),
    cindyLabel: str(h?.cindyLabel, HX_DEFAULTS.cindyLabel),
  };
}

export type HXMember = { memberId: string; userId: string; name: string; quiz: number | null }; // quiz = score au QCM bonus (null = pas repondu)
export type HXTeam = { id: string; order: number; name: string; startStationId: string | null; members: HXMember[] };
export type HXEvent = { id: string; teamId: string; key: string; at: number }; // key = "st:<id>" | "run:<n>" | "cindy" ; at = ms ecoulees
export type HXCard = { id: string; teamId: string; at: number };
export type HXContext = { teams: HXTeam[]; settings: HXSettings; events: HXEvent[]; cards: HXCard[] };

export const CINDY_KEY = "cindy";

export function fmt(ms: number | null | undefined): string {
  if (ms == null) return "";
  const neg = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (neg ? "−" : "") + m + ":" + (r < 10 ? "0" : "") + r;
}

// Un segment du parcours d'une equipe : une station, ou une PARTIE de run (RUN 1 A, B, C). `n` = position (1..),
// `stationNo` = numero de la station (pour un run : celle VERS laquelle on court, 0 = arrivee apres la derniere),
// `run` / `part` = numero du run et de sa partie. `label` = ce que lit l'eleve sur la fiche (nom de l'exo, sans numero).
export type HXSegment = { key: string; kind: "station" | "run"; n: number; station: HXStation | null; stationNo: number; run: number; part: number; label: string; short: string; detail: string };

export function segmentsFor(s: HXSettings, startIndex: number): HXSegment[] {
  const out: HXSegment[] = [];
  const N = s.stations.length;
  const parts = s.runParts.length ? s.runParts : HX_DEFAULTS.runParts;
  for (let i = 0; i < N; i++) {
    const idx = (startIndex + i) % N;
    const st = s.stations[idx];
    out.push({ key: `st:${st.id}`, kind: "station", n: out.length + 1, station: st, stationNo: idx + 1, run: 0, part: 0, label: st.label, short: st.label, detail: `${st.reps} ${st.unit} · station ${idx + 1}` });
    if (i < N - 1 || s.runAfterLast) {
      const nextIdx = i < N - 1 ? (startIndex + i + 1) % N : -1;
      const nextNo = nextIdx >= 0 ? nextIdx + 1 : 0;
      const towards = nextIdx >= 0 ? `→ ${s.stations[nextIdx].label}` : "→ arrivée";
      parts.forEach((p, k) => {
        const letter = parts.length > 1 ? ` ${HX_PART_LETTERS[k] ?? k + 1}` : "";
        out.push({ key: parts.length > 1 ? `run:${i + 1}:${k + 1}` : `run:${i + 1}`, kind: "run", n: out.length + 1, station: null, stationNo: nextNo, run: i + 1, part: k + 1, label: `${s.runLabel.toUpperCase()} ${i + 1}${letter}`, short: `${s.runLabel.toUpperCase()} ${i + 1}${letter}`, detail: `${p} ${towards}` });
      });
    }
  }
  return out;
}

// Station de depart : celle choisie par le greffier, sinon round-robin sur le numero d'equipe (1 -> station 1, 9 -> 1…).
export function startIndexOf(ctx: HXContext, team: HXTeam): number {
  const i = team.startStationId ? ctx.settings.stations.findIndex((s) => s.id === team.startStationId) : -1;
  return i >= 0 ? i : (Math.max(1, team.order) - 1) % ctx.settings.stations.length;
}

export type HXTeamState = {
  team: HXTeam;
  startIndex: number;
  segments: HXSegment[];
  times: number[]; // ms ecoulees a chaque validation, dans l'ordre du parcours
  splits: number[]; // duree de chaque segment valide
  done: number;
  current: HXSegment | null; // segment en cours (null = parcours fini)
  finishedMs: number | null; // temps du WOD (derniere station ou dernier run)
  cindy: number[]; // ms ecoulees de chaque tour de Cindy valide
  cards: number;
  penMs: number;
  scoreMs: number | null; // temps + penalites
  lastMs: number | null;
  stationsDone: number;
  runsDone: number;
  quiz: { done: number; score: number }; // QCM bonus : eleves ayant repondu, somme de leurs points (bareme a fixer)
};

export function teamState(ctx: HXContext, team: HXTeam): HXTeamState {
  const startIndex = startIndexOf(ctx, team);
  const segments = segmentsFor(ctx.settings, startIndex);
  const ev = ctx.events.filter((e) => e.teamId === team.id).sort((a, b) => a.at - b.at);
  const times: number[] = [];
  const cindy: number[] = [];
  for (const e of ev) {
    if (e.key === CINDY_KEY) cindy.push(e.at);
    else if (times.length < segments.length) times.push(e.at);
  }
  const splits = times.map((t, i) => t - (i ? times[i - 1] : 0));
  const done = times.length;
  const finishedMs = done >= segments.length ? times[segments.length - 1] : null;
  const cards = ctx.cards.filter((c) => c.teamId === team.id).length;
  const penMs = cards * ctx.settings.penSec * 1000;
  const lastMs = cindy.length ? cindy[cindy.length - 1] : done ? times[done - 1] : null;
  return {
    team,
    startIndex,
    segments,
    times,
    splits,
    done,
    current: finishedMs === null ? segments[done] : null,
    finishedMs,
    cindy,
    cards,
    penMs,
    scoreMs: finishedMs === null ? null : finishedMs + penMs,
    lastMs,
    stationsDone: segments.slice(0, done).filter((s) => s.kind === "station").length,
    // Runs COMPLETS (toutes les parties validees).
    runsDone: segments.slice(0, done).filter((s) => s.kind === "run" && s.part === (ctx.settings.runParts.length || 1)).length,
    quiz: { done: team.members.filter((m) => m.quiz !== null).length, score: team.members.reduce((a, m) => a + (m.quiz ?? 0), 0) },
  };
}

// Classement au temps : equipes arrivees par temps + penalites, puis les autres par segments faits (la plus avancee
// d'abord, a egalite la plus rapide).
export function timeRows(ctx: HXContext): HXTeamState[] {
  const out = ctx.teams.map((t) => teamState(ctx, t));
  out.sort((a, b) => {
    if (a.scoreMs !== null && b.scoreMs !== null) return a.scoreMs - b.scoreMs || a.team.order - b.team.order;
    if (a.scoreMs !== null) return -1;
    if (b.scoreMs !== null) return 1;
    if (a.done !== b.done) return b.done - a.done;
    if (a.lastMs !== null && b.lastMs !== null && a.lastMs !== b.lastMs) return a.lastMs - b.lastMs;
    return a.team.order - b.team.order;
  });
  return out;
}

// Classement Cindy : tours faits, puis temps du WOD (arrivee plus rapide devant a egalite).
export function cindyRows(ctx: HXContext): HXTeamState[] {
  const out = ctx.teams.map((t) => teamState(ctx, t));
  out.sort((a, b) => b.cindy.length - a.cindy.length || (a.scoreMs ?? Infinity) - (b.scoreMs ?? Infinity) || a.team.order - b.team.order);
  return out;
}

export type HXStat = { key: string; label: string; n: number; best: number | null; avg: number | null };

// Statistiques par station et par run (durees des segments valides, toutes equipes confondues). Un run compte quand
// toutes ses parties sont validees : sa duree = la somme des parties. Cles : "st:<id>" et "run:<n>".
export function segmentStats(ctx: HXContext): { stations: HXStat[]; runs: HXStat[]; byTeam: Record<string, Record<string, number>> } {
  const acc = new Map<string, number[]>();
  const byTeam: Record<string, Record<string, number>> = {};
  const nParts = ctx.settings.runParts.length || 1;
  for (const t of ctx.teams) {
    const st = teamState(ctx, t);
    byTeam[t.id] = {};
    const runAcc = new Map<number, { n: number; ms: number }>();
    for (let i = 0; i < st.done; i++) {
      const seg = st.segments[i];
      if (seg.kind === "station") {
        acc.set(seg.key, [...(acc.get(seg.key) ?? []), st.splits[i]]);
        byTeam[t.id][seg.key] = st.splits[i];
      } else {
        const r = runAcc.get(seg.run) ?? { n: 0, ms: 0 };
        r.n++;
        r.ms += st.splits[i];
        runAcc.set(seg.run, r);
      }
    }
    for (const [run, r] of runAcc) {
      if (r.n < nParts) continue;
      acc.set(`run:${run}`, [...(acc.get(`run:${run}`) ?? []), r.ms]);
      byTeam[t.id][`run:${run}`] = r.ms;
    }
  }
  const stat = (key: string, label: string): HXStat => {
    const v = acc.get(key) ?? [];
    return { key, label, n: v.length, best: v.length ? Math.min(...v) : null, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  };
  const stations = ctx.settings.stations.map((s, i) => stat(`st:${s.id}`, `${i + 1} · ${s.label}`));
  const nRuns = ctx.settings.stations.length - (ctx.settings.runAfterLast ? 0 : 1);
  const runs = Array.from({ length: nRuns }, (_, i) => stat(`run:${i + 1}`, `${ctx.settings.runLabel.toUpperCase()} ${i + 1}`));
  return { stations, runs, byTeam };
}

export function segmentLabel(ctx: HXContext, teamId: string, key: string): string {
  if (key === CINDY_KEY) return "Tour de Cindy";
  const team = ctx.teams.find((t) => t.id === teamId);
  if (!team) return key;
  const seg = segmentsFor(ctx.settings, startIndexOf(ctx, team)).find((s) => s.key === key);
  return seg?.label ?? key;
}

// Export CSV : classements, detail par equipe, statistiques, journal, reglages.
export function hxCsv(ctx: HXContext, liveMs: number, state: string): string {
  const L: string[] = [];
  const members = (t: HXTeam) => t.members.map((m) => m.name).join(" / ");
  L.push("Classement au temps");
  L.push(["Rang", "Equipe", "Eleves", "Depart", "Stations", "Runs", "Temps WOD", "Cartes jaunes", "Penalites", "Score", "Tours Cindy", "QCM (points)", "QCM (reponses)"].join(";"));
  let rank = 0;
  timeRows(ctx).forEach((st) => {
    if (st.scoreMs !== null) rank++;
    L.push([st.scoreMs !== null ? rank : "", st.team.name, members(st.team), st.startIndex + 1, st.stationsDone, st.runsDone, st.finishedMs !== null ? fmt(st.finishedMs) : "", st.cards, st.cards ? fmt(st.penMs) : "", st.scoreMs !== null ? fmt(st.scoreMs) : "", st.cindy.length, st.quiz.done ? st.quiz.score : "", st.quiz.done].join(";"));
  });
  L.push("");
  L.push("Classement Cindy");
  L.push(["Rang", "Equipe", "Tours", "Temps WOD"].join(";"));
  cindyRows(ctx).forEach((st, i) => L.push([i + 1, st.team.name, st.cindy.length, st.scoreMs !== null ? fmt(st.scoreMs) : ""].join(";")));
  L.push("");
  L.push("Detail par equipe (temps ecoule a la validation ; entre parentheses : duree du segment)");
  ctx.teams.forEach((t) => {
    const st = teamState(ctx, t);
    L.push([t.name, ...st.segments.map((s, i) => `${s.label}${i < st.done ? ` ${fmt(st.times[i])} (${fmt(st.splits[i])})` : ""}`), ...st.cindy.map((c, i) => `Cindy ${i + 1} ${fmt(c)}`)].join(";"));
  });
  L.push("");
  L.push("Statistiques");
  L.push(["Segment", "Equipes", "Meilleur", "Moyen"].join(";"));
  const stats = segmentStats(ctx);
  [...stats.stations, ...stats.runs].forEach((s) => L.push([s.label, s.n, s.best !== null ? fmt(s.best) : "", s.avg !== null ? fmt(s.avg) : ""].join(";")));
  L.push("");
  L.push("Journal chronologique");
  L.push(["Temps", "Equipe", "Validation"].join(";"));
  const teamName = new Map(ctx.teams.map((t) => [t.id, t.name]));
  [...ctx.events].sort((a, b) => a.at - b.at).forEach((e) => L.push([fmt(e.at), teamName.get(e.teamId) ?? e.teamId, segmentLabel(ctx, e.teamId, e.key)].join(";")));
  L.push("");
  L.push("Reglages");
  ctx.settings.stations.forEach((s, i) => L.push([`Station ${i + 1}`, s.label, `${s.reps} ${s.unit}`].join(";")));
  L.push(["Run", ctx.settings.runLabel, ctx.settings.runParts.join(" / ")].join(";"));
  L.push(["Temps limite (min)", ctx.settings.capMin].join(";"));
  L.push(["Carte jaune (s)", ctx.settings.penSec].join(";"));
  L.push(["Temps ecoule", fmt(liveMs)].join(";"));
  L.push(["Etat", state].join(";"));
  return "﻿" + L.join("\r\n");
}
