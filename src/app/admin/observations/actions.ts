"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { participantsOf } from "@/lib/observations";

// Eleves a observer en priorite (Sartay 07/10) : liste d'identifiants dans Session.settings.obsWatch. Profs et coachs.
export async function setObsWatchAction(sessionId: string, userIds: string[]): Promise<{ error: string } | { ok: true; n: number }> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) return { error: "Accès refusé." };
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt) return { error: "Séance introuvable." };
  const parts = await participantsOf(sessionId);
  const allowed = new Set(parts.map((p) => p.userId));
  const keep = [...new Set(userIds.filter((id) => typeof id === "string" && allowed.has(id)))];
  // Eleves marques sur leur fiche (coches d'office) que le prof decoche pour CETTE seance.
  const off = parts.filter((p) => p.watch && !keep.includes(p.userId)).map((p) => p.userId);
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, obsWatch: keep, obsWatchOff: off })) });
  return { ok: true, n: keep.length };
}
