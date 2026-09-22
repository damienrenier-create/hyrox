"use server";

import { login, SessionPayload } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import crypto from "crypto";

export type LoginState = { error: string } | undefined;

// Le prof importe depuis la liste des eleves (ligne PROF) : c'est cette ligne qui porte les flottes fantomes.
const PROF_USER_NAME = "Damien Renier";

// Les comptes pseudo + mot de passe doivent pointer sur une VRAIE ligne User : flottes, tirs et evaluations
// portent tous une cle etrangere vers User.id. Un identifiant invente faisait echouer toute ecriture
// (erreur serveur au placement d'un bateau) et changeait a chaque connexion.
async function resolveStaffUser(pseudo: string, role: SessionPayload["role"]): Promise<string> {
  const names = pseudo === "DAMZER" ? [PROF_USER_NAME, pseudo] : [pseudo];
  for (const name of names) {
    const found = await db.orm.public.User.where({ name }).first();
    if (found) return found.id;
  }
  const created = await db.orm.public.User.create({ name: pseudo, role: role === "STUDENT" ? "ADMIN" : role });
  return created.id;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const rawName = formData.get("name") as string;
  const password = ((formData.get("password") as string) || "").trim();
  const remember = formData.get("remember") === "on";

  if (!rawName) return { error: "Le nom est requis." };
  const name = rawName.trim().toUpperCase();

  let role: SessionPayload["role"] = "STUDENT";

  // Auto-détection du rôle en fonction du Pseudo
  if (name === "DAMZER") {
    role = "MASTER_ADMIN";
    if (password !== "boss") return { error: "Mot de passe incorrect pour DAMZER." };
  } else if (["AXEZER", "GUIZER", "SIMZER", "RACZER"].includes(name)) {
    role = "ADMIN";
    if (password !== "coach") return { error: "Mot de passe incorrect." };
  } else if (name === "GREFFIER") {
    role = "GREFFIER";
    if (password !== "greffe") return { error: "Mot de passe incorrect." };
  } else {
    // Ce formulaire est reserve aux comptes pseudo + mot de passe. Un eleve passe par
    // classe -> recherche -> PIN (studentLoginAction), seul chemin qui donne son vrai identifiant.
    return { error: "Pseudo inconnu. Les élèves se connectent avec leur classe et leur code PIN." };
  }

  // Créer la session JWT sur le VRAI identifiant en base (stable d'une connexion a l'autre).
  await login({ id: await resolveStaffUser(name, role), role, name }, remember);

  // Redirection selon le rôle. Les coachs (ADMIN) tombaient dans le `redirect` final et atterrissaient
  // sur le Touché-Coulé, qui leur generait aussitot une flotte : ils entraient dans le jeu en se
  // connectant. Leur ecran, c'est la consultation.
  if (role === "MASTER_ADMIN" || role === "ADMIN") redirect("/admin");
  if (role === "GREFFIER") redirect("/greffier");
  redirect("/touche-coule");
}

// ===== Login élève : classe -> recherche -> PIN, avec le vrai identifiant permanent =====

export async function listClassesAction(): Promise<string[]> {
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  const classes = new Set<string>();
  students.forEach((s) => { if (s.className) classes.add(s.className); });
  return Array.from(classes).sort();
}

export type StudentMatch = { id: string; firstName: string; lastName: string; hasPin: boolean };

export async function searchStudentsAction(className: string, query: string): Promise<StudentMatch[]> {
  const q = query.trim().toLowerCase();
  if (!className || q.length < 1) return [];
  const students = await db.orm.public.User.where({ role: "STUDENT", className }).all();
  return students
    .filter((s) =>
      (s.firstName ?? "").toLowerCase().startsWith(q) || (s.lastName ?? "").toLowerCase().startsWith(q)
    )
    .slice(0, 8)
    .map((s) => ({ id: s.id, firstName: s.firstName ?? "", lastName: s.lastName ?? "", hasPin: !!s.pinCode }));
}

function hashPin(pin: string, salt: string) {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

export async function studentLoginAction(
  studentId: string,
  pin: string,
  remember = false
): Promise<{ error: string } | void> {
  if (!/^\d{4,6}$/.test(pin)) {
    return { error: "Le code PIN doit contenir 4 à 6 chiffres." };
  }

  const user = await db.orm.public.User.where({ id: studentId, role: "STUDENT" }).first();
  if (!user) return { error: "Élève introuvable." };

  if (!user.pinCode) {
    // Première connexion : on enregistre ce code comme code personnel.
    const salt = crypto.randomBytes(16).toString("hex");
    await db.orm.public.User.where({ id: user.id }).update({ pinCode: `${salt}:${hashPin(pin, salt)}` });
  } else {
    const [salt, hash] = user.pinCode.split(":");
    if (hashPin(pin, salt) !== hash) return { error: "Code PIN incorrect." };
  }

  await login(
    {
      id: user.id,
      role: "STUDENT",
      name: user.name,
      className: user.className ?? undefined,
    },
    remember
  );
  redirect("/eleve");
}
