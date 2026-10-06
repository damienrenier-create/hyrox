// Note /20 d'un eleve a l'Eval S.O.R.O (Sartay 06/10, « uniquement pour les admins »). Module PUR : la page des notes
// et les extractions locales calculent avec les memes fonctions.
//   50 % perf de l'equipe · 25 % technique perso · 15 % technique de l'equipe · 10 % implication de l'equipe
//   - 1 point par carte jaune de l'equipe ; note bornee a 0-20.
// Perf : le travail fait a la fin officielle, chaque segment pese son temps de reference (eval-reference.ts : equipe
// moyenne du 05/10 ; un run 50 s). Seuil = 60 % du WOD de base (le parcours 3 etoiles), le meme pour tous les parcours
// (« tous les eleves commencent a avoir des points a partir du meme nombre de reps ») ; puis les points montent en ligne
// droite jusqu'a la note du parcours (annees, filles / garcons ou mixte), atteinte au parcours complet. Une equipe qui
// boucle son parcours avant la fin officielle a la note de son parcours.
import { EVAL_CARD_PENALTY, EVAL_DEFAULT_STARS, EVAL_BASE_GROUP, EVAL_LEVELS, EVAL_NOTE_MAX, EVAL_PERF_FLOOR, EVAL_TECH_MAX, EVAL_TECH_POINTS, EVAL_WEIGHTS, evalNote, isEvalGroup } from "./eval-bareme";
import { EVAL_RUN_MS, evalWorkMs } from "./eval-reference";
import { isImplicationCheck } from "./level-criteria";
import { qualityCodeFromValue } from "./wod-engines/core/quality";
import { hxStationReps, segmentsFor, type HXSegment, type HXSettings, type HXTeamState } from "./wod-engines/templates/hyrox-engine";

// Validations impossibles (audit du 05/10) : signalees, jamais retirees d'office.
export const EVAL_SUSPECT_STATION_MS = 30_000;
export const EVAL_SUSPECT_RUN_MS = 20_000;

const round1 = (x: number) => Math.round(x * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Parcours (etoiles) d'une seance sans niveaux : celui dont les repetitions sont celles des stations (60 = 5 etoiles).
export function courseStars(settings: HXSettings): number {
  const reps = settings.stations.filter((s) => s.unit === "rép.").map((s) => s.reps);
  const r = reps.length ? Math.max(...reps) : EVAL_LEVELS[EVAL_LEVELS.length - 1].reps;
  return [...EVAL_LEVELS].reverse().find((l) => l.reps <= r)?.stars ?? EVAL_LEVELS[0].stars;
}

function segmentWork(seg: HXSegment, settings: HXSettings, stars: number | null): number {
  if (seg.kind === "run" || !seg.station) return EVAL_RUN_MS / Math.max(1, settings.runParts.length);
  return evalWorkMs(seg.station.label, seg.station.unit, hxStationReps(seg.station, stars));
}
const workOf = (segs: HXSegment[], settings: HXSettings, stars: number | null) => segs.reduce((a, s) => a + segmentWork(s, settings, stars), 0);

export type EvalPerf = {
  stars: number; // parcours de l'equipe
  max: number; // note du parcours pour son groupe
  doneMs: number; // travail fait a la fin officielle (temps de reference)
  baseMs: number; // WOD de base (parcours 3 etoiles)
  courseMs: number; // parcours complet de l'equipe
  floorMs: number; // seuil : 60 % du WOD de base
  share: number; // part du WOD de base faite (0-1+)
  pointPct: number; // part du WOD de base qui rapporte 1 point (« chaque x % fait gagner 1/20 »)
  note: number;
  inTime: boolean;
  segmentsDone: number;
  segmentsTotal: number;
  suspects: { n: number; label: string; ms: number }[]; // validations trop rapides pour etre vraies
  excluded: number; // segments retires du calcul (variante sans les validations suspectes)
};

// `exclude` : numeros (0-based) de segments a ne pas compter (variante chiffree, jamais par defaut).
export function evalPerf(settings: HXSettings, st: HXTeamState, exclude: Set<number> = new Set()): EvalPerf {
  const officialMs = settings.capMin * 60_000;
  const stars = st.stars ?? courseStars(settings);
  const group = isEvalGroup(st.team.group) ? st.team.group : EVAL_BASE_GROUP;
  const max = evalNote(group, stars);
  const doneN = st.times.filter((t) => t <= officialMs).length;
  const done = st.segments.slice(0, doneN).filter((_, i) => !exclude.has(i));
  const doneMs = workOf(done, settings, st.stars);
  const baseMs = workOf(segmentsFor(settings, st.startIndex, EVAL_DEFAULT_STARS), settings, EVAL_DEFAULT_STARS);
  const courseMs = workOf(st.segments, settings, st.stars);
  const floorMs = EVAL_PERF_FLOOR * baseMs;
  const inTime = doneN >= st.segments.length && exclude.size === 0;
  const span = Math.max(1, courseMs - floorMs);
  const note = inTime ? max : doneMs <= floorMs ? 0 : Math.min(max, (max * (doneMs - floorMs)) / span);
  const suspects = st.splits.flatMap((ms, i) => {
    const seg = st.segments[i];
    const lim = seg.kind === "run" ? EVAL_SUSPECT_RUN_MS : EVAL_SUSPECT_STATION_MS;
    return ms < lim ? [{ n: i, label: `${seg.label}${seg.kind === "station" && seg.lap > 1 ? ` (tour ${seg.lap})` : ""}`, ms }] : [];
  });
  return { stars, max, doneMs, baseMs, courseMs, floorMs, share: doneMs / baseMs, pointPct: max > 0 ? span / max / baseMs : 0, note: round1(note), inTime, segmentsDone: doneN, segmentsTotal: st.segments.length, suspects, excluded: exclude.size };
}

// Appreciations d'arbitres (Evaluation + mode de l'Observation).
export type GradeEval = { targetUserId: string; teamId: string | null; exerciseId: string; value: number; staff: boolean; checks: { label: string; met: boolean }[] };

const techPoints = (value: number): number | null => {
  const code = qualityCodeFromValue(value);
  return code ? EVAL_TECH_POINTS[code] : null;
};

// Appreciations retenues pour un eleve : par exercice, celles des profs s'il y en a (« en cas de conflit, on ne garde
// que l'eval prof »), sinon celles des arbitres eleves.
export function keptEvals(evals: GradeEval[]): GradeEval[] {
  const byKey = new Map<string, GradeEval[]>();
  for (const e of evals) {
    const k = `${e.targetUserId}|${e.exerciseId}`;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  return [...byKey.values()].flatMap((list) => (list.some((e) => e.staff) ? list.filter((e) => e.staff) : list));
}

export type EvalTech = { note: number | null; exercises: { exerciseId: string; staff: boolean; n: number; points: number }[] };

// Technique perso /20 : moyenne par exercice (sur 5) puis moyenne des exercices, ramenee sur 20.
export function evalTech(kept: GradeEval[], userId: string): EvalTech {
  const mine = kept.filter((e) => e.targetUserId === userId);
  const ids = [...new Set(mine.map((e) => e.exerciseId))];
  const exercises = ids.flatMap((exerciseId) => {
    const list = mine.filter((e) => e.exerciseId === exerciseId);
    const pts = mean(list.flatMap((e) => { const p = techPoints(e.value); return p === null ? [] : [p]; }));
    return pts === null ? [] : [{ exerciseId, staff: list.some((e) => e.staff), n: list.length, points: pts }];
  });
  const m = mean(exercises.map((x) => x.points));
  return { note: m === null ? null : round1((m / EVAL_TECH_MAX) * EVAL_NOTE_MAX), exercises };
}

// Criteres d'equipe des grilles d'avant la ligne « implication » (seances du 05/10) : servent d'estimation.
const PROXY = ["L'élève reste avec ses deux coéquipiers", "L'élève ne démarre pas le run", "La transition entre les élèves"];
const isProxy = (label: string) => PROXY.some((p) => label.startsWith(p));

export type EvalInvolvement = { note: number | null; met: number; total: number; estimated: boolean };

// Implication de l'equipe /20 : part des lignes « implication » cochees par les profs sur les eleves de l'equipe ; a
// defaut, part des criteres d'equipe coches (rester groupes, partir au complet, transitions), notee « estimée ».
export function evalInvolvement(teamEvals: GradeEval[]): EvalInvolvement {
  const line = teamEvals.filter((e) => e.staff).flatMap((e) => e.checks.filter((c) => isImplicationCheck(c.label)));
  const pick = (list: GradeEval[]) => list.flatMap((e) => e.checks.filter((c) => isProxy(c.label)));
  const proxy = teamEvals.some((e) => e.staff && pick([e]).length) ? pick(teamEvals.filter((e) => e.staff)) : pick(teamEvals);
  const checks = line.length ? line : proxy;
  const met = checks.filter((c) => c.met).length;
  return { note: checks.length ? round1((EVAL_NOTE_MAX * met) / checks.length) : null, met, total: checks.length, estimated: !line.length && checks.length > 0 };
}

export type EvalParts = { perf: number | null; personal: number | null; team: number | null; involvement: number | null };
const PART_WEIGHT: Record<keyof EvalParts, number> = { perf: EVAL_WEIGHTS.perf, personal: EVAL_WEIGHTS.personal, team: EVAL_WEIGHTS.team, involvement: EVAL_WEIGHTS.involvement };

// Note finale : moyenne ponderee des parts connues (une part sans donnee laisse son poids aux autres), moins les
// cartes jaunes, bornee a 0-20.
export function evalFinal(parts: EvalParts, cards: number): { note: number; missing: (keyof EvalParts)[] } {
  const keys = Object.keys(PART_WEIGHT) as (keyof EvalParts)[];
  const known = keys.filter((k) => parts[k] !== null);
  const w = known.reduce((a, k) => a + PART_WEIGHT[k], 0);
  const raw = w ? known.reduce((a, k) => a + PART_WEIGHT[k] * (parts[k] as number), 0) / w : 0;
  return { note: round1(Math.max(0, Math.min(EVAL_NOTE_MAX, raw - EVAL_CARD_PENALTY * cards))), missing: keys.filter((k) => parts[k] === null) };
}

export type GradePupil = { userId: string; teamId: string; name: string; className: string | null; sex: string | null };
export type EvalGradeRow = {
  pupil: GradePupil;
  team: { id: string; order: number; name: string; size: number };
  perf: EvalPerf;
  perfWithoutSuspects: number | null; // perf si on retire les validations suspectes (null : aucune)
  personal: EvalTech;
  personalNote: number | null; // technique perso retenue (celle des coequipiers si l'eleve n'a pas ete observe)
  teamNote: number | null; // technique de l'equipe : celle des coequipiers observes
  involvement: EvalInvolvement;
  cards: number;
  note: number;
  flags: string[];
};

// Notes de tous les eleves d'une seance. `states` : un etat par equipe (teamState) ; `pupils` : les eleves (pas les
// profs inscrits dans une equipe).
export function evalGradeRows(settings: HXSettings, states: HXTeamState[], pupils: GradePupil[], evals: GradeEval[]): EvalGradeRow[] {
  const kept = keptEvals(evals);
  const tech = new Map(pupils.map((p) => [p.userId, evalTech(kept, p.userId)]));
  const teamOf = new Map(pupils.map((p) => [p.userId, p.teamId]));
  return states.flatMap((st) => {
    const members = pupils.filter((p) => p.teamId === st.team.id);
    if (!members.length) return [];
    const perf = evalPerf(settings, st);
    const perfWithoutSuspects = perf.suspects.length ? evalPerf(settings, st, new Set(perf.suspects.map((s) => s.n))).note : null;
    const teamEvals = kept.filter((e) => teamOf.get(e.targetUserId) === st.team.id);
    const involvement = evalInvolvement(teamEvals);
    return members.map((p) => {
      const flags: string[] = [];
      const personal = tech.get(p.userId)!;
      const mates = members.filter((m) => m.userId !== p.userId).map((m) => tech.get(m.userId)!.note).filter((n): n is number => n !== null);
      const matesNote = mates.length ? round1(mean(mates)!) : null;
      let personalNote = personal.note;
      if (personalNote === null && matesNote !== null) { personalNote = matesNote; flags.push("pas observé : technique de ses coéquipiers"); }
      let teamNote = matesNote;
      if (teamNote === null && personal.note !== null) { teamNote = personal.note; flags.push(members.length > 1 ? "coéquipiers pas observés : sa propre technique" : "seul dans son équipe : sa propre technique"); }
      if (involvement.estimated) flags.push("implication estimée (critères d'équipe des arbitres)");
      if (members.length < 3) flags.push(`équipe de ${members.length}`);
      if (perf.suspects.length) flags.push(`${perf.suspects.length} validation${perf.suspects.length > 1 ? "s" : ""} suspecte${perf.suspects.length > 1 ? "s" : ""}`);
      const { note, missing } = evalFinal({ perf: perf.note, personal: personalNote, team: teamNote, involvement: involvement.note }, st.cards);
      const NAMES: Record<keyof EvalParts, string> = { perf: "perf", personal: "technique perso", team: "technique d'équipe", involvement: "implication" };
      if (missing.length) flags.push(`sans ${missing.map((k) => NAMES[k]).join(", ")} : poids reportés sur le reste`);
      if (st.cards) flags.push(`${st.cards} carte${st.cards > 1 ? "s" : ""} jaune${st.cards > 1 ? "s" : ""} : -${EVAL_CARD_PENALTY * st.cards}`);
      return { pupil: p, team: { id: st.team.id, order: st.team.order, name: st.team.name, size: members.length }, perf, perfWithoutSuspects, personal, personalNote, teamNote, involvement, cards: st.cards, note, flags };
    });
  });
}

// Export CSV (« ; », virgule decimale : Excel en francais).
export function evalGradesCsv(rows: EvalGradeRow[], settings: HXSettings): string {
  const n = (x: number | null) => (x === null ? "" : x.toFixed(1).replace(".", ","));
  const label = (id: string) => (id === "run" ? "Run" : settings.stations.find((s) => s.id === id)?.label ?? id);
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["Équipe", "Élève", "Classe", "Parcours (étoiles)", "Note du parcours", "Segments validés", "Part du WOD de base (%)", "Perf /20", "Technique perso /20", "Technique de l'équipe /20", "Implication /20", "Cartes jaunes", "Note /20", "Appréciations retenues (sur 5)", "Remarques"];
  const lines = rows.map((r) => [
    `E${r.team.order}`, r.pupil.name, r.pupil.className ?? "", String(r.perf.stars), String(r.perf.max), `${r.perf.segmentsDone}/${r.perf.segmentsTotal}`, String(Math.round(r.perf.share * 100)),
    n(r.perf.note), n(r.personalNote), n(r.teamNote), n(r.involvement.note), String(r.cards), n(r.note),
    r.personal.exercises.map((x) => `${label(x.exerciseId)} ${n(x.points)}${x.staff ? " (prof)" : ""}`).join(" · "), r.flags.join(" ; "),
  ].map(q).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n");
}
