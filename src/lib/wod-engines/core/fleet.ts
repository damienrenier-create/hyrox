export type Orientation = "horizontal" | "vertical";
export type Cell = { teamId: string; exerciseId: string };

// Composition de la flotte de reference : 3x1, 2x2, 1x3, 1x4, 1x5 (8 navires, 19 cases).
// Valable pour la grille Hyrox actuelle (12 exercices fixes, 15 a 25 equipes).
// Point unique a adapter si une grille de forme tres differente apparait avec un futur cycle/seance.
const REFERENCE_FLEET: readonly number[] = [5, 4, 3, 2, 2, 1, 1, 1];

export function fleetFor(rows: number, cols: number): readonly number[] {
  return REFERENCE_FLEET;
}

export function computeCells(
  teams: { id: string }[],
  exercises: { id: string }[],
  size: number,
  orientation: Orientation,
  startTeamId: string,
  startExerciseId: string
): Cell[] | null {
  const tIdx = teams.findIndex((t) => t.id === startTeamId);
  const eIdx = exercises.findIndex((e) => e.id === startExerciseId);
  if (tIdx === -1 || eIdx === -1) return null;

  const cells: Cell[] = [];
  if (orientation === "horizontal") {
    if (eIdx + size > exercises.length) return null;
    for (let i = 0; i < size; i++) cells.push({ teamId: teams[tIdx].id, exerciseId: exercises[eIdx + i].id });
  } else {
    if (tIdx + size > teams.length) return null;
    for (let i = 0; i < size; i++) cells.push({ teamId: teams[tIdx + i].id, exerciseId: exercises[eIdx].id });
  }
  return cells;
}

export type GhostShip = {
  size: number;
  orientation: Orientation;
  startTeamId: string;
  startExerciseId: string;
  cells: Cell[];
};

// Placement aleatoire complet et valide (sans chevauchement) pour une flotte fantome.
// alreadyOccupied doit contenir toutes les cases deja prises par n'importe quelle autre flotte de la session.
export function generateRandomFleet(
  teams: { id: string }[],
  exercises: { id: string }[],
  alreadyOccupied: Set<string> = new Set()
): GhostShip[] {
  const spec = fleetFor(teams.length, exercises.length);
  const occupied = new Set(alreadyOccupied);
  const ships: GhostShip[] = [];

  for (const size of spec) {
    let placed = false;
    for (let attempts = 0; attempts < 500 && !placed; attempts++) {
      const orientation: Orientation = Math.random() > 0.5 ? "horizontal" : "vertical";
      const team = teams[Math.floor(Math.random() * teams.length)];
      const exercise = exercises[Math.floor(Math.random() * exercises.length)];
      const cells = computeCells(teams, exercises, size, orientation, team.id, exercise.id);
      if (!cells || cells.some((c) => occupied.has(`${c.teamId}_${c.exerciseId}`))) continue;

      cells.forEach((c) => occupied.add(`${c.teamId}_${c.exerciseId}`));
      ships.push({ size, orientation, startTeamId: team.id, startExerciseId: exercise.id, cells });
      placed = true;
    }
    if (!placed) {
      throw new Error("Impossible de placer une flotte fantôme complète : la grille est trop occupée.");
    }
  }
  return ships;
}
