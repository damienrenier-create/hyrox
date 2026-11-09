import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { activeTournament, badmintonRoster, loadMatches, loadTournaments, peopleOf, pickerRef, pupilWindowEnd, pupilWindowOpen, studentInSession, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { formatText, mineOf, poolsOf } from "@/lib/badminton-tournament";
import { swapSets } from "@/lib/badminton";
import type { TourCardData } from "./BadmintonClient";
import { viewOf, type BmPersonRef } from "@/lib/badminton";
import { readSessionClasses } from "@/lib/session-roles";
import { toMs } from "@/lib/scheduling";
import { TopBar } from "../../../_components/TopBar";
import { BadmintonClient } from "./BadmintonClient";
import { SelfEvalGrid } from "../../SelfEvalGrid";
import { SELF_EVAL_GRIDS } from "@/lib/wod-engines/core/self-eval";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Badminton, cote eleve (Sartay 20/10) : encoder ses matchs (contre qui, le score), signer ou corriger ceux que
// l'adversaire a encodes, encoder comme arbitre le match de deux autres eleves. Tout ce qui a ete encode reste visible.
export default async function BadmintonPupilPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ autoeval?: string }> }) {
  const { sessionId } = await params;
  const { autoeval } = await searchParams;
  const user = await getSession();
  if (!user) redirect("/");
  if (BM_STAFF_ROLES.includes(user.role)) redirect(`/admin/badminton?session=${sessionId}`);
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt || session.wodType !== "BADMINTON") redirect("/eleve");
  const me = await db.orm.public.User.where({ id: user.id }).first();
  if (!me || !(await studentInSession(session, me.id, me.className ?? null))) redirect("/eleve");

  const [matches, roster] = await Promise.all([loadMatches(sessionId), badmintonRoster(session)]);
  const people = await peopleOf(matches, roster.map((p) => p.id));
  const ref = (id: string): BmPersonRef => { const p = people.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
  const views = matches.map((m) => viewOf(m, me.id, false, ref));
  const involved = views.filter((v) => v.meSide !== null || v.createdBy.id === me.id);
  const toSign = involved.filter((v) => v.status === "PENDING" && v.can.validate);
  const mine = involved.filter((v) => v.meSide !== null && !toSign.includes(v));
  const refereed = involved.filter((v) => v.meSide === null);
  // Auto-evaluation de la seance (grille « AUTO-ÉVALUATION – CYCLE BADMINTON », Sartay 03/11) : ouverte tant que l'eleve
  // peut encoder ses matchs (seance ouverte, ou terminee depuis moins de 24 h).
  const writable = pupilWindowOpen(session);
  // Tournoi par poules en cours (09/11) : ma poule, mon adversaire de la ronde en cours, le classement de ma poule.
  const tour = activeTournament(await loadTournaments(sessionId));
  let tourCard: TourCardData | null = null;
  if (tour) {
    const mine = mineOf(poolsOf(tour.players, matches.filter((m) => m.tournamentId === tour.id)), me.id);
    if (mine) {
      const p = mine.pairing;
      const meA = p?.a === me.id;
      const opp = p ? (meA ? p.b : p.a) : null;
      tourCard = {
        label: tour.label,
        format: formatText(tour.settings),
        pool: mine.pool.name,
        round: mine.pool.current,
        rounds: mine.pool.rounds.length,
        status: mine.pool.done ? "done" : p?.status ?? "bye",
        opponent: opp ? ref(opp) : null,
        sets: p?.sets ? (meA ? p.sets : swapSets(p.sets)) : null,
        rank: mine.rank,
        of: mine.of,
        table: mine.pool.standings.map((s) => ({ name: ref(s.id).name, score: s.score, rank: s.rank, me: s.id === me.id })),
      };
    }
  }
  const selfEval = await db.orm.public.SelfEvaluation.where({ sessionId, studentId: me.id }).first();
  const grid = SELF_EVAL_GRIDS.badminton;
  const closes = session.closesAt ? new Date(toMs(session.closesAt)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }) : null;

  return (
    <div className="min-h-dvh bg-paper">
      <TopBar title="🏸 Badminton" subtitle={`${readSessionClasses(session.settings).join(" + ")}${session.isActive && closes ? ` · jusqu'à ${closes}` : ""}`} back={{ href: "/eleve", label: "Mon espace" }} />
      <BadmintonClient
        sessionId={sessionId}
        meId={me.id}
        writable={writable}
        roster={roster.filter((p) => p.id !== me.id).map(pickerRef)}
        toSign={toSign}
        mine={mine}
        refereed={refereed}
        tour={tourCard}
      />
      <section id="auto-eval" className="max-w-xl mx-auto px-4 pb-10">
        <details open={autoeval === "1"} className={`${ui.card} p-3`}>
          <summary className="cursor-pointer select-none flex items-center justify-between gap-2">
            <span className="font-display font-extrabold text-ink">📝 Mon auto-évaluation</span>
            <span className={cx(ui.chip, selfEval ? ui.chipOk : writable ? ui.chipWarn : ui.chipMuted)}>{selfEval ? "envoyée ✅" : writable ? "à remplir" : "non remplie"}</span>
          </summary>
          <div className="mt-3">
            <p className={`${ui.hint} mb-2`}>{grid.title}. À remplir à la fin du cours (jusqu&apos;à 24 h après).</p>
            <SelfEvalGrid
              sessionId={sessionId}
              criteria={grid.criteria}
              instruction={grid.instruction}
              initial={selfEval ? (selfEval.answers as Record<string, string>) : null}
              state={writable ? "open" : "expired"}
              closesAt={pupilWindowEnd(session)}
              submittedAt={selfEval ? new Date(String(selfEval.submittedAt)).getTime() : null}
            />
          </div>
        </details>
      </section>
    </div>
  );
}
