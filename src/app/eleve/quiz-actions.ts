"use server";

import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { readQuizOpen } from "@/lib/session-roles";
import { buildQuiz, gradeQuiz, quizSeed } from "@/lib/hyrox-quiz";

// Reponse au QCM bonus (WOD Hyrox) : une seule tentative, corrigee cote serveur avec le meme tirage que la page.
export async function submitQuizAction(sessionId: string, checked: Record<string, string[]>): Promise<{ error: string } | { ok: true; score: number; total: number }> {
  if (await inPreview()) return { error: PREVIEW_READ_ONLY };
  const user = await getSession();
  if (!user || user.role !== "STUDENT") return { error: "Réservé aux élèves connectés." };
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt || session.wodType !== "HYROX") return { error: "Séance introuvable." };
  if (!readQuizOpen(session.settings)) return { error: "Le QCM est fermé." };
  const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  if (!teams.some((t) => memberships.some((m) => m.teamId === t.id))) return { error: "Tu n'as pas participé à cette séance." };
  if (await db.orm.public.QuizAnswer.where({ sessionId, studentId: user.id }).first()) return { error: "Tu as déjà répondu à ce QCM." };

  const { key } = buildQuiz(quizSeed(sessionId, user.id));
  const clean: Record<string, string[]> = {};
  for (const q of Object.keys(key)) clean[q] = [...new Set((checked[q] ?? []).filter((v) => typeof v === "string" && /^[vf]\d$/.test(v)))].sort();
  const { score, total } = gradeQuiz(key, clean);
  try {
    await db.orm.public.QuizAnswer.create({ sessionId, studentId: user.id, answers: clean, score, total });
  } catch {
    return { error: "Tu as déjà répondu à ce QCM." }; // contrainte unique : double envoi
  }
  return { ok: true, score, total };
}
