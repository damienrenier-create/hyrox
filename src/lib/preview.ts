import { getSession } from "@/lib/auth";

// Aperçu d'un compte eleve par un admin (« se connecter en tant que », 29/09 nuit) : lecture seule. Chaque action
// d'ecriture de l'eleve (auto-evaluation, demande d'arbitrage, flotte, tirs, evaluations) commence par ce controle.
export const PREVIEW_READ_ONLY = "Mode aperçu : tu vois le compte de l'élève, tu ne peux rien faire à sa place.";
export async function inPreview(): Promise<boolean> {
  return !!(await getSession())?.impersonatedBy;
}
