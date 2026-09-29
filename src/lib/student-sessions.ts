import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";
import { readChild } from "@/lib/level-context";
import { notDeleted } from "@/lib/session-roles";
import { toMs } from "@/lib/scheduling";

export const WOD_LABELS: Record<string, string> = {
  PYRAMIDE_CLASSIQUE: "WOD Pyramide",
  RELAIS_SPRINT: "Relais sprint",
  TOUCHE_COULE_HYROX: "Touché-Coulé",
  FETE_FORAINE: "WOD Fête Foraine",
  LEVEL: "WOD Level",
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
  wodName: string; // nom propre du WOD (« WOD Level »), a la place du libelle libre de la seance (« Lvls · écran 2 »)
  createdAt: string;
  dateMs: number; // coup d'envoi (sinon ouverture prevue, sinon creation)
  teamId: string;
  teamName: string;
  isActive: boolean;
  ended: boolean;
  // Seance vraiment enregistree pour l'eleve (Sartay 29/09 nuit) : course lancee ET au moins un resultat de son
  // equipe (fiche cochee au Level, tour a la Pyramide, atelier a la Fete Foraine). Sinon, l'eleve ne la voit pas.
  recorded: boolean;
  cycleId: string | null; // seance sans cycle : rattachee au cycle en cours
  cycleName: string | null;
};

// Toutes les seances ou l'eleve a ete encode dans une equipe (par identifiant), plus recente en premier. Requetes
// groupees (.in) : equipes, seances, courses, cycles, puis les resultats des seules equipes de l'eleve.
export async function sessionsForStudent(userId: string): Promise<StudentSessionRow[]> {
  const memberships = await db.orm.public.TeamMember.where({ userId }).all();
  if (memberships.length === 0) return [];
  const teams = await db.orm.public.Team.where((t) => t.id.in(memberships.map((m) => m.teamId))).all();
  if (!teams.length) return [];
  // Echauffement / finisher : pas une seance a part entiere pour l'eleve ; corbeille : invisible.
  const sessions = (await db.orm.public.Session.where((x) => x.id.in([...new Set(teams.map((t) => t.sessionId))])).all()).filter((x) => notDeleted(x) && !readChild(x.settings));
  if (!sessions.length) return [];
  const sessionIds = sessions.map((x) => x.id);
  const teamIds = teams.filter((t) => sessionIds.includes(t.sessionId)).map((t) => t.id);
  const [raceStates, cycles, ticks, laps, stations] = await Promise.all([
    db.orm.public.RaceState.where((r) => r.sessionId.in(sessionIds)).all(),
    db.orm.public.Cycle.where({}).all(),
    db.orm.public.LevelTick.where((t) => t.teamId.in(teamIds)).all(),
    db.orm.public.Lap.where((l) => l.teamId.in(teamIds)).all(),
    db.orm.public.StationEvent.where((e) => e.teamId.in(teamIds)).all(),
  ]);
  const withResults = new Set([...ticks.map((t) => t.teamId), ...laps.map((l) => l.teamId), ...stations.map((e) => e.teamId)]);
  const current = cycles.find((c) => c.isCurrent) ?? null;
  const rows: StudentSessionRow[] = [];
  for (const session of sessions) {
    const team = teams.find((t) => t.sessionId === session.id);
    if (!team) continue;
    const rs = raceStates.find((r) => r.sessionId === session.id);
    const cycle = cycles.find((c) => c.id === session.cycleId) ?? current;
    rows.push({
      sessionId: session.id,
      wodType: session.wodType,
      label: session.label ?? wodLabel(session.wodType),
      wodName: wodLabel(session.wodType),
      createdAt: String(session.createdAt),
      dateMs: rs?.startedAt ? toMs(rs.startedAt) : session.opensAt ? toMs(session.opensAt) : toMs(session.createdAt),
      teamId: team.id,
      teamName: team.name,
      isActive: session.isActive,
      ended: !!session.raceEndedAt,
      recorded: !!rs?.startedAt && withResults.has(team.id),
      cycleId: cycle?.id ?? null,
      cycleName: cycle?.name ?? null,
    });
  }
  return rows.sort((x, y) => y.dateMs - x.dateMs);
}

// Types de WOD vraiment faits par l'eleve (records : il ne voit que ceux-la).
export const recordedWodTypes = (rows: StudentSessionRow[]) => [...new Set(rows.filter((r) => r.recorded).map((r) => r.wodType))];

export function exerciseLabelsFor(session: { wodType: string; settings?: unknown }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of exercisesFor(session)) out[e.id] = e.label;
  return out;
}
