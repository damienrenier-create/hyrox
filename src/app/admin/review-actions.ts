"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { displayPseudo } from "@/lib/staff-names";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { isQualityCode } from "@/lib/wod-engines/core/quality";

// Regard du prof sur la seance d'un eleve : meme grille que l'auto-evaluation, plus un commentaire.
// L'eleve ne voit la grille et le commentaire que si l'admin l'a explicitement decide, separement.
export type ReviewInput = {
  sessionId: string;
  studentId: string;
  answers: Record<string, string>;
  visible: boolean;
  comment: string;
  commentVisible: boolean;
};
export type ReviewView = { answers: Record<string, string>; visible: boolean; comment: string | null; commentVisible: boolean; reviewerName: string; updatedAt: string };

async function requireStaff() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}

export async function saveReviewAction(input: ReviewInput): Promise<{ error: string } | { ok: true; review: ReviewView }> {
  const user = await requireStaff();
  const student = await db.orm.public.User.where({ id: input.studentId, role: "STUDENT" }).first();
  if (!student) return { error: "Élève introuvable." };
  if (!(await db.orm.public.Session.where({ id: input.sessionId }).first())) return { error: "Séance introuvable." };

  // On ne garde que des reponses valides sur des criteres connus : la grille de l'eleve et celle du prof
  // parlent exactement la meme langue.
  const clean: Record<string, string> = {};
  for (const c of SELF_EVAL_CRITERIA) {
    const v = input.answers[c.id];
    if (v && isQualityCode(v)) clean[c.id] = v;
  }
  const comment = input.comment.trim().slice(0, 1000) || null;
  const data = {
    answers: clean,
    visible: !!input.visible,
    comment,
    commentVisible: !!input.commentVisible && !!comment,
    reviewerName: displayPseudo(user.name),
    updatedAt: Temporal.Now.instant(),
  };

  const existing = await db.orm.public.SelfEvalReview.where({ sessionId: input.sessionId, studentId: input.studentId }).first();
  if (existing) await db.orm.public.SelfEvalReview.where({ id: existing.id }).update(data);
  else await db.orm.public.SelfEvalReview.create({ sessionId: input.sessionId, studentId: input.studentId, ...data });

  return { ok: true, review: { ...data, updatedAt: String(data.updatedAt) } };
}

export async function deleteReviewAction(sessionId: string, studentId: string): Promise<{ ok: true }> {
  await requireStaff();
  const existing = await db.orm.public.SelfEvalReview.where({ sessionId, studentId }).first();
  if (existing) await db.orm.public.SelfEvalReview.where({ id: existing.id }).delete();
  return { ok: true };
}
