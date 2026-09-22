import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getWodEngine } from "@/lib/wod-engines";
import { computeRefereeScore } from "@/lib/wod-engines/core/pirate-score";
import { FleetPlacement } from "./FleetPlacement";
import { ToucheCouleClient } from "./client";

export default async function ToucheCoulePage() {
  const evaluator = await getSession();
  if (!evaluator) {
    redirect("/");
  }

  // Pas de filtre isActive : la fin du WOD ne coupe pas l'acces au Touché-Coulé (§28) — elle ne fait
  // que faire basculer les tirs suivants en POST_WOD (voir touche-coule/actions.ts).
  const session = await db.orm.public.Session
    .where({ refereeMode: true })
    .orderBy((s) => s.createdAt.desc())
    .first();

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
  const ships = fleet ? await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).all() : [];

  if (!fleet || fleet.status !== "LOCKED") {
    return (
      <FleetPlacement
        evaluator={evaluator}
        sessionId={session.id}
        teams={teams}
        exercises={exercises}
        ships={ships.map((s) => ({
          id: s.id,
          size: s.size,
          orientation: s.orientation as "horizontal" | "vertical",
          startTeamId: s.startTeamId,
          startExerciseId: s.startExerciseId,
        }))}
      />
    );
  }

  const myShipIds = new Set(ships.map((s) => s.id));
  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId: session.id }).all();
  const myCells = allPlacements
    .filter((p) => p.shipId && myShipIds.has(p.shipId))
    .map((p) => `${p.teamId}_${p.exerciseId}`);

  const myScore = await computeRefereeScore(session.id, evaluator.id);

  return (
    <ToucheCouleClient
      evaluator={evaluator}
      sessionId={session.id}
      teams={teams}
      exercises={exercises}
      myCells={myCells}
      myScore={myScore}
    />
  );
}
