"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { canonicalClassName, classCountsOf } from "@/lib/class-names";
import { MAX_IMPORT_ROWS, planImport, sanitizeRow, type ExistingStudent, type PlannedRow } from "@/lib/student-import";

// Fiche eleve, cote admin : identite corrigeable (nom, prenom, classe, sexe, date de naissance) et
// remise a zero du code PIN. Jamais de suppression d'eleve ici.
async function requireStaff() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function updateStudentAction(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  const student = await db.orm.public.User.where({ id, role: "STUDENT" }).first();
  if (!student) redirect("/admin/eleves?msg=" + encodeURIComponent("Élève introuvable."));

  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  // Orthographe de la classe existante (« 5GTA » -> « 5GTa ») : sinon une classe de plus dans la liste de connexion.
  const className = canonicalClassName(str(fd, "className"), classCountsOf(await db.orm.public.User.where({ role: "STUDENT" }).all()));
  const sexRaw = str(fd, "sex");
  const dob = str(fd, "dateOfBirth");
  if (!firstName || !lastName) redirect(`/admin/eleves/${id}?msg=` + encodeURIComponent("Prénom et nom sont obligatoires."));
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) redirect(`/admin/eleves/${id}?msg=` + encodeURIComponent("Date de naissance invalide."));

  await db.orm.public.User.where({ id }).update({
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    className: className || null,
    sex: sexRaw === "M" || sexRaw === "F" ? sexRaw : null,
    // Stockee a minuit UTC, comme a l'import : la verification de premiere connexion compare les 10 premiers caracteres.
    dateOfBirth: dob ? Temporal.Instant.from(`${dob}T00:00:00Z`) : null,
  });
  revalidatePath(`/admin/eleves/${id}`);
  redirect(`/admin/eleves/${id}?ok=` + encodeURIComponent("Fiche enregistrée."));
}

// Nouveau profil (nouvel eleve, collegue, stagiaire...) : nom, prenom, classe, sexe, date de naissance.
// Le PIN se cree a la premiere connexion, comme pour un eleve importe.
export async function createStudentAction(fd: FormData) {
  await requireStaff();
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  const sexRaw = str(fd, "sex");
  const dob = str(fd, "dateOfBirth");
  if (!firstName || !lastName) redirect("/admin/eleves?msg=" + encodeURIComponent("Prénom et nom sont obligatoires."));
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) redirect("/admin/eleves?msg=" + encodeURIComponent("Date de naissance invalide."));
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  // Plus de MAJUSCULES forcees (Sartay 08/10) : la classe reprend l'orthographe de la classe existante (« 5gta » -> « 5GTa »).
  const className = canonicalClassName(str(fd, "className"), classCountsOf(students));
  const dup = students.find((u) => (u.firstName ?? "").trim().toLowerCase() === firstName.toLowerCase() && (u.lastName ?? "").trim().toLowerCase() === lastName.toLowerCase());
  if (dup) redirect(`/admin/eleves/${dup.id}?msg=` + encodeURIComponent("Ce profil existe déjà : le voici."));
  const created = await db.orm.public.User.create({
    role: "STUDENT",
    name: `${firstName} ${lastName}`,
    firstName,
    lastName,
    className: className || null,
    sex: sexRaw === "M" || sexRaw === "F" ? sexRaw : null,
    dateOfBirth: dob ? Temporal.Instant.from(`${dob}T00:00:00Z`) : null,
  });
  revalidatePath("/admin/eleves");
  redirect(`/admin/eleves/${created.id}?ok=` + encodeURIComponent("Profil créé. L'élève choisira son PIN à sa première connexion."));
}

// « A observer en priorite » (WOD Eval, Sartay 07/10) : l'eleve est coche d'office dans la liste de chaque seance ou il joue ;
// le tirage au sort le donne d'abord aux arbitres eleves, discretement. Reversible, rien n'est efface.
export async function setStudentObsWatchAction(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  const on = str(fd, "on") === "1";
  const student = await db.orm.public.User.where({ id, role: "STUDENT" }).first();
  if (!student) redirect("/admin/eleves?msg=" + encodeURIComponent("Élève introuvable."));
  await db.orm.public.User.where({ id }).update({ obsWatch: on });
  revalidatePath(`/admin/eleves/${id}`);
  redirect(`/admin/eleves/${id}?ok=` + encodeURIComponent(on ? "Élève à observer en priorité : coché d'office dans chaque séance Eval où il joue." : "Élève retiré des priorités d'observation."));
}

export async function resetStudentPinAction(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  const student = await db.orm.public.User.where({ id, role: "STUDENT" }).first();
  if (!student) redirect("/admin/eleves?msg=" + encodeURIComponent("Élève introuvable."));
  await db.orm.public.User.where({ id }).update({ pinCode: null });
  revalidatePath(`/admin/eleves/${id}`);
  redirect(`/admin/eleves/${id}?ok=` + encodeURIComponent("Code PIN remis à zéro : l'élève en recréera un à sa prochaine connexion (date de naissance + engagement)."));
}

// ===== Importer une liste d'eleves (Sartay 18/11 : J. Piret le fait seule, « je ne peux pas m'occuper de ça en
// permanence ») =====
// Reserve au responsable de l'ecole (MASTER_ADMIN). La page lit la liste collee (lib/student-import.ts) ; ici le serveur
// relit chaque ligne, cherche les doublons parmi les eleves de l'ecole (filtre automatique de lib/db) et ne cree QUE les
// nouveaux : un eleve deja inscrit n'est ni modifie ni efface. Classe : l'orthographe d'une classe existante est reprise.
type ImportReply = { error: string } | { plan: PlannedRow[]; newClasses: string[]; created?: number };

async function prepareImport(rows: unknown): Promise<{ error: string } | { plan: PlannedRow[]; newClasses: string[] }> {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN" || user.impersonatedBy) return { error: "Réservé au responsable de l'école." };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "La liste est vide." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `Trop de lignes (${rows.length}) : ${MAX_IMPORT_ROWS} au maximum par import.` };
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  const existing: ExistingStudent[] = students.map((s) => ({
    id: s.id, firstName: s.firstName, lastName: s.lastName, className: s.className,
    dateOfBirth: s.dateOfBirth ? String(s.dateOfBirth).slice(0, 10) : null,
  }));
  const counts = classCountsOf(students);
  const known = new Set(counts.keys());
  const plan = planImport(rows.map(sanitizeRow), existing).map((r) => {
    if (r.status !== "new") return r;
    const className = canonicalClassName(r.className, counts);
    counts.set(className, (counts.get(className) ?? 0) + 1); // « 5gtb » puis « 5GTB » dans la meme liste : une seule classe
    return { ...r, className };
  });
  const newClasses = [...new Set(plan.filter((r) => r.status === "new" && !known.has(r.className)).map((r) => r.className))].sort();
  return { plan, newClasses };
}

export async function previewStudentImportAction(rows: unknown): Promise<ImportReply> {
  return prepareImport(rows);
}

export async function importStudentsAction(rows: unknown): Promise<ImportReply> {
  const prep = await prepareImport(rows);
  if ("error" in prep) return prep;
  const fresh = prep.plan.filter((r) => r.status === "new");
  let created = 0;
  await db.transaction(async (tx) => {
    for (let i = 0; i < fresh.length; i += 200) {
      created += await tx.orm.public.User.createAndCount(
        fresh.slice(i, i + 200).map((r) => ({
          role: "STUDENT" as const,
          name: `${r.firstName} ${r.lastName}`,
          firstName: r.firstName,
          lastName: r.lastName,
          className: r.className,
          sex: r.sex,
          // Minuit UTC, comme la fiche eleve : la premiere connexion compare les 10 premiers caracteres.
          dateOfBirth: r.dateOfBirth ? Temporal.Instant.from(`${r.dateOfBirth}T00:00:00Z`) : null,
        }))
      );
    }
  });
  revalidatePath("/admin/eleves");
  return { ...prep, created };
}
