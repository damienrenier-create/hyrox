import { db } from "@/lib/db";
import { isTestClass } from "@/lib/session-roles";

// Historique protege (Sartay 29/09 nuit : « il faut garder une trace de tous les WOD qui ont été faits par de vrais
// élèves ») : une seance ou de vrais eleves (hors classe test 7A) ont un resultat enregistre — fiche cochee, tour,
// atelier, auto-evaluation — ne va jamais a la corbeille ni a la purge. Un brouillon ou un faux depart sans resultat
// reste supprimable.
export const PROTECTED_MESSAGE = "Séance jouée par de vrais élèves : elle reste dans l'historique (règle d'or).";

export async function sessionsPlayedByRealStudents(sessionIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!sessionIds.length) return out;
  const teams = await db.orm.public.Team.where((t) => t.sessionId.in(sessionIds)).all();
  if (!teams.length) return out;
  const members = await db.orm.public.TeamMember.where((m) => m.teamId.in(teams.map((t) => t.id))).all();
  const users = members.length ? await db.orm.public.User.where((u) => u.id.in([...new Set(members.map((m) => m.userId))])).all() : [];
  const real = new Set(users.filter((u) => u.role === "STUDENT" && !isTestClass(u.className)).map((u) => u.id));
  const realTeams = new Set(members.filter((m) => real.has(m.userId)).map((m) => m.teamId));
  if (!realTeams.size) return out;
  const teamIds = [...realTeams];
  const sessionOfTeam = new Map(teams.map((t) => [t.id, t.sessionId]));
  const raceStates = await db.orm.public.RaceState.where((r) => r.sessionId.in(sessionIds)).all();
  const [ticks, laps, stations, selfs, quiz] = await Promise.all([
    db.orm.public.LevelTick.where((t) => t.teamId.in(teamIds)).all(),
    raceStates.length ? db.orm.public.Lap.where((l) => l.raceStateId.in(raceStates.map((r) => r.id))).all() : Promise.resolve([]),
    db.orm.public.StationEvent.where((e) => e.teamId.in(teamIds)).all(),
    db.orm.public.SelfEvaluation.where((e) => e.sessionId.in(sessionIds)).all(),
    db.orm.public.QuizAnswer.where((q) => q.sessionId.in(sessionIds)).all(),
  ]);
  for (const t of ticks) out.add(t.sessionId);
  for (const l of laps) if (realTeams.has(l.teamId)) { const s = sessionOfTeam.get(l.teamId); if (s) out.add(s); }
  for (const e of stations) out.add(e.sessionId);
  for (const e of selfs) if (real.has(e.studentId)) out.add(e.sessionId);
  for (const q of quiz) if (real.has(q.studentId)) out.add(q.sessionId);
  return out;
}
