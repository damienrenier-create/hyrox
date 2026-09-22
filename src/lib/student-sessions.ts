import { db } from "@/lib/db";
import { getWodEngine } from "@/lib/wod-engines";

export const WOD_LABELS: Record<string, string> = {
  PYRAMIDE_CLASSIQUE: "WOD Pyramide",
  RELAIS_SPRINT: "Relais sprint",
  TOUCHE_COULE_HYROX: "Touché-Coulé",
};

export function wodLabel(wodType: string): string {
  return WOD_LABELS[wodType] ?? wodType;
}

export function fmtDate(v: unknown): string {
  return new Date(String(v)).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

export type StudentSessionRow = {
  sessionId: string;
  wodType: string;
  label: string;
  createdAt: string;
  teamId: string;
  teamName: string;
  isActive: boolean;
  ended: boolean;
};

// Toutes les seances ou l'eleve a ete encode dans une equipe (par identifiant), plus recente en premier.
export async function sessionsForStudent(userId: string): Promise<StudentSessionRow[]> {
  const memberships = await db.orm.public.TeamMember.where({ userId }).all();
  if (memberships.length === 0) return [];
  const rows: StudentSessionRow[] = [];
  for (const m of memberships) {
    const team = await db.orm.public.Team.where({ id: m.teamId }).first();
    if (!team) continue;
    const session = await db.orm.public.Session.where({ id: team.sessionId }).first();
    if (!session) continue;
    rows.push({
      sessionId: session.id,
      wodType: session.wodType,
      label: wodLabel(session.wodType),
      createdAt: String(session.createdAt),
      teamId: team.id,
      teamName: team.name,
      isActive: session.isActive,
      ended: !!session.raceEndedAt,
    });
  }
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function exerciseLabelsFor(wodType: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of getWodEngine(wodType).exercises) out[e.id] = e.label;
  return out;
}
