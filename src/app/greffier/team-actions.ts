"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { MAX_CLASSES, REFEREE_REASONS, readSessionClasses } from "@/lib/session-roles";
import { deleteTeam, teamDeletionPreview } from "@/lib/team-count";
import { STAFF_CLASS_LABEL, STAFF_ROLES, fold, memberNames } from "@/lib/staff-names";

async function requireGreffier() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}

export type StudentHit = { id: string; firstName: string; lastName: string; className: string | null };

// ===== Classes participantes (max 5), stockees dans Session.settings.classes =====

export async function setSessionClassesAction(sessionId: string, classes: string[]): Promise<{ error: string } | { ok: true; classes: string[] }> {
  await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const unique = [...new Set(classes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length > MAX_CLASSES) return { error: `Maximum ${MAX_CLASSES} classes par séance.` };
  const known = new Set((await db.orm.public.User.where({ role: "STUDENT" }).all()).map((u) => u.className).filter(Boolean));
  const bad = unique.find((c) => !known.has(c));
  if (bad) return { error: `Classe inconnue : ${bad}.` };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, classes: unique } });
  return { ok: true, classes: unique };
}

// ===== Recherche d'eleves (prefixe prenom / nom / "prenom nom"), restreinte aux classes choisies si fournies =====

export async function searchAllStudentsAction(query: string, classes: string[] = []): Promise<StudentHit[]> {
  await requireGreffier();
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const allowed = new Set(classes);
  const qf = fold(q);
  // Eleves des classes choisies + les profs, par nom de famille et quelle que soit la classe.
  const users = await db.orm.public.User.where({}).all();
  return users
    .filter((u) => (u.role === "STUDENT" && (allowed.size === 0 || (u.className && allowed.has(u.className)))) || STAFF_ROLES.includes(u.role as string))
    .map((u) => {
      const n = memberNames(u);
      return { id: u.id, firstName: n.firstName, lastName: n.lastName, className: u.role === "STUDENT" ? u.className ?? null : STAFF_CLASS_LABEL };
    })
    .filter((h) => {
      const first = fold(h.firstName);
      const last = fold(h.lastName);
      return first.startsWith(qf) || last.startsWith(qf) || `${first} ${last}`.startsWith(qf) || `${last} ${first}`.startsWith(qf);
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"))
    .slice(0, 10);
}

// ===== Membres d'equipe : un eleve = une seule equipe par seance, persiste par identifiant =====

export type MemberView = { id: string; firstName: string; lastName: string; className: string | null };

// Renvoie la fiche du membre pour que l'ecran se mette a jour SANS re-rendu serveur (le greffier encode
// vite, une equipe apres l'autre : l'eleve doit apparaitre au tap).
export async function addTeamMemberAction(teamId: string, userId: string): Promise<{ error: string } | { ok: true; member: MemberView }> {
  await requireGreffier();
  const team = await db.orm.public.Team.where({ id: teamId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const student = await db.orm.public.User.where({ id: userId }).first();
  // Un prof peut jouer dans une equipe comme un eleve ; le compte GREFFIER, lui, n'est pas une personne.
  if (!student || !(student.role === "STUDENT" || STAFF_ROLES.includes(student.role as string))) return { error: "Élève introuvable." };
  const names = memberNames(student);
  const member: MemberView = { id: student.id, firstName: names.firstName, lastName: names.lastName, className: student.role === "STUDENT" ? student.className ?? null : STAFF_CLASS_LABEL };

  const sessionTeams = await db.orm.public.Team.where({ sessionId: team.sessionId }).all();
  const teamIds = new Set(sessionTeams.map((t) => t.id));
  const memberships = await db.orm.public.TeamMember.where({ userId }).all();
  const existing = memberships.find((m) => teamIds.has(m.teamId));
  if (existing) {
    if (existing.teamId === teamId) return { ok: true, member };
    const other = sessionTeams.find((t) => t.id === existing.teamId);
    return { error: `${names.firstName} ${names.lastName} est déjà dans ${other?.name ?? "une autre équipe"}.` };
  }

  await db.orm.public.TeamMember.create({ teamId, userId });
  return { ok: true, member };
}

export async function removeTeamMemberAction(teamId: string, userId: string): Promise<{ ok: true }> {
  await requireGreffier();
  const members = await db.orm.public.TeamMember.where({ teamId, userId }).all();
  for (const m of members) await db.orm.public.TeamMember.where({ id: m.id }).delete();
  return { ok: true };
}

// ===== Arbitres encodes par le greffier (pendant tout le WOD : DNF, blessure...) =====

// Encodage direct par le greffier = autorise d'office (APPROVED). Motif obligatoire.
export type RefereeAdded = MemberView & { note: string | null; status: string };

export async function addRefereeAction(sessionId: string, userId: string, note?: string): Promise<{ error: string } | { ok: true; referee: RefereeAdded }> {
  const who = await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const student = await db.orm.public.User.where({ id: userId }).first();
  if (!student || student.role !== "STUDENT") return { error: "Élève introuvable." };
  if (!note || !(REFEREE_REASONS as readonly string[]).includes(note)) return { error: "Indique le motif (blessé, abandon, pas de tenue…)." };
  const referee: RefereeAdded = { id: student.id, firstName: student.firstName ?? "", lastName: student.lastName ?? "", className: student.className ?? null, note, status: "APPROVED" };
  const existing = await db.orm.public.SessionReferee.where({ sessionId, userId }).first();
  if (existing) {
    await db.orm.public.SessionReferee.where({ id: existing.id }).update({ note, status: "APPROVED", decidedBy: who.name, decidedAt: Temporal.Now.instant() });
    return { ok: true, referee };
  }
  await db.orm.public.SessionReferee.create({ sessionId, userId, note, status: "APPROVED", decidedBy: who.name, decidedAt: Temporal.Now.instant() });
  return { ok: true, referee };
}

export async function removeRefereeAction(sessionId: string, userId: string): Promise<{ ok: true }> {
  await requireGreffier();
  const rows = await db.orm.public.SessionReferee.where({ sessionId, userId }).all();
  for (const r of rows) await db.orm.public.SessionReferee.where({ id: r.id }).delete();
  return { ok: true };
}

export async function getSessionClasses(sessionId: string): Promise<string[]> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  return readSessionClasses(session?.settings);
}

// ===== Suppression d'une equipe (double confirmation cote ecran) =====

export async function teamDeletionPreviewAction(teamId: string) {
  await requireGreffier();
  return teamDeletionPreview(teamId);
}

export async function deleteTeamAction(teamId: string) {
  await requireGreffier();
  return deleteTeam(teamId);
}
