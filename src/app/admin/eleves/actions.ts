"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";

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
  const className = str(fd, "className");
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
  const className = str(fd, "className").toUpperCase();
  const sexRaw = str(fd, "sex");
  const dob = str(fd, "dateOfBirth");
  if (!firstName || !lastName) redirect("/admin/eleves?msg=" + encodeURIComponent("Prénom et nom sont obligatoires."));
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) redirect("/admin/eleves?msg=" + encodeURIComponent("Date de naissance invalide."));
  const dup = (await db.orm.public.User.where({ role: "STUDENT" }).all()).find((u) => (u.firstName ?? "").trim().toLowerCase() === firstName.toLowerCase() && (u.lastName ?? "").trim().toLowerCase() === lastName.toLowerCase());
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
