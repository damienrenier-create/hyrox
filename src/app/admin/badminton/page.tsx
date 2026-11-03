import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { badmintonRoster, loadEloBoard, loadMatches, peopleOf, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { rankElo } from "@/lib/badminton-elo";
import { SELF_EVAL_GRIDS } from "@/lib/wod-engines/core/self-eval";
import { SELF_EVAL_SHORT } from "@/lib/student-self-evals";
import { gradeOfAnswers } from "@/lib/carnet";
import { matchState, pupilStats, viewOf, type BmPersonRef } from "@/lib/badminton";
import { isTestClass, notDeleted, readSessionClasses } from "@/lib/session-roles";
import { isSessionOpen, toMs } from "@/lib/scheduling";
import { TopBar } from "../../_components/TopBar";
import { BadmintonStaff, type BmEloRow, type BmPupilRow, type BmSelfEvalRow } from "./BadmintonStaff";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Badminton, cote prof (Sartay 20/10) : tous les matchs d'une seance avec leur historique (qui a encode, corrige,
// signe), le bilan par eleve (y compris ceux qui n'ont encode aucun match), et les gestes du prof : valider, corriger,
// annuler, encoder un match. Ouvert aussi au compte GREFFIER (PC projete : le greffier d'une seance badminton mene ici).
export default async function AdminBadmintonPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !BM_STAFF_ROLES.includes(user.role)) redirect("/");
  const { session: wanted } = await searchParams;
  const all = (await db.orm.public.Session.where({ wodType: "BADMINTON" }).all()).filter(notDeleted).sort((a, b) => toMs(b.opensAt ?? b.createdAt) - toMs(a.opensAt ?? a.createdAt));
  const session = all.find((s) => s.id === wanted) ?? all.find((s) => isSessionOpen(s)) ?? all[0] ?? null;
  const back = user.role === "GREFFIER" ? undefined : { href: "/admin", label: "Console" };
  if (!session) {
    return (
      <div className={ui.page}>
        <TopBar title="🏸 Badminton" subtitle="Matchs encodés par les élèves" back={back} />
        <main className={`${ui.container} py-6`}>
          <p className={`${ui.cardPad} ${ui.muted}`}>Aucune séance Badminton pour l&apos;instant. Dans la console, ajoutez une séance-type « Badminton » à un cycle : les séances s&apos;ouvriront ensuite toutes seules pendant les créneaux, comme pour l&apos;Eval.</p>
        </main>
      </div>
    );
  }

  const [matches, roster] = await Promise.all([loadMatches(session.id), badmintonRoster(session)]);
  const people = await peopleOf(matches, roster.map((p) => p.id));
  const ref = (id: string): BmPersonRef => { const p = people.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
  const views = matches.map((m) => viewOf(m, user.id, true, ref));
  const states = matches.map((m) => ({ match: m, state: matchState(m) }));
  // Bilan : les eleves de la seance, plus ceux qui y ont joue sans en faire partie (classe changee entre-temps).
  // (Les 1P, proposes comme adversaires, ne sont listes que s'ils ont joue.)
  const classes = readSessionClasses(session.settings);
  const ids = [...new Set([...roster.filter((p) => p.className && classes.includes(p.className)).map((p) => p.id), ...matches.flatMap((m) => [m.playerAId, m.playerBId])])];
  const rows: BmPupilRow[] = ids
    .map((id) => { const p = people.get(id); return { id, name: p?.name ?? "?", lastName: p?.lastName ?? "", firstName: p?.firstName ?? "", className: p?.className ?? null, staff: p?.staff ?? false, stats: pupilStats(id, states) }; })
    .filter((r) => !r.staff)
    .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "", "fr", { numeric: true }) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"))
    .map(({ id, name, className, stats }) => ({ id, name, className, stats }));
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
  // Classement ELO (tous les matchs de toutes les seances, inter-classes). Seance de la classe de test : son monde a part.
  const board = await loadEloBoard();
  const testSession = classes.length > 0 && classes.every((c) => isTestClass(c));
  const elo: BmEloRow[] = rankElo([...board.entries.values()].filter((e) => board.test.has(e.id) === testSession)).map((e) => {
    const p = board.people.get(e.id);
    return { id: e.id, name: p?.name ?? "?", className: p?.className ?? null, rating: e.rating, games: e.games, won: e.won, draws: e.draws, lost: e.lost, provisional: e.provisional };
  });
  const label = (s: (typeof all)[number]) => `${new Date(toMs(s.opensAt ?? s.createdAt)).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" })} · ${readSessionClasses(s.settings).join("+")}`;

  return (
    <div className={ui.page}>
      <TopBar title="🏸 Badminton" subtitle={`${readSessionClasses(session.settings).join(" + ")} · ${isSessionOpen(session) ? "séance ouverte" : "séance fermée"}`} back={back} />
      <main className={`${ui.container} py-5 space-y-4`}>
        {all.length > 1 && (
          <nav className="flex flex-wrap gap-1.5">
            {all.slice(0, 12).map((s) => (
              <Link key={s.id} href={`/admin/badminton?session=${s.id}`} className={cx(ui.chip, s.id === session.id ? ui.chipBrand : ui.chipMuted, "text-sm py-1")}>{isSessionOpen(s) ? "● " : ""}{label(s)}</Link>
            ))}
          </nav>
        )}
        <BadmintonStaff sessionId={session.id} viewerId={user.id} views={views} rows={rows} roster={roster.map((p) => ({ id: p.id, name: p.name, className: p.className }))} selfEvals={selfEvals} seCols={seCols} elo={elo} groupClasses={classes} />
      </main>
    </div>
  );
}
