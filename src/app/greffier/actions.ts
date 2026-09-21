"use server";

import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { resolveCaseA, resolveCaseB } from "@/lib/wod-engines/core/reliability";

export async function finishRaceAction(sessionId: string, gridData: string) {
  const grid = JSON.parse(gridData);
  
  // 1. Sauvegarder toutes les évaluations dans PostgreSQL
  const evaluationsToCreate: any[] = [];
  const reliabilityScore: Record<string, number> = {};

  for (const coord in grid) {
    const [teamId, exerciseId] = coord.split("_");
    const cellData = grid[coord];
    
    if (cellData.shots) {
      const shots = Object.values(cellData.shots) as any[];
      
      const adminShots = shots.filter(s => s.role === "ADMIN" || s.role === "MASTER_ADMIN");
      const studentShots = shots.filter(s => s.role === "STUDENT");

      // Appliquer l'algorithme de fiabilité
      if (adminShots.length > 0) {
        // CAS A
        const adminTruth = adminShots[0];
        const updates = resolveCaseA(adminTruth, studentShots);
        for (const [uid, score] of Object.entries(updates)) {
          reliabilityScore[uid] = (reliabilityScore[uid] || 0) + score;
        }
      } else {
        // CAS B (On simule une moyenne d'équipe de 3 pour la démo)
        const teamAverage = 3; 
        const updates = resolveCaseB(studentShots, teamAverage);
        for (const [uid, score] of Object.entries(updates)) {
          reliabilityScore[uid] = (reliabilityScore[uid] || 0) + score;
        }
      }

      // Préparer les insertions Prisma
      for (const shot of shots) {
        evaluationsToCreate.push({
          sessionId,
          teamId,
          exerciseId,
          evaluatorId: shot.evaluatorId,
          repsObserved: shot.repsObserved,
          note: shot.note,
          isValidated: true,
        });
      }
    }
  }

  // Transaction Prisma
  await db.transaction(async (tx) => {
    // Insérer les évaluations
    for (const evalData of evaluationsToCreate) {
      await tx.orm.public.Evaluation.create(evalData);
    }

    // Mettre à jour la fiabilité des arbitres
    for (const [userId, score] of Object.entries(reliabilityScore)) {
      if (userId.startsWith("user_")) continue; // Ignorer les utilisateurs anonymes/demo
      
      const user = await tx.orm.public.User.where({ id: userId }).first();
      if (user) {
        await tx.orm.public.User.where({ id: userId }).update({
          reliability: user.reliability + score
        });
      }
    }

    // Fermer la session
    await tx.orm.public.Session.where({ id: sessionId }).update({ isActive: false });
  });

  redirect("/");
}
