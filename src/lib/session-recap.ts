import { db } from "@/lib/db";
import { buildLevelBundle, levelPointsOf, levelStandings, levelsForTeam } from "@/lib/level-context";
import { PACE_FAST, paceReport, type PaceRun } from "@/lib/level-pace";
import { codeOf, dissonances, gradeOf, isBad, isExcellent, levelIndex, refereeRanking } from "@/lib/eval-insights";
import { GRADED_CRITERIA, gradeOfAnswers } from "@/lib/carnet";
import { displayName } from "@/lib/staff-names";
import { exoLabel } from "@/lib/level-criteria";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { activeCards, starsLabel, switchChain, STARS, teamFormatOf, teamStarsOf, type Format, type Stars, type StarSwitch } from "@/lib/wod-engines/templates/level-engine";

// Recap d'une seance Level pour les admins (Sartay 28/09 ; par NUMERO D'EQUIPE depuis le 30/09) : les faits a retenir.
// - Fiche de chaque equipe : noms complets, parcours et rang, temps niveau par niveau compares a la mediane des
//   autres equipes (meme niveau, meme parcours, meme format), vies perdues, cartes jaunes, echauffement, finisher.
// - Louche : niveaux boucles anormalement vite, cartes jaunes (avec les noms de l'equipe).
// - Arbitrages bizarres : desaccords regroupes par eleve et exercice, arbitres systematiquement plus severes ou
//   plus larges que leurs co-arbitres, moyennes extremes.
// - Equipes trop fortes / trop faibles : rythme moyen, descente de categorie, vies perdues.
// - Evaluations tres basses / tres hautes, regroupees par eleve.
// - Auto-evaluation de chaque eleve (note /5 comme au carnet, grille, forme du jour) et avis du prof s'il existe ;
//   ecart marque entre l'auto-evaluation et les arbitres.
// Les arbitres (eleves dispenses, profs) ont leur propre bloc : ils ne sont dans aucune equipe.

export type RecapFact = { tone: "bad" | "good" | "warn" | "info"; text: string };
export type RecapSelfEval = { grade: number | null; codes: Record<string, string>; forme: string | null; review: number | null };
export type RecapMember = { id: string; name: string; className: string; evals: number; avgGrade: number | null; avgCode: string | null; selfEval: RecapSelfEval | null };
export type RecapLevel = PaceRun & { lost: number }; // lost = vies perdues sur ce niveau
export type RecapPhase = { levels: number; total: number; finishMs: number | null; losses: number; cards: number; score: number | null };
export type TeamSheet = {
  teamId: string;
  name: string;
  stars: Stars; // parcours en fin de WOD (apres une eventuelle descente)
  switches: StarSwitch[]; // changements de categorie, du plus ancien au plus recent (descente a la 3e vie, montee sur un BOSS)
  format: Format;
  members: RecapMember[];
  rank: number; // rang dans son parcours, ou dans le classement commun (regles du 29/09 soir)
  rankOf: number;
  rankScope: "parcours" | "global";
  points: number | null; // classement commun : niveau x etoiles
  completedLevels: number;
  totalLevels: number;
  finishedMs: number | null; // chrono de course : echelle bouclee
  lastTickMs: number | null; // chrono de course : derniere fiche cochee
  losses: { level: number; atMs: number; soft: boolean }[];
  cards: number[]; // chrono de course de chaque carte jaune
  paceRatio: number | null; // moyenne geometrique temps / reference (1 = comme les autres)
  levels: RecapLevel[];
  openLevel: { level: number; lost: number } | null; // niveau en cours a la fin (non boucle)
  warmup: RecapPhase | null;
  finisher: RecapPhase | null;
  suspicious: string[]; // raisons, vide = rien de louche
};
export type TeamRecap = { number: number; sheet: TeamSheet; facts: RecapFact[]; alerts: number };
export type SessionRecap = {
  sessionId: string;
  label: string;
  ended: boolean;
  evaluations: number;
  startedAtMs: number | null;
  durationMs: number | null;
  classes: string[];
  teams: TeamRecap[]; // par numero d'equipe
  referees: RecapFact[]; // arbitrages bizarres (arbitres trop severes, trop larges, en desaccord)
  selfEvals: { submitted: number; expected: number };
};
export const SELF_EVAL_LABELS = GRADED_CRITERIA.map((c) => ({ id: c.id, label: c.label }));

const STAFF_CLASS = "Profs & coachs";
export const fmtDuration = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}`; };
const fmt = fmtDuration;
const cap = exoLabel;
const num = (x: number) => x.toFixed(1).replace(".", ",");
const nearestCode = (grade: number) => [...QUALITY_LEVELS].sort((x, y) => Math.abs(x.grade - grade) - Math.abs(y.grade - grade))[0].code;
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
const lives = (n: number) => `${n} vie${n > 1 ? "s" : ""} perdue${n > 1 ? "s" : ""}`;
const TONE_ORDER: Record<RecapFact["tone"], number> = { bad: 0, warn: 1, info: 2, good: 3 };
const byTone = (a: RecapFact, b: RecapFact) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone];

export async function buildSessionRecap(sessionId: string): Promise<SessionRecap | null> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "LEVEL") return null;
  const bundle = await buildLevelBundle(sessionId);
  const ranked = levelStandings(bundle);
  const pace = await paceReport(sessionId).catch(() => ({ flags: [], teams: [], runs: [] as PaceRun[] }));
  const evals = bundle.evaluations;

  // Noms complets et classe de chaque personne (eleves des equipes, eleves cibles, arbitres).
  const ids = [...new Set([...bundle.teams.flatMap((t) => t.members.map((m) => m.id)), ...evals.flatMap((e) => [e.targetUserId, e.refereeId])])];
  const users = ids.length ? await db.orm.public.User.where((u) => u.id.in(ids)).all() : [];
  const classOf = new Map(users.map((u) => [u.id, u.role === "STUDENT" ? u.className ?? "?" : STAFF_CLASS]));
  const fullName = new Map(users.map((u) => [u.id, displayName(u)]));
  const nameOf = (id: string, fallback = "?") => fullName.get(id) ?? fallback;
  // Auto-evaluations des eleves et avis du prof sur cette seance.
  const [selfRows, reviewRows] = await Promise.all([db.orm.public.SelfEvaluation.where({ sessionId }).all(), db.orm.public.SelfEvalReview.where({ sessionId }).all()]);
  const reviewOf = new Map(reviewRows.map((r) => [r.studentId, r.answers as Record<string, unknown> | null]));
  const selfOf = new Map<string, RecapSelfEval>();
  for (const r of selfRows) {
    const a = (r.answers as Record<string, unknown> | null) ?? {};
    const codes: Record<string, string> = {};
    for (const c of GRADED_CRITERIA) if (typeof a[c.id] === "string") codes[c.id] = a[c.id] as string;
    selfOf.set(r.studentId, { grade: gradeOfAnswers(a), codes, forme: typeof a.forme === "string" ? a.forme : null, review: gradeOfAnswers(reviewOf.get(r.studentId)) });
  }
  // Avis du prof sans auto-evaluation rendue.
  for (const [id, a] of reviewOf) if (!selfOf.has(id)) selfOf.set(id, { grade: null, codes: {}, forme: null, review: gradeOfAnswers(a) });

  // --- Fiche de chaque equipe.
  const progressOf = new Map(ranked.map((p) => [p.teamId, p]));
  const finalStars = (teamId: string): Stars => bundle.starSwitches[teamId]?.to ?? teamStarsOf(bundle.teamStars, teamId);
  const rankIn = new Map<string, { rank: number; of: number }>();
  const globalRank = bundle.reorient && !bundle.child && !bundle.emom;
  if (globalRank) ranked.forEach((p, i) => rankIn.set(p.teamId, { rank: i + 1, of: ranked.length }));
  else for (const st of STARS) {
    const inCat = ranked.filter((p) => finalStars(p.teamId) === st);
    inCat.forEach((p, i) => rankIn.set(p.teamId, { rank: i + 1, of: inCat.length }));
  }
  const evalsOf = new Map<string, typeof evals>();
  for (const e of evals) evalsOf.set(e.targetUserId, [...(evalsOf.get(e.targetUserId) ?? []), e]);
  const phaseOf = (kind: "warmup" | "finisher", order: number): RecapPhase | null => {
    const ph = bundle.phases.find((p) => p.kind === kind);
    const t = ph?.byOrder[order];
    return ph && t ? { levels: t.levels, total: ph.levelsTotal, finishMs: t.finishMs, losses: t.losses, cards: t.cards, score: t.score } : null;
  };
  const sheets = new Map<string, TeamSheet>();
  for (const t of bundle.teams.filter((x) => x.members.length)) {
    const p = progressOf.get(t.id);
    const losses = bundle.losses.filter((l) => l.teamId === t.id).map((l) => ({ level: l.level, atMs: l.atMs, soft: !!l.soft })).sort((a, b) => a.atMs - b.atMs);
    const lostOn = (level: number) => losses.filter((l) => l.level === level).length;
    const runs = pace.runs.filter((r) => r.teamId === t.id).sort((a, b) => a.level - b.level);
    const levels: RecapLevel[] = runs.map((r) => ({ ...r, lost: lostOn(r.level) }));
    const paceTeam = pace.teams.find((x) => x.teamId === t.id);
    const cards = bundle.yellowCards.filter((c) => c.teamId === t.id).map((c) => c.atMs).sort((a, b) => a - b);
    const fast = levels.filter((l) => l.ratio < PACE_FAST);
    const suspicious = [
      ...fast.map((l) => `${l.boss ? "BOSS" : "Niveau"} ${l.level} en ${fmt(l.durationMs)} au lieu de ${fmt(l.referenceMs)} (${l.basis === "moyenne" ? `médiane de ${l.n} passages` : "temps théorique"})`),
      ...(cards.length ? [`${plural(cards.length, "carte jaune")} (à ${cards.map(fmt).join(", ")} de course)`] : []),
    ];
    const r = rankIn.get(t.id) ?? { rank: 0, of: 0 };
    sheets.set(t.id, {
      teamId: t.id,
      name: t.name,
      stars: finalStars(t.id),
      switches: switchChain(bundle.starSwitches[t.id]),
      format: teamFormatOf(bundle.teamFormats, t.id, t.members.length),
      members: t.members.map((m) => {
        const es = evalsOf.get(m.id) ?? [];
        const avg = es.length ? es.reduce((s, e) => s + gradeOf(e.note), 0) / es.length : null;
        return { id: m.id, name: nameOf(m.id, m.name), className: classOf.get(m.id) === STAFF_CLASS ? "prof" : classOf.get(m.id) ?? "?", evals: es.length, avgGrade: avg, avgCode: avg === null ? null : nearestCode(avg), selfEval: selfOf.get(m.id) ?? null };
      }),
      rank: r.rank,
      rankOf: r.of,
      rankScope: globalRank ? "global" : "parcours",
      points: globalRank && p ? levelPointsOf(bundle, p) : null,
      completedLevels: p?.completedLevels ?? 0,
      totalLevels: levelsForTeam(bundle, t.id).filter((l) => activeCards(l).length > 0).length,
      finishedMs: p?.finishedMs ?? null,
      lastTickMs: p?.lastTickMs ?? null,
      losses,
      cards,
      paceRatio: paceTeam ? paceTeam.ratio : null,
      levels,
      openLevel: p?.currentLevel != null ? { level: p.currentLevel, lost: lostOn(p.currentLevel) } : null,
      warmup: phaseOf("warmup", t.order),
      finisher: phaseOf("finisher", t.order),
      suspicious,
    });
  }

  // --- Arbitres : desaccords regroupes par eleve et exercice, et sens de chaque desaccord pour chaque arbitre.
  const dis = dissonances(evals);
  const ranking = refereeRanking(evals);
  const side = new Map<string, { lower: number; higher: number }>();
  for (const d of dis) {
    const [lo, hi] = levelIndex(d.a.note) < levelIndex(d.b.note) ? [d.a, d.b] : [d.b, d.a];
    const l = side.get(lo.refereeId) ?? { lower: 0, higher: 0 }; l.lower++; side.set(lo.refereeId, l);
    const h = side.get(hi.refereeId) ?? { lower: 0, higher: 0 }; h.higher++; side.set(hi.refereeId, h);
  }
  const disGroups = new Map<string, typeof evals>();
  for (const d of dis) {
    const k = `${d.a.targetUserId}_${d.a.exerciseId}`;
    if (!disGroups.has(k)) disGroups.set(k, evals.filter((e) => e.targetUserId === d.a.targetUserId && e.exerciseId === d.a.exerciseId).sort((a, b) => levelIndex(a.note) - levelIndex(b.note)));
  }

  // --- Arbitres (bloc a part : ils ne sont dans aucune equipe).
  const referees: RecapFact[] = [];
  for (const r of ranking) {
    const sd = side.get(r.refereeId);
    const n = sd ? sd.lower + sd.higher : 0;
    const ref = `${nameOf(r.refereeId, r.name)}${classOf.get(r.refereeId) && classOf.get(r.refereeId) !== STAFF_CLASS ? ` (${classOf.get(r.refereeId)})` : ""}`;
    if (sd && n >= 3 && sd.lower / n >= 0.75) referees.push({ tone: "bad", text: `${ref} note plus sévèrement que les autres arbitres : plus bas dans ${sd.lower} désaccords sur ${n} (${r.count} évaluations, moyenne ${num(r.avgGrade)}/5 ≈ ${r.avgCode}).` });
    else if (sd && n >= 3 && sd.higher / n >= 0.75) referees.push({ tone: "bad", text: `${ref} note plus largement que les autres arbitres : plus haut dans ${sd.higher} désaccords sur ${n} (${r.count} évaluations, moyenne ${num(r.avgGrade)}/5 ≈ ${r.avgCode}).` });
    else if (r.dissonant >= 2 && r.rate >= 0.3) referees.push({ tone: "warn", text: `${ref} : ${r.dissonant} évaluations en désaccord sur ${r.count} (${Math.round(r.rate * 100)} %), sans sens net.` });
    if (r.count >= 3 && r.avgGrade >= 4.7) referees.push({ tone: "warn", text: `${ref} note très large : moyenne ${num(r.avgGrade)}/5 (≈ ${r.avgCode}) sur ${r.count} évaluations.` });
    if (r.count >= 3 && r.avgGrade <= 1.2) referees.push({ tone: "warn", text: `${ref} note très sévère : moyenne ${num(r.avgGrade)}/5 (≈ ${r.avgCode}) sur ${r.count} évaluations.` });
  }

  // --- Chaque equipe, par numero : ses faits (louche, niveau, evaluations et auto-evaluations de ses eleves).
  const list = (es: typeof evals) => {
    const by = new Map<string, { n: number; refs: Set<string> }>();
    for (const e of es) { const k = cap(e.exerciseLabel); const g = by.get(k) ?? { n: 0, refs: new Set<string>() }; g.n++; g.refs.add(nameOf(e.refereeId, e.refereeName)); by.set(k, g); }
    return [...by.entries()].map(([k, g]) => `${k}${g.n > 1 ? ` ×${g.n}` : ""} (${[...g.refs].join(", ")})`).join(", ");
  };
  const teams: TeamRecap[] = bundle.teams.filter((t) => sheets.has(t.id)).map((t) => {
    const sh = sheets.get(t.id)!;
    const members = new Set(t.members.map((m) => m.id));
    const facts: RecapFact[] = [];
    if (sh.suspicious.length) facts.push({ tone: sh.suspicious.length >= 2 || sh.cards.length >= 2 ? "bad" : "warn", text: `🕵️ Louche : ${sh.suspicious.join(" · ")}.` });
    const pt = pace.teams.find((x) => x.teamId === t.id);
    if (pt && pt.levels >= 3 && pt.ratio < 0.7) facts.push({ tone: "warn", text: `Va ${Math.round((1 - pt.ratio) * 100)} % plus vite que les autres équipes sur ${pt.levels} niveaux : parcours ${starsLabel(pt.stars)} sans doute trop facile.` });
    if (pt && pt.levels >= 3 && pt.ratio > 1.5) facts.push({ tone: "bad", text: `Va ${Math.round((pt.ratio - 1) * 100)} % plus lentement que les autres équipes sur ${pt.levels} niveaux : équipe en difficulté.` });
    for (const sw of sh.switches) {
      if (sw.to < sw.from) facts.push({ tone: "bad", text: `Descendue de ${starsLabel(sw.from)} à ${starsLabel(sw.to)} au niveau ${sw.fromLevel} (3 vies perdues).` });
      else facts.push({ tone: "good", text: `Montée de ${starsLabel(sw.from)} à ${starsLabel(sw.to)} au niveau ${sw.fromLevel} (1re de sa catégorie sur tout un BOSS).` });
    }
    if (sh.losses.length >= 5) facts.push({ tone: "bad", text: `${lives(sh.losses.length)} (${sh.completedLevels} niveaux bouclés).` });
    if (sh.rank === 1 && sh.rankOf > 1) facts.push({ tone: "good", text: `1re du parcours ${starsLabel(sh.stars)} (${sh.completedLevels} niveaux, ${lives(sh.losses.length)}).` });
    for (const m of sh.members) {
      const es = evalsOf.get(m.id) ?? [];
      const avg = es.length ? es.reduce((x, e) => x + gradeOf(e.note), 0) / es.length : null;
      if (es.length) {
        const ti = es.filter((e) => codeOf(e.note) === "TI");
        const bad = es.filter((e) => isBad(e.note));
        const top = es.filter((e) => isExcellent(e.note));
        if (es.length >= 2 && avg! <= 1.5) facts.push({ tone: "bad", text: `${m.name} : moyenne ${num(avg!)}/5 sur ${es.length} évaluations${bad.length ? ` — TI/I en ${list(bad)}` : ""}.` });
        else if (ti.length) facts.push({ tone: "bad", text: `${m.name} : TI en ${list(ti)}.` });
        if (es.length >= 2 && avg! >= 4.5) facts.push({ tone: "good", text: `${m.name} : moyenne ${num(avg!)}/5 sur ${es.length} évaluations${top.length ? `, dont ${top.length} E` : ""}.` });
        else if (top.length) facts.push({ tone: "good", text: `${m.name} : ${top.length} E — ${list(top)}.` });
      }
      // Auto-evaluation tres loin de ce que les arbitres ont vu (au moins 2 evaluations).
      const self = m.selfEval?.grade ?? null;
      if (self !== null && avg !== null && es.length >= 2 && self - avg >= 2) facts.push({ tone: "warn", text: `${m.name} s'auto-évalue à ${num(self)}/5, les arbitres à ${num(avg)}/5 : se surestime.` });
      if (self !== null && avg !== null && es.length >= 2 && avg - self >= 2) facts.push({ tone: "info", text: `${m.name} s'auto-évalue à ${num(self)}/5, les arbitres à ${num(avg)}/5 : se sous-estime.` });
    }
    for (const es of disGroups.values()) {
      if (!members.has(es[0].targetUserId)) continue;
      const seen = new Map<string, number>(); // meme arbitre, meme appreciation : « S ×2 par Martin »
      for (const e of es) { const k = `${codeOf(e.note)} par ${nameOf(e.refereeId, e.refereeName)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
      facts.push({ tone: "warn", text: `⚖️ ${nameOf(es[0].targetUserId, es[0].targetName)} en ${cap(es[0].exerciseLabel)} : ${[...seen.entries()].map(([k, n]) => (n > 1 ? k.replace(" par ", ` ×${n} par `) : k)).join(", ")}.` });
    }
    const unseen = sh.members.filter((m) => !m.evals);
    if (unseen.length && evals.length) facts.push({ tone: "info", text: `Jamais évalué${unseen.length > 1 ? "s" : ""} par les arbitres : ${unseen.map((m) => m.name).join(", ")}.` });
    const sorted = facts.sort(byTone);
    return { number: t.order, sheet: sh, facts: sorted, alerts: sorted.filter((x) => x.tone === "bad" || x.tone === "warn").length };
  }).sort((a, b) => a.number - b.number);

  const players = teams.flatMap((x) => x.sheet.members).filter((m) => m.className !== "prof");
  const classes = [...new Set(players.map((m) => m.className).filter((c) => c && c !== "?"))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const endAbs = bundle.raceEndedAtMs ?? bundle.endedAtMs;
  const durationMs = bundle.startedAtMs !== null && endAbs !== null ? elapsed(bundle.startedAtMs, bundle.pauses, endAbs) : null;
  return {
    sessionId,
    label: session.label ?? "WOD Level",
    ended: !!session.raceEndedAt,
    evaluations: evals.length,
    startedAtMs: bundle.startedAtMs,
    durationMs,
    classes,
    teams,
    referees: referees.sort(byTone),
    selfEvals: { submitted: players.filter((m) => m.selfEval?.grade != null).length, expected: players.length },
  };
}
