import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { activeTournament, badmintonRoster, freeRoster, loadEloBoard, loadMatches, loadTournamentMatches, loadTournaments, peopleOf, pickerRef, BM_STAFF_ROLES, type BmPerson, type BmTournament, type EloBoard } from "@/lib/badminton-server";
import { bracketOf, formatText, poolsOf } from "@/lib/badminton-tournament";
import { ELO_START } from "@/lib/badminton-elo";
import { rankElo } from "@/lib/badminton-elo";
import { SELF_EVAL_GRIDS } from "@/lib/wod-engines/core/self-eval";
import { SELF_EVAL_SHORT } from "@/lib/student-self-evals";
import { gradeOfAnswers } from "@/lib/carnet";
import { BM_FREE, matchState, pupilStats, viewOf, type BmMatch, type BmPersonRef } from "@/lib/badminton";
import { isTestClass, notDeleted, readSessionClasses } from "@/lib/session-roles";
import { isOnePClass, isSessionOpen, linkedClassesFor, toMs } from "@/lib/scheduling";
import { TopBar } from "../../_components/TopBar";
import { BadmintonStaff, type BmEloRow, type BmPupilRow, type BmSelfEvalRow, type BmTourProps } from "./BadmintonStaff";
import type { TourView } from "./TournamentPanel";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Bilan par eleve : stats sur les matchs donnes, tries par classe puis par nom (les profs ne sont pas listes).
function pupilRows(ids: string[], people: Map<string, BmPerson>, matches: BmMatch[]): BmPupilRow[] {
  const states = matches.map((m) => ({ match: m, state: matchState(m) }));
  return ids
    .map((id) => { const p = people.get(id); return { id, name: p?.name ?? "?", lastName: p?.lastName ?? "", firstName: p?.firstName ?? "", className: p?.className ?? null, staff: p?.staff ?? false, stats: pupilStats(id, states) }; })
    .filter((r) => !r.staff)
    .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "", "fr", { numeric: true }) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"))
    .map(({ id, name, className, stats }) => ({ id, name, className, stats }));
}
// Classement ELO (tous les matchs de toutes les seances + matchs libres officiels, inter-classes). `test` : la classe de
// test, son monde a part.
function eloRows(board: EloBoard, test: boolean): BmEloRow[] {
  return rankElo([...board.entries.values()].filter((e) => board.test.has(e.id) === test)).map((e) => {
    const p = board.people.get(e.id);
    return { id: e.id, name: p?.name ?? "?", className: p?.className ?? null, rating: e.rating, games: e.games, won: e.won, draws: e.draws, lost: e.lost, provisional: e.provisional };
  });
}

// Badminton, cote prof (Sartay 20/10) : tous les matchs d'une seance avec leur historique (qui a encode, corrige,
// signe), le bilan par eleve (y compris ceux qui n'ont encode aucun match), et les gestes du prof : valider, corriger,
// annuler, encoder un match. Ouvert aussi au compte GREFFIER (PC projete : le greffier d'une seance badminton mene ici).
// `?session=libre` (03/11) : les matchs libres (entre classes, hors cours) ; la validation du prof les rend officiels.
export default async function AdminBadmintonPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !BM_STAFF_ROLES.includes(user.role)) redirect("/");
  const { session: wanted } = await searchParams;
  const all = (await db.orm.public.Session.where({ wodType: "BADMINTON" }).all()).filter(notDeleted).sort((a, b) => toMs(b.opensAt ?? b.createdAt) - toMs(a.opensAt ?? a.createdAt));
  const free = wanted === BM_FREE;
  const session = free ? null : all.find((s) => s.id === wanted) ?? all.find((s) => isSessionOpen(s)) ?? all[0] ?? null;
  const back = user.role === "GREFFIER" ? undefined : { href: "/admin", label: "Console" };
  const label = (s: (typeof all)[number]) => `${new Date(toMs(s.opensAt ?? s.createdAt)).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" })} · ${readSessionClasses(s.settings).join("+")}`;
  const nav = (
    <nav className="flex flex-wrap gap-1.5">
      <Link href={`/admin/badminton?session=${BM_FREE}`} className={cx(ui.chip, free ? ui.chipBrand : ui.chipMuted, "text-sm py-1")}>🆓 Matchs libres</Link>
      {all.slice(0, 12).map((s) => (
        <Link key={s.id} href={`/admin/badminton?session=${s.id}`} className={cx(ui.chip, s.id === session?.id ? ui.chipBrand : ui.chipMuted, "text-sm py-1")}>{isSessionOpen(s) ? "● " : ""}{label(s)}</Link>
      ))}
    </nav>
  );

  if (free) {
    const [matches, roster, board] = await Promise.all([loadMatches(BM_FREE), freeRoster(false), loadEloBoard()]);
    const people = await peopleOf(matches);
    const byId = new Map(roster.map((p) => [p.id, p]));
    const ref = (id: string): BmPersonRef => { const p = people.get(id) ?? byId.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
    const views = matches.map((m) => viewOf(m, user.id, true, ref));
    const rows = pupilRows([...new Set(matches.flatMap((m) => [m.playerAId, m.playerBId]))], people, matches);
    return (
      <div className={ui.page}>
        <TopBar title="🏸 Badminton" subtitle="Matchs libres · entre classes, en dehors des cours" back={back} />
        <main className={`${ui.container} py-5 space-y-4`}>
          {nav}
          <p className={ui.hint}>Un match libre compte au classement quand il est officiel : 2 élèves l&apos;ont attesté (l&apos;arbitre en est un), ou un prof l&apos;a validé (« Valider (officiel) »).</p>
          <BadmintonStaff sessionId={BM_FREE} viewerId={user.id} views={views} rows={rows} roster={roster.map(pickerRef)} selfEvals={[]} seCols={[]} elo={eloRows(board, false)} groupClasses={[]} free />
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={ui.page}>
        <TopBar title="🏸 Badminton" subtitle="Matchs encodés par les élèves" back={back} />
        <main className={`${ui.container} py-6 space-y-4`}>
          {nav}
          <p className={`${ui.cardPad} ${ui.muted}`}>Aucune séance Badminton pour l&apos;instant. Dans la console, ajoutez une séance-type « Badminton » à un cycle : les séances s&apos;ouvriront ensuite toutes seules pendant les créneaux, comme pour l&apos;Eval.</p>
        </main>
      </div>
    );
  }

  const [matches, roster] = await Promise.all([loadMatches(session.id), badmintonRoster(session)]);
  const people = await peopleOf(matches, roster.map((p) => p.id));
  const ref = (id: string): BmPersonRef => { const p = people.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
  const views = matches.map((m) => viewOf(m, user.id, true, ref));
  // Bilan : les eleves de la seance, plus ceux qui y ont joue sans en faire partie (classe changee entre-temps).
  // (Les 1P, proposes comme adversaires, ne sont listes que s'ils ont joue.)
  const classes = readSessionClasses(session.settings);
  const rows = pupilRows([...new Set([...roster.filter((p) => p.className && classes.includes(p.className)).map((p) => p.id), ...matches.flatMap((m) => [m.playerAId, m.playerBId])])], people, matches);
  // Auto-evaluations de la seance (grille badminton, 03/11) : une ligne par eleve du bilan, remplie ou pas.
  const selfRows = await db.orm.public.SelfEvaluation.where({ sessionId: session.id }).all();
  const selfIds = [...new Set([...rows.map((r) => r.id), ...selfRows.map((r) => r.studentId)])];
  const selfPeople = await peopleOf([], selfIds);
  const selfEvals: BmSelfEvalRow[] = selfIds
    .map((id) => {
      const p = selfPeople.get(id);
      const se = selfRows.find((r) => r.studentId === id);
      const answers = (se?.answers as Record<string, string> | null) ?? null;
      return { id, name: p?.name ?? "?", lastName: p?.lastName ?? "", firstName: p?.firstName ?? "", className: p?.className ?? null, answers, grade: answers ? gradeOfAnswers(answers, "BADMINTON") : null, at: se ? toMs(se.submittedAt) : null };
    })
    .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "", "fr", { numeric: true }) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"))
    .map(({ id, name, className, answers, grade, at }) => ({ id, name, className, answers, grade, at }));
  const seCols = SELF_EVAL_GRIDS.badminton.criteria.map((c) => ({ id: c.id, short: SELF_EVAL_SHORT[c.id] ?? c.label, label: c.label }));
  const board = await loadEloBoard();
  const elo = eloRows(board, classes.length > 0 && classes.every((c) => isTestClass(c)));
  // Tournois (09/11) : participants proposes = les eleves de la seance (coches : ceux qui y ont deja joue ou arbitre). Les
  // matchs d'un tournoi se lisent toutes seances confondues (il peut se continuer au cours suivant).
  const tours = await loadTournaments(session.id);
  const present = new Set(matches.flatMap((m) => [m.playerAId, m.playerBId, m.createdById]));
  // Eleves de 1P rattaches a ces classes (ils y ont deja joue) : proposes et coches comme les eleves de la classe.
  const oneP = roster.filter((p) => !p.staff && isOnePClass(p.className));
  const linked = await linkedClassesFor(oneP.map((p) => p.id));
  const attached = new Set(oneP.filter((p) => [...(linked.get(p.id) ?? [])].some((c) => classes.includes(c))).map((p) => p.id));
  const tourView = async (t: BmTournament): Promise<TourView> => {
    const tm = await loadTournamentMatches(t.id);
    const tp = await peopleOf(tm, t.players.map((p) => p.studentId));
    return {
      id: t.id,
      kind: t.kind,
      label: t.label,
      format: formatText(t.settings),
      pools: t.kind === "BRACKET" ? null : poolsOf(t.players, tm, t.kind === "HANDICAP" ? t.settings : null),
      bracket: t.kind === "BRACKET" ? bracketOf(t.players, tm) : null,
      names: Object.fromEntries(t.players.map((p) => [p.studentId, { name: tp.get(p.studentId)?.name ?? "?", className: tp.get(p.studentId)?.className ?? null }])),
    };
  };
  const active = activeTournament(tours);
  const previous = tours.find((t) => t.closedAt) ?? null;
  const rosterIds = new Set(roster.map((p) => p.id));
  const elsewhere = active ? [] : (await loadTournaments(null)).filter((t) => t.sessionId !== session.id && t.players.some((p) => rosterIds.has(p.studentId)));
  const tour: BmTourProps = {
    entrants: roster
      .filter((p) => !p.staff && ((p.className && classes.includes(p.className)) || present.has(p.id) || attached.has(p.id)))
      .map((p) => ({ id: p.id, name: p.name, className: p.className, elo: Math.round(board.entries.get(p.id)?.rating ?? ELO_START), present: present.has(p.id) })),
    active: active ? await tourView(active) : null,
    previous: previous ? await tourView(previous) : null,
    // Retardataires possibles : les eleves de la seance pas encore dans le tournoi en cours.
    candidates: active ? roster.filter((p) => !p.staff && ((p.className && classes.includes(p.className)) || present.has(p.id) || attached.has(p.id)) && !active.players.some((x) => x.studentId === p.id)).map((p) => ({ id: p.id, name: p.name, className: p.className })) : [],
    elsewhere: elsewhere.map((t) => ({ id: t.id, label: t.label, players: t.players.length, when: `le ${new Date(t.createdAt).toLocaleDateString("fr-BE", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" })}` })),
  };

  return (
    <div className={ui.page}>
      <TopBar title="🏸 Badminton" subtitle={`${readSessionClasses(session.settings).join(" + ")} · ${isSessionOpen(session) ? "séance ouverte" : "séance fermée"}`} back={back} />
      <main className={`${ui.container} py-5 space-y-4`}>
        {nav}
        <BadmintonStaff sessionId={session.id} viewerId={user.id} views={views} rows={rows} roster={roster.map(pickerRef)} selfEvals={selfEvals} seCols={seCols} elo={elo} groupClasses={classes} tour={tour} />
      </main>
    </div>
  );
}
