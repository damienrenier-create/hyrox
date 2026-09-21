"use server";

import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export async function createSessionAction(formData: FormData) {
  const numTeamsRaw = formData.get("numTeams");
  const numTeams = numTeamsRaw ? parseInt(numTeamsRaw as string, 10) : 24;

  // 1. Fermer l'ancienne session
  await db.orm.public.Session.where({ isActive: true }).update({ isActive: false });

  await db.transaction(async (tx) => {
    const newSession = await tx.orm.public.Session.create({
      wodType: "PYRAMIDE_CLASSIQUE",
      isActive: true,
      settings: {
        numTeams
      }
    });

    const teams = Array.from({ length: numTeams }).map((_, i) => ({
      name: `Équipe ${i + 1}`,
      sessionId: newSession.id,
    }));

    for (const team of teams) {
      await tx.orm.public.Team.create(team);
    }
  });

  redirect("/greffier");
}
