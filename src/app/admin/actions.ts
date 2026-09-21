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

export type ImportUserPayload = {
  firstName: string;
  lastName: string;
  className: string;
};

export async function importUsersAction(users: ImportUserPayload[]) {
  let importedCount = 0;
  await db.transaction(async (tx) => {
    for (const user of users) {
      // Create a unique name identifier. If there's a collision, we could append a number, but for now we append class name.
      let computedName = `${user.firstName.trim()} ${user.lastName.trim()} (${user.className.trim()})`;
      
      // Check if exists
      const existing = await tx.orm.public.User.where({ name: computedName }).first();
      if (!existing) {
        await tx.orm.public.User.create({
          name: computedName,
          firstName: user.firstName.trim(),
          lastName: user.lastName.trim(),
          className: user.className.trim(),
          role: "STUDENT",
        });
        importedCount++;
      }
    }
  });
  return { success: true, count: importedCount };
}
