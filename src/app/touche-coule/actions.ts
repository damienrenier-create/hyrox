"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { exercisesFor } from "@/lib/session-exercises";
import { fleetFor, computeCells, generateRandomFleet, Orientation } from "@/lib/wod-engines/core/fleet";
import { QUALITY_VALUES } from "@/lib/wod-engines/core/quality";
import { refereeAccess } from "@/lib/referee-access";

export type Direction = "right" | "left" | "down" | "up";

async function loadContext(sessionId: string) {
  const evaluator = await getSession();
  if (!evaluator) throw new Error("Non authentifié.");

  // Pas de filtre isActive : la fin du WOD (raceEndedAt) change la phase d'un tir, elle ne coupe pas l'acces (§28).
  const session = await db.orm.public.Session.where({ id: sessionId, refereeMode: true }).first();
  if (!session) throw new Error("Session introuvable ou arbitrage désactivé pour cette séance.");

  // Un participant (encode dans une equipe) n'arbitre pas, sauf si le greffier l'a inscrit comme arbitre (DNF...).
  const access = await refereeAccess(sessionId, evaluator);
  if (!access.allowed) throw new Error(access.reason ?? "Accès à l'arbitrage refusé.");

  const teams = (await db.orm.public.Team.where({ sessionId }).all()) as { id: string; order: number | null }[];
  teams.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const exercises = exercisesFor(session);

  return { evaluator, session, teams, exercises, access };
}

// Inventaire restant = flotte de reference moins les tailles deja posees (multiset).
function remainingSizes(spec: readonly number[], placed: number[]): number[] {
  const rest = [...spec];
  for (const s of placed) {
    const i = rest.indexOf(s);
    if (i !== -1) rest.splice(i, 1);
  }
  return rest;
}

export type PlaceShipResult =
  | { error: string }
  | { ok: true; shipId: string; size: number; orientation: Orientation; direction: Direction; startTeamId: string; startExerciseId: string };

// Placement en deux touches : premiere case = poupe, derniere case = proue.
// La taille est deduite de la distance ; la direction (sens de la proue) est conservee pour l'affichage.
export async function placeShipAction(
  sessionId: string,
  fromTeamId: string,
  fromExerciseId: string,
  toTeamId: string,
  toExerciseId: string
): Promise<PlaceShipResult> {
  const { evaluator, teams, exercises } = await loadContext(sessionId);

  const existingFleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (existingFleet?.status === "LOCKED") return { error: "Ta flotte est déjà verrouillée." };

  const tFrom = teams.findIndex((t) => t.id === fromTeamId);
  const eFrom = exercises.findIndex((e) => e.id === fromExerciseId);
  const tTo = teams.findIndex((t) => t.id === toTeamId);
  const eTo = exercises.findIndex((e) => e.id === toExerciseId);
  if (tFrom === -1 || eFrom === -1 || tTo === -1 || eTo === -1) return { error: "Case inconnue." };

  let orientation: Orientation;
  let direction: Direction;
  let size: number;
  if (tFrom === tTo) {
    orientation = "horizontal";
    size = Math.abs(eTo - eFrom) + 1;
    direction = eTo >= eFrom ? "right" : "left";
  } else if (eFrom === eTo) {
    orientation = "vertical";
    size = Math.abs(tTo - tFrom) + 1;
    direction = tTo >= tFrom ? "down" : "up";
  } else {
    return { error: "Les deux cases doivent être sur la même ligne ou la même colonne (pas de diagonale)." };
  }

  const spec = fleetFor(teams.length, exercises.length);
  const placedShips = existingFleet ? await db.orm.public.RefereeShip.where({ fleetId: existingFleet.id }).all() : [];
  const remaining = remainingSizes(spec, placedShips.map((s) => s.size));
  if (!remaining.includes(size)) {
    return {
      error: remaining.length
        ? `Aucun navire de ${size} case${size > 1 ? "s" : ""} disponible. Il reste : ${remaining.join(" · ")}.`
        : "Ta flotte est déjà complète.",
    };
  }

  // Point de depart canonique (index le plus petit) : computeCells etend vers la droite / le bas.
  const startTeamId = teams[Math.min(tFrom, tTo)].id;
  const startExerciseId = exercises[Math.min(eFrom, eTo)].id;
  const cells = computeCells(teams, exercises, size, orientation, startTeamId, startExerciseId);
  if (!cells) return { error: "Ce placement dépasse la grille." };

  // Calques par arbitre : seul le chevauchement avec SA propre flotte est interdit. Les flottes des autres
  // restent invisibles (aucun refus ne doit reveler ou elles sont) et la capacite ne depend plus du nombre d'arbitres.
  const myShipIds = new Set(placedShips.map((s) => s.id));
  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
  const mine = new Set(allPlacements.filter((p) => p.shipId && myShipIds.has(p.shipId)).map((p) => `${p.teamId}_${p.exerciseId}`));
  if (cells.some((c) => mine.has(`${c.teamId}_${c.exerciseId}`))) {
    return { error: "Un de tes navires occupe déjà une de ces cases." };
  }

  let shipId = "";
  await db.transaction(async (tx) => {
    const fleet =
      existingFleet ??
      (await tx.orm.public.RefereeFleet.create({ sessionId, refereeId: evaluator.id, slot: 0, status: "PLACING" }));

    const ship = await tx.orm.public.RefereeShip.create({
      fleetId: fleet.id,
      size,
      orientation,
      direction,
      startTeamId,
      startExerciseId,
    });
    shipId = ship.id;

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

  return { ok: true, shipId, size, orientation, direction, startTeamId, startExerciseId };
}

// Supprime n'importe quel navire de SA flotte tant qu'elle n'est pas verrouillee (la taille revient dans l'inventaire).
export async function deleteShipAction(sessionId: string, shipId: string): Promise<{ error: string } | { ok: true }> {
  const evaluator = await getSession();
  if (!evaluator) throw new Error("Non authentifié.");

  const fleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (!fleet) return { error: "Aucune flotte." };
  if (fleet.status === "LOCKED") return { error: "Flotte verrouillée : impossible de modifier." };

  const ship = await db.orm.public.RefereeShip.where({ id: shipId }).first();
  if (!ship || ship.fleetId !== fleet.id) return { error: "Ce navire n'est pas dans ta flotte." };

  await db.orm.public.RefereeShip.where({ id: ship.id }).delete(); // cascade sur BoatPlacement
  return { ok: true };
}

export async function lockFleetAction(sessionId: string): Promise<{ error: string } | { ok: true }> {
  const { evaluator, teams, exercises } = await loadContext(sessionId);

  const fleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: evaluator.id, slot: 0 }).first();
  if (!fleet) return { error: "Place d'abord ta flotte." };
  if (fleet.status === "LOCKED") return { ok: true };

  const spec = fleetFor(teams.length, exercises.length);
  const ships = await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).all();
  const remaining = remainingSizes(spec, ships.map((s) => s.size));
  if (remaining.length) {
    return { error: `Il manque encore : ${remaining.join(" · ")} (taille des navires à placer).` };
  }

  await db.orm.public.RefereeFleet
    .where({ id: fleet.id })
    .update({ status: "LOCKED", lockedAt: Temporal.Now.instant() });

  return { ok: true };
}

// ===== Phase 4-5 : évaluation (reps + qualité) -> tir, atomique, verifie serveur =====

const VALID_NOTES = QUALITY_VALUES; // TI, I, S, B, TB, E — echelle partagee avec l'auto-evaluation

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
  const { evaluator, session, teams, exercises, access } = await loadContext(sessionId);

  if (!teams.some((t) => t.id === targetTeamId)) return { error: "Équipe invalide pour cette séance." };
  if (!exercises.some((e) => e.id === targetExerciseId)) return { error: "Exercice invalide pour cette séance." };
  // Un arbitre issu d'une equipe (DNF, blessure) n'evalue jamais sa propre equipe.
  if (access.teamId === targetTeamId) return { error: `Tu ne peux pas arbitrer ta propre équipe (${access.teamName}).` };
  if (!Number.isInteger(reps) || reps < 0 || reps > 999) return { error: "Répétitions invalides." };
  if (!VALID_NOTES.includes(note)) return { error: "Appréciation invalide." };

  // Une seule evaluation par case et par arbitre : sinon on pourrait marteler une case ou un bateau
  // est connu pour encaisser des points, et chaque tap polluerait les reps de l'equipe.
  // La contrainte @@unique sur Shot fait foi ; ce test sert a rendre un message lisible.
  const alreadyShot = await db.orm.public.Shot.where({
    sessionId,
    refereeId: evaluator.id,
    targetTeamId,
    targetExerciseId,
  }).first();
  if (alreadyShot) return { error: "Tu as déjà évalué cette case : une seule évaluation par équipe et par atelier." };

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
  const exercises = exercisesFor(session);

  const ghost = await db.orm.public.User.where({ name: GHOST_USER_NAME }).first();
  if (!ghost) {
    return { error: `Utilisateur système "${GHOST_USER_NAME}" introuvable — réimporte la liste des élèves (ligne PROF).` };
  }

  const existingGhostFleets = await db.orm.public.RefereeFleet.where({ sessionId, refereeId: ghost.id }).all();
  const usedSlots = new Set(existingGhostFleets.map((f) => f.slot));

  // On prefere etaler les fantomes sur des cases libres ; si la grille est petite (peu d'equipes / d'ateliers),
  // on accepte le chevauchement avec les autres flottes (calques par arbitre).
  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
  const occupied = new Set(allPlacements.map((p) => `${p.teamId}_${p.exerciseId}`));

  let created = 0;
  let slot = 1;
  while (created < count && slot < 100) {
    if (usedSlots.has(slot)) {
      slot++;
      continue;
    }

    let ships;
    try {
      ships = generateRandomFleet(teams, exercises, occupied);
    } catch {
      ships = generateRandomFleet(teams, exercises);
    }

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
          direction: s.orientation === "horizontal" ? (Math.random() < 0.5 ? "right" : "left") : Math.random() < 0.5 ? "down" : "up",
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
