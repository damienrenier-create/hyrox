import { getSession } from "@/lib/session-server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";
import { buildBoardData } from "@/lib/referee-board";
import { refereeAccess } from "@/lib/referee-access";
import { lastFleetAction } from "./actions";
import { ensureFleet } from "@/lib/fleet-autopilot";
import { listOpenSessions, openSessionsForStudent } from "@/lib/scheduling";
import { FleetPlacement } from "./FleetPlacement";
import { ToucheCouleClient } from "./client";
import { DemineurClient } from "./DemineurClient";
import { mineViewFor } from "@/lib/mine";
import { wodLabel } from "@/lib/student-sessions";
import type { BoardShip } from "./Board";
import { btn, ui } from "@/lib/ui";
import { notDeleted } from "@/lib/session-roles";
import { ObservationClient, type ObsHistoryRow } from "./ObservationClient";
import { currentObservation, loadObsView, obsStations, participantsOf, staffCoverage, staffObservation, studentObservations } from "@/lib/observations";

// Heure du serveur (hors du rendu, regle react-hooks/purity) : le compte a rebours de l'arbitre s'y recale.
function serverNow(): number {
  return Date.now();
}

export default async function ToucheCoulePage({ searchParams }: { searchParams: Promise<{ session?: string; eleve?: string }> }) {
  const evaluator = await getSession();
  if (!evaluator) {
    redirect("/");
  }

  // Choix de la seance : ?session=, sinon une seance OUVERTE avec arbitrage (celle de la classe de l'eleve),
  // sinon la plus recente avec arbitrage. Pas de filtre isActive sur le repli : la fin du WOD ne coupe pas
  // l'acces au Touché-Coulé (§28) — elle ne fait que basculer les tirs suivants en POST_WOD.
  const { session: requested, eleve } = await searchParams;
  let session = requested ? await db.orm.public.Session.where({ id: requested, refereeMode: true }).first() : null;
  if (session?.deletedAt) session = null; // seance supprimee (corbeille)
  if (!session) {
    const open = evaluator.role === "STUDENT"
      ? await openSessionsForStudent(evaluator.id, evaluator.className ?? null)
      : await listOpenSessions();
    session = open.find((s) => s.refereeMode) ?? null;
  }
  if (!session) {
    session = (await db.orm.public.Session.where({ refereeMode: true }).orderBy((s) => s.createdAt.desc()).all()).find(notDeleted) ?? null;
  }

  if (!session) {
    return (
      <div className={`${ui.page} flex items-center justify-center p-4 text-center`}>
        <div className={`${ui.cardPad} max-w-sm`}>
          <div className="text-4xl mb-3">🏴‍☠️</div>
          <h1 className={`${ui.h2} mb-2`}>Aucune séance d&apos;arbitrage active</h1>
          <p className={ui.muted}>Attendez que l&apos;admin lance une séance avec le Touché-Coulé activé.</p>
        </div>
      </div>
    );
  }

  // Participant encode dans une equipe et pas inscrit arbitre par le greffier -> pas d'arbitrage.
  const access = await refereeAccess(session.id, evaluator);
  if (!access.allowed) {
    return (
      <div className={`${ui.page} flex items-center justify-center p-6 text-center`}>
        <div className={`${ui.cardPad} max-w-sm`}>
          <div className="text-5xl mb-3">{access.status === "PENDING" ? "⏳" : access.status === "REFUSED" ? "🚫" : "💪"}</div>
          <h1 className={`${ui.h2} text-sea-ink mb-2`}>
            {access.status === "PENDING" ? "Demande en attente" : access.status === "REFUSED" ? "Demande refusée" : access.teamId ? "Tu es participant sur ce WOD" : "Autorisation nécessaire"}
          </h1>
          <p className={`${ui.muted} mb-6`}>{access.reason}</p>
          <a href="/eleve" className={btn.primary}>← Mon espace</a>
        </div>
      </div>
    );
  }

  // WOD Eval (Sartay 04/10) : ni flotte ni demineur. L'eleve arbitre suit un eleve tire au sort pendant 5 minutes ; le
  // prof evalue qui il veut (?eleve=), sur 6 criteres, avec le rappel de ce qui a deja ete evalue.
  if (session.wodType === "HYROX") {
    const staff = evaluator.role !== "STUDENT";
    const [parts, rs] = await Promise.all([participantsOf(session.id), db.orm.public.RaceState.where({ sessionId: session.id }).first()]);
    const race = !rs?.startedAt ? "pre" : rs.endedAt || session.raceEndedAt ? "post" : "run";
    const nowMs = serverNow();
    const common = { sessionId: session.id, sessionLabel: session.label ?? wodLabel(session.wodType), race, serverNowMs: nowMs } as const;
    if (staff) {
      const coverage = await staffCoverage(session.id);
      const roster = parts.map((p) => ({ ...p, done: coverage[p.userId] ?? {} }));
      const selected = roster.find((p) => p.userId === eleve) ?? null;
      const row = selected ? await staffObservation(session.id, evaluator.id, selected.userId) : null;
      return <ObservationClient {...common} mode="STAFF" backHref={`/greffier?session=${session.id}`} stations={obsStations(session, "STAFF")} obs={row ? await loadObsView(row, parts) : null} roster={roster} selected={selected} />;
    }
    // Cycle de l'arbitre eleve : l'observation du moment (eleve annonce, ou fenetre de 5 minutes en cours), et les
    // fenetres deja fermees. Le prochain eleve est demande par l'ecran lui-meme a la fin de chaque fenetre : rien n'est
    // cree ici, a la simple lecture de la page.
    const mine = await studentObservations(session.id, evaluator.id);
    const row = currentObservation(mine, nowMs);
    const ended = mine.filter((o) => o !== row).slice(0, 8);
    const paused = rs ? (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).some((p) => p.to == null) : false;
    const labelOf = new Map(obsStations(session, "STUDENT").map((s) => [s.id, s.label]));
    const history: ObsHistoryRow[] = [];
    for (const o of ended) {
      const v = await loadObsView(o, parts);
      const totals = new Map<string, number[]>();
      for (const e of v.entries) if (!e.voided) totals.set(e.exerciseId, [...(totals.get(e.exerciseId) ?? []), e.reps]);
      history.push({ id: v.id, targetName: v.targetName, teamName: v.teamName, clock: new Date(v.startedAtMs).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }), summary: [...totals].map(([id, sets]) => `${labelOf.get(id) ?? id} : ${sets.join(" - ")}`).join(" · ") });
    }
    return <ObservationClient {...common} mode="STUDENT" backHref="/eleve" stations={obsStations(session, "STUDENT")} obs={row ? await loadObsView(row, parts) : null} history={history} cycleStarted={mine.length > 0} paused={paused} />;
  }

  // WOD Level : pas de flotte ni de tirs, un demineur eleves x exercices (une carte par seance, figee avec
  // l'echelle au coup d'envoi). Tant que le WOD n'est pas lance, la carte n'existe pas encore.
  if (session.wodType === "LEVEL") {
    const view = await mineViewFor(session.id, evaluator.id);
    if (!view) {
      return (
        <div className={`${ui.page} flex items-center justify-center p-6 text-center`}>
          <div className={`${ui.cardPad} max-w-sm`}>
            <div className="text-5xl mb-3">💣</div>
            <h1 className={`${ui.h2} mb-2`}>Le démineur s&apos;ouvre au coup d&apos;envoi</h1>
            <p className={`${ui.muted} mb-6`}>La carte (élèves × exercices) est tirée au sort quand le greffier lance le WOD Level. Reviens dans un instant.</p>
            <a href={evaluator.role === "STUDENT" ? "/eleve" : "/admin"} className={btn.primary}>← Retour</a>
          </div>
        </div>
      );
    }
    return (
      <DemineurClient
        sessionId={session.id}
        sessionLabel={session.label ?? wodLabel(session.wodType)}
        evaluator={{ id: evaluator.id, role: evaluator.role, name: evaluator.name }}
        view={view}
        ended={!!session.raceEndedAt}
        ownTeamId={access.teamId}
      />
    );
  }

  const rawTeams = await db.orm.public.Team.where({ sessionId: session.id }).all();
  const teams = rawTeams
    .map((t) => ({ id: t.id, name: t.name, order: t.order ?? 0 }))
    .sort((a, b) => a.order - b.order);

  const exercises = exercisesFor(session).map((e) => ({ id: e.id, label: e.label }));

  // Profs, coachs et greffier n'ont jamais a re-placer huit bateaux : leur flotte est reprise de la derniere
  // seance du meme type de WOD, sinon tiree au hasard, puis verrouillee automatiquement (src/lib/fleet-autopilot.ts).
  // Les eleves gardent l'ecran de placement (le rituel fait partie du jeu), avec reprise et tirage au sort en un tap.
  if (evaluator.role !== "STUDENT") {
    try {
      await ensureFleet(session.id, evaluator.id);
    } catch (e) {
      console.error("ensureFleet a échoué, écran de placement manuel :", e);
    }
  }

  const fleet = await db.orm.public.RefereeFleet.where({
    sessionId: session.id,
    refereeId: evaluator.id,
    slot: 0,
  }).first();
  const rawShips = fleet ? await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).all() : [];
  const myShips: BoardShip[] = rawShips.map((s) => ({
    id: s.id,
    size: s.size,
    orientation: s.orientation as "horizontal" | "vertical",
    direction: (s.direction as BoardShip["direction"]) ?? null,
    startTeamId: s.startTeamId,
    startExerciseId: s.startExerciseId,
  }));

  if (!fleet || fleet.status !== "LOCKED") {
    // Flotte deja posee lors d'une autre seance : proposee en un geste (memes positions).
    const reusable = myShips.length === 0 ? await lastFleetAction(session.id) : null;
    return <FleetPlacement evaluator={evaluator} sessionId={session.id} teams={teams} exercises={exercises} ships={myShips} reusable={reusable} />;
  }

  const myShipIds = new Set(rawShips.map((s) => s.id));
  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId: session.id }).all();
  // Cibles possibles = cases portant au moins un navire qui n'est pas a moi (calques par arbitre).
  const occupiedCells = new Set(allPlacements.filter((p) => p.shipId && !myShipIds.has(p.shipId)).map((p) => `${p.teamId}_${p.exerciseId}`));
  const myCells = allPlacements
    .filter((p) => p.shipId && myShipIds.has(p.shipId))
    .map((p) => `${p.teamId}_${p.exerciseId}`);
  const myCellSet = new Set(myCells);

  const allShots = await db.orm.public.Shot.where({ sessionId: session.id }).all();
  const myShots = allShots
    .filter((s) => s.refereeId === evaluator.id)
    .map((s) => ({
      teamId: s.targetTeamId,
      exerciseId: s.targetExerciseId,
      hit: occupiedCells.has(`${s.targetTeamId}_${s.targetExerciseId}`),
    }));
  // Degats subis : uniquement les tirs des AUTRES. Un arbitre peut evaluer une case ou il est pose,
  // et ce geste d'arbitrage ne doit jamais abimer sa propre flotte ni lui couter un point.
  const incoming = allShots.filter((s) => s.refereeId !== evaluator.id && myCellSet.has(`${s.targetTeamId}_${s.targetExerciseId}`));
  const hitsOnMyFleet = incoming.length;

  // Mes cinq dernieres evaluations, corrigeables : un arbitre qui tape 55 au lieu de 5 doit pouvoir
  // se rattraper sans passer par le prof.
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const exLabel = new Map(exercises.map((e) => [e.id, e.label]));
  const myRecent = (await db.orm.public.Evaluation.where({ sessionId: session.id, evaluatorId: evaluator.id }).orderBy((e) => e.createdAt.desc()).all())
    .slice(0, 5)
    .map((e) => ({ id: e.id, teamName: teamName.get(e.teamId) ?? "?", exerciseLabel: exLabel.get(e.exerciseId) ?? "?", reps: e.repsObserved, note: e.note, atMs: new Date(String(e.createdAt)).getTime() }));
  // Cases de MA flotte deja touchees : l'arbitre doit voir OU il encaisse, pas seulement un compteur.
  const damagedCells = incoming.map((s) => ({ teamId: s.targetTeamId, exerciseId: s.targetExerciseId }));

  // Classement pirate (meme calcul pour tous : greffier, carte admin, arbitres).
  const board = await buildBoardData(session.id);
  const myScore = board.referees.find((r) => r.refereeId === evaluator.id)?.score ?? 0;

  // Un navire coule est revele a tout le monde (regle classique de la bataille navale) : ses cases
  // portent une epave. Tant qu'il flotte, la flotte adverse reste invisible.
  const sunkShipIds = new Set(board.ships.filter((s) => s.sunk).map((s) => s.id));
  const wreckCells = allPlacements
    .filter((p) => p.shipId && sunkShipIds.has(p.shipId))
    .map((p) => ({ teamId: p.teamId, exerciseId: p.exerciseId }));
  const myShipsWithState: BoardShip[] = myShips.map((s) => ({ ...s, dimmed: sunkShipIds.has(s.id) }));
  const leaderboard = board.referees.map((r) => ({ refereeId: r.refereeId, name: r.name, score: r.score, hits: r.hits, sunk: r.sunk, intact: r.intact }));

  return (
    <ToucheCouleClient
      evaluator={evaluator}
      sessionId={session.id}
      teams={teams}
      exercises={exercises}
      myShips={myShipsWithState}
      myCells={myCells}
      myShots={myShots}
      hitsOnMyFleet={hitsOnMyFleet}
      damagedCells={damagedCells}
      wreckCells={wreckCells}
      raceEnded={!!session.raceEndedAt}
      myScore={myScore}
      ownTeam={access.teamId ? { id: access.teamId, name: access.teamName ?? "" } : null}
      leaderboard={leaderboard}
      myRecent={myRecent}
      canUnlock={incoming.length === 0}
    />
  );
}
