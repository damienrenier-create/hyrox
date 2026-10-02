// Moteur « Eval » (ex-« Hyrox », Sartay 01-03/10 ; identifiant de WOD inchange : HYROX). Equipes de 3, 9 stations,
// un run APRES chaque station, le circuit se fait 2 FOIS (2 tours), depart decale (chaque equipe commence a SA station
// et tourne), temps limite 50 min ; parcours fini = Cindy en AMRAP jusqu'au temps limite. Chaque station et chaque run
// sont valides a l'ordi : un pointage date par segment -> temps par station, par run, total ; deux classements separes
// (temps du WOD, tours de Cindy). Tout est reglable par seance (stations, reps, parties d'un run, nombre de tours).
// Module PUR : temps en ms ECOULEES de course (pauses deduites), comme la Fete Foraine.

export const HX_MIN_STATIONS = 2;
export const HX_MAX_STATIONS = 12;
export const HX_MAX_LAPS = 4;
export type HXStation = { id: string; label: string; reps: number; unit: string };
export const HX_UNITS = ["rép.", "A/R", "m", "s"] as const;
// Version « Eval » du 03/10 : 3 stations en allers-retours puis 6 stations a 60 repetitions. Les stations sont des
// EMPLACEMENTS st1..stN (Team.startExerciseId, colonnes du Touche-Coule) ; libelles, reps et nombre se reglent avant le depart.
export const HX_DEFAULT_STATIONS: HXStation[] = [
  { id: "st1", label: "Burpees broad jump", reps: 3, unit: "A/R" },
  { id: "st2", label: "Fentes marchées", reps: 3, unit: "A/R" },
  { id: "st3", label: "Farmer carry", reps: 3, unit: "A/R" },
  { id: "st4", label: "One rep", reps: 60, unit: "rép." },
  { id: "st5", label: "Squats", reps: 60, unit: "rép." },
  { id: "st6", label: "Pompage", reps: 60, unit: "rép." },
  { id: "st7", label: "Corde", reps: 60, unit: "rép." },
  { id: "st8", label: "KB swing", reps: 60, unit: "rép." },
  { id: "st9", label: "Wall ball shot", reps: 60, unit: "rép." },
];

export type HXSettings = {
  stations: HXStation[];
  runLabel: string;
  // Un run peut se valider en plusieurs parties nommees (« RUN 1 A, B, C ») : une validation a l'ordi par partie.
  // Version Eval : une seule partie, « 2 allers-retours ».
  runParts: string[];
  runAfterLast: boolean; // un run apres la toute derniere station aussi (Eval : oui, « apres CHAQUE station »)
  laps: number; // nombre de tours du circuit (Eval : 2)
  capMin: number; // temps limite du WOD (Cindy comprise)
  penSec: number; // secondes ajoutees au temps par carte jaune
  cindyLabel: string;
};
export const HX_MAX_RUN_PARTS = 4;
export const HX_PART_LETTERS = ["A", "B", "C", "D"];
export const HX_DEFAULTS: HXSettings = {
  stations: HX_DEFAULT_STATIONS,
  runLabel: "Run",
  runParts: ["2 allers-retours"],
  runAfterLast: true,
  laps: 2,
  capMin: 50,
  penSec: 60,
  cindyLabel: "Cindy : 5 tractions · 10 pompes · 15 squats",
};

const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

// Reglages de la seance (Session.settings.hyrox) par-dessus les valeurs par defaut, bornes comprises. Une seance
// enregistree AVANT les tours (pas de `laps`) reste a 1 tour : son parcours ne change pas apres coup.
export function readHXSettings(settings: unknown): HXSettings {
  const h = (settings as { hyrox?: Partial<HXSettings> } | null)?.hyrox;
  const raw = Array.isArray(h?.stations) ? (h!.stations as Partial<HXStation>[]) : null;
  const count = raw && raw.length >= HX_MIN_STATIONS && raw.length <= HX_MAX_STATIONS ? raw.length : HX_DEFAULT_STATIONS.length;
  const stations = Array.from({ length: count }, (_, i) => {
    const d = HX_DEFAULT_STATIONS[i] ?? { id: `st${i + 1}`, label: `Station ${i + 1}`, reps: 60, unit: "rép." };
    const s = raw?.[i];
    return { id: `st${i + 1}`, label: str(s?.label, d.label), reps: num(s?.reps, d.reps, 0, 100000), unit: str(s?.unit, d.unit) };
  });
  const parts = Array.isArray(h?.runParts) ? (h!.runParts as unknown[]).filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()).slice(0, HX_MAX_RUN_PARTS) : [];
  return {
    stations,
    runLabel: str(h?.runLabel, HX_DEFAULTS.runLabel),
    runParts: parts.length ? parts : HX_DEFAULTS.runParts,
    runAfterLast: h ? h.runAfterLast === true : HX_DEFAULTS.runAfterLast,
    laps: num(h?.laps, h ? 1 : HX_DEFAULTS.laps, 1, HX_MAX_LAPS),
    capMin: num(h?.capMin, HX_DEFAULTS.capMin, 5, 180),
    penSec: num(h?.penSec, HX_DEFAULTS.penSec, 0, 600),
    cindyLabel: str(h?.cindyLabel, HX_DEFAULTS.cindyLabel),
  };
}

export type HXMember = { memberId: string; userId: string; name: string; quiz: number | null }; // quiz = score au QCM bonus (null = pas repondu)
export type HXTeam = { id: string; order: number; name: string; startStationId: string | null; members: HXMember[] };
export type HXEvent = { id: string; teamId: string; key: string; at: number }; // key = "st:<id>[:<tour>]" | "run:<n>[:<partie>]" | "cindy" ; at = ms ecoulees
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

// « 3 allers-retours », « 60 rép. », « 50 m » : la consigne d'une station telle que l'eleve la lit.
export function amountText(reps: number, unit: string): string {
  if (unit === "A/R") return `${reps} aller${reps > 1 ? "s" : ""}-retour${reps > 1 ? "s" : ""}`;
  return `${reps} ${unit}`;
}

// Un segment du parcours d'une equipe : une station, ou une partie de run. `n` = position (1..), `lap` = tour,
// `stationNo` = numero de la station (pour un run : celle VERS laquelle on court, 0 = arrivee), `run` / `part` = numero
// du run (continu sur tous les tours) et de sa partie. `label` = ce que lit l'eleve sur la fiche (nom de l'exo, sans numero).
export type HXSegment = { key: string; kind: "station" | "run"; n: number; lap: number; station: HXStation | null; stationNo: number; run: number; part: number; label: string; short: string; detail: string };

export function segmentsFor(s: HXSettings, startIndex: number): HXSegment[] {
  const out: HXSegment[] = [];
  const N = s.stations.length;
  const laps = Math.max(1, s.laps);
  const parts = s.runParts.length ? s.runParts : HX_DEFAULTS.runParts;
  for (let lap = 1; lap <= laps; lap++) {
    for (let i = 0; i < N; i++) {
      const idx = (startIndex + i) % N;
      const st = s.stations[idx];
      out.push({ key: `st:${st.id}${lap > 1 ? `:${lap}` : ""}`, kind: "station", n: out.length + 1, lap, station: st, stationNo: idx + 1, run: 0, part: 0, label: st.label, short: st.label, detail: amountText(st.reps, st.unit) });
      const last = lap === laps && i === N - 1; // toute derniere station du parcours
      if (last && !s.runAfterLast) continue;
      const runNo = (lap - 1) * N + i + 1;
      const nextIdx = last ? -1 : (startIndex + i + 1) % N;
      const towards = nextIdx >= 0 ? `→ ${s.stations[nextIdx].label}` : "→ arrivée";
      parts.forEach((p, k) => {
        const letter = parts.length > 1 ? ` ${HX_PART_LETTERS[k] ?? k + 1}` : "";
        const label = `${s.runLabel.toUpperCase()} ${runNo}${letter}`;
        out.push({ key: parts.length > 1 ? `run:${runNo}:${k + 1}` : `run:${runNo}`, kind: "run", n: out.length + 1, lap, station: null, stationNo: nextIdx >= 0 ? nextIdx + 1 : 0, run: runNo, part: k + 1, label, short: label, detail: `${p} ${towards}` });
      });
    }
  }
  return out;
}

// Station de depart : celle choisie par le greffier, sinon round-robin sur le numero d'equipe (1 -> station 1, 10 -> 1…).
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
  lap: number; // tour en cours (le dernier une fois fini)
  finishedMs: number | null; // temps du WOD (dernier segment)
  cindy: number[]; // ms ecoulees de chaque tour de Cindy valide
  cards: number;
  penMs: number;
  scoreMs: number | null; // temps + penalites
  lastMs: number | null; // derniere validation (station, run ou Cindy)
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
  const current = finishedMs === null ? segments[done] : null;
  const nParts = ctx.settings.runParts.length || 1;
  return {
    team,
    startIndex,
    segments,
    times,
    splits,
    done,
    current,
    lap: current?.lap ?? Math.max(1, ctx.settings.laps),
    finishedMs,
    cindy,
    cards,
    penMs,
    scoreMs: finishedMs === null ? null : finishedMs + penMs,
    lastMs,
    stationsDone: segments.slice(0, done).filter((s) => s.kind === "station").length,
    // Runs COMPLETS (toutes les parties validees).
    runsDone: segments.slice(0, done).filter((s) => s.kind === "run" && s.part === nParts).length,
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
export type HXTop = { teamId: string; order: number; name: string; ms: number };

// Nombre total de runs du parcours (tous tours confondus).
export const runCount = (s: HXSettings) => s.stations.length * Math.max(1, s.laps) - (s.runAfterLast ? 0 : 1);

// Statistiques par station (tous tours confondus) et par run complet (somme de ses parties) ; `byTeam` garde la duree
// de chaque segment par sa cle (« st:st4 » tour 1, « st:st4:2 » tour 2, « run:7 ») ; `tops` = les 3 meilleures equipes
// de chaque station, chacune a son meilleur passage.
export function segmentStats(ctx: HXContext, topN = 3): { stations: HXStat[]; runs: HXStat[]; byTeam: Record<string, Record<string, number>>; tops: Record<string, HXTop[]> } {
  const acc = new Map<string, number[]>();
  const bestOf = new Map<string, Map<string, number>>(); // station -> equipe -> meilleur passage
  const byTeam: Record<string, Record<string, number>> = {};
  const nParts = ctx.settings.runParts.length || 1;
  for (const t of ctx.teams) {
    const st = teamState(ctx, t);
    byTeam[t.id] = {};
    const runAcc = new Map<number, { n: number; ms: number }>();
    for (let i = 0; i < st.done; i++) {
      const seg = st.segments[i];
      if (seg.kind === "station" && seg.station) {
        const k = `st:${seg.station.id}`;
        acc.set(k, [...(acc.get(k) ?? []), st.splits[i]]);
        byTeam[t.id][seg.key] = st.splits[i];
        const m = bestOf.get(k) ?? new Map<string, number>();
        m.set(t.id, Math.min(m.get(t.id) ?? Infinity, st.splits[i]));
        bestOf.set(k, m);
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
  const stations = ctx.settings.stations.map((s) => stat(`st:${s.id}`, s.label));
  const runs = Array.from({ length: runCount(ctx.settings) }, (_, i) => stat(`run:${i + 1}`, `${ctx.settings.runLabel.toUpperCase()} ${i + 1}`));
  const teamById = new Map(ctx.teams.map((t) => [t.id, t]));
  const tops: Record<string, HXTop[]> = {};
  for (const s of ctx.settings.stations) {
    const k = `st:${s.id}`;
    tops[k] = [...(bestOf.get(k) ?? new Map<string, number>())]
      .map(([teamId, ms]) => ({ teamId, order: teamById.get(teamId)?.order ?? 0, name: teamById.get(teamId)?.name ?? teamId, ms }))
      .sort((a, b) => a.ms - b.ms || a.order - b.order)
      .slice(0, topN);
  }
  return { stations, runs, byTeam, tops };
}

export function segmentLabel(ctx: HXContext, teamId: string, key: string): string {
  if (key === CINDY_KEY) return "Tour de Cindy";
  const team = ctx.teams.find((t) => t.id === teamId);
  if (!team) return key;
  const seg = segmentsFor(ctx.settings, startIndexOf(ctx, team)).find((s) => s.key === key);
  if (!seg) return key;
  return ctx.settings.laps > 1 && seg.kind === "station" ? `${seg.label} (tour ${seg.lap})` : seg.label;
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
    L.push([t.name, ...st.segments.map((s, i) => `${ctx.settings.laps > 1 ? `T${s.lap} ` : ""}${s.label}${i < st.done ? ` ${fmt(st.times[i])} (${fmt(st.splits[i])})` : ""}`), ...st.cindy.map((c, i) => `Cindy ${i + 1} ${fmt(c)}`)].join(";"));
  });
  L.push("");
  L.push("Statistiques (stations : tous tours confondus)");
  L.push(["Segment", "Passages", "Meilleur", "Moyen", "Top 3"].join(";"));
  const stats = segmentStats(ctx);
  stats.stations.forEach((s) => L.push([s.label, s.n, s.best !== null ? fmt(s.best) : "", s.avg !== null ? fmt(s.avg) : "", (stats.tops[s.key] ?? []).map((x) => `${x.name} ${fmt(x.ms)}`).join(" / ")].join(";")));
  stats.runs.forEach((s) => L.push([s.label, s.n, s.best !== null ? fmt(s.best) : "", s.avg !== null ? fmt(s.avg) : "", ""].join(";")));
  L.push("");
  L.push("Journal chronologique");
  L.push(["Temps", "Equipe", "Validation"].join(";"));
  const teamName = new Map(ctx.teams.map((t) => [t.id, t.name]));
  [...ctx.events].sort((a, b) => a.at - b.at).forEach((e) => L.push([fmt(e.at), teamName.get(e.teamId) ?? e.teamId, segmentLabel(ctx, e.teamId, e.key)].join(";")));
  L.push("");
  L.push("Reglages");
  ctx.settings.stations.forEach((s, i) => L.push([`Station ${i + 1}`, s.label, amountText(s.reps, s.unit)].join(";")));
  L.push(["Run", ctx.settings.runLabel, ctx.settings.runParts.join(" / ")].join(";"));
  L.push(["Tours", ctx.settings.laps].join(";"));
  L.push(["Temps limite (min)", ctx.settings.capMin].join(";"));
  L.push(["Carte jaune (s)", ctx.settings.penSec].join(";"));
  L.push(["Temps ecoule", fmt(liveMs)].join(";"));
  L.push(["Etat", state].join(";"));
  return "﻿" + L.join("\r\n");
}
