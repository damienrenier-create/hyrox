import { db } from "@/lib/db";
import { notDeleted } from "@/lib/session-roles";
import { sessionsForStudent, type StudentSessionRow } from "@/lib/student-sessions";
import { toMs } from "@/lib/scheduling";
import { SELF_EVAL_WINDOW_MS } from "@/lib/wod-engines/core/self-eval";

// Auto-evaluations d'un eleve (Sartay 29/09 nuit : onglet « Mes auto-évaluations », puis le recap de chacune).
// Seulement ses WOD vraiment enregistres (une seance lancee sans aucun resultat reste invisible). De l'avis du prof,
// l'eleve ne voit que ce que le prof a rendu visible (grille et commentaire separement).

// Libelles courts (tableau d'evolution, resume de chaque ligne) ; la phrase complete est sur le recap.
export const SELF_EVAL_SHORT: Record<string, string> = {
  engagement: "Engagement",
  technique: "Exécution",
  quotas: "Quotas",
  effort: "Effort",
  tenue_cooperation: "Tenue & coop.",
  forme: "Forme du jour",
};

export type StudentSelfEval = {
  sessionId: string;
  answers: Record<string, string>;
  dateMs: number;
  wodName: string;
  teamName: string | null;
  review: { answers: Record<string, string> | null; comment: string | null; by: string } | null;
};

export async function loadSelfEvalHistory(userId: string, known?: StudentSessionRow[]): Promise<{ evals: StudentSelfEval[]; todo: StudentSessionRow[] }> {
  const [selfRows, reviewRows, mine] = await Promise.all([
    db.orm.public.SelfEvaluation.where({ studentId: userId }).all(),
    db.orm.public.SelfEvalReview.where({ studentId: userId }).all(),
    known ? Promise.resolve(known) : sessionsForStudent(userId),
  ]);
  const sessionIds = [...new Set(selfRows.map((r) => r.sessionId))];
  const sessions = sessionIds.length ? (await db.orm.public.Session.where((s) => s.id.in(sessionIds)).all()).filter(notDeleted) : [];
  const rowOf = new Map(mine.map((r) => [r.sessionId, r]));
  const evals = selfRows
    .filter((r) => sessions.some((s) => s.id === r.sessionId) && rowOf.get(r.sessionId)?.recorded)
    .map((r) => {
      const wod = rowOf.get(r.sessionId)!;
      const rev = reviewRows.find((x) => x.sessionId === r.sessionId);
      return {
        sessionId: r.sessionId,
        answers: (r.answers as Record<string, string> | null) ?? {},
        dateMs: wod.dateMs,
        wodName: wod.wodName,
        teamName: wod.teamName,
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
  return { evals, todo };
}
