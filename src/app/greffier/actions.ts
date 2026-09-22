"use server";

import { db } from "@/lib/db";
import { resolveCaseA, resolveCaseB } from "@/lib/wod-engines/core/reliability";
import type { FirebaseShot } from "@/lib/firebase/firebase-sync";

// Les evaluations sont deja creees en direct par les arbitres (touche-coule/actions.ts -> submitEvaluationAction) :
// Postgres est la seule source de verite. Cette action ne relit plus jamais Firebase, elle calcule juste la
// fiabilite finale a partir des vraies evaluations enregistrees, et cloture la session.
export async function finishRaceAction(sessionId: string) {
  const evaluations = await db.orm.public.Evaluation.where({ sessionId }).all();

  const evaluatorIds = [...new Set(evaluations.map((e) => e.evaluatorId))];
  const roleByEvaluator = new Map<string, string>();
  for (const id of evaluatorIds) {
    const user = await db.orm.public.User.where({ id }).first();
    if (user) roleByEvaluator.set(id, user.role);
  }

  const byCell = new Map<string, typeof evaluations>();
  for (const ev of evaluations) {
    const key = `${ev.teamId}_${ev.exerciseId}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key)!.push(ev);
  }

  const toShot = (e: (typeof evaluations)[number]): FirebaseShot => ({
    evaluatorId: e.evaluatorId,
    role: roleByEvaluator.get(e.evaluatorId) ?? "STUDENT",
    repsObserved: e.repsObserved,
    note: e.note,
    timestamp: 0,
  });

  const reliabilityScore: Record<string, number> = {};
  const addScores = (updates: Record<string, number>) => {
    for (const [uid, score] of Object.entries(updates)) {
      reliabilityScore[uid] = (reliabilityScore[uid] || 0) + score;
    }
  };

  for (const cellEvals of byCell.values()) {
    const adminShots = cellEvals.filter((e) => ["ADMIN", "MASTER_ADMIN"].includes(roleByEvaluator.get(e.evaluatorId) ?? "")).map(toShot);
    const studentShots = cellEvals.filter((e) => roleByEvaluator.get(e.evaluatorId) === "STUDENT").map(toShot);

    if (adminShots.length > 0) {
      addScores(resolveCaseA(adminShots[0], studentShots));
    } else if (studentShots.length > 0) {
      const teamAverage = studentShots.reduce((sum, s) => sum + s.note, 0) / studentShots.length;
      addScores(resolveCaseB(studentShots, teamAverage));
    }
  }

  await db.transaction(async (tx) => {
    for (const [userId, score] of Object.entries(reliabilityScore)) {
      const user = await tx.orm.public.User.where({ id: userId }).first();
      if (user) {
        await tx.orm.public.User.where({ id: userId }).update({ reliability: user.reliability + score });
      }
    }
    await tx.orm.public.Session.where({ id: sessionId }).update({
      isActive: false,
      raceEndedAt: Temporal.Now.instant(),
    });
    const raceState = await tx.orm.public.RaceState.where({ sessionId }).first();
    if (raceState && !raceState.endedAt) {
      await tx.orm.public.RaceState.where({ id: raceState.id }).update({ endedAt: Temporal.Now.instant() });
    }
  });
}
