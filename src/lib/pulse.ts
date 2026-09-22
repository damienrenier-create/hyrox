"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";

// « Pouls » d'une seance : une signature minuscule que les ecrans interrogent a la place de recharger
// toute la page. Un rafraichissement complet du greffier, c'est ~30 requetes ; ce pouls en fait 2 a 4,
// et la plupart du temps il renvoie la MEME valeur, donc aucun rendu n'est declenche.
// C'est ce qui evite de laisser la base Neon tourner en permanence (et de la facturer) pendant un cours.

export type Pulse = string;

async function count(fn: () => Promise<{ n: number }>): Promise<number> {
  try {
    return (await fn()).n;
  } catch {
    return -1;
  }
}

// Ecran d'arbitrage (eleves) : seuls les tirs et la fin du WOD changent ce qu'ils voient.
export async function refereePulseAction(sessionId: string): Promise<Pulse> {
  const user = await getSession();
  if (!user) return "";
  const [shots, session] = await Promise.all([
    count(() => db.orm.public.Shot.where({ sessionId }).aggregate((a) => ({ n: a.count() }))),
    db.orm.public.Session.where({ id: sessionId }).first(),
  ]);
  return `${shots}|${session?.raceEndedAt ? 1 : 0}`;
}

// Ecran greffier : tours, cartes, evaluations, composition des equipes et arbitres.
export async function greffierPulseAction(sessionId: string): Promise<Pulse> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER", "ADMIN"].includes(user.role)) return "";
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const [laps, cards, evals, refs] = await Promise.all([
    rs ? count(() => db.orm.public.Lap.where({ raceStateId: rs.id }).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
    rs ? count(() => db.orm.public.YellowCard.where({ raceStateId: rs.id }).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
    count(() => db.orm.public.Evaluation.where({ sessionId }).aggregate((a) => ({ n: a.count() }))),
    count(() => db.orm.public.SessionReferee.where({ sessionId }).aggregate((a) => ({ n: a.count() }))),
  ]);
  return `${laps}|${cards}|${evals}|${refs}|${rs?.startedAt ? 1 : 0}|${rs?.endedAt ? 1 : 0}`;
}

// Espace eleve en attente d'autorisation d'arbitrage : seul son propre statut compte.
export async function myRefereeStatusPulseAction(sessionId: string): Promise<Pulse> {
  const user = await getSession();
  if (!user) return "";
  const row = await db.orm.public.SessionReferee.where({ sessionId, userId: user.id }).first();
  return row?.status ?? "NONE";
}
