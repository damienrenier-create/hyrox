import { db } from "@/lib/db";
import { buildLevelBundle, levelStandings, levelsForTeam } from "@/lib/level-context";
import { PACE_FAST, PACE_SLOW, paceReport, type PaceRun } from "@/lib/level-pace";
import { codeOf, dissonances, gradeOf, isBad, isExcellent, levelIndex, refereeRanking } from "@/lib/eval-insights";
import { readSessionClasses } from "@/lib/session-roles";
import { displayName } from "@/lib/staff-names";
import { exoLabel } from "@/lib/level-criteria";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { activeCards, starsLabel, teamFormatOf, teamStarsOf, type Format, type Stars, type StarSwitch } from "@/lib/wod-engines/templates/level-engine";

// Recap d'une seance Level pour les admins (Sartay 28/09), classe par classe : les faits a retenir.
// - Fiche de chaque equipe : noms complets, parcours et rang, temps niveau par niveau compares a la mediane des
//   autres equipes (meme niveau, meme parcours, meme format), vies perdues, cartes jaunes, echauffement, finisher.
// - Louche : niveaux boucles anormalement vite, cartes jaunes (avec les noms de l'equipe).
// - Arbitrages bizarres : desaccords regroupes par eleve et exercice, arbitres systematiquement plus severes ou
//   plus larges que leurs co-arbitres, moyennes extremes.
// - Equipes trop fortes / trop faibles : rythme moyen, descente de categorie, vies perdues.
// - Evaluations tres basses / tres hautes, regroupees par eleve.
// Une equipe melangeant plusieurs classes apparait dans chacune ; un arbitre prof ou coach est range a part.

export type RecapFact = { tone: "bad" | "good" | "warn" | "info"; text: string };
export type RecapMember = { id: string; name: string; className: string; evals: number; avgGrade: number | null; avgCode: string | null };
export type RecapLevel = PaceRun & { lost: number }; // lost = vies perdues sur ce niveau
export type RecapPhase = { levels: number; total: number; finishMs: number | null; losses: number; cards: number; score: number | null };
export type TeamSheet = {
  teamId: string;
  name: string;
  stars: Stars; // parcours en fin de WOD (apres une eventuelle descente)
  switched: StarSwitch | null;
  format: Format;
  members: RecapMember[];
  rank: number; // rang dans son parcours
  rankOf: number;
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
export type ClassRecap = { className: string; teams: number; students: number; teamSheets: TeamSheet[]; suspects: RecapFact[]; refereeing: RecapFact[]; teamsLevel: RecapFact[]; evals: RecapFact[] };
export type SessionRecap = { sessionId: string; label: string; ended: boolean; evaluations: number; startedAtMs: number | null; durationMs: number | null; classes: ClassRecap[] };

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
  const teamClasses = new Map(bundle.teams.map((t) => [t.id, [...new Set(t.members.map((m) => classOf.get(m.id) ?? "?"))]]));
  const classes = [...new Set([...readSessionClasses(session.settings), ...[...teamClasses.values()].flat(), ...evals.map((e) => classOf.get(e.refereeId) ?? "?")])]
    .filter((c) => c && c !== "?")
    .sort((a, b) => (a === STAFF_CLASS ? 1 : b === STAFF_CLASS ? -1 : a.localeCompare(b, "fr", { numeric: true })));

  // --- Fiche de chaque equipe.
  const progressOf = new Map(ranked.map((p) => [p.teamId, p]));
  const finalStars = (teamId: string): Stars => bundle.starSwitches[teamId]?.to ?? teamStarsOf(bundle.teamStars, teamId);
  const rankIn = new Map<string, { rank: number; of: number }>();
  for (const st of [1, 2, 3] as const) {
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
      switched: bundle.starSwitches[t.id] ?? null,
      format: teamFormatOf(bundle.teamFormats, t.id, t.members.length),
      members: t.members.map((m) => {
        const es = evalsOf.get(m.id) ?? [];
        const avg = es.length ? es.reduce((s, e) => s + gradeOf(e.note), 0) / es.length : null;
        return { id: m.id, name: nameOf(m.id, m.name), className: classOf.get(m.id) === STAFF_CLASS ? "prof" : classOf.get(m.id) ?? "?", evals: es.length, avgGrade: avg, avgCode: avg === null ? null : nearestCode(avg) };
      }),
      rank: r.rank,
      rankOf: r.of,
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
  // « Équipe 3 (Noah Petit, Rayane Bouzid, Oscar Dupont) »
  const who = (teamId: string) => { const s = sheets.get(teamId); return s ? `${s.name} (${s.members.map((m) => m.name).join(", ")})` : "?"; };

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

  const out: ClassRecap[] = classes.map((cls) => {
    const teams = bundle.teams.filter((t) => sheets.has(t.id) && (teamClasses.get(t.id) ?? []).includes(cls));
    const teamIds = new Set(teams.map((t) => t.id));
    const students = new Set(teams.flatMap((t) => t.members.filter((m) => classOf.get(m.id) === cls).map((m) => m.id)));
    const refereeing: RecapFact[] = [];
    const teamsLevel: RecapFact[] = [];
    const suspects: RecapFact[] = [];
    const evalFacts: RecapFact[] = [];

    // --- Louche : chaque equipe avec ses raisons, noms compris.
    for (const t of teams) {
      const s = sheets.get(t.id)!;
      if (s.suspicious.length) suspects.push({ tone: s.suspicious.length >= 2 || s.cards.length >= 2 ? "bad" : "warn", text: `${who(t.id)} : ${s.suspicious.join(" · ")}.` });
    }

    // --- Arbitrages bizarres : arbitres de la classe, puis desaccords sur des eleves de la classe.
    for (const r of ranking.filter((r) => classOf.get(r.refereeId) === cls)) {
      const sd = side.get(r.refereeId);
      const n = sd ? sd.lower + sd.higher : 0;
      const ref = nameOf(r.refereeId, r.name);
      if (sd && n >= 3 && sd.lower / n >= 0.75) refereeing.push({ tone: "bad", text: `${ref} note plus sévèrement que les autres arbitres : plus bas dans ${sd.lower} désaccords sur ${n} (${r.count} évaluations, moyenne ${num(r.avgGrade)}/5 ≈ ${r.avgCode}).` });
      else if (sd && n >= 3 && sd.higher / n >= 0.75) refereeing.push({ tone: "bad", text: `${ref} note plus largement que les autres arbitres : plus haut dans ${sd.higher} désaccords sur ${n} (${r.count} évaluations, moyenne ${num(r.avgGrade)}/5 ≈ ${r.avgCode}).` });
      else if (r.dissonant >= 2 && r.rate >= 0.3) refereeing.push({ tone: "warn", text: `${ref} : ${r.dissonant} évaluations en désaccord sur ${r.count} (${Math.round(r.rate * 100)} %), sans sens net.` });
      if (r.count >= 3 && r.avgGrade >= 4.7) refereeing.push({ tone: "warn", text: `${ref} note très large : moyenne ${num(r.avgGrade)}/5 (≈ ${r.avgCode}) sur ${r.count} évaluations.` });
      if (r.count >= 3 && r.avgGrade <= 1.2) refereeing.push({ tone: "warn", text: `${ref} note très sévère : moyenne ${num(r.avgGrade)}/5 (≈ ${r.avgCode}) sur ${r.count} évaluations.` });
    }
    for (const es of disGroups.values()) {
      if (!students.has(es[0].targetUserId)) continue;
      const seen = new Map<string, number>(); // meme arbitre, meme appreciation : « S ×2 par Martin »
      for (const e of es) { const k = `${codeOf(e.note)} par ${nameOf(e.refereeId, e.refereeName)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
      refereeing.push({ tone: "warn", text: `${nameOf(es[0].targetUserId, es[0].targetName)} en ${cap(es[0].exerciseLabel)} : ${[...seen.entries()].map(([k, n]) => (n > 1 ? k.replace(" par ", ` ×${n} par `) : k)).join(", ")}.` });
    }

    // --- Equipes trop fortes / trop faibles.
    for (const t of pace.teams.filter((x) => teamIds.has(x.teamId))) {
      if (t.levels >= 3 && t.ratio < 0.7) teamsLevel.push({ tone: "warn", text: `${who(t.teamId)} ${starsLabel(t.stars)} va ${Math.round((1 - t.ratio) * 100)} % plus vite que les autres équipes sur ${t.levels} niveaux : parcours sans doute trop facile.` });
      if (t.levels >= 3 && t.ratio > 1.5) teamsLevel.push({ tone: "bad", text: `${who(t.teamId)} ${starsLabel(t.stars)} va ${Math.round((t.ratio - 1) * 100)} % plus lentement que les autres équipes sur ${t.levels} niveaux : équipe en difficulté.` });
    }
    for (const t of teams) {
      const s = sheets.get(t.id)!;
      if (s.switched) teamsLevel.push({ tone: "bad", text: `${who(t.id)} est descendue de ${starsLabel(s.switched.from)} à ${starsLabel(s.switched.to)} au niveau ${s.switched.fromLevel} (3 vies perdues).` });
      if (s.losses.length >= 5) teamsLevel.push({ tone: "bad", text: `${who(t.id)} a perdu ${s.losses.length} vies (${s.completedLevels} niveaux bouclés).` });
      if (s.rank === 1 && s.rankOf > 1) teamsLevel.push({ tone: "good", text: `${who(t.id)} termine 1re du parcours ${starsLabel(s.stars)} (${s.completedLevels} niveaux, ${lives(s.losses.length)}).` });
    }

    // --- Evaluations tres basses / tres hautes, regroupees par eleve.
    const list = (es: typeof evals) => {
      const by = new Map<string, { n: number; refs: Set<string> }>();
      for (const e of es) { const k = cap(e.exerciseLabel); const g = by.get(k) ?? { n: 0, refs: new Set<string>() }; g.n++; g.refs.add(nameOf(e.refereeId, e.refereeName)); by.set(k, g); }
      return [...by.entries()].map(([k, g]) => `${k}${g.n > 1 ? ` ×${g.n}` : ""} (${[...g.refs].join(", ")})`).join(", ");
    };
    for (const id of students) {
      const es = evalsOf.get(id) ?? [];
      if (!es.length) continue;
      const name = nameOf(id, es[0].targetName);
      const avg = es.reduce((s, e) => s + gradeOf(e.note), 0) / es.length;
      const ti = es.filter((e) => codeOf(e.note) === "TI");
      const bad = es.filter((e) => isBad(e.note));
      const top = es.filter((e) => isExcellent(e.note));
      if (es.length >= 2 && avg <= 1.5) evalFacts.push({ tone: "bad", text: `${name} : moyenne ${num(avg)}/5 sur ${es.length} évaluations${bad.length ? ` — TI/I en ${list(bad)}` : ""}.` });
      else if (ti.length) evalFacts.push({ tone: "bad", text: `${name} : TI en ${list(ti)}.` });
      if (es.length >= 2 && avg >= 4.5) evalFacts.push({ tone: "good", text: `${name} : moyenne ${num(avg)}/5 sur ${es.length} évaluations${top.length ? `, dont ${top.length} E` : ""}.` });
      else if (top.length) evalFacts.push({ tone: "good", text: `${name} : ${top.length} E — ${list(top)}.` });
    }
    const unseen = [...students].filter((id) => !evalsOf.has(id)).length;
    if (unseen && evals.length) evalFacts.push({ tone: "info", text: `${plural(unseen, "élève")} de la classe jamais évalué${unseen > 1 ? "s" : ""}.` });

    const teamSheets = teams.map((t) => sheets.get(t.id)!).sort((a, b) => b.stars - a.stars || a.rank - b.rank);
    return { className: cls, teams: teams.length, students: students.size, teamSheets, suspects: suspects.sort(byTone), refereeing: refereeing.sort(byTone), teamsLevel: teamsLevel.sort(byTone), evals: evalFacts.sort(byTone) };
  }).filter((c) => c.teams || c.refereeing.length);

  const endAbs = bundle.raceEndedAtMs ?? bundle.endedAtMs;
  const durationMs = bundle.startedAtMs !== null && endAbs !== null ? elapsed(bundle.startedAtMs, bundle.pauses, endAbs) : null;
  return { sessionId, label: session.label ?? "WOD Level", ended: !!session.raceEndedAt, evaluations: evals.length, startedAtMs: bundle.startedAtMs, durationMs, classes: out };
}
