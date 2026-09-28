import { db } from "@/lib/db";
import { buildLevelBundle, levelStandings } from "@/lib/level-context";
import { paceReport } from "@/lib/level-pace";
import { dissonances, gradeOf, isBad, isExcellent, refereeRanking } from "@/lib/eval-insights";
import { readSessionClasses, isTestClass } from "@/lib/session-roles";
import { codeOf } from "@/lib/eval-insights";
import { exoLabel } from "@/lib/level-criteria";
import { starsLabel, teamStarsOf } from "@/lib/wod-engines/templates/level-engine";

// Recap d'une seance Level pour les admins (Sartay 28/09), classe par classe : les faits a retenir.
// - Arbitrages bizarres : evaluations dissonantes, arbitres tres larges ou tres severes.
// - Equipes trop fortes / trop faibles : rythme moyen, descente de categorie, vies perdues.
// - Triche suspectee : niveaux boucles anormalement vite, cartes jaunes.
// - Evaluations tres basses / tres hautes d'un eleve.
// Une equipe melangeant plusieurs classes apparait dans chacune ; un arbitre prof ou coach est range a part.

export type RecapFact = { tone: "bad" | "good" | "warn" | "info"; text: string };
export type ClassRecap = { className: string; teams: number; students: number; refereeing: RecapFact[]; teamsLevel: RecapFact[]; cheating: RecapFact[]; evals: RecapFact[] };
export type SessionRecap = { sessionId: string; label: string; ended: boolean; evaluations: number; classes: ClassRecap[] };

const STAFF_CLASS = "Profs & coachs";
const fmt = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, "0")}`; };
const cap = exoLabel;

export async function buildSessionRecap(sessionId: string): Promise<SessionRecap | null> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "LEVEL") return null;
  const bundle = await buildLevelBundle(sessionId);
  const ranked = levelStandings(bundle);
  const pace = await paceReport(sessionId).catch(() => ({ flags: [], teams: [] }));
  const evals = bundle.evaluations;

  // Classe de chaque personne (eleves des equipes, eleves cibles, arbitres).
  const ids = [...new Set([...bundle.teams.flatMap((t) => t.members.map((m) => m.id)), ...evals.flatMap((e) => [e.targetUserId, e.refereeId])])];
  const users = ids.length ? await db.orm.public.User.where((u) => u.id.in(ids)).all() : [];
  const classOf = new Map(users.map((u) => [u.id, u.role === "STUDENT" ? u.className ?? "?" : STAFF_CLASS]));
  const teamClasses = new Map(bundle.teams.map((t) => [t.id, [...new Set(t.members.map((m) => classOf.get(m.id) ?? "?"))]]));
  const teamName = new Map(bundle.teams.map((t) => [t.id, t.name]));
  const classes = [...new Set([...readSessionClasses(session.settings), ...[...teamClasses.values()].flat(), ...evals.map((e) => classOf.get(e.refereeId) ?? "?")])]
    .filter((c) => c && c !== "?")
    .sort((a, b) => (a === STAFF_CLASS ? 1 : b === STAFF_CLASS ? -1 : a.localeCompare(b, "fr", { numeric: true })));

  const dis = dissonances(evals);
  const ranking = refereeRanking(evals);
  const yellowBy = new Map<string, number>();
  for (const c of bundle.yellowCards) yellowBy.set(c.teamId, (yellowBy.get(c.teamId) ?? 0) + 1);
  const progressOf = new Map(ranked.map((p) => [p.teamId, p]));

  const out: ClassRecap[] = classes.map((cls) => {
    const teams = bundle.teams.filter((t) => (teamClasses.get(t.id) ?? []).includes(cls));
    const teamIds = new Set(teams.map((t) => t.id));
    const students = new Set(teams.flatMap((t) => t.members.filter((m) => classOf.get(m.id) === cls).map((m) => m.id)));
    const refereeing: RecapFact[] = [];
    const teamsLevel: RecapFact[] = [];
    const cheating: RecapFact[] = [];
    const evalFacts: RecapFact[] = [];

    // --- Arbitrages bizarres : arbitres de la classe, et dissonances sur des eleves de la classe.
    for (const r of ranking.filter((r) => classOf.get(r.refereeId) === cls)) {
      if (r.dissonant >= 2 && r.rate >= 0.3) refereeing.push({ tone: "bad", text: `${r.name} : ${r.dissonant} évaluation${r.dissonant > 1 ? "s" : ""} dissonante${r.dissonant > 1 ? "s" : ""} sur ${r.count} (${Math.round(r.rate * 100)} %).` });
      if (r.count >= 3 && r.avgGrade >= 4.7) refereeing.push({ tone: "warn", text: `${r.name} note très large : moyenne ${r.avgGrade.toFixed(1).replace(".", ",")}/5 (≈ ${r.avgCode}) sur ${r.count} évaluations.` });
      if (r.count >= 3 && r.avgGrade <= 1.2) refereeing.push({ tone: "warn", text: `${r.name} note très sévère : moyenne ${r.avgGrade.toFixed(1).replace(".", ",")}/5 (≈ ${r.avgCode}) sur ${r.count} évaluations.` });
    }
    for (const d of dis.filter((d) => students.has(d.a.targetUserId))) {
      refereeing.push({ tone: "warn", text: `${d.a.targetName} en ${cap(d.a.exerciseLabel)} : ${codeOf(d.a.note)} par ${d.a.refereeName}, ${codeOf(d.b.note)} par ${d.b.refereeName}.` });
    }

    // --- Equipes trop fortes / trop faibles.
    for (const t of pace.teams.filter((x) => teamIds.has(x.teamId))) {
      if (t.levels >= 3 && t.ratio < 0.7) teamsLevel.push({ tone: "warn", text: `${t.teamName} ${starsLabel(t.stars)} va ${Math.round((1 - t.ratio) * 100)} % plus vite que la moyenne sur ${t.levels} niveaux : parcours sans doute trop facile.` });
      if (t.levels >= 3 && t.ratio > 1.5) teamsLevel.push({ tone: "bad", text: `${t.teamName} ${starsLabel(t.stars)} va ${Math.round((t.ratio - 1) * 100)} % plus lentement que la moyenne sur ${t.levels} niveaux : équipe en difficulté.` });
    }
    for (const t of teams) {
      const sw = bundle.starSwitches[t.id];
      if (sw) teamsLevel.push({ tone: "bad", text: `${t.name} est descendue de ${starsLabel(sw.from)} à ${starsLabel(sw.to)} après 3 vies perdues.` });
      const p = progressOf.get(t.id);
      if (p && p.losses >= 5) teamsLevel.push({ tone: "bad", text: `${t.name} a perdu ${p.losses} vies (${p.completedLevels} niveaux bouclés).` });
    }
    // Meilleure equipe de chaque parcours present dans la classe (reperes).
    for (const st of [3, 2, 1] as const) {
      const inCat = ranked.filter((p) => teamStarsOf(bundle.teamStars, p.teamId) === st);
      const best = inCat[0];
      if (best && teamIds.has(best.teamId) && inCat.length > 1) teamsLevel.push({ tone: "good", text: `${teamName.get(best.teamId)} termine 1re du parcours ${starsLabel(st)} (${best.completedLevels} niveaux, ${best.losses} vie${best.losses > 1 ? "s" : ""} perdue${best.losses > 1 ? "s" : ""}).` });
    }

    // --- Triche suspectee.
    for (const f of pace.flags.filter((x) => x.kind === "fast" && teamIds.has(x.teamId))) {
      cheating.push({ tone: "bad", text: `${f.teamName} : ${f.boss ? "BOSS" : "niveau"} ${f.level} bouclé en ${fmt(f.durationMs)} (habituellement ${fmt(f.referenceMs)}).` });
    }
    for (const t of teams) { const n = yellowBy.get(t.id) ?? 0; if (n) cheating.push({ tone: n >= 2 ? "bad" : "warn", text: `${t.name} : ${n} carte${n > 1 ? "s" : ""} jaune${n > 1 ? "s" : ""}.` }); }

    // --- Evaluations tres basses / tres hautes d'un eleve.
    const mine = evals.filter((e) => students.has(e.targetUserId));
    const byStudent = new Map<string, typeof mine>();
    for (const e of mine) byStudent.set(e.targetUserId, [...(byStudent.get(e.targetUserId) ?? []), e]);
    for (const [, es] of byStudent) {
      const avg = es.reduce((s, e) => s + gradeOf(e.note), 0) / es.length;
      const name = es[0].targetName;
      if (es.length >= 2 && avg <= 1.5) evalFacts.push({ tone: "bad", text: `${name} : moyenne ${avg.toFixed(1).replace(".", ",")}/5 sur ${es.length} évaluations.` });
      else for (const e of es.filter((x) => isBad(x.note) && codeOf(x.note) === "TI")) evalFacts.push({ tone: "bad", text: `${name} : TI en ${cap(e.exerciseLabel)} (par ${e.refereeName}).` });
      if (es.length >= 2 && avg >= 4.5) evalFacts.push({ tone: "good", text: `${name} : moyenne ${avg.toFixed(1).replace(".", ",")}/5 sur ${es.length} évaluations.` });
      else for (const e of es.filter((x) => isExcellent(x.note))) evalFacts.push({ tone: "good", text: `${name} : E en ${cap(e.exerciseLabel)} (par ${e.refereeName}).` });
    }
    const unseen = [...students].filter((id) => !byStudent.has(id)).length;
    if (unseen && evals.length) evalFacts.push({ tone: "info", text: `${unseen} élève${unseen > 1 ? "s" : ""} de la classe jamais évalué${unseen > 1 ? "s" : ""}.` });

    return { className: cls, teams: teams.length, students: students.size, refereeing, teamsLevel, cheating, evals: evalFacts };
  }).filter((c) => c.teams || c.refereeing.length);
  void isTestClass;
  return { sessionId, label: session.label ?? "WOD Level", ended: !!session.raceEndedAt, evaluations: evals.length, classes: out };
}
