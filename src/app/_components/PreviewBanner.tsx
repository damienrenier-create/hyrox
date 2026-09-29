import { getSession } from "@/lib/session-server";
import { stopImpersonatingAction } from "../actions";

// Bandeau de l'aperçu d'un compte eleve (« se connecter en tant que », 29/09 nuit) : qui regarde quoi, lecture seule,
// et retour au compte admin en un clic.
export async function PreviewBanner() {
  const user = await getSession();
  if (!user?.impersonatedBy) return null;
  return (
    <form action={stopImpersonatingAction} className="bg-ink text-white px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
      <span>👁 Aperçu du compte de <b>{user.name}</b>{user.className ? ` (${user.className})` : ""} — exactement ce qu&apos;il voit, en lecture seule.</span>
      <button type="submit" className="rounded-full bg-white text-ink font-bold px-3 py-0.5 hover:bg-paper">↩︎ Revenir à mon compte</button>
    </form>
  );
}
