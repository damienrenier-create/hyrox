import { db } from "@/lib/db";
import { notDeleted } from "@/lib/session-roles";
import { sessionsForStudent, wodLabel, type StudentSessionRow } from "@/lib/student-sessions";
import { toMs } from "@/lib/scheduling";
import { SELF_EVAL_WINDOW_MS, selfEvalGridFor, type SelfEvalGridKey } from "@/lib/wod-engines/core/self-eval";
import { pupilWindowOpen } from "@/lib/badminton-server";

// Auto-evaluations d'un eleve (Sartay 29/09 nuit : onglet « Mes auto-évaluations », puis le recap de chacune).
// Seulement ses WOD vraiment enregistres (une seance lancee sans aucun resultat reste invisible). De l'avis du prof,
// l'eleve ne voit que ce que le prof a rendu visible (grille et commentaire separement).
// Badminton (03/11) : pas d'equipes, sa propre grille ; la seance compte des que l'eleve s'y est auto-evalue, et elle
// est « à remplir » s'il y a joue ou arbitre un match et peut encore y encoder.

// Libelles courts (tableau d'evolution, resume de chaque ligne) ; la phrase complete est sur le recap.
export const SELF_EVAL_SHORT: Record<string, string> = {
  engagement: "Engagement",
  technique: "Exécution",
  quotas: "Quotas",
  effort: "Effort",
  tenue_cooperation: "Tenue & coop.",
  deplacements: "Déplacements",
  frappe: "Frappe",
  tactique: "Tactique",
  fairplay: "Fair-play",
  coaching: "Coaching",
  forme: "Forme du jour",
};

export type StudentSelfEval = {
  sessionId: string;
  grid: SelfEvalGridKey;
  answers: Record<string, string>;
  dateMs: number;
  wodName: string;
  teamName: string | null;
  review: { answers: Record<string, string> | null; comment: string | null; by: string } | null;
};

// Page d'une seance pour l'eleve (le WOD, ou ses matchs de badminton).
export const sessionHref = (sessionId: string, wodType: string) => (wodType === "BADMINTON" ? `/eleve/badminton/${sessionId}` : `/eleve/${sessionId}`);

export async function loadSelfEvalHistory(userId: string, known?: StudentSessionRow[]): Promise<{ evals: StudentSelfEval[]; todo: StudentSessionRow[] }> {
  const [selfRows, reviewRows, mine, bmSessions] = await Promise.all([
    db.orm.public.SelfEvaluation.where({ studentId: userId }).all(),
    db.orm.public.SelfEvalReview.where({ studentId: userId }).all(),
    known ? Promise.resolve(known) : sessionsForStudent(userId),
    db.orm.public.Session.where({ wodType: "BADMINTON" }).all().then((all) => all.filter(notDeleted)),
  ]);
  const sessionIds = [...new Set(selfRows.map((r) => r.sessionId))];
  const sessions = sessionIds.length ? (await db.orm.public.Session.where((s) => s.id.in(sessionIds)).all()).filter(notDeleted) : [];
  const rowOf = new Map(mine.map((r) => [r.sessionId, r]));
  // Badminton : une ligne « comme un WOD » pour chaque seance (date = ouverture prevue, sinon creation).
  const bmRow = (s: (typeof bmSessions)[number]): StudentSessionRow => ({
    sessionId: s.id,
    wodType: s.wodType,
    label: s.label ?? wodLabel(s.wodType),
    wodName: wodLabel(s.wodType),
    createdAt: String(s.createdAt),
    dateMs: toMs(s.opensAt ?? s.createdAt),
    teamId: "",
    teamName: "",
    isActive: s.isActive,
    ended: !pupilWindowOpen(s),
    recorded: true,
    cycleId: null,
    cycleName: null,
  });
  for (const s of bmSessions) if (sessionIds.includes(s.id)) rowOf.set(s.id, bmRow(s));
  const evals = selfRows
    .filter((r) => sessions.some((s) => s.id === r.sessionId) && rowOf.get(r.sessionId)?.recorded)
    .map((r) => {
      const wod = rowOf.get(r.sessionId)!;
      const rev = reviewRows.find((x) => x.sessionId === r.sessionId);
      return {
        sessionId: r.sessionId,
        grid: selfEvalGridFor(wod.wodType).key,
        answers: (r.answers as Record<string, string> | null) ?? {},
        dateMs: wod.dateMs,
        wodName: wod.wodName,
        teamName: wod.teamName || null,
        review: rev && (rev.visible || (rev.commentVisible && rev.comment)) ? { answers: rev.visible ? ((rev.answers as Record<string, string>) ?? {}) : null, comment: rev.commentVisible ? rev.comment ?? null : null, by: rev.reviewerName } : null,
      };
    })
    .sort((a, b) => a.dateMs - b.dateMs);
  // WOD termines depuis moins de 24 h sans auto-evaluation : a remplir (la page du WOD donne l'etat exact).
  const done = new Set(evals.map((e) => e.sessionId));
  const candidates = mine.filter((r) => r.recorded && r.ended && !done.has(r.sessionId));
  const ended = candidates.length ? await db.orm.public.Session.where((s) => s.id.in(candidates.map((r) => r.sessionId))).all() : [];
  const now = Date.now();
  const todo = candidates.filter((r) => {
    const s = ended.find((x) => x.id === r.sessionId);
    return !!s?.raceEndedAt && now - toMs(s.raceEndedAt) <= SELF_EVAL_WINDOW_MS;
  });
  // Badminton : seances ou l'eleve peut encore encoder, ou il a joue ou arbitre un match, sans auto-evaluation.
  const bmOpen = bmSessions.filter((s) => !done.has(s.id) && pupilWindowOpen(s));
  if (bmOpen.length) {
    const matches = await db.orm.public.BadmintonMatch.where((m) => m.sessionId.in(bmOpen.map((s) => s.id))).all();
    for (const s of bmOpen) if (matches.some((m) => m.sessionId === s.id && (m.playerAId === userId || m.playerBId === userId || m.createdById === userId))) todo.push(bmRow(s));
  }
  return { evals, todo };
}
