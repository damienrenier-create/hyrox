"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buildRaceContext, teamFinishedAtMs } from "@/lib/race-context";
import { finishAt } from "@/lib/wod-engines/templates/pyramide-engine";
import { SELF_EVAL_CRITERIA, selfEvalWindow } from "@/lib/wod-engines/core/self-eval";
import { isQualityCode } from "@/lib/wod-engines/core/quality";

export async function submitSelfEvaluationAction(
  sessionId: string,
  answers: Record<string, string>
): Promise<{ error: string } | { ok: true }> {
  const user = await getSession();
  if (!user || user.role !== "STUDENT") return { error: "Réservé aux élèves connectés." };

  // L'eleve doit avoir participe (membre d'une equipe de cette seance, encode par le greffier).
  const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const myTeam = teams.find((t) => memberships.some((m) => m.teamId === t.id));
  if (!myTeam) return { error: "Tu n'as pas participé à cette séance." };

  // Toutes les lignes doivent etre remplies avec un code de l'echelle.
  for (const c of SELF_EVAL_CRITERIA) {
    if (!isQualityCode(answers[c.id])) return { error: `Réponse manquante ou invalide : ${c.label}.` };
  }
  const clean: Record<string, string> = {};
  for (const c of SELF_EVAL_CRITERIA) clean[c.id] = answers[c.id];

  // Fenetre de 24h a partir de la fin de l'equipe (ou de la fin officielle du WOD), verifiee cote serveur.
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const bundle = await buildRaceContext(sessionId);
  const finishedAt = teamFinishedAtMs(bundle, finishAt(bundle.ctx, myTeam.id));
  const raceEndedAtMs = session.raceEndedAt ? new Date(String(session.raceEndedAt)).getTime() : null;
  const win = selfEvalWindow(finishedAt, raceEndedAtMs);
  if (win.notYet) return { error: "L'auto-évaluation s'ouvre à la fin de ton WOD." };
  if (win.expired) return { error: "Le délai de 24 h est dépassé." };

  const existing = await db.orm.public.SelfEvaluation.where({ sessionId, studentId: user.id }).first();
  if (existing) {
    await db.orm.public.SelfEvaluation.where({ id: existing.id }).update({ answers: clean, submittedAt: Temporal.Now.instant() });
  } else {
    await db.orm.public.SelfEvaluation.create({ sessionId, studentId: user.id, answers: clean });
  }
  return { ok: true };
}
