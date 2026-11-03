"use server";

import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { buildSessionStandings } from "@/lib/session-standings";
import { selfEvalGridFor, selfEvalWindow } from "@/lib/wod-engines/core/self-eval";
import { pupilWindowOpen, studentInSession } from "@/lib/badminton-server";
import { isQualityCode } from "@/lib/wod-engines/core/quality";

export async function submitSelfEvaluationAction(
  sessionId: string,
  answers: Record<string, string>
): Promise<{ error: string } | { ok: true }> {
  if (await inPreview()) return { error: PREVIEW_READ_ONLY };
  const user = await getSession();
  if (!user || user.role !== "STUDENT") return { error: "Réservé aux élèves connectés." };

  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const grid = selfEvalGridFor(session.wodType);

  // Toutes les lignes doivent etre remplies avec un code de l'echelle (grille de la seance : badminton ou Hyrox).
  for (const c of grid.criteria) {
    if (!isQualityCode(answers[c.id])) return { error: `Réponse manquante ou invalide : ${c.label}.` };
  }
  const clean: Record<string, string> = {};
  for (const c of grid.criteria) clean[c.id] = answers[c.id];

  if (session.wodType === "BADMINTON") {
    // Badminton (03/11) : pas d'equipes. Un eleve de la seance, tant qu'il peut y encoder ses matchs (seance ouverte,
    // ou terminee depuis moins de 24 h).
    const me = await db.orm.public.User.where({ id: user.id }).first();
    if (!(await studentInSession(session, user.id, me?.className ?? null))) return { error: "Tu n'es pas dans cette séance." };
    if (!pupilWindowOpen(session)) return { error: "Le délai de 24 h est dépassé." };
  } else {
    // L'eleve doit avoir participe (membre d'une equipe de cette seance, encode par le greffier).
    const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
    const teams = await db.orm.public.Team.where({ sessionId }).all();
    const myTeam = teams.find((t) => memberships.some((m) => m.teamId === t.id));
    if (!myTeam) return { error: "Tu n'as pas participé à cette séance." };

    // Fenetre de 24h a partir de la fin de l'equipe (ou de la fin officielle du WOD), verifiee cote serveur.
    const stand = await buildSessionStandings(session);
    const finishedAt = stand.finishedAtMs[myTeam.id] ?? null;
    const raceEndedAtMs = session.raceEndedAt ? new Date(String(session.raceEndedAt)).getTime() : null;
    const win = selfEvalWindow(finishedAt, raceEndedAtMs);
    if (win.notYet) return { error: "L'auto-évaluation s'ouvre à la fin de ton WOD." };
    if (win.expired) return { error: "Le délai de 24 h est dépassé." };
  }

  const existing = await db.orm.public.SelfEvaluation.where({ sessionId, studentId: user.id }).first();
  if (existing) {
    await db.orm.public.SelfEvaluation.where({ id: existing.id }).update({ answers: clean, submittedAt: Temporal.Now.instant() });
  } else {
    await db.orm.public.SelfEvaluation.create({ sessionId, studentId: user.id, answers: clean });
  }
  return { ok: true };
}
