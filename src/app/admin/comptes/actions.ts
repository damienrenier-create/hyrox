"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { ORIGIN_SCHOOL } from "@/lib/school";
import { hashSecret, newPasswordProblem, secretMatches } from "@/lib/passwords";
import { pseudoProblem, pseudoTaken } from "@/lib/school-accounts";

// Comptes d'une AUTRE ecole (Sartay 18/11 : J. Piret doit pouvoir le faire seule). La responsable de l'ecole
// (MASTER_ADMIN) cree les comptes de ses collegues et du greffier et leur donne un nouveau mot de passe ; chacun change
// le sien. Toutes les requetes restent dans l'ecole de la session (filtre automatique, lib/db.ts). Aucun compte n'est
// jamais supprime. L'ecole d'origine n'est pas concernee : ses comptes et mots de passe sont dans le code.
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (kind: "ok" | "msg", text: string): never => redirect(`/admin/comptes?${kind}=${encodeURIComponent(text)}`);

async function schoolStaff(boss: boolean) {
  const me = await getSession();
  if (!me || me.impersonatedBy || !["MASTER_ADMIN", "ADMIN"].includes(me.role)) redirect("/");
  if ((me.school ?? null) === ORIGIN_SCHOOL) back("msg", "Les comptes de l'école d'origine ne se gèrent pas ici.");
  if (boss && me.role !== "MASTER_ADMIN") back("msg", "Réservé au responsable de l'école.");
  return me;
}

const initial = (first: string) => (first ? `${first.charAt(0).toUpperCase()}.` : "");

export async function createAccountAction(fd: FormData) {
  await schoolStaff(true);
  const pseudo = str(fd, "pseudo").toUpperCase();
  const role = str(fd, "role");
  const firstName = str(fd, "firstName").slice(0, 40);
  const lastName = str(fd, "lastName").slice(0, 60);
  if (role !== "ADMIN" && role !== "GREFFIER") back("msg", "Choisissez le type de compte.");
  if (role === "ADMIN" && (!firstName || !lastName)) back("msg", "Prénom et nom du collègue : les élèves verront « M. Dupont », jamais le pseudo.");
  const bad = pseudoProblem(pseudo) ?? newPasswordProblem(str(fd, "password"), str(fd, "confirm"));
  if (bad) back("msg", bad);
  if (await pseudoTaken(pseudo)) back("msg", `Le pseudo ${pseudo} est déjà pris : choisissez-en un autre.`);
  await db.orm.public.User.create({
    name: pseudo,
    role: role as "ADMIN" | "GREFFIER",
    firstName: role === "ADMIN" ? initial(firstName) : firstName || null,
    lastName: lastName || (role === "GREFFIER" ? "Greffier" : null),
    password: hashSecret(str(fd, "password")),
  });
  revalidatePath("/admin/comptes");
  back("ok", `Compte ${pseudo} créé. Donnez-lui son pseudo et son mot de passe : il se connecte sur la page d'accueil, onglet « Coach / Greffier / Admin ».`);
}

// La responsable donne un nouveau mot de passe a un compte de son ecole (oubli, ou pour couper l'acces d'un collegue).
// Pour le sien, elle passe par « Mon mot de passe » (l'actuel est demande).
export async function setAccountPasswordAction(fd: FormData) {
  const me = await schoolStaff(true);
  const target = await db.orm.public.User.where({ id: str(fd, "id") }).first();
  if (!target || target.role === "STUDENT" || target.name === "DAMZER") back("msg", "Compte introuvable dans cette école.");
  if (target!.id === me.id) back("msg", "Pour votre propre mot de passe, utilisez « Mon mot de passe » (l'actuel est demandé).");
  const bad = newPasswordProblem(str(fd, "password"), str(fd, "confirm"));
  if (bad) back("msg", bad);
  await db.orm.public.User.where({ id: target!.id }).update({ password: hashSecret(str(fd, "password")) });
  revalidatePath("/admin/comptes");
  back("ok", `Nouveau mot de passe enregistré pour ${target!.name}. L'ancien ne fonctionne plus.`);
}

export async function changeMyPasswordAction(fd: FormData) {
  const me = await schoolStaff(false);
  const row = await db.orm.public.User.where({ id: me.id }).first();
  if (!row?.password) back("msg", "Votre compte n'a pas de mot de passe propre à cette école.");
  if (!secretMatches(str(fd, "current"), row!.password)) back("msg", "Mot de passe actuel incorrect.");
  const bad = newPasswordProblem(str(fd, "password"), str(fd, "confirm"));
  if (bad) back("msg", bad);
  await db.orm.public.User.where({ id: me.id }).update({ password: hashSecret(str(fd, "password")) });
  revalidatePath("/admin/comptes");
  back("ok", "Mot de passe changé : utilisez-le dès votre prochaine connexion.");
}
