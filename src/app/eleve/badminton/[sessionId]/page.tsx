import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { activeTournament, badmintonRoster, loadMatches, loadTournamentMatches, loadTournaments, peopleOf, pickerRef, pupilWindowEnd, pupilWindowOpen, studentInSession, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { bracketMineOf, bracketOf, formatText, liveRuleOf, mineOf, playersNow, poolsOf, ruleFor } from "@/lib/badminton-tournament";
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
  // Tournoi en cours (09/11) : mon prochain adversaire (poule ou tableau), le handicap, mon classement.
  const tour = activeTournament(await loadTournaments(sessionId));
  let tourCard: TourCardData | null = null;
  // Regle de chaque match de tournoi de la seance (pour reprendre un arbitrage en direct avec le bon objectif).
  const tm = tour ? await loadTournamentMatches(tour.id) : [];
  // Championnat a handicap : ELO du moment (13/11), recalcule apres chaque match joue.
  const tourNow = tour && tour.kind === "HANDICAP" ? { ...tour, players: playersNow(tour.players, tm, tour.settings) } : tour;
  const liveRules = Object.fromEntries(tourNow ? matches.filter((m) => m.tournamentId === tourNow.id).map((m) => [m.id, liveRuleOf(tourNow, m)]) : []);
  if (tour && tourNow) {
    const tp = await peopleOf(tm, tour.players.map((p) => p.studentId));
    const tref = (id: string): BmPersonRef => { const p = tp.get(id) ?? people.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
    // Format affiche : celui de MON prochain match (objectif du match, de la poule ou du tournoi).
    const fmt = (a: string | null | undefined, b: string | null | undefined) => (a && b ? formatText(tour.settings, ruleFor(tour.settings, tour.players, a, b).points) : formatText(tour.settings));
    const base = { kind: tour.kind, label: tour.label, format: formatText(tour.settings) };
    if (tour.kind === "BRACKET") {
      const mine = bracketMineOf(bracketOf(tour.players, tm), me.id);
      if (mine) {
        const p = mine.pairing;
        const meA = p?.a === me.id;
        const opp = p ? (meA ? p.b : p.a) : null;
        tourCard = { ...base, format: fmt(p?.a, p?.b), where: mine.lo === mine.hi ? `place ${mine.lo}` : `places ${mine.lo} à ${mine.hi}`, round: mine.round, rounds: mine.rounds, status: mine.finished ? "done" : p?.status ?? "wait", opponent: opp ? tref(opp) : null, sets: p?.sets ? (meA ? p.sets : swapSets(p.sets)) : null, rank: mine.rank, of: mine.of, table: null, headStart: null, late: false, extra: [], poolDone: !!mine.rank, order: null };
      }
    } else {
      const mine = mineOf(poolsOf(tourNow.players, tm, tour.kind === "HANDICAP" ? tour.settings : null, tour.settings.poolLegs), me.id);
      if (mine) {
        const p = mine.pairing;
        const meA = p?.a === me.id;
        const opp = p ? (meA ? p.b : p.a) : null;
        const h = p?.handicap;
        tourCard = {
          ...base,
          format: fmt(p?.a, p?.b),
          where: mine.pool.players.length === tour.players.length ? "tous contre tous" : `poule ${mine.pool.name}`,
          round: mine.round?.n ?? null,
          rounds: mine.pool.rounds.length,
          // Mon prochain match (rattrapage pour un retardataire) ; plus aucun : j'ai fini (rattrapages des autres a part).
          status: p?.status ?? "done",
          opponent: opp ? tref(opp) : null,
          sets: p?.sets ? (meA ? p.sets : swapSets(p.sets)) : null,
          rank: mine.rank,
          of: mine.of,
          table: mine.pool.standings.map((s) => ({ name: tref(s.id).name, score: s.score, rank: s.rank, me: s.id === me.id })),
          headStart: h ? { mine: meA ? h[0] : h[1], theirs: meA ? h[1] : h[0] } : null,
          late: mine.late,
          extra: mine.extra.map((x) => tref(x.a)),
          poolDone: mine.pool.done,
          // L'ordre de tous les matchs de ma poule, pour que chacun s'organise sur les terrains.
          order: [...mine.pool.rounds.flatMap((r) => r.pairings.map((x) => ({ round: r.n as number | null, x }))), ...mine.pool.catchUp.map((x) => ({ round: null as number | null, x }))].map(({ round, x }) => ({
            round,
            a: tref(x.a).name,
            b: x.b ? tref(x.b).name : null,
            status: x.status,
            score: x.sets ? x.sets.map(([s1, s2]) => `${s1}-${s2}`).join(" ") : null,
            mine: x.a === me.id || x.b === me.id,
            // objectif a part (match ou poule) : affiche a cote de la rencontre
            points: x.b && ruleFor(tour.settings, tour.players, x.a, x.b).points !== tour.settings.points ? ruleFor(tour.settings, tour.players, x.a, x.b).points : null,
          })),
        };
      }
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
        liveRules={liveRules}
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
