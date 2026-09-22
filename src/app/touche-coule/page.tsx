import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getWodEngine } from "@/lib/wod-engines";
import { computeRefereeScore } from "@/lib/wod-engines/core/pirate-score";
import { refereeAccess } from "@/lib/referee-access";
import { listOpenSessions, openSessionsForStudent } from "@/lib/scheduling";
import { FleetPlacement } from "./FleetPlacement";
import { ToucheCouleClient } from "./client";
import type { BoardShip } from "./Board";

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-cyan-50 font-mono text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Aucune séance d'arbitrage active</h1>
          <p className="text-slate-400">Attendez que l'admin lance une séance avec le Touché-Coulé activé.</p>
        </div>
      </div>
    );
  }

  // Participant encode dans une equipe et pas inscrit arbitre par le greffier -> pas d'arbitrage.
  const access = await refereeAccess(session.id, evaluator);
  if (!access.allowed) {
    return (
      <div className="min-h-[100dvh] bg-[#062230] flex items-center justify-center p-6 text-amber-50 text-center">
        <div className="max-w-sm">
          <div className="text-5xl mb-3">{access.status === "PENDING" ? "⏳" : access.status === "REFUSED" ? "🚫" : "💪"}</div>
          <h1 className="text-xl font-black text-amber-300 mb-2">
            {access.status === "PENDING" ? "Demande en attente" : access.status === "REFUSED" ? "Demande refusée" : access.teamId ? "Tu es participant sur ce WOD" : "Autorisation nécessaire"}
          </h1>
          <p className="text-sm text-amber-100/80 mb-6">{access.reason}</p>
          <a href="/eleve" className="inline-block bg-amber-400 text-slate-950 font-black px-5 py-3 rounded-xl">← Mon espace</a>
        </div>
      </div>
    );
  }

  const rawTeams = await db.orm.public.Team.where({ sessionId: session.id }).all();
  const teams = rawTeams
    .map((t) => ({ id: t.id, name: t.name, order: t.order ?? 0 }))
    .sort((a, b) => a.order - b.order);

  const exercises = [...getWodEngine(session.wodType).exercises]
    .sort((a, b) => a.number - b.number)
    .map((e) => ({ id: e.id, label: e.label }));

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
    return <FleetPlacement evaluator={evaluator} sessionId={session.id} teams={teams} exercises={exercises} ships={myShips} />;
  }

  const myShipIds = new Set(rawShips.map((s) => s.id));
  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId: session.id }).all();
  const occupiedCells = new Set(allPlacements.filter((p) => p.shipId).map((p) => `${p.teamId}_${p.exerciseId}`));
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
  const hitsOnMyFleet = allShots.filter((s) => myCellSet.has(`${s.targetTeamId}_${s.targetExerciseId}`)).length;

  const myScore = await computeRefereeScore(session.id, evaluator.id);

  return (
    <ToucheCouleClient
      evaluator={evaluator}
      sessionId={session.id}
      teams={teams}
      exercises={exercises}
      myShips={myShips}
      myCells={myCells}
      myShots={myShots}
      hitsOnMyFleet={hitsOnMyFleet}
      raceEnded={!!session.raceEndedAt}
      myScore={myScore}
      ownTeam={access.teamId ? { id: access.teamId, name: access.teamName ?? "" } : null}
    />
  );
}
