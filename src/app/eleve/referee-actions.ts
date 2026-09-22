"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { isSessionOpen } from "@/lib/scheduling";
import { REFEREE_REASONS } from "@/lib/session-roles";

// L'eleve demande l'autorisation d'arbitrer (motif obligatoire). La demande apparait en popup chez le greffier
// et dans la console admin ; tant qu'elle n'est pas acceptee, pas d'acces au Touche-Coule.
export async function requestRefereeAction(sessionId: string, reason: string): Promise<{ error: string } | { ok: true }> {
  const user = await getSession();
  if (!user || user.role !== "STUDENT") return { error: "Réservé aux élèves connectés." };
  if (!(REFEREE_REASONS as readonly string[]).includes(reason)) return { error: "Indique pourquoi tu ne joues pas." };

  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || !isSessionOpen(session)) return { error: "Cette séance n'est pas ouverte." };
  if (!session.refereeMode) return { error: "Pas d'arbitrage sur cette séance." };

  const existing = await db.orm.public.SessionReferee.where({ sessionId, userId: user.id }).first();
  if (existing) {
    if (existing.status === "APPROVED") return { ok: true };
    await db.orm.public.SessionReferee.where({ id: existing.id }).update({ status: "PENDING", note: reason, decidedBy: null, decidedAt: null });
    return { ok: true };
  }
  await db.orm.public.SessionReferee.create({ sessionId, userId: user.id, note: reason, status: "PENDING" });
  return { ok: true };
}

export async function cancelRefereeRequestAction(sessionId: string): Promise<{ ok: true }> {
  const user = await getSession();
  if (!user || user.role !== "STUDENT") return { ok: true };
  const rows = await db.orm.public.SessionReferee.where({ sessionId, userId: user.id }).all();
  for (const r of rows) if (r.status === "PENDING") await db.orm.public.SessionReferee.where({ id: r.id }).delete();
  return { ok: true };
}
