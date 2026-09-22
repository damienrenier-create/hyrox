"use server";

import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export async function createSessionAction(formData: FormData) {
  const numTeamsRaw = formData.get("numTeams");
  const numTeams = numTeamsRaw ? parseInt(numTeamsRaw as string, 10) : 24;
  const refereeMode = formData.get("refereeMode") === "on";

  // 1. Fermer l'ancienne session
  await db.orm.public.Session.where({ isActive: true }).update({ isActive: false });

  await db.transaction(async (tx) => {
    const newSession = await tx.orm.public.Session.create({
      wodType: "PYRAMIDE_CLASSIQUE",
      isActive: true,
      refereeMode,
      settings: {
        numTeams
      }
    });

    const teams = Array.from({ length: numTeams }).map((_, i) => ({
      name: `Équipe ${i + 1}`,
      order: i + 1,
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
  sex?: "M" | "F";
  dateOfBirth?: string; // "JJ/MM/AAAA"
};

function parseFrDate(raw?: string) {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, d, mo, y] = m;
  return Temporal.Instant.fromEpochMilliseconds(Date.UTC(+y, +mo - 1, +d));
}

export async function importUsersAction(users: ImportUserPayload[]) {
  let importedCount = 0;
  await db.transaction(async (tx) => {
    for (const user of users) {
      const firstName = user.firstName.trim();
      const lastName = user.lastName.trim();
      const isProf = user.className.trim().toUpperCase() === "PROF";
      const className = isProf ? null : user.className.trim();

      // Identite naturelle : prenom + nom + classe (jamais utilisee comme cle, seulement pour eviter les doublons a l'import)
      const existing = await tx.orm.public.User.where({
        firstName,
        lastName,
        className: className ?? undefined,
      }).first();
      if (existing) continue;

      await tx.orm.public.User.create({
        name: `${firstName} ${lastName}`,
        firstName,
        lastName,
        className,
        sex: user.sex,
        dateOfBirth: parseFrDate(user.dateOfBirth),
        role: isProf ? "ADMIN" : "STUDENT",
      });
      importedCount++;
    }
  });
  return { success: true, count: importedCount };
}
