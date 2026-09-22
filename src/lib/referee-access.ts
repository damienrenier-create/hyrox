import { db } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";
import type { RefereeStatus } from "@/lib/session-roles";

export type RefereeAccess = {
  allowed: boolean;
  reason: string | null;
  status: RefereeStatus | null; // null = aucune demande / aucun encodage
  note: string | null;
  teamId: string | null;
  teamName: string | null;
};

// Qui peut arbitrer (Touche-Coule) sur une seance ?
// - profs / greffier : toujours.
// - eleve : uniquement s'il est inscrit arbitre avec le statut APPROVED (encode par le greffier, ou demande
//   de l'eleve acceptee par le greffier/un admin). S'il est aussi dans une equipe (DNF, blessure...), il ne
//   pourra pas evaluer sa propre equipe.
export async function refereeAccess(sessionId: string, user: SessionPayload): Promise<RefereeAccess> {
  if (user.role !== "STUDENT") return { allowed: true, reason: null, status: "APPROVED", note: null, teamId: null, teamName: null };

  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
  const myTeam = teams.find((t) => memberships.some((m) => m.teamId === t.id)) ?? null;
  const row = await db.orm.public.SessionReferee.where({ sessionId, userId: user.id }).first();
  const status = (row?.status as RefereeStatus | undefined) ?? null;
  const base = { note: row?.note ?? null, teamId: myTeam?.id ?? null, teamName: myTeam?.name ?? null };

  if (status === "APPROVED") return { allowed: true, reason: null, status, ...base };
  if (status === "PENDING") {
    return { allowed: false, status, reason: "Ta demande d'arbitrage est en attente : le greffier (ou un prof) doit l'accepter.", ...base };
  }
  if (status === "REFUSED") {
    return { allowed: false, status, reason: "Ta demande d'arbitrage a été refusée. Tu peux en refaire une si la situation change.", ...base };
  }
  return {
    allowed: false,
    status: null,
    reason: myTeam
      ? `Tu participes au WOD dans ${myTeam.name}. Si tu arrêtes (blessure, abandon…), demande l'autorisation d'arbitrer.`
      : "Pour arbitrer, demande l'autorisation au greffier (ou à un prof) en indiquant pourquoi tu ne joues pas.",
    ...base,
  };
}
