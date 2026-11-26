import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { activeTournament, badmintonRoster, loadMatches, loadScoutingMatches, loadPlayerScouting, loadScoutConfigs, loadTournamentMatches, loadTournaments, peopleOf, pickerRef, pupilWindowOpen, selfEvalEnd, selfEvalOpen, sessionEndMs, studentInSession, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { BM_SELF_EVAL_DAYS, selfEvalTiming, timingComment } from "@/lib/self-eval-timing";
import { AfterMatchPrompt, FormeQuick } from "./SelfEvalPrompts";
import { betPair, headStartOf, myPendingBet, readPendingBets, readSessionConstraints } from "@/lib/badminton-constraints";
import { ELO_START, kFactor } from "@/lib/badminton-elo";
import { THEME_ELO_WEIGHT } from "@/lib/badminton-themes";
import { loadEloBoard } from "@/lib/badminton-server";
import type { BetData } from "./BetBox";
import { bracketMineOf, bracketOf, formatText, liveRuleOf, mineOf, playersNow, poolsOf, ruleFor } from "@/lib/badminton-tournament";
import { marginFor, readyState, scoreFor, teamFormatText, teamMineOf, teamStakes, teamsOf } from "@/lib/badminton-teams";
import { sessionTheme } from "@/lib/badminton-themes";
import { readScoutConfig, scoutUnlocked, studentLayer } from "@/lib/badminton-scout";
import { scoutQueue } from "@/lib/badminton-scout-queue";
import { ScoutView } from "../../../_components/ScoutView";
import { swapSets } from "@/lib/badminton";
import type { TourCardData } from "./BadmintonClient";
import { matchState, viewOf, type BmPersonRef } from "@/lib/badminton";
import { readSessionClasses } from "@/lib/session-roles";
import { toMs } from "@/lib/scheduling";
import { TopBar } from "../../../_components/TopBar";
import { BadmintonClient } from "./BadmintonClient";
import { SelfEvalNudge } from "../../../_components/SelfEvalNudge";
import { SelfEvalGrid } from "../../SelfEvalGrid";
import { SELF_EVAL_GRIDS } from "@/lib/wod-engines/core/self-eval";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";
// Heure de la lecture (hors du rendu, regle react-hooks/purity) : le chrono du tournoi par equipes s'y recale.
function currentTime(): number {
  return Date.now();
}

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
  // Observations de scouting (26/11) : pas des matchs ; seulement pour le scouting et son analyse.
  const scoutingObs = await loadScoutingMatches(sessionId);
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
  // Contraintes de la lecon (26/11 soir) : handicap et mises ; l'ELO de chacun (avances et mises) seulement si besoin.
  const cons = readSessionConstraints(session.settings);
  const board = cons.handicap || cons.bet ? await loadEloBoard() : null;
  const ratingOf = (id: string) => board?.entries.get(id)?.rating ?? ELO_START;
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
    if (tour.kind === "TEAMS") {
      // Tournoi par equipes (24/11) : mon equipe, mon prochain match, la rencontre en cours, le chrono, le classement.
      const st = teamsOf(tour.players, tm, tour.settings);
      const mine = teamMineOf(st, me.id);
      const ts = tour.settings.team!;
      if (mine) {
        const p = mine.pairing;
        const meA = mine.side === 0;
        const opp = p ? (meA ? p.b : p.a) : null;
        const oppLetter = mine.rencontre ? (mine.side === 0 ? mine.rencontre.y : mine.rencontre.x) ?? null : null;
        const coachName = (l: string) => tref(st.teams.find((t) => t.letter === l)?.coach ?? "").name;
        const rc = mine.rencontre && mine.rencontre.status !== "bye" && mine.rencontre.status !== "wait" ? mine.rencontre : null;
        // Ce qui se joue dans mon prochain match (26/11) : ce qu'il rapporte selon le score, et ce qu'il faut pour passer devant.
        const stk = p && opp && (p.status === "todo" || p.status === "live") ? teamStakes(tour.players, tm, tour.settings, me.id, opp, !!sessionTheme(session.settings), !!cons.handicap) : null;
        let need: string | null = null;
        if (stk && rc) {
          const ours = mine.side === 0 ? rc.pts[0] : rc.pts[1], theirs = mine.side === 0 ? rc.pts[1] : rc.pts[0];
          const others = rc.matches.filter((x) => x !== p && x.status !== "played" && x.status !== "gone").length;
          const gap = theirs - ours;
          if (gap < 0) need = `Ton équipe mène de ${-gap} point${-gap > 1 ? "s" : ""} dans la rencontre : ${stk.scoring === "POINTS" ? "chaque point que tu marques creuse l'écart, même en perdant." : "une victoire creuse l'écart."}`;
          else if (stk.scoring === "POINTS") {
            const lead = gap === 0 ? "Les deux équipes sont à égalité" : `Ton équipe est menée de ${gap} point${gap > 1 ? "s" : ""}`;
            const x = scoreFor(stk, gap + 1);
            need = !stk.target ? `${lead} : chaque point que tu marques compte (×${stk.coef.toFixed(1).replace(".", ",")}), et la victoire ajoute un bonus.` : x !== null ? `${lead} : gagne ${stk.target}-${x} ou mieux pour la faire passer devant ; et même si tu perds, chaque point marqué compte.` : others ? `${lead} : même une large victoire ne suffit pas seule, il faudra aussi tes coéquipiers (${others} match${others > 1 ? "s" : ""} restant${others > 1 ? "s" : ""}) ; chaque point compte.` : `${lead} : même une large victoire ne suffira pas à passer devant, mais chaque point marqué compte${st.format === "BRACKET" ? "" : " au classement"}.`;
          } else {
            const m = marginFor(stk, gap + 1);
            const lead = gap === 0 ? "Les deux équipes sont à égalité" : `Ton équipe est menée de ${gap} point${gap > 1 ? "s" : ""}`;
            need = m === 0 ? `${lead} : une victoire suffit pour la faire passer devant.` : m !== null ? `${lead} : gagne avec au moins ${m} point${m > 1 ? "s" : ""} d'écart pour la faire passer devant.` : others ? `${lead} : même une large victoire ne suffit pas seule, il faudra aussi des victoires de tes coéquipiers (${others} match${others > 1 ? "s" : ""} restant${others > 1 ? "s" : ""}).` : `${lead} : même une large victoire ne suffira pas à passer devant${st.format === "BRACKET" ? "" : ", mais chaque point compte au classement"}.`;
          }
        }
        tourCard = {
          ...base,
          format: teamFormatText(tour.settings, st.teams.length),
          where: mine.sub ? `remplaçant · équipe ${mine.team.letter}` : `équipe ${mine.team.letter}`,
          round: mine.round?.n ?? null,
          rounds: st.rounds.length,
          status: p ? p.status : mine.finished ? "done" : mine.waiting ? "wait" : mine.resting ? "bye" : "done",
          opponent: opp ? tref(opp) : null,
          sets: p?.sets ? (meA ? p.sets : swapSets(p.sets)) : null,
          rank: mine.team.rank, of: st.teams.length, table: null, headStart: null, late: false, extra: [], poolDone: st.done, order: null,
          team: {
            letter: mine.team.letter,
            coach: coachName(mine.team.letter),
            meCoach: mine.team.coach === me.id,
            pts: mine.team.pts,
            myPts: mine.team.members.find((m) => m.id === me.id)?.pts ?? 0,
            bracket: st.format === "BRACKET",
            time: ts.mode === "TIME",
            minutes: ts.minutes,
            timer: ts.timer,
            now: currentTime(),
            wave: p?.wave ?? null,
            roundLabel: mine.round ? `${mine.round.label}${mine.rencontre?.stage ? ` · ${mine.rencontre.stage}` : ""}` : "",
            oppTeam: oppLetter ? { letter: oppLetter, coach: coachName(oppLetter) } : null,
            sub: !!mine.sub,
            scoring: ts.scoring,
            tourId: tour.id,
            // « Pret » (26/11) : seulement si je joue dans la prochaine vague au temps et que son chrono n'est pas lance.
            ready: (() => { const rs = readyState(st, ts); return rs && rs.expected.includes(me.id) ? { me: rs.ready.includes(me.id), count: rs.ready.length, total: rs.expected.length } : null; })(),
            stakes: stk ? { win: stk.win, lose: stk.lose, draw: stk.draw, chance: Math.round(stk.chance * 100), need, scoring: stk.scoring, coef: Math.round(stk.coef * 10) / 10, target: stk.target } : null,
            current: rc ? {
              pts: mine.side === 0 ? rc.pts : [rc.pts[1], rc.pts[0]],
              status: rc.status,
              matches: rc.matches.map((x) => {
                const ours = mine.side === 0 ? x.a : x.b, theirs = mine.side === 0 ? x.b : x.a;
                const sets = x.sets ? (mine.side === 0 ? x.sets : swapSets(x.sets)) : null;
                return { ours: tref(ours).name, theirs: tref(theirs).name, wave: x.wave, status: x.status, score: sets ? sets.map(([s1, s2]) => `${s1}-${s2}`).join(" ") : null, pts: (mine.side === 0 ? x.pts : [x.pts[1], x.pts[0]]) as [number, number], me: ours === me.id };
              }),
            } : null,
            table: [...st.teams].sort((x, y) => x.group - y.group || (x.rank ?? 99) - (y.rank ?? 99) || x.lo - y.lo).map((t) => ({ letter: t.letter, coach: coachName(t.letter), pts: t.pts, rank: t.rank, lo: t.lo, hi: t.hi, group: t.group, record: `${t.won}-${t.drawn}-${t.lost}`, me: t.letter === mine.team.letter })),
            groups: st.groups,
          },
        };
      }
    } else if (tour.kind === "BRACKET") {
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
  // Handicap de la lecon (hors championnat a handicap, qui a le sien) : mon avance (ou la sienne) pour mon prochain match.
  if (tourCard && tour && cons.handicap && tour.kind !== "HANDICAP" && tourCard.opponent && tourCard.status === "todo") {
    const pts = tour.kind === "TEAMS" ? (tour.settings.team?.mode === "TIME" ? 15 : tour.settings.points) : ruleFor(tour.settings, tour.players, me.id, tourCard.opponent.id).points;
    const h = headStartOf(ratingOf(me.id), ratingOf(tourCard.opponent.id), cons.handicap.eloPerPoint, pts);
    tourCard = { ...tourCard, headStart: { mine: h[0], theirs: h[1] } };
  }
  // Mises (26/11 soir) : mes mises en cours (posees depuis notre dernier match) et l'ELO de chacun pour le tableau +/−.
  const pending = cons.bet ? readPendingBets(session.settings) : [];
  const since = (opp: string) => Math.max(0, ...matches.filter((m) => betPair(m.playerAId, m.playerBId) === betPair(me.id, opp)).map((m) => m.createdAt));
  const others = roster.filter((p) => p.id !== me.id);
  const bet: BetData | null = cons.bet && writable ? {
    k: kFactor(board?.entries.get(me.id)?.games ?? 0),
    even: !!cons.handicap,
    weight: sessionTheme(session.settings) ? THEME_ELO_WEIGHT : 1,
    me: Math.round(ratingOf(me.id)),
    opps: Object.fromEntries(others.map((p) => [p.id, Math.round(ratingOf(p.id))])),
    mine: Object.fromEntries(others.flatMap((p) => { const c = myPendingBet(pending, me.id, p.id, since(p.id)); return c === null ? [] : [[p.id, c]]; })),
  } : null;
  const selfEval = await db.orm.public.SelfEvaluation.where({ sessionId, studentId: me.id }).first();
  const grid = SELF_EVAL_GRIDS.badminton;
  // Auto-evaluation (26/11 soir) : ouverte pendant le cours et 3 jours apres ; le petit mot selon le moment du PREMIER envoi ;
  // fermee sans auto-eval : le mot « trop tard » (et pas de classement ELO jusqu'a la prochaine).
  const nowMs = currentTime();
  const endMs = sessionEndMs(session);
  const seOpen = selfEvalOpen(session, nowMs);
  const sentMs = selfEval ? new Date(String(selfEval.submittedAt)).getTime() : null;
  const timing = sentMs !== null ? selfEvalTiming(sentMs, endMs) : !seOpen && nowMs > endMs ? "CLOSED" : null;
  const timingText = timing ? timingComment(timing, me.id, sessionId) : null;
  // Mes matchs de ce cours qui ont un score (pour « Tu veux t'auto-evaluer maintenant ? » apres chaque match).
  const played = involved.filter((v) => v.meSide !== null && (v.status === "PENDING" || v.status === "VALIDATED")).length;
  // Scouting (24/11) : mes couches quand j'arbitre en direct ; les matchs que je peux observer (en direct d'abord).
  // Verrouille par defaut (26/11) : seulement si le prof l'a deverrouille pour toute la classe ou pour moi, pendant ce cours.
  const scoutCfg = readScoutConfig(session.settings);
  const scoutOpen = scoutUnlocked(scoutCfg, me.id);
  const scoutMine = scoutOpen ? { court: scoutCfg.court, level: studentLayer(me.id, scoutCfg, await loadScoutConfigs()) } : null;
  // Pendant un tournoi, le scout recoit le PROCHAIN match pas encore commence (26/11, voir badminton-scout-queue.ts).
  const watched = new Set(scoutingObs.filter((m) => matchState(m).status === "LIVE").map((m) => [m.playerAId, m.playerBId].sort().join("|")));
  const scoutNext = scoutOpen && tourNow ? scoutQueue(tourNow, tm, me.id, watched).slice(0, 4) : null;
  // Mes observations en cours (a reprendre).
  const myObs = scoutOpen ? scoutingObs.filter((m) => m.createdById === me.id && matchState(m).status === "LIVE") : [];
  const obsNames = myObs.length ? await peopleOf(myObs) : new Map();
  const scoutResume = myObs.map((m) => ({ id: m.id, aName: obsNames.get(m.playerAId)?.name ?? "?", bName: obsNames.get(m.playerBId)?.name ?? "?", sets: matchState(m).sets ?? [[0, 0]] }));
  const scoutNames = scoutNext?.length ? await peopleOf([], scoutNext.flatMap((p) => [p.a, p.b])) : new Map();
  const scoutPicks = scoutNext ? scoutNext.map((p) => ({ a: { id: p.a, name: scoutNames.get(p.a)?.name ?? "?" }, b: { id: p.b, name: scoutNames.get(p.b)?.name ?? "?" }, label: p.label })) : null;
  const scoutable = scoutOpen ? views.filter((v) => v.meSide === null && v.status !== "CANCELLED").sort((x, y) => Number(y.status === "LIVE") - Number(x.status === "LIVE") || y.createdAt - x.createdAt).slice(0, 15) : null;
  // Analyse de MON scouting (Sartay 24/11 : « a la fin de chaque cours, l'eleve pourra, s'il a rempli son auto-eval,
  // demander a recevoir l'analyse de son scouting ») : ce cours, et tous mes cours ; seulement apres l'auto-evaluation.
  const myScout = selfEval ? await loadPlayerScouting(me.id) : null;
  const here = new Set([...matches, ...scoutingObs].map((m) => m.id));
  const scoutHere = myScout ? { rallies: myScout.rallies.filter((r) => here.has(r.matchId)), sheets: myScout.sheets.filter((s) => here.has(s.matchId)) } : null;
  const closes = session.closesAt ? new Date(toMs(session.closesAt)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }) : null;

  return (
    <div className="min-h-dvh bg-paper">
      <TopBar title="🏸 Badminton" subtitle={`${readSessionClasses(session.settings).join(" + ")}${session.isActive && closes ? ` · jusqu'à ${closes}` : ""}`} back={{ href: "/eleve", label: "Mon espace" }} />
      {/* Rappel de l'auto-evaluation, 10 min avant la fin du cours (24/11). */}
      <div className="max-w-xl mx-auto px-4 pt-4 empty:hidden">
        <SelfEvalNudge closesAt={session.closesAt ? toMs(session.closesAt) : null} windowEnd={selfEvalEnd(session)} serverNow={nowMs} sent={!!selfEval} modalKey={`reps_bm_nudge_modal_${sessionId}`} />
      </div>
      {/* Avant le premier match : la forme du jour (une ligne de l'auto-eval) ; apres chaque match : « maintenant ? ». */}
      {!selfEval && writable && nowMs < endMs && <div className="max-w-xl mx-auto px-4 pt-3"><FormeQuick sessionId={sessionId} /></div>}
      {!selfEval && seOpen && <AfterMatchPrompt sessionId={sessionId} played={played} closesAt={session.closesAt ? toMs(session.closesAt) : null} serverNow={nowMs} />}
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
        theme={sessionTheme(session.settings)}
        scout={scoutMine}
        scoutable={scoutable}
        scoutPicks={scoutPicks}
        scoutResume={scoutResume}
        bet={bet}
        handicapOn={!!cons.handicap}
      />
      <section id="auto-eval" className="max-w-xl mx-auto px-4 pb-10">
        <details open={autoeval === "1"} className={`${ui.card} p-3`}>
          <summary className="cursor-pointer select-none flex items-center justify-between gap-2">
            <span className="font-display font-extrabold text-ink">📝 Mon auto-évaluation</span>
            <span className={cx(ui.chip, selfEval ? ui.chipOk : seOpen ? ui.chipWarn : ui.chipMuted)}>{selfEval ? "envoyée ✅" : seOpen ? "à remplir" : "non remplie"}</span>
          </summary>
          <div className="mt-3">
            {selfEval && timingText && <p className={cx("mb-3 rounded-xl px-3 py-2 text-sm font-semibold", timing === "TOP" || timing === "SUPER" ? "bg-success-soft text-success-ink" : timing === "HOMEWORK" || timing === "NEXT_DAY" ? "bg-warn-soft text-warn-ink" : "bg-danger-soft text-danger-ink")}>💬 {timingText}</p>}
            <p className={`${ui.hint} mb-2`}>{grid.title}. À remplir à la fin du cours (au plus tard {BM_SELF_EVAL_DAYS} jours après). Sans elle, pas de classement ELO.</p>
            <SelfEvalGrid
              sessionId={sessionId}
              criteria={grid.criteria}
              instruction={grid.instruction}
              initial={selfEval ? (selfEval.answers as Record<string, string>) : null}
              state={seOpen ? "open" : "expired"}
              closesAt={selfEvalEnd(session)}
              submittedAt={sentMs}
              draft
              firstSent
              expiredText={!selfEval && timingText ? timingText : `Le délai de ${BM_SELF_EVAL_DAYS} jours est écoulé.`}
            />
          </div>
        </details>
      </section>
      <section id="analyse" className="max-w-xl mx-auto px-4 pb-10 -mt-6">
        {!myScout ? (
          <div className={cx(ui.card, "p-3 opacity-80")}>
            <p className="font-display font-extrabold text-ink">📊 Analyse de mon scouting 🔒</p>
            <p className={ui.hint}>Remplis d&apos;abord ton auto-évaluation : tu pourras ensuite recevoir l&apos;analyse de ton scouting (où tu gagnes et perds tes points, ta technique vue par les scouts).</p>
          </div>
        ) : (
          <details className={`${ui.card} p-3`}>
            <summary className="cursor-pointer select-none font-display font-extrabold text-ink">📊 Recevoir l&apos;analyse de mon scouting</summary>
            <div className="mt-3 space-y-4">
              {scoutHere && (scoutHere.rallies.length || scoutHere.sheets.length) ? (
                <div>
                  <p className="font-bold mb-1">Ce cours</p>
                  <ScoutView rallies={scoutHere.rallies} sheets={scoutHere.sheets} me />
                </div>
              ) : <p className={ui.muted}>Pas encore de scouting sur toi dans ce cours : aucun arbitre n&apos;a noté les impacts de tes matchs, aucun scout n&apos;a rempli ta fiche technique.</p>}
              {(myScout.rallies.length > (scoutHere?.rallies.length ?? 0) || myScout.sheets.length > (scoutHere?.sheets.length ?? 0)) && (
                <details>
                  <summary className="cursor-pointer font-bold">Tous mes cours</summary>
                  <div className="mt-2"><ScoutView rallies={myScout.rallies} sheets={myScout.sheets} me /></div>
                </details>
              )}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
