import { db } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";

export type RefereeAccess = {
  allowed: boolean;
  reason: string | null;
  isEncodedReferee: boolean;
  teamId: string | null;
  teamName: string | null;
};

// Qui peut arbitrer (Touche-Coule) sur une seance ?
// - profs / greffier : toujours.
// - eleve encode comme arbitre par le greffier : oui (meme s'il est aussi dans une equipe = cas DNF/blessure ;
//   il ne pourra alors pas evaluer sa propre equipe).
// - eleve dans une equipe et PAS encode arbitre : non (il participe).
// - eleve ni dans une equipe ni encode : oui (arbitre libre, comme avant).
export async function refereeAccess(sessionId: string, user: SessionPayload): Promise<RefereeAccess> {
  if (user.role !== "STUDENT") return { allowed: true, reason: null, isEncodedReferee: false, teamId: null, teamName: null };

  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
  const myTeam = teams.find((t) => memberships.some((m) => m.teamId === t.id)) ?? null;
  const refereeRow = await db.orm.public.SessionReferee.where({ sessionId, userId: user.id }).first();
  const isEncodedReferee = !!refereeRow;

  if (myTeam && !isEncodedReferee) {
    return {
      allowed: false,
      reason: `Tu participes au WOD dans ${myTeam.name}. Si tu arrêtes (DNF, blessure…), demande au greffier de t'inscrire comme arbitre.`,
      isEncodedReferee: false,
      teamId: myTeam.id,
      teamName: myTeam.name,
    };
  }
  return { allowed: true, reason: null, isEncodedReferee, teamId: myTeam?.id ?? null, teamName: myTeam?.name ?? null };
}
