"use server";

import { login, SessionPayload } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData) {
  const rawName = formData.get("name") as string;
  const password = formData.get("password") as string;

  if (!rawName) throw new Error("Le nom est requis.");
  const name = rawName.trim().toUpperCase();

  let role: SessionPayload["role"] = "STUDENT";

  // Auto-détection du rôle en fonction du Pseudo
  if (name === "DAMZER") {
    role = "MASTER_ADMIN";
    if (password !== "boss") throw new Error("Mot de passe incorrect pour DAMZER.");
  } else if (["AXEZER", "GUIZER", "SIMZER", "RACZER"].includes(name)) {
    role = "ADMIN";
    if (password !== "coach") throw new Error("Mot de passe incorrect.");
  } else if (name === "GREFFIER") {
    role = "GREFFIER";
    if (password !== "greffe") throw new Error("Mot de passe incorrect.");
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
