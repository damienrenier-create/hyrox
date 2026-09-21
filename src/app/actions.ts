"use server";

import { login, SessionPayload } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData) {
  const role = formData.get("role") as SessionPayload["role"];
  const name = formData.get("name") as string;
  const password = formData.get("password") as string;

  // Validation très basique pour la démo
  if (!name) throw new Error("Le nom est requis.");

  // Vérification des mots de passe (en dur pour la V1)
  if (role === "MASTER_ADMIN" && password !== "boss") {
    throw new Error("Mot de passe incorrect.");
  }
  if (role === "ADMIN" && password !== "coach") {
    throw new Error("Mot de passe incorrect.");
  }
  if (role === "GREFFIER" && password !== "greffe") {
    throw new Error("Mot de passe incorrect.");
  }

  // Créer la session JWT
  await login({
    id: `user_${Date.now()}`,
    role,
    name,
  });

  // Redirection selon le rôle
  if (role === "MASTER_ADMIN") redirect("/admin");
  if (role === "GREFFIER") redirect("/greffier");
  redirect("/touche-coule");
}
