import { db } from "@/lib/db";
import { displayName } from "@/lib/staff-names";

// Les profs (DAMZER, coachs) : les seuls a avoir un journal de classe et un carnet de cotes. Le greffier n'en a pas.
// La ligne User d'un prof est creee a sa premiere connexion (resolveStaffUser) : un coach qui ne s'est jamais
// connecte n'apparait pas encore ici, c'est normal.
export type Teacher = { id: string; pseudo: string; name: string; role: string };

export async function listTeachers(): Promise<Teacher[]> {
  const rows = await db.orm.public.User.where((u) => u.role.in(["ADMIN", "MASTER_ADMIN"])).all();
  return rows
    .map((u) => ({ id: u.id, pseudo: u.name, name: displayName(u), role: u.role as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// Nom d'usage par identifiant, pour etiqueter creneaux et seances (« G. Tasquin »).
export async function teacherNameById(): Promise<Map<string, string>> {
  return new Map((await listTeachers()).map((t) => [t.id, t.name]));
}
