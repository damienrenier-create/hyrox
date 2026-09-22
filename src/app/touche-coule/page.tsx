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
import type { BoardShip } from "./Board";
import { btn, ui } from "@/lib/ui";

export default async function ToucheCoulePage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const evaluator = await getSession();
  if (!evaluator) {
    redirect("/");
  }

  // Choix de la seance : ?session=, sinon une seance OUVERTE avec arbitrage (celle de la classe de l'eleve),
  // sinon la plus recente avec arbitrage. Pas de filtre isActive sur le repli : la fin du WOD ne coupe pas
  // l'acces au Touché-Coulé (§28) — elle ne fait que basculer les tirs suivants en POST_WOD.
  const { session: requested } = await searchParams;
  let session = requested ? await db.orm.public.Session.where({ id: requested, refereeMode: true }).first() : null;
  if (!session) {
    const open = evaluator.role === "STUDENT"
      ? await openSessionsForStudent(evaluator.id, evaluator.className ?? null)
      : await listOpenSessions();
    session = open.find((s) => s.refereeMode) ?? null;
  }
  if (!session) {
    session = await db.orm.public.Session.where({ refereeMode: true }).orderBy((s) => s.createdAt.desc()).first();
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

  const rawTeams = await db.orm.public.Team.where({ sessionId: session.id }).all();
  const teams = rawTeams
    .map((t) => ({ id: t.id, name: t.name, order: t.order ?? 0 }))
    .sort((a, b) => a.order - b.order);

  const exercises = exercisesFor(session).map((e) => ({ id: e.id, label: e.label }));

  // Profs, coachs et greffier n'ont jamais a re-placer huit bateaux : leur flotte est reprise de la derniere
  // seance du meme type de WOD, sinon tiree au hasard, puis verrouillee automatiquement (src/lib/fleet-autopilot.ts).
  // Les eleves gardent l'ecran de placement (le rituel fait partie du jeu), avec reprise et tirage au sort en un tap.
  if (evaluator.role !== "STUDENT") await ensureFleet(session.id, evaluator.id);

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
      canUnlock={incoming.length === 0}
    />
  );
}
