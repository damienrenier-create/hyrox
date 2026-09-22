export type Orientation = "horizontal" | "vertical";
export type Cell = { teamId: string; exerciseId: string };

// Composition de la flotte de reference : 3x1, 2x2, 1x3, 1x4, 1x5 (8 navires, 19 cases) — grille Pyramide 24x12.
const REFERENCE_FLEET: readonly number[] = [5, 4, 3, 2, 2, 1, 1, 1];
const MAX_FLEET_SHARE = 0.35; // une flotte n'occupe jamais plus de 35 % des cases de la grille

// La grille = equipes x ateliers de la seance en cours chez le greffier (Pyramide 24x12, Fete Foraine ~20x7,
// petite classe 8x7...). La flotte s'y adapte : aucun navire plus long que la plus grande dimension, et on retire
// les plus grands navires tant que la flotte depasse 35 % de la grille. Source unique : serveur ET client.
export function fleetFor(rows: number, cols: number): readonly number[] {
  const maxLen = Math.max(1, rows, cols);
  const cells = Math.max(1, rows * cols);
  const budget = Math.max(3, Math.floor(cells * MAX_FLEET_SHARE));
  let fleet = REFERENCE_FLEET.filter((s) => s <= maxLen); // trie decroissant conserve
  const total = (f: readonly number[]) => f.reduce((a, b) => a + b, 0);
  while (fleet.length > 1 && total(fleet) > budget) fleet = fleet.slice(1); // on sacrifie le plus grand d'abord
  return fleet.length ? fleet : [1];
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

// Placement aleatoire complet et valide d'une flotte fantome (jamais de chevauchement a l'interieur de la flotte).
// `avoid` = cases des autres flottes qu'on PREFERE eviter (pour etaler les cibles) ; si la grille est trop pleine,
// l'appelant peut rappeler sans `avoid` : les calques par arbitre autorisent le chevauchement entre flottes.
export function generateRandomFleet(
  teams: { id: string }[],
  exercises: { id: string }[],
  avoid: Set<string> = new Set(),
  sizes?: readonly number[] // par defaut la flotte complete ; sinon les seules tailles a poser (re-placement)
): GhostShip[] {
  const spec = sizes ?? fleetFor(teams.length, exercises.length);
  const occupied = new Set(avoid);
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
