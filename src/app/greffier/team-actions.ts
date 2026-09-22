"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

async function requireGreffier() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}

export type StudentHit = { id: string; firstName: string; lastName: string; className: string | null };

// Recherche dans TOUTE la base eleves (toutes classes) : prefixe du prenom, du nom, ou "prenom nom".
export async function searchAllStudentsAction(query: string): Promise<StudentHit[]> {
  await requireGreffier();
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  return students
    .filter((s) => {
      const first = (s.firstName ?? "").toLowerCase();
      const last = (s.lastName ?? "").toLowerCase();
      return first.startsWith(q) || last.startsWith(q) || `${first} ${last}`.startsWith(q) || `${last} ${first}`.startsWith(q);
    })
    .sort((a, b) => (a.lastName ?? "").localeCompare(b.lastName ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? ""))
    .slice(0, 10)
    .map((s) => ({ id: s.id, firstName: s.firstName ?? "", lastName: s.lastName ?? "", className: s.className ?? null }));
}

// Un eleve ne peut etre que dans UNE equipe par seance ; l'appartenance est persistee par identifiant.
export async function addTeamMemberAction(teamId: string, userId: string): Promise<{ error: string } | { ok: true }> {
  await requireGreffier();
  const team = await db.orm.public.Team.where({ id: teamId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const student = await db.orm.public.User.where({ id: userId }).first();
  if (!student || student.role !== "STUDENT") return { error: "Élève introuvable." };

  const sessionTeams = await db.orm.public.Team.where({ sessionId: team.sessionId }).all();
  const teamIds = new Set(sessionTeams.map((t) => t.id));
  const memberships = await db.orm.public.TeamMember.where({ userId }).all();
  const existing = memberships.find((m) => teamIds.has(m.teamId));
  if (existing) {
    if (existing.teamId === teamId) return { ok: true };
    const other = sessionTeams.find((t) => t.id === existing.teamId);
    return { error: `${student.firstName} ${student.lastName} est déjà dans ${other?.name ?? "une autre équipe"}.` };
  }

  await db.orm.public.TeamMember.create({ teamId, userId });
  return { ok: true };
}

export async function removeTeamMemberAction(teamId: string, userId: string): Promise<{ ok: true }> {
  await requireGreffier();
  const members = await db.orm.public.TeamMember.where({ teamId, userId }).all();
  for (const m of members) await db.orm.public.TeamMember.where({ id: m.id }).delete();
  return { ok: true };
}
