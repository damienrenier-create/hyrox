"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";

// La creation/ouverture de seance vit dans cycles-actions.ts (openSessionAction) et src/lib/scheduling.ts.

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
  // Faille fermee le 18/11 : cette action n'etait reservee a personne. Seul le responsable de l'ecole importe (la page
  // Eleves a son propre import, avec verification des doublons : eleves/actions.ts).
  const me = await getSession();
  if (!me || me.role !== "MASTER_ADMIN" || me.impersonatedBy) throw new Error("Accès refusé.");
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
