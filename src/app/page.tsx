import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import LoginPage from "./LoginPage";

export const dynamic = "force-dynamic";

// « Se souvenir de moi » ne sert que si l'accueil lit le cookie : un visiteur encore connecte file dans son
// espace sans retaper son code. `?compte=autre` force le formulaire (changer d'utilisateur sur un appareil
// partage), et un cookie dont l'utilisateur n'existe plus (base nettoyee) retombe aussi sur le formulaire.
export default async function Home({ searchParams }: { searchParams: Promise<{ compte?: string }> }) {
  const { compte } = await searchParams;
  const user = compte === "autre" ? null : await getSession();
  if (user) {
    const exists = await db.orm.public.User.where({ id: user.id }).first();
    if (exists) redirect(user.role === "STUDENT" ? "/eleve" : user.role === "GREFFIER" ? "/greffier" : "/admin");
  }
  return <LoginPage />;
}
