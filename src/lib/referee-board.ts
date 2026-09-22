import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";

// Vue complete d'une seance Touche-Coule (greffier « Arbitrage », carte admin, classement des arbitres) :
// toutes les flottes, tous les tirs, toutes les evaluations, et le score pirate de chaque arbitre
// (+1 touche, +3 pour le tir qui coule, +1 par case intacte de sa flotte) calcule en une passe.

export type BoardShipData = {
  id: string;
  size: number;
  orientation: "horizontal" | "vertical";
  direction: "right" | "left" | "down" | "up" | null;
  startTeamId: string;
  startExerciseId: string;
  refereeId: string;
  refereeName: string;
  ghost: boolean;
  sunk: boolean;
};

export type ShotData = { teamId: string; exerciseId: string; refereeId: string; hit: boolean; sunk: boolean; phase: string; at: number };

export type CellSummary = { teamId: string; exerciseId: string; count: number; reps: number[]; notes: number[]; medianReps: number | null };

export type RefereeRow = {
  refereeId: string;
  name: string;
  className: string | null;
  fleetLocked: boolean;
  score: number;
  hits: number;
  sunk: number;
  misses: number;
  shots: number;
  intact: number;
  cellsTotal: number;
  shipsLost: number;
  shipsTotal: number;
};

export type BoardData = {
  sessionId: string;
  teams: { id: string; name: string }[];
  exercises: { id: string; label: string }[];
  ships: BoardShipData[];
  shots: ShotData[];
  cells: CellSummary[];
  referees: RefereeRow[];
  evaluationsCount: number;
};

const GHOST_USER_NAME = "Damien Renier";

export async function buildBoardData(sessionId: string): Promise<BoardData> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const teams = (await db.orm.public.Team.where({ sessionId }).all())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((t) => ({ id: t.id, name: t.name }));
  const exercises = exercisesFor(session).map((e) => ({ id: e.id, label: e.label }));

  const fleets = await db.orm.public.RefereeFleet.where({ sessionId }).all();
  const placements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
  const rawShots = (await db.orm.public.Shot.where({ sessionId }).all()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const evaluations = await db.orm.public.Evaluation.where({ sessionId }).all();

  // Noms
  const userIds = new Set<string>([...fleets.map((f) => f.refereeId), ...rawShots.map((s) => s.refereeId)]);
  const userById = new Map<string, { name: string; className: string | null; ghost: boolean }>();
  for (const id of userIds) {
    const u = await db.orm.public.User.where({ id }).first();
    if (u) userById.set(id, { name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.name, className: u.className ?? null, ghost: u.name === GHOST_USER_NAME });
  }

  // Navires + cases
  const shipIdByCell = new Map<string, string>();
  const cellsByShip = new Map<string, string[]>();
  placements.forEach((p) => {
    if (!p.shipId) return;
    const coord = `${p.teamId}_${p.exerciseId}`;
    shipIdByCell.set(coord, p.shipId);
    if (!cellsByShip.has(p.shipId)) cellsByShip.set(p.shipId, []);
    cellsByShip.get(p.shipId)!.push(coord);
  });

  const ships: BoardShipData[] = [];
  const fleetOfShip = new Map<string, (typeof fleets)[number]>();
  for (const f of fleets) {
    const rawShips = await db.orm.public.RefereeShip.where({ fleetId: f.id }).all();
    const u = userById.get(f.refereeId);
    for (const s of rawShips) {
      fleetOfShip.set(s.id, f);
      ships.push({
        id: s.id,
        size: s.size,
        orientation: s.orientation as "horizontal" | "vertical",
        direction: (s.direction as BoardShipData["direction"]) ?? null,
        startTeamId: s.startTeamId,
        startExerciseId: s.startExerciseId,
        refereeId: f.refereeId,
        refereeName: u?.name ?? "?",
        ghost: f.slot > 0 || !!u?.ghost,
        sunk: false,
      });
    }
  }

  // Tirs, dans l'ordre : touche / coule / a l'eau, et score par tireur
  const hitByShip = new Map<string, Set<string>>();
  const stats = new Map<string, { hits: number; sunk: number; misses: number }>();
  const bump = (id: string, k: "hits" | "sunk" | "misses") => {
    const s = stats.get(id) ?? { hits: 0, sunk: 0, misses: 0 };
    s[k]++;
    stats.set(id, s);
  };
  const shots: ShotData[] = [];
  for (const shot of rawShots) {
    const coord = `${shot.targetTeamId}_${shot.targetExerciseId}`;
    const shipId = shipIdByCell.get(coord);
    let hit = false;
    let sunk = false;
    if (shipId) {
      hit = true;
      const cells = cellsByShip.get(shipId) ?? [];
      const before = hitByShip.get(shipId) ?? new Set<string>();
      const wasSunk = cells.length > 0 && cells.every((c) => before.has(c));
      const after = new Set(before);
      after.add(coord);
      hitByShip.set(shipId, after);
      const isSunkNow = cells.every((c) => after.has(c));
      sunk = isSunkNow && !wasSunk;
      bump(shot.refereeId, "hits");
      if (sunk) bump(shot.refereeId, "sunk");
    } else {
      bump(shot.refereeId, "misses");
    }
    shots.push({ teamId: shot.targetTeamId, exerciseId: shot.targetExerciseId, refereeId: shot.refereeId, hit, sunk, phase: shot.phase, at: new Date(String(shot.createdAt)).getTime() });
  }
  for (const s of ships) {
    const cells = cellsByShip.get(s.id) ?? [];
    const h = hitByShip.get(s.id);
    s.sunk = cells.length > 0 && !!h && cells.every((c) => h.has(c));
  }

  // Classement des arbitres (flottes reelles = slot 0, fantomes exclus)
  const everShot = new Set(shots.map((s) => `${s.teamId}_${s.exerciseId}`));
  const referees: RefereeRow[] = [];
  for (const f of fleets.filter((f) => f.slot === 0)) {
    const u = userById.get(f.refereeId);
    if (u?.ghost) continue;
    const myShips = ships.filter((s) => s.refereeId === f.refereeId && fleetOfShip.get(s.id)?.id === f.id);
    const myCells = myShips.flatMap((s) => cellsByShip.get(s.id) ?? []);
    const intact = myCells.filter((c) => !everShot.has(c)).length;
    const st = stats.get(f.refereeId) ?? { hits: 0, sunk: 0, misses: 0 };
    referees.push({
      refereeId: f.refereeId,
      name: u?.name ?? "?",
      className: u?.className ?? null,
      fleetLocked: f.status === "LOCKED",
      score: st.hits + 3 * st.sunk + intact,
      hits: st.hits,
      sunk: st.sunk,
      misses: st.misses,
      shots: st.hits + st.misses,
      intact,
      cellsTotal: myCells.length,
      shipsLost: myShips.filter((s) => s.sunk).length,
      shipsTotal: myShips.length,
    });
  }
  referees.sort((a, b) => b.score - a.score || b.sunk - a.sunk || b.hits - a.hits || a.name.localeCompare(b.name));

  // Evaluations par case
  const cellMap = new Map<string, CellSummary>();
  for (const e of evaluations) {
    const key = `${e.teamId}_${e.exerciseId}`;
    if (!cellMap.has(key)) cellMap.set(key, { teamId: e.teamId, exerciseId: e.exerciseId, count: 0, reps: [], notes: [], medianReps: null });
    const c = cellMap.get(key)!;
    c.count++;
    c.reps.push(e.repsObserved);
    c.notes.push(e.note);
  }
  for (const c of cellMap.values()) {
    const sorted = [...c.reps].sort((a, b) => a - b);
    c.medianReps = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  }

  return { sessionId, teams, exercises, ships, shots, cells: [...cellMap.values()], referees, evaluationsCount: evaluations.length };
}
