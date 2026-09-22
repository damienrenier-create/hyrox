import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { buildRaceContext } from "@/lib/race-context";
import { ensureAutoSessions, listOpenSessions } from "@/lib/scheduling";
import { readSessionClasses } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import { ensureRaceStateAction } from "./race-actions";
import { getSessionClasses } from "./team-actions";
import { GreffierClient, type SessionOption } from "./client";
import type { RefereeView, TeamWithMembers } from "./TeamsManager";

export default async function GreffierPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const evaluator = await getSession();
  if (!evaluator || !["MASTER_ADMIN", "GREFFIER"].includes(evaluator.role)) {
    redirect("/");
  }

  // Ouverture automatique des seances des classes en creneau, puis choix de la seance :
  // ?session=, sinon la seance ouverte la plus recente, sinon la derniere seance (relecture des resultats).
  await ensureAutoSessions();
  const open = await listOpenSessions();
  const { session: requested } = await searchParams;
  let session = requested ? await db.orm.public.Session.where({ id: requested }).first() : null;
  if (!session) session = open[0] ?? null;
  if (!session) session = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).first();

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-cyan-50 font-mono text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Aucune séance</h1>
          <p className="text-slate-400 text-sm">DAMZER doit ouvrir une séance (ou définir un cycle avec les horaires des classes).</p>
        </div>
      </div>
    );
  }

  const options: SessionOption[] = open.map((s) => ({
    id: s.id,
    label: s.label ?? wodLabel(s.wodType),
    classes: readSessionClasses(s.settings),
    open: true,
  }));
  if (!options.some((o) => o.id === session!.id)) {
    options.push({ id: session.id, label: session.label ?? wodLabel(session.wodType), classes: readSessionClasses(session.settings), open: false });
  }

  await ensureRaceStateAction(session.id);
  const bundle = await buildRaceContext(session.id);

  // Composition des equipes (identifiants permanents) + arbitres + classes pour l'onglet "Equipes & arbitres".
  const rawTeams = await db.orm.public.Team.where({ sessionId: session.id }).all();
  const teamsWithMembers: TeamWithMembers[] = [];
  const teamOfStudent = new Map<string, string>();
  for (const t of [...rawTeams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const members = await db.orm.public.TeamMember.where({ teamId: t.id }).all();
    const views: TeamWithMembers["members"] = [];
    for (const m of members) {
      const u = await db.orm.public.User.where({ id: m.userId }).first();
      if (u) {
        views.push({ id: u.id, firstName: u.firstName ?? "", lastName: u.lastName ?? "", className: u.className ?? null });
        teamOfStudent.set(u.id, t.name);
      }
    }
    views.sort((a, b) => a.lastName.localeCompare(b.lastName));
    teamsWithMembers.push({ id: t.id, name: t.name, order: t.order ?? 0, members: views });
  }

  const refereeRows = await db.orm.public.SessionReferee.where({ sessionId: session.id }).orderBy((r) => r.createdAt.asc()).all();
  const referees: RefereeView[] = [];
  for (const r of refereeRows) {
    const u = await db.orm.public.User.where({ id: r.userId }).first();
    if (u) referees.push({ id: u.id, firstName: u.firstName ?? "", lastName: u.lastName ?? "", className: u.className ?? null, note: r.note ?? null, teamName: teamOfStudent.get(u.id) ?? null });
  }

  const classes = await getSessionClasses(session.id);
  const allClasses = [...new Set((await db.orm.public.User.where({ role: "STUDENT" }).all()).map((u) => u.className).filter((c): c is string => !!c))].sort();

  return (
    <GreffierClient
      sessionId={session.id}
      sessionLabel={session.label ?? wodLabel(session.wodType)}
      sessionOptions={options}
      bundle={bundle}
      teamsWithMembers={teamsWithMembers}
      classes={classes}
      allClasses={allClasses}
      referees={referees}
    />
  );
}
