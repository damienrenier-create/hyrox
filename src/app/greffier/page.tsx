import { getSession } from "@/lib/session-server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { buildRaceContext } from "@/lib/race-context";
import { buildBoardData } from "@/lib/referee-board";
import { buildFFBundle } from "@/lib/fete-foraine-context";
import { exercisesFor } from "@/lib/session-exercises";
import { FeteForaineClient } from "./ff-client";
import { LevelClient } from "./level-client";
import { buildLevelBundle, readChild } from "@/lib/level-context";
import { ensureAutoSessions, listOpenSessions, toMs } from "@/lib/scheduling";
import { isBirthdayToday } from "@/lib/birthday";
import { teammatePairs } from "@/lib/teammates";
import { STAFF_CLASS_LABEL, STAFF_ROLES, memberNames } from "@/lib/staff-names";
import type { PickerData } from "./TeamsManager";
import { readSessionClasses } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import { ensureRaceStateAction } from "./race-actions";
import { getSessionClasses } from "./team-actions";
import { GreffierClient, type SessionOption } from "./client";
import type { RefereeView, TeamWithMembers } from "./TeamsManager";
import type { PendingRequest } from "./referee-decisions";
import { ui } from "@/lib/ui";

export default async function GreffierPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const evaluator = await getSession();
  if (!evaluator || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(evaluator.role)) {
    redirect("/");
  }

  // Ouverture automatique des seances des classes en creneau, puis choix de la seance :
  // ?session=, sinon la seance ouverte la plus recente, sinon la derniere seance (relecture des resultats).
  await ensureAutoSessions();
  const open = await listOpenSessions();
  const { session: requested } = await searchParams;
  let session = requested ? await db.orm.public.Session.where({ id: requested }).first() : null;
  // Sans ?session= : la seance ouverte la plus recente qui n'est pas un echauffement ou un finisher (ceux-ci
  // se rejoignent depuis le greffier de leur WOD), sinon la plus recente tout court.
  if (!session) session = open.find((s) => !readChild(s.settings)) ?? open[0] ?? null;
  if (!session) session = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).first();

  if (!session) {
    return (
      <div className={`${ui.page} flex items-center justify-center p-4 text-center`}>
        <div className={`${ui.cardPad} max-w-sm`}>
          <div className="text-4xl mb-3">🕒</div>
          <h1 className={`${ui.h2} mb-2`}>Aucune séance</h1>
          <p className={ui.muted}>DAMZER doit ouvrir une séance (ou définir un cycle avec les horaires des classes).</p>
        </div>
      </div>
    );
  }

  // Navigation entre seances : le greffier doit pouvoir revenir a celle qui vient de se terminer
  // (revoir les scores, finir d'encoder) ou passer a la suivante, sans repasser par la console.
  // On liste les 12 dernieres seances par ordre chronologique, la plus recente en tete.
  const openIds = new Set(open.map((s) => s.id));
  const recent = (await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all()).slice(0, 12);
  const chain = recent.some((s) => s.id === session!.id) ? recent : [session, ...recent];
  const options: SessionOption[] = chain.map((s) => ({
    id: s.id,
    label: s.label ?? wodLabel(s.wodType),
    classes: readSessionClasses(s.settings),
    open: openIds.has(s.id),
    dateMs: toMs(s.createdAt),
  }));
  const at = options.findIndex((o) => o.id === session!.id);
  // « Précédente » = la seance plus ancienne, « Suivante » = la plus recente : la liste est en ordre decroissant.
  const olderSession = at >= 0 && at < options.length - 1 ? options[at + 1] : null;
  const newerSession = at > 0 ? options[at - 1] : null;

  await ensureRaceStateAction(session.id);
  // Onglet Arbitrage (evaluations par case + classement pirate) uniquement si le Touche-Coule est actif.
  const board = session.refereeMode && session.wodType !== "LEVEL" ? await buildBoardData(session.id) : null;

  // Composition des equipes (identifiants permanents) + arbitres + classes pour l'onglet "Equipes & arbitres".
  // Les eleves sont charges UNE fois (une requete) et les membres de toutes les equipes en parallele :
  // la page greffier est re-rendue a chaque rafraichissement, elle doit rester legere.
  const [rawTeams, users, refereeRows, classes] = await Promise.all([
    db.orm.public.Team.where({ sessionId: session.id }).all(),
    db.orm.public.User.where({}).all(),
    db.orm.public.SessionReferee.where({ sessionId: session.id }).orderBy((r) => r.createdAt.asc()).all(),
    getSessionClasses(session.id),
  ]);
  const students = users.filter((u) => u.role === "STUDENT");
  // Les profs jouent aussi : membres et arbitres sont cherches parmi TOUS les comptes.
  const studentById = new Map(users.filter((u) => u.role === "STUDENT" || STAFF_ROLES.includes(u.role as string)).map((u) => [u.id, u]));
  const view = (u: (typeof users)[number]) => {
    const n = memberNames(u);
    return { id: u.id, firstName: n.firstName, lastName: n.lastName, className: u.role === "STUDENT" ? u.className ?? null : STAFF_CLASS_LABEL };
  };
  const sortedTeams = [...rawTeams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const membersByTeam = await Promise.all(sortedTeams.map((t) => db.orm.public.TeamMember.where({ teamId: t.id }).all()));
  const teamsWithMembers: TeamWithMembers[] = [];
  const teamOfStudent = new Map<string, string>();
  sortedTeams.forEach((t, i) => {
    const views: TeamWithMembers["members"] = [];
    for (const m of membersByTeam[i]) {
      const u = studentById.get(m.userId);
      if (u) {
        views.push({ ...view(u), birthday: isBirthdayToday(u.dateOfBirth) });
        teamOfStudent.set(u.id, t.name);
      }
    }
    views.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    teamsWithMembers.push({ id: t.id, name: t.name, order: t.order ?? 0, members: views });
  });

  const referees: RefereeView[] = [];
  for (const r of refereeRows) {
    const u = studentById.get(r.userId) ?? (await db.orm.public.User.where({ id: r.userId }).first());
    if (u) referees.push({ ...view(u), note: r.note ?? null, status: r.status, teamName: teamOfStudent.get(u.id) ?? null });
  }
  const pendingRequests: PendingRequest[] = referees
    .filter((r) => r.status === "PENDING")
    .map((r) => ({ userId: r.id, name: `${r.firstName} ${r.lastName}`.trim(), className: r.className, note: r.note, teamName: r.teamName, since: 0 }));

  const allClasses = [...new Set(students.map((u) => u.className).filter((c): c is string => !!c))].sort();

  // Selecteur d'eleves PRECHARGE : les eleves des classes de la seance (toutes si aucune) + les profs, et pour
  // chacun ses coequipiers habituels. Plus aucune requete pendant la frappe : la suggestion est immediate.
  const inScope = classes.length ? students.filter((u) => u.className && classes.includes(u.className)) : students;
  const roster = [...inScope, ...users.filter((u) => STAFF_ROLES.includes(u.role as string))]
    .map(view)
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"));
  const picker: PickerData = { roster, pairs: await teammatePairs(inScope.map((u) => u.id)) };

  // Chaque seance-type a son greffier : Level (niveaux de fiches), Fete Foraine (ateliers + corde + Finisher)
  // ou Pyramide (tours).
  if (session.wodType === "LEVEL") {
    const levelBundle = await buildLevelBundle(session.id);
    return (
      <LevelClient
        sessionId={session.id}
        sessionLabel={session.label ?? wodLabel(session.wodType)}
        sessionOptions={options}
        olderSession={olderSession}
        newerSession={newerSession}
        bundle={levelBundle}
        isMaster={evaluator.role === "MASTER_ADMIN"}
        teamsWithMembers={teamsWithMembers}
        classes={classes}
        allClasses={allClasses}
        referees={referees}
        pendingRequests={pendingRequests}
        picker={picker}
      />
    );
  }
  if (session.wodType === "FETE_FORAINE") {
    const ffBundle = await buildFFBundle(session.id);
    return (
      <FeteForaineClient
        sessionId={session.id}
        sessionLabel={session.label ?? wodLabel(session.wodType)}
        sessionOptions={options}
        olderSession={olderSession}
        newerSession={newerSession}
        bundle={ffBundle}
        teamsWithMembers={teamsWithMembers}
        classes={classes}
        allClasses={allClasses}
        referees={referees}
        pendingRequests={pendingRequests}
        board={board}
        picker={picker}
        exercisesAll={exercisesFor(session)}
      />
    );
  }

  const bundle = await buildRaceContext(session.id);
  return (
    <GreffierClient
      sessionId={session.id}
      sessionLabel={session.label ?? wodLabel(session.wodType)}
      sessionOptions={options}
      olderSession={olderSession}
      newerSession={newerSession}
      isMaster={evaluator.role === "MASTER_ADMIN"}
      canCorrect={["MASTER_ADMIN", "GREFFIER"].includes(evaluator.role)}
      bundle={bundle}
      teamsWithMembers={teamsWithMembers}
      classes={classes}
      allClasses={allClasses}
      referees={referees}
      pendingRequests={pendingRequests}
      board={board}
      picker={picker}
    />
  );
}
