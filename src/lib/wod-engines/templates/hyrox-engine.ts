// Moteur « Eval » (ex-« Hyrox », Sartay 01-03/10 ; identifiant de WOD inchange : HYROX). Equipes de 3, 10 stations,
// un run APRES chaque station, le circuit se fait 2 FOIS (2 tours), depart decale (chaque equipe commence a SA station
// et tourne), fin officielle a 55 min puis 5 min de prolongation (la Cindy de fin de parcours a ete abandonnee le
// 03/10). Chaque station et chaque run sont valides a l'ordi : un pointage date par segment -> temps par station, par
// run, total ; un classement au temps (+ penalites des cartes jaunes). Chaque equipe choisit son niveau « etoiles »
// avant son depart (40 a 60 repetitions, 3 etoiles par defaut). Tout est reglable par seance (stations, reps, tours).
// Module PUR : temps en ms ECOULEES de course (pauses deduites), comme la Fete Foraine.

import { EVAL_BASE_GROUP, EVAL_DEFAULT_STARS, EVAL_GROUPS, EVAL_LEVELS, evalGroupLabel, evalLevelReps, evalNote, isEvalGroup, isEvalStars, noteText } from "@/lib/eval-bareme";

export const HX_MIN_STATIONS = 2;
export const HX_MAX_STATIONS = 12;
export const HX_MAX_LAPS = 4;
export type HXStation = { id: string; label: string; reps: number; unit: string };
export const HX_UNITS = ["rép.", "A/R", "m", "s"] as const;
// Version « Eval » du 03/10 : 3 stations en allers-retours puis 6 stations a 60 repetitions. Les stations sont des
// EMPLACEMENTS st1..stN (Team.startExerciseId, colonnes du Touche-Coule) ; libelles, reps et nombre se reglent avant le depart.
// 04/10 (Sartay) : le break dance remplace le one rep en station 4. Une seance deja jouee garde SON parcours : il est
// fige dans ses reglages a la premiere validation (freezeHXCourse, hyrox-context.ts).
// 05/10 (Sartay, apres les trois premieres seances reelles) : burpees, fentes et farmer passent de 3 a 2 allers-retours.
// Les seances jouees a 3 allers-retours les gardent (parcours fige).
// 05/10 au soir (Sartay) : « rajouter une dixieme station (Helico) », et un nouvel ordre : « apres les pompages on met
// les helicos, puis les wall ball shot, puis les KB swing, puis la corde ». Les seances deja jouees gardent leurs
// 9 stations dans leur ordre (parcours fige).
export const HX_DEFAULT_STATIONS: HXStation[] = [
  { id: "st1", label: "Burpees broad jump", reps: 2, unit: "A/R" },
  { id: "st2", label: "Fentes marchées", reps: 2, unit: "A/R" },
  { id: "st3", label: "Farmer carry", reps: 2, unit: "A/R" },
  { id: "st4", label: "Break dance", reps: 60, unit: "rép." },
  { id: "st5", label: "Squats", reps: 60, unit: "rép." },
  { id: "st6", label: "Pompage", reps: 60, unit: "rép." },
  { id: "st7", label: "Hélico", reps: 60, unit: "rép." },
  { id: "st8", label: "Wall ball shot", reps: 60, unit: "rép." },
  { id: "st9", label: "KB swing", reps: 60, unit: "rép." },
  { id: "st10", label: "Corde", reps: 60, unit: "rép." },
];

// Niveaux « etoiles » = parcours (Sartay 05/10 : « les eleves peuvent choisir leur niveau », « comme ca on peut prendre
// les stats en fonction des parcours », puis : « on doit proposer seulement des parcours a 40-45-50-55-60 ; le niveau de
// base est a 3 etoiles pour tout le monde ; max 5 etoiles »). Le parcours d'une equipe fixe les repetitions des stations
// comptees en repetitions, les memes pour tout le monde ; les allers-retours ne changent pas. Les points qui vont avec
// dependent aussi des annees et du sexe (eval-bareme.ts). « Pas de changement de niveau » : fige a la 1re validation.
export const HX_LEVELS = EVAL_LEVELS;
export const HX_LEVEL_BASE = 60; // les quantites des stations sont ecrites pour 60 repetitions (5 etoiles)
export const HX_DEFAULT_STARS = EVAL_DEFAULT_STARS;
export const isHXStars = isEvalStars;
export const hxLevelReps = (stars: number | null | undefined): number => (stars == null ? HX_LEVEL_BASE : evalLevelReps(stars));
// Quantite d'une station au niveau d'une equipe : seules les stations en repetitions suivent le niveau.
export const hxStationReps = (st: HXStation, stars: number | null | undefined): number => (stars == null || st.unit !== "rép." ? st.reps : Math.round((st.reps * hxLevelReps(stars)) / HX_LEVEL_BASE));
// Une station d'une seance a l'autre (son emplacement peut changer) : libelle, unite et quantite de base.
export const hxStationKey = (st: HXStation) => `${st.label.trim().toUpperCase()}|${st.unit}|${st.reps}`;

export type HXSettings = {
  stations: HXStation[];
  runLabel: string;
  // Un run peut se valider en plusieurs parties nommees (« RUN 1 A, B, C ») : une validation a l'ordi par partie.
  // Version Eval : une seule partie, « 2 allers-retours ».
  runParts: string[];
  runAfterLast: boolean; // un run apres la toute derniere station aussi (Eval : oui, « apres CHAQUE station »)
  laps: number; // nombre de tours du circuit (Eval : 2)
  capMin: number; // fin OFFICIELLE du WOD : le classement et les notes s'arretent la
  // Prolongation (Sartay 05/10 : « fin du wod officiel a 55 min, mais le chrono va jusqu'a 60 si jamais on a le temps ») :
  // minutes pendant lesquelles on valide encore apres la fin officielle ; a capMin + extraMin la course s'arrete seule.
  extraMin: number;
  levels: boolean; // niveaux « etoiles » : chaque equipe choisit son nombre de repetitions
  penSec: number; // secondes ajoutees au temps par carte jaune
};
export const HX_MAX_RUN_PARTS = 4;
export const HX_PART_LETTERS = ["A", "B", "C", "D"];
export const HX_DEFAULTS: HXSettings = {
  stations: HX_DEFAULT_STATIONS,
  runLabel: "Run",
  runParts: ["2 allers-retours"],
  runAfterLast: true,
  laps: 2,
  capMin: 55,
  extraMin: 5,
  levels: true,
  penSec: 60,
};

const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

// Reglages de la seance (Session.settings.hyrox) par-dessus les valeurs par defaut, bornes comprises. Une seance
// enregistree AVANT les tours (pas de `laps`) reste a 1 tour : son parcours ne change pas apres coup. De meme, une
// seance enregistree avant la prolongation et les niveaux (05/10) reste sans prolongation et sans niveaux.
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
    extraMin: num(h?.extraMin, h ? 0 : HX_DEFAULTS.extraMin, 0, 60),
    levels: h ? h.levels === true : HX_DEFAULTS.levels,
    penSec: num(h?.penSec, HX_DEFAULTS.penSec, 0, 600),
  };
}

// Parcours choisi par chaque equipe avant son depart (Session.settings.hxStars = { [teamId]: etoiles }) : il se fige a
// sa premiere validation (« pas de changement de niveau », hxSetLevelAction).
export function readHXStars(settings: unknown): Record<string, number> {
  const raw = (settings as { hxStars?: unknown } | null)?.hxStars;
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isHXStars(v)) out[k] = v;
  return out;
}

export type HXMember = { memberId: string; userId: string; name: string; quiz: number | null }; // quiz = score au QCM bonus (null = pas repondu)
// `stars` = parcours de l'equipe (choisi, sinon 3 etoiles) ; `group` = son groupe pour les points (annees + filles /
// garcons ou mixte, voir eval-bareme.ts).
export type HXTeam = { id: string; order: number; name: string; startStationId: string | null; members: HXMember[]; stars?: number | null; group?: string | null };
// key = "st:<id>[:<tour>]" | "run:<n>[:<partie>]" ; at = ms ecoulees de course ; abs = heure d'horloge du clic (ms epoch,
// null pour un clic local pas encore confirme par le serveur) : c'est elle qu'on compare a l'heure des arbitres.
export type HXEvent = { id: string; teamId: string; key: string; at: number; abs: number | null };
// `by` : qui l'a donnee (« Léa M. · arbitre ») ; `reason` : son motif (cartes des arbitres, depuis le 06/10).
export type HXCard = { id: string; teamId: string; at: number; by?: string | null; reason?: string | null };
export type HXContext = { teams: HXTeam[]; settings: HXSettings; events: HXEvent[]; cards: HXCard[] };

// Ancienne cle des tours de Cindy (AMRAP apres le parcours, abandonnee le 03/10 : « on laisse tomber le cindy »). Les
// pointages deja enregistres sous cette cle restent en base (regle d'or) et sont ignores par le calcul.
export const CINDY_KEY = "cindy";

// Heure d'horloge (Bruxelles) d'une validation : « 09:12:05 ». Meme rendu cote serveur et cote navigateur.
const CLOCK = new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const clockText = (abs: number | null | undefined): string => (abs == null ? "" : CLOCK.format(abs));

export function fmt(ms: number | null | undefined): string {
  if (ms == null) return "";
  const neg = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (neg ? "−" : "") + m + ":" + (r < 10 ? "0" : "") + r;
}

// « 2 allers-retours », « 60 rép. », « 50 m » : la consigne d'une station telle que l'eleve la lit.
export function amountText(reps: number, unit: string): string {
  if (unit === "A/R") return `${reps} aller${reps > 1 ? "s" : ""}-retour${reps > 1 ? "s" : ""}`;
  return `${reps} ${unit}`;
}

// Un segment du parcours d'une equipe : une station, ou une partie de run. `n` = position (1..), `lap` = tour,
// `stationNo` = numero de la station (pour un run : celle VERS laquelle on court, 0 = arrivee), `run` / `part` = numero
// du run (continu sur tous les tours) et de sa partie. `label` = ce que lit l'eleve sur la fiche (nom de l'exo, sans numero).
export type HXSegment = { key: string; kind: "station" | "run"; n: number; lap: number; station: HXStation | null; stationNo: number; run: number; part: number; label: string; short: string; detail: string };

// `stars` = niveau de l'equipe (null ou absent : les quantites des reglages, telles quelles).
export function segmentsFor(s: HXSettings, startIndex: number, stars: number | null = null): HXSegment[] {
  const out: HXSegment[] = [];
  const N = s.stations.length;
  const laps = Math.max(1, s.laps);
  const parts = s.runParts.length ? s.runParts : HX_DEFAULTS.runParts;
  for (let lap = 1; lap <= laps; lap++) {
    for (let i = 0; i < N; i++) {
      const idx = (startIndex + i) % N;
      const st = s.stations[idx];
      out.push({ key: `st:${st.id}${lap > 1 ? `:${lap}` : ""}`, kind: "station", n: out.length + 1, lap, station: st, stationNo: idx + 1, run: 0, part: 0, label: st.label, short: st.label, detail: amountText(hxStationReps(st, stars), st.unit) });
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
  clocks: (number | null)[]; // heure d'horloge de chaque validation (meme ordre)
  splits: number[]; // duree de chaque segment valide
  done: number;
  current: HXSegment | null; // segment en cours (null = parcours fini)
  lap: number; // tour en cours (le dernier une fois fini)
  finishedMs: number | null; // temps du WOD (dernier segment), prolongation comprise
  // Fin officielle (capMin) : `inTime` = parcours boucle avant ; `doneAtCap` = segments valides a cet instant (les
  // validations de la prolongation ne comptent ni pour le classement ni pour la note) ; `capLastMs` = derniere
  // validation comptee. Seance sans prolongation : la fin officielle est la fin de course, doneAtCap = done.
  inTime: boolean;
  doneAtCap: number;
  capLastMs: number | null;
  stars: number | null; // niveau de l'equipe (null : seance sans niveaux)
  levelReps: number | null; // repetitions par station a ce niveau
  cards: number;
  penMs: number;
  scoreMs: number | null; // temps + penalites
  lastMs: number | null; // derniere validation (station ou run)
  stationsDone: number;
  runsDone: number;
  quiz: { done: number; score: number }; // QCM bonus : eleves ayant repondu, somme de leurs points (bareme a fixer)
};

export function teamState(ctx: HXContext, team: HXTeam): HXTeamState {
  const startIndex = startIndexOf(ctx, team);
  const stars = ctx.settings.levels ? (isHXStars(team.stars) ? team.stars : HX_DEFAULT_STARS) : null;
  const segments = segmentsFor(ctx.settings, startIndex, stars);
  const ev = ctx.events.filter((e) => e.teamId === team.id).sort((a, b) => a.at - b.at);
  const times: number[] = [];
  const clocks: (number | null)[] = [];
  for (const e of ev) {
    if (e.key === CINDY_KEY) continue; // ancien pointage Cindy : ignore
    if (times.length < segments.length) {
      times.push(e.at);
      clocks.push(e.abs);
    }
  }
  const splits = times.map((t, i) => t - (i ? times[i - 1] : 0));
  const done = times.length;
  const finishedMs = done >= segments.length ? times[segments.length - 1] : null;
  const cards = ctx.cards.filter((c) => c.teamId === team.id).length;
  const penMs = cards * ctx.settings.penSec * 1000;
  const lastMs = done ? times[done - 1] : null;
  const current = finishedMs === null ? segments[done] : null;
  const nParts = ctx.settings.runParts.length || 1;
  const officialMs = ctx.settings.extraMin > 0 ? ctx.settings.capMin * 60_000 : Infinity;
  const doneAtCap = times.filter((t) => t <= officialMs).length;
  return {
    team,
    startIndex,
    segments,
    times,
    clocks,
    splits,
    done,
    current,
    lap: current?.lap ?? Math.max(1, ctx.settings.laps),
    finishedMs,
    inTime: finishedMs !== null && finishedMs <= officialMs,
    doneAtCap,
    capLastMs: doneAtCap ? times[doneAtCap - 1] : null,
    stars,
    levelReps: stars === null ? null : hxLevelReps(stars),
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

// Classement au temps, arrete a la FIN OFFICIELLE : equipes arrivees avant par temps + penalites, puis les autres par
// segments faits a cet instant (la plus avancee d'abord, a egalite la plus rapide). Ce qui est valide en prolongation
// ne fait que departager deux equipes a egalite parfaite.
export function timeRows(ctx: HXContext): HXTeamState[] {
  const out = ctx.teams.map((t) => teamState(ctx, t));
  out.sort((a, b) => {
    if (a.inTime && b.inTime) return a.scoreMs! - b.scoreMs! || a.team.order - b.team.order;
    if (a.inTime) return -1;
    if (b.inTime) return 1;
    if (a.doneAtCap !== b.doneAtCap) return b.doneAtCap - a.doneAtCap;
    if (a.capLastMs !== null && b.capLastMs !== null && a.capLastMs !== b.capLastMs) return a.capLastMs - b.capLastMs;
    if (a.done !== b.done) return b.done - a.done;
    return a.team.order - b.team.order;
  });
  return out;
}

// Note de perf d'une equipe (bareme de eval-bareme.ts) : les points de son parcours pour son groupe, si elle a boucle le WOD avant la
// fin officielle. `max` = cette note maximale, `note` = la note acquise (null tant que le WOD n'est pas boucle a temps :
// la regle pour un WOD inacheve n'est pas fixee), `share` = part du WOD faite a la fin officielle.
export function hxIntensity(st: HXTeamState): { group: string; max: number; note: number | null; share: number } | null {
  if (st.stars === null) return null;
  const group = isEvalGroup(st.team.group) ? st.team.group : EVAL_BASE_GROUP;
  const max = evalNote(group, st.stars);
  return { group: evalGroupLabel(group), max, note: st.inTime ? max : null, share: st.segments.length ? st.doneAtCap / st.segments.length : 0 };
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

// Top 1 de chaque parcours sur chaque station (Sartay 05/10 : « a droite on ne garde que le top 1 de chaque
// parcours ») : le meilleur passage des equipes de chaque niveau, tous tours confondus. `stars` = niveaux en jeu.
export function parcoursTops(ctx: HXContext): { stars: number[]; tops: Record<string, Record<number, HXTop>> } {
  const tops: Record<string, Record<number, HXTop>> = {};
  const inPlay = new Set<number>();
  for (const t of ctx.teams) {
    const st = teamState(ctx, t);
    if (st.stars === null) continue;
    inPlay.add(st.stars);
    for (let i = 0; i < st.done; i++) {
      const seg = st.segments[i];
      if (seg.kind !== "station" || !seg.station) continue;
      const k = `st:${seg.station.id}`;
      const byStars = (tops[k] = tops[k] ?? {});
      const cur = byStars[st.stars];
      if (!cur || st.splits[i] < cur.ms) byStars[st.stars] = { teamId: t.id, order: t.order, name: t.name, ms: st.splits[i] };
    }
  }
  return { stars: [...inPlay].sort((a, b) => b - a), tops };
}

export function segmentLabel(ctx: HXContext, teamId: string, key: string): string {
  if (key === CINDY_KEY) return "Tour de Cindy (ancien)";
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
  const lv = ctx.settings.levels;
  L.push(["Rang", "Equipe", "Eleves", ...(lv ? ["Niveau (etoiles)", "Repetitions", "Groupe"] : []), "Depart", "Stations", "Runs", "Temps WOD", "Cartes jaunes", "Penalites", "Score", ...(lv ? ["Segments a la fin officielle", "Part du WOD (%)", "Note perf max /20", "Note perf /20"] : []), "QCM (points)", "QCM (reponses)"].join(";"));
  let rank = 0;
  timeRows(ctx).forEach((st) => {
    if (st.inTime) rank++;
    const it = hxIntensity(st);
    L.push([st.inTime ? rank : "", st.team.name, members(st.team), ...(lv ? [st.stars ?? "", st.levelReps ?? "", it?.group ?? ""] : []), st.startIndex + 1, st.stationsDone, st.runsDone, st.finishedMs !== null ? `${fmt(st.finishedMs)}${st.inTime ? "" : " (prolongation)"}` : "", st.cards, st.cards ? fmt(st.penMs) : "", st.inTime ? fmt(st.scoreMs) : "", ...(lv ? [`${st.doneAtCap}/${st.segments.length}`, it ? Math.round(it.share * 100) : "", it ? noteText(it.max) : "", it?.note != null ? noteText(it.note) : ""] : []), st.quiz.done ? st.quiz.score : "", st.quiz.done].join(";"));
  });
  L.push("");
  L.push("Detail par equipe (heure du clic, temps ecoule a la validation ; entre parentheses : duree du segment)");
  ctx.teams.forEach((t) => {
    const st = teamState(ctx, t);
    L.push([t.name, ...st.segments.map((s, i) => `${ctx.settings.laps > 1 ? `T${s.lap} ` : ""}${s.label}${i < st.done ? ` ${st.clocks[i] != null ? `${clockText(st.clocks[i])} ` : ""}${fmt(st.times[i])} (${fmt(st.splits[i])})` : ""}`)].join(";"));
  });
  L.push("");
  L.push("Statistiques (stations : tous tours confondus)");
  L.push(["Segment", "Passages", "Meilleur", "Moyen", "Top 3"].join(";"));
  const stats = segmentStats(ctx);
  stats.stations.forEach((s) => L.push([s.label, s.n, s.best !== null ? fmt(s.best) : "", s.avg !== null ? fmt(s.avg) : "", (stats.tops[s.key] ?? []).map((x) => `${x.name} ${fmt(x.ms)}`).join(" / ")].join(";")));
  stats.runs.forEach((s) => L.push([s.label, s.n, s.best !== null ? fmt(s.best) : "", s.avg !== null ? fmt(s.avg) : "", ""].join(";")));
  L.push("");
  L.push("Journal chronologique");
  L.push(["Heure", "Temps de course", "Equipe", "Validation"].join(";"));
  const teamName = new Map(ctx.teams.map((t) => [t.id, t.name]));
  [...ctx.events].sort((a, b) => a.at - b.at).forEach((e) => L.push([clockText(e.abs), fmt(e.at), teamName.get(e.teamId) ?? e.teamId, segmentLabel(ctx, e.teamId, e.key)].join(";")));
  L.push("");
  L.push("Reglages");
  ctx.settings.stations.forEach((s, i) => L.push([`Station ${i + 1}`, s.label, `${amountText(s.reps, s.unit)}${ctx.settings.levels && s.unit === "rép." ? " (au niveau 5 etoiles)" : ""}`].join(";")));
  L.push(["Run", ctx.settings.runLabel, ctx.settings.runParts.join(" / ")].join(";"));
  L.push(["Tours", ctx.settings.laps].join(";"));
  L.push([ctx.settings.extraMin > 0 ? "Fin officielle (min)" : "Temps limite (min)", ctx.settings.capMin].join(";"));
  if (ctx.settings.extraMin > 0) L.push(["Prolongation (min)", ctx.settings.extraMin].join(";"));
  if (lv) {
    L.push(["Parcours (etoiles = repetitions par station)", HX_LEVELS.map((l) => `${l.stars} = ${l.reps}`).join(" / "), `${HX_DEFAULT_STARS} par defaut`].join(";"));
    EVAL_GROUPS.forEach((g) => L.push([`Note perf /20 ${g.years} ${g.team}`, HX_LEVELS.map((l) => `${l.reps} rep = ${evalNote(g.key, l.stars)}`).join(" / ")].join(";")));
  }
  L.push(["Carte jaune (s)", ctx.settings.penSec].join(";"));
  L.push(["Temps ecoule", fmt(liveMs)].join(";"));
  L.push(["Etat", state].join(";"));
  return "﻿" + L.join("\r\n");
}
