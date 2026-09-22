import { db } from "@/lib/db";

// Scoring du jeu Touché-Coulé lui-meme (independant de la fiabilite d'arbitrage) :
// +1 par touche, +3 pour le tir qui coule un navire, +1 par case de sa propre flotte jamais touchee.
// Calcule a la volee depuis Postgres (source de verite) plutot que stocke, vu le faible volume par seance.
export async function computeRefereeScore(sessionId: string, refereeId: string): Promise<number> {
  const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
  const shipIdByCell = new Map<string, string>();
  allPlacements.forEach((p) => {
    if (p.shipId) shipIdByCell.set(`${p.teamId}_${p.exerciseId}`, p.shipId);
  });

  const allShots = await db.orm.public.Shot.where({ sessionId }).all();
  if (!allShots.length) return await intactBonus(sessionId, refereeId, allPlacements, new Set());

  const sortedShots = [...allShots].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const shipCells = new Map<string, string[]>();
  for (const [coord, shipId] of shipIdByCell) {
    if (!shipCells.has(shipId)) shipCells.set(shipId, []);
    shipCells.get(shipId)!.push(coord);
  }

  const hitSoFarByShip = new Map<string, Set<string>>();
  let score = 0;

  for (const shot of sortedShots) {
    const coord = `${shot.targetTeamId}_${shot.targetExerciseId}`;
    const shipId = shipIdByCell.get(coord);
    if (!shipId) continue; // case vide : tir manque, aucun point

    const cells = shipCells.get(shipId) ?? [];
    const before = hitSoFarByShip.get(shipId) ?? new Set<string>();
    const wasSunk = cells.length > 0 && cells.every((c) => before.has(c));

    if (shot.refereeId === refereeId) {
      score += 1; // touche
      const after = new Set(before);
      after.add(coord);
      const isSunkNow = cells.every((c) => after.has(c));
      if (isSunkNow && !wasSunk) score += 3; // ce tir precis vient de couler le navire
    }

    const after = hitSoFarByShip.get(shipId) ?? new Set<string>();
    after.add(coord);
    hitSoFarByShip.set(shipId, after);
  }

  const everShot = new Set(allShots.map((s) => `${s.targetTeamId}_${s.targetExerciseId}`));
  return score + (await intactBonus(sessionId, refereeId, allPlacements, everShot));
}

type Placement = { teamId: string; exerciseId: string; shipId: string | null };

async function intactBonus(
  sessionId: string,
  refereeId: string,
  allPlacements: Placement[],
  everShot: Set<string>
): Promise<number> {
  const myFleet = await db.orm.public.RefereeFleet.where({ sessionId, refereeId, slot: 0 }).first();
  if (!myFleet) return 0;
  const myShips = await db.orm.public.RefereeShip.where({ fleetId: myFleet.id }).all();
  const myShipIds = new Set(myShips.map((s) => s.id));
  const myCells = allPlacements
    .filter((p) => p.shipId && myShipIds.has(p.shipId))
    .map((p) => `${p.teamId}_${p.exerciseId}`);
  return myCells.filter((c) => !everShot.has(c)).length;
}
