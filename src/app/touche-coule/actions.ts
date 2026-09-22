"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWodEngine } from "@/lib/wod-engines";
import { fleetFor, computeCells, generateRandomFleet, Orientation } from "@/lib/wod-engines/core/fleet";

async function loadContext(sessionId: string) {
  const evaluator = await getSession();
  if (!evaluator) throw new Error("Non authentifié.");

  // Pas de filtre isActive : la fin du WOD (raceEndedAt) change la phase d'un tir, elle ne coupe pas l'acces (§28).
  const session = await db.orm.public.Session.where({ id: sessionId, refereeMode: true }).first();
  if (!session) throw new Error("Session introuvable ou arbitrage désactivé pour cette séance.");

  const teams = (await db.orm.public.Team.where({ sessionId }).all()) as { id: string; order: number | null }[];
  teams.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const exercises = [...getWodEngine(session.wodType).exercises].sort((a, b) => a.number - b.number);

  return { evaluator, session, teams, exercises };
}

export async function placeShipAction(
  sessionId: string,
  orientation: Orientation,
  startTeamId: string,
  startExerciseId: string
): Promise<{ error: string } | { ok: true }> {
  const { evaluator, teams, exercises } = await loadContext(sessionId);

  const existingFleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (existingFleet?.status === "LOCKED") return { error: "Ta flotte est déjà verrouillée." };

  const spec = fleetFor(teams.length, exercises.length);
  const placedShips = existingFleet
    ? await db.orm.public.RefereeShip.where({ fleetId: existingFleet.id }).all()
    : [];
  const shipIndex = placedShips.length;
  if (shipIndex >= spec.length) return { error: "Ta flotte est déjà complète." };
  const size = spec[shipIndex];

  const cells = computeCells(teams, exercises, size, orientation, startTeamId, startExerciseId);
  if (!cells) return { error: "Ce placement dépasse la grille." };

  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
  const occupied = new Set(allPlacements.map((p) => `${p.teamId}_${p.exerciseId}`));
  if (cells.some((c) => occupied.has(`${c.teamId}_${c.exerciseId}`))) {
    return { error: "Un autre navire occupe déjà une de ces cases." };
  }

  await db.transaction(async (tx) => {
    const fleet =
      existingFleet ??
      (await tx.orm.public.RefereeFleet.create({ sessionId, refereeId: evaluator.id, slot: 0, status: "PLACING" }));

    const ship = await tx.orm.public.RefereeShip.create({
      fleetId: fleet.id,
      size,
      orientation,
      startTeamId,
      startExerciseId,
    });

    for (const cell of cells) {
      await tx.orm.public.BoatPlacement.create({
        sessionId,
        teamId: cell.teamId,
        exerciseId: cell.exerciseId,
        ownerId: evaluator.id,
        shipId: ship.id,
      });
    }
  });

  return { ok: true };
}

export async function undoLastShipAction(sessionId: string): Promise<{ error: string } | { ok: true }> {
  const evaluator = await getSession();
  if (!evaluator) throw new Error("Non authentifié.");

  const fleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (!fleet || fleet.status === "LOCKED") return { error: "Rien à annuler." };

  const ships = await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).orderBy((s) => s.createdAt.asc()).all();
  if (!ships.length) return { error: "Rien à annuler." };

  const last = ships[ships.length - 1];
  await db.orm.public.RefereeShip.where({ id: last.id }).delete(); // cascade sur BoatPlacement
  return { ok: true };
}

export async function lockFleetAction(sessionId: string): Promise<{ error: string } | { ok: true }> {
  const { evaluator, teams, exercises } = await loadContext(sessionId);

  const fleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (!fleet) return { error: "Place d'abord ta flotte." };
  if (fleet.status === "LOCKED") return { ok: true };

  const spec = fleetFor(teams.length, exercises.length);
  const ships = await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).all();
  if (ships.length < spec.length) {
    return { error: `Il manque ${spec.length - ships.length} navire(s) avant de verrouiller.` };
  }

  await db.orm.public.RefereeFleet
    .where({ id: fleet.id })
    .update({ status: "LOCKED", lockedAt: Temporal.Now.instant() });

  return { ok: true };
}

// ===== Phase 4-5 : évaluation (reps + qualité) -> tir, atomique, verifie serveur =====

const VALID_NOTES = [-1, 0, 3, 4, 5]; // TI, I, S, B, TB

export type EvaluationResult =
  | { error: string }
  | {
      ok: true;
      phase: "DURING_WOD" | "POST_WOD";
      hits: { refereeId: string; refereeName: string; shipId: string; sunk: boolean }[];
    };

export async function submitEvaluationAction(
  sessionId: string,
  targetTeamId: string,
  targetExerciseId: string,
  reps: number,
  note: number
): Promise<EvaluationResult> {
  const { evaluator, session, teams, exercises } = await loadContext(sessionId);

  if (!teams.some((t) => t.id === targetTeamId)) return { error: "Équipe invalide pour cette séance." };
  if (!exercises.some((e) => e.id === targetExerciseId)) return { error: "Exercice invalide pour cette séance." };
  if (!Number.isInteger(reps) || reps < 0 || reps > 999) return { error: "Répétitions invalides." };
  if (!VALID_NOTES.includes(note)) return { error: "Appréciation invalide." };

  // Prérequis absolu (§9-10) : flotte placée ET verrouillée, verifie cote serveur.
  const fleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (!fleet || fleet.status !== "LOCKED") {
    return { error: "Place et verrouille ta flotte avant de pouvoir arbitrer." };
  }

  // Règle d'or (§12) : jamais tirer sur sa propre flotte, verifie cote serveur.
  const myShips = await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).all();
  const myShipIds = new Set(myShips.map((s) => s.id));
  const cellPlacements = await db.orm.public.BoatPlacement.where({
    sessionId,
    teamId: targetTeamId,
    exerciseId: targetExerciseId,
  }).all();
  if (cellPlacements.some((p) => p.shipId && myShipIds.has(p.shipId))) {
    return { error: "Tu ne peux pas tirer sur ta propre flotte." };
  }

  // Phase liee a l'etat reel de la session, jamais a une valeur envoyee par le client (§8).
  const phase: "DURING_WOD" | "POST_WOD" = session.raceEndedAt ? "POST_WOD" : "DURING_WOD";

  // Evaluation + Tir crees dans la meme transaction : jamais l'un sans l'autre (§26).
  await db.transaction(async (tx) => {
    const evaluation = await tx.orm.public.Evaluation.create({
      sessionId,
      teamId: targetTeamId,
      exerciseId: targetExerciseId,
      evaluatorId: evaluator.id,
      repsObserved: reps,
      note,
      isValidated: true,
    });
    await tx.orm.public.Shot.create({
      sessionId,
      refereeId: evaluator.id,
      targetTeamId,
      targetExerciseId,
      evaluationId: evaluation.id,
      phase,
    });
  });

  // Resolution des bateaux touches (le mien est deja exclu ci-dessus).
  const hitShipIds = [...new Set(cellPlacements.filter((p) => p.shipId).map((p) => p.shipId as string))];
  const allShots = await db.orm.public.Shot.where({ sessionId }).all();
  const shotCells = new Set(allShots.map((s) => `${s.targetTeamId}_${s.targetExerciseId}`));

  const hits: { refereeId: string; refereeName: string; shipId: string; sunk: boolean }[] = [];
  for (const shipId of hitShipIds) {
    const ship = await db.orm.public.RefereeShip.where({ id: shipId }).first();
    if (!ship) continue;
    const ownerFleet = await db.orm.public.RefereeFleet.where({ id: ship.fleetId }).first();
    if (!ownerFleet) continue;
    const owner = await db.orm.public.User.where({ id: ownerFleet.refereeId }).first();
    const shipCells = await db.orm.public.BoatPlacement.where({ shipId }).all();
    const sunk = shipCells.every((c) => shotCells.has(`${c.teamId}_${c.exerciseId}`));
    hits.push({ refereeId: ownerFleet.refereeId, refereeName: owner?.name ?? "?", shipId, sunk });
  }

  return { ok: true, phase, hits };
}

// ===== Flottes fantômes (§1, §16-17) : générées par un admin/greffier, portées par le vrai
// utilisateur système "Damien Renier" (importé depuis la liste des élèves, ligne PROF). =====

const GHOST_USER_NAME = "Damien Renier";

export async function generateGhostFleetsAction(
  sessionId: string,
  count: number = 2
): Promise<{ error: string } | { ok: true; created: number }> {
  const evaluator = await getSession();
  if (!evaluator || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(evaluator.role)) {
    return { error: "Droits insuffisants." };
  }

  const session = await db.orm.public.Session.where({ id: sessionId, refereeMode: true }).first();
  if (!session) return { error: "Séance introuvable ou arbitrage désactivé." };

  const teams = (await db.orm.public.Team.where({ sessionId }).all()) as { id: string; order: number | null }[];
  teams.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const exercises = [...getWodEngine(session.wodType).exercises].sort((a, b) => a.number - b.number);

  const ghost = await db.orm.public.User.where({ name: GHOST_USER_NAME }).first();
  if (!ghost) {
    return { error: `Utilisateur système "${GHOST_USER_NAME}" introuvable — réimporte la liste des élèves (ligne PROF).` };
  }

  const existingGhostFleets = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: ghost.id }).all();
  const usedSlots = new Set(existingGhostFleets.map((f) => f.slot));

  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
  const occupied = new Set(allPlacements.map((p) => `${p.teamId}_${p.exerciseId}`));

  let created = 0;
  let slot = 1;
  while (created < count && slot < 100) {
    if (usedSlots.has(slot)) {
      slot++;
      continue;
    }

    const ships = generateRandomFleet(teams, exercises, occupied);

    await db.transaction(async (tx) => {
      const fleet = await tx.orm.public.RefereeFleet.create({
        sessionId,
        refereeId: ghost.id,
        slot,
        status: "LOCKED",
        lockedAt: Temporal.Now.instant(),
      });
      for (const s of ships) {
        const ship = await tx.orm.public.RefereeShip.create({
          fleetId: fleet.id,
          size: s.size,
          orientation: s.orientation,
          startTeamId: s.startTeamId,
          startExerciseId: s.startExerciseId,
        });
        for (const c of s.cells) {
          await tx.orm.public.BoatPlacement.create({
            sessionId,
            teamId: c.teamId,
            exerciseId: c.exerciseId,
            ownerId: ghost.id,
            shipId: ship.id,
          });
          occupied.add(`${c.teamId}_${c.exerciseId}`);
        }
      }
    });

    created++;
    slot++;
  }

  return { ok: true, created };
}
