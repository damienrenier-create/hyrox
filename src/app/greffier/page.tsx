import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { buildRaceContext } from "@/lib/race-context";
import { ensureRaceStateAction } from "./race-actions";
import { getSessionClasses } from "./team-actions";
import { GreffierClient } from "./client";
import type { RefereeView, TeamWithMembers } from "./TeamsManager";

export default async function GreffierPage() {
  const evaluator = await getSession();
  if (!evaluator || !["MASTER_ADMIN", "GREFFIER"].includes(evaluator.role)) {
    redirect("/");
  }

  // Pas de filtre isActive : le greffier doit pouvoir revoir les resultats finaux juste apres
  // avoir clos la course, meme si l'admin en a ouvert une autre entre-temps.
  const session = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).first();

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-cyan-50 font-mono text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Aucune session</h1>
        </div>
      </div>
    );
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
      bundle={bundle}
      teamsWithMembers={teamsWithMembers}
      classes={classes}
      allClasses={allClasses}
      referees={referees}
    />
  );
}
