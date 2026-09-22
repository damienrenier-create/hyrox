"use server";

import { login, SessionPayload } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import crypto from "crypto";

export type LoginState = { error: string } | undefined;

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const rawName = formData.get("name") as string;
  const password = formData.get("password") as string;

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
    // Étudiant : on garde la casse originale pour l'affichage
    role = "STUDENT";
  }

  // Créer la session JWT
  await login({
    id: `user_${Date.now()}`,
    role,
    name: role === "STUDENT" ? rawName.trim() : name,
  });

  // Redirection selon le rôle
  if (role === "MASTER_ADMIN") redirect("/admin");
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

export async function studentLoginAction(studentId: string, pin: string): Promise<{ error: string } | void> {
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

  await login({
    id: user.id,
    role: "STUDENT",
    name: user.name,
    className: user.className ?? undefined,
  });
  redirect("/touche-coule");
}
