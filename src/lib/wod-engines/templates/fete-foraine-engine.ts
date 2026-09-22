// Moteur « Fête Foraine » : port fidele de Downloads/WOD - FETE FORAINE.html (chrono, corde a sauter repetable
// entre 6 ateliers, Fin du WOD, penalites, Finisher par coureur, classements equipes / couleurs / coureurs).
// Module PUR : aucune dependance base de donnees. Les temps sont des millisecondes ECOULEES de course
// (pauses deja deduites), comme dans le fichier d'origine.

export const FF_COLORS = ["jaune", "vert", "bleu", "rouge"] as const;
export type FFColor = (typeof FF_COLORS)[number];
export const FF_CHEX: Record<FFColor, string> = { jaune: "#E0A800", vert: "#1E7A3C", bleu: "#1B5FA8", rouge: "#B02A1F" };

export type FFStation = { id: string; label: string; reps: number; repeat?: boolean; n?: number };
export const FF_STATIONS: FFStation[] = [
  { id: "corde", label: "Corde à sauter", repeat: true, reps: 100 },
  { id: "ex1", n: 1, label: "Hélicoptère", reps: 100 },
  { id: "ex2", n: 2, label: "Plank Slide", reps: 100 },
  { id: "ex3", n: 3, label: "Snatch", reps: 100 },
  { id: "ex4", n: 4, label: "Pompage", reps: 100 },
  { id: "ex5", n: 5, label: "Squat", reps: 150 },
  { id: "ex6", n: 6, label: "Traction", reps: 50 },
];
export const FF_EX = FF_STATIONS.filter((s) => !s.repeat);
export const FF_UNITS = [1, 5, 10, 15, 30, 60];
export const FF_MAX_MEMBERS = 4;

export type FFEvent = { teamId: string; stationId: string; at: number }; // at = ms ecoulees
export type FFRunner = { memberId: string; userId: string; name: string; points: number };
export type FFTeam = { id: string; order: number; name: string; color: FFColor | null; penalties: number; runners: FFRunner[] };
export type FFSettings = { unit: number; mode: "avg" | "sum" };
export type FFContext = {
  teams: FFTeam[]; // tries par order
  exercises: FFStation[]; // ateliers non repetables, dans l'ordre de la seance (libelles eventuellement surcharges)
  events: FFEvent[];
  settings: FFSettings;
};

export function fmt(ms: number | null | undefined): string {
  if (ms == null) return "";
  const neg = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (neg ? "−" : "") + m + ":" + (r < 10 ? "0" : "") + r;
}
export function num(x: number): string {
  return (Math.round(x * 10) / 10).toString().replace(".", ",");
}

export function defColor(order: number): FFColor {
  return FF_COLORS[(Math.max(1, order) - 1) % 4];
}
export function colorOf(team: FFTeam): FFColor {
  return team.color ?? defColor(team.order);
}
export function nextColor(c: FFColor): FFColor {
  return FF_COLORS[(FF_COLORS.indexOf(c) + 1) % 4];
}

export type FFRunnerState = FFRunner & { score: number | null };
export type FFTeamState = {
  team: FFTeam;
  corde: number[];
  ex: Record<string, number>;
  fin: number | null;
  exDone: number;
  wod: number | null;
  pen: number;
  penMs: number;
  base: number | null;
  list: FFRunnerState[];
  sum: number;
  avg: number;
  teamPts: number;
  score: number | null;
};

export function teamState(ctx: FFContext, team: FFTeam): FFTeamState {
  const corde: number[] = [];
  const ex: Record<string, number> = {};
  let fin: number | null = null;
  for (const e of ctx.events) {
    if (e.teamId !== team.id) continue;
    if (e.stationId === "corde") corde.push(e.at);
    else if (e.stationId === "fin") fin = e.at;
    else ex[e.stationId] = e.at;
  }
  const exDone = ctx.exercises.filter((x) => ex[x.id] != null).length;
  const wod = fin;
  const pen = team.penalties || 0;
  const penMs = pen * ctx.settings.unit * 1000;
  const base = wod === null ? null : wod + penMs;
  const runners = team.runners.length ? team.runners : [{ memberId: "", userId: "", name: "(sans prénom)", points: 0 }];
  const sum = runners.reduce((a, r) => a + (r.points || 0), 0);
  const avg = runners.length ? sum / runners.length : 0;
  const teamPts = ctx.settings.mode === "sum" ? sum : avg;
  const score = base === null ? null : Math.max(0, base - teamPts * ctx.settings.unit * 1000);
  const list: FFRunnerState[] = runners.map((r) => ({ ...r, score: base === null ? null : Math.max(0, base - (r.points || 0) * ctx.settings.unit * 1000) }));
  return { team, corde, ex, fin, exDone, wod, pen, penMs, base, list, sum, avg, teamPts, score };
}

export function teamRows(ctx: FFContext): FFTeamState[] {
  const out = ctx.teams.map((t) => teamState(ctx, t));
  out.sort((a, b) => {
    if (a.score === null && b.score === null) return a.team.order - b.team.order;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });
  return out;
}

export type FFColorRow = { color: FFColor; n: number; done: number; avg: number | null };
export function colorRows(ctx: FFContext): FFColorRow[] {
  const agg: Record<FFColor, { n: number; done: number; sum: number }> = { jaune: { n: 0, done: 0, sum: 0 }, vert: { n: 0, done: 0, sum: 0 }, bleu: { n: 0, done: 0, sum: 0 }, rouge: { n: 0, done: 0, sum: 0 } };
  for (const t of ctx.teams) {
    const c = colorOf(t);
    const st = teamState(ctx, t);
    agg[c].n++;
    if (st.score !== null) {
      agg[c].done++;
      agg[c].sum += st.score;
    }
  }
  const list = FF_COLORS.map((c) => ({ color: c, n: agg[c].n, done: agg[c].done, avg: agg[c].done ? agg[c].sum / agg[c].done : null })).filter((x) => x.n > 0);
  list.sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  });
  return list;
}

export type FFRunnerRow = { team: FFTeam; st: FFTeamState; runner: FFRunnerState };
export function runnerRows(ctx: FFContext): FFRunnerRow[] {
  const out: FFRunnerRow[] = [];
  for (const t of ctx.teams) {
    const st = teamState(ctx, t);
    st.list.forEach((r) => out.push({ team: t, st, runner: r }));
  }
  out.sort((a, b) => {
    if (a.runner.score === null && b.runner.score === null) return a.team.order - b.team.order;
    if (a.runner.score === null) return 1;
    if (b.runner.score === null) return -1;
    return a.runner.score - b.runner.score;
  });
  return out;
}

export function stationLabel(ctx: FFContext, id: string): string {
  if (id === "fin") return "Fin du WOD";
  if (id === "corde") return FF_STATIONS[0].label;
  return ctx.exercises.find((x) => x.id === id)?.label ?? id;
}

// Export CSV : memes sections que « Exporter vers Excel » du fichier d'origine.
export function ffCsv(ctx: FFContext, liveMs: number, state: "terminee" | "en pause" | "en cours" | "pas commencee"): string {
  const L: string[] = [];
  L.push("Classement des couleurs");
  L.push(["Couleur", "Equipes classees", "Equipes", "Score moyen"].join(";"));
  colorRows(ctx).forEach((x) => L.push([x.color, x.done, x.n, x.avg !== null ? fmt(x.avg) : ""].join(";")));

  L.push("");
  L.push("Classement des equipes");
  const head = ["Rang", "Equipe", "Couleur", "Participants", "Corde a sauter", ...ctx.exercises.map((x) => x.label), "Temps WOD", "Penalites", "Bonus penalites", "Finisher equipe (pts)", "Score equipe"];
  L.push(head.join(";"));
  let rank = 0;
  teamRows(ctx).forEach((st) => {
    if (st.score !== null) rank++;
    const line: (string | number)[] = [st.score !== null ? rank : "", st.team.name, colorOf(st.team), st.team.runners.map((r) => r.name).join(" / "), st.corde.length];
    ctx.exercises.forEach((x) => line.push(st.ex[x.id] != null ? fmt(st.ex[x.id]) : ""));
    line.push(st.wod !== null ? fmt(st.wod) : "", st.pen, st.pen ? fmt(st.penMs) : "", num(st.teamPts), st.score !== null ? fmt(st.score) : "");
    L.push(line.join(";"));
  });

  L.push("");
  L.push("Classement individuel");
  L.push(["Rang", "Coureur", "Equipe", "Couleur", "Temps equipe", "Penalites", "Finisher (pts)", "Score"].join(";"));
  let r2 = 0;
  runnerRows(ctx).forEach((r) => {
    if (r.runner.score !== null) r2++;
    L.push([r.runner.score !== null ? r2 : "", r.runner.name, r.team.name, colorOf(r.team), r.st.wod !== null ? fmt(r.st.wod) : "", r.st.pen ? fmt(r.st.penMs) : "", r.runner.points, r.runner.score === null ? "" : fmt(r.runner.score)].join(";"));
  });

  L.push("");
  L.push("Journal chronologique");
  L.push(["Temps", "Equipe", "Atelier"].join(";"));
  const teamName = new Map(ctx.teams.map((t) => [t.id, t.name]));
  [...ctx.events].sort((a, b) => a.at - b.at).forEach((e) => L.push([fmt(e.at), teamName.get(e.teamId) ?? e.teamId, stationLabel(ctx, e.stationId)].join(";")));

  L.push("");
  L.push("Reglages");
  L.push(["1 point = (secondes)", ctx.settings.unit].join(";"));
  L.push(["Finisher d'equipe", ctx.settings.mode === "sum" ? "somme des coureurs" : "moyenne des coureurs"].join(";"));
  L.push(["Temps ecoule", fmt(liveMs)].join(";"));
  L.push(["Etat", state].join(";"));
  return "﻿" + L.join("\r\n");
}
