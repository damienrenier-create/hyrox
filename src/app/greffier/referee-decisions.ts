"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";

// Le greffier (popup sur l'ecran projete) ou un prof accepte / refuse une demande d'arbitrage.
export async function decideRefereeAction(sessionId: string, userId: string, decision: "APPROVED" | "REFUSED"): Promise<{ error: string } | { ok: true }> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return { error: "Accès refusé." };
  const row = await db.orm.public.SessionReferee.where({ sessionId, userId }).first();
  if (!row) return { error: "Demande introuvable." };
  await db.orm.public.SessionReferee.where({ id: row.id }).update({ status: decision, decidedBy: user.name, decidedAt: Temporal.Now.instant() });
  return { ok: true };
}

export type PendingRequest = { userId: string; name: string; className: string | null; note: string | null; teamName: string | null; since: number };

// Demandes en attente sur une seance (pour le polling du greffier).
export async function listPendingRequestsAction(sessionId: string): Promise<PendingRequest[]> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return [];
  const rows = await db.orm.public.SessionReferee.where({ sessionId, status: "PENDING" }).orderBy((r) => r.createdAt.asc()).all();
  if (rows.length === 0) return [];
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const out: PendingRequest[] = [];
  for (const r of rows) {
    const u = await db.orm.public.User.where({ id: r.userId }).first();
    if (!u) continue;
    const memberships = await db.orm.public.TeamMember.where({ userId: r.userId }).all();
    const team = teams.find((t) => memberships.some((m) => m.teamId === t.id));
    out.push({
      userId: r.userId,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
      className: u.className ?? null,
      note: r.note ?? null,
      teamName: team?.name ?? null,
      since: new Date(String(r.createdAt)).getTime(),
    });
  }
  return out;
}
