import { db } from "@/lib/db";
import { getSession as readCookie, login, type SessionPayload } from "@/lib/auth";

// Lecture de session cote serveur, avec REPARATION des cookies emis avant le correctif des comptes pseudo :
// leur identifiant etait invente (`user_<horodatage>`), donc toute ecriture echouait en cle etrangere.
// Ici on retrouve la vraie ligne User a partir du pseudo et on rafraichit le cookie quand le contexte le
// permet (action serveur) ; sinon la requete en cours travaille deja avec le bon identifiant.
// Ce module importe la base : il ne doit JAMAIS etre importe par le proxy (middleware), qui garde `decrypt`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROF_USER_NAME = "Damien Renier";

export async function getSession(): Promise<SessionPayload | null> {
  const s = await readCookie();
  if (!s) return null;
  if (s.role === "STUDENT" || UUID.test(s.id)) return s;

  const names = s.name === "DAMZER" ? [PROF_USER_NAME, s.name] : [s.name];
  for (const name of names) {
    const found = await db.orm.public.User.where({ name }).first();
    if (!found) continue;
    const repaired: SessionPayload = { ...s, id: found.id };
    try {
      await login(repaired, true); // hors action serveur, Next refuse d'ecrire le cookie : on ignore
    } catch {
      /* le cookie sera reecrit a la prochaine action serveur */
    }
    return repaired;
  }
  return s;
}

export type { SessionPayload };
