import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";
import { computeCells, fleetFor, generateRandomFleet, type Orientation } from "@/lib/wod-engines/core/fleet";

// Pilote automatique des flottes : personne ne doit re-placer huit bateaux a chaque seance.
// 1) ensureFleet  : a l'arrivee sur une seance, rejoue la derniere flotte du meme type de WOD, sinon en tire
//                   une au hasard, puis VERROUILLE — l'arbitre arrive directement sur l'ecran de tir.
// 2) reconcileFleets : apres un changement de grille (equipes retirees/ajoutees), les navires hors champ ou
//                   en trop sont re-poses ailleurs au lieu de faire disparaitre la flotte.

type TeamRow = { id: string; order: number | null };
type ExRow = { id: string };

function sortTeams(teams: TeamRow[]): TeamRow[] {
  return [...teams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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

type Plan = { size: number; orientation: Orientation; direction: string | null; startTeamId: string; startExerciseId: string; cells: { teamId: string; exerciseId: string }[] };

// Positions de la derniere flotte verrouillee de cet arbitre sur une autre seance du MEME type de WOD,
// reportees par INDEX (les identifiants d'equipe changent d'une seance a l'autre). null si rien ne rentre.
async function planFromLastFleet(sessionId: string, refereeId: string, wodType: string, teams: TeamRow[], exercises: ExRow[]): Promise<Plan[] | null> {
  const spec = fleetFor(teams.length, exercises.length);
  const fleets = (await db.orm.public.RefereeFleet.where({ refereeId, slot: 0, status: "LOCKED" }).all())
    .filter((f) => f.sessionId !== sessionId)
    .sort((a, b) => String(b.lockedAt ?? b.createdAt).localeCompare(String(a.lockedAt ?? a.createdAt)));

  for (const f of fleets) {
    const src = await db.orm.public.Session.where({ id: f.sessionId }).first();
    if (!src || src.wodType !== wodType) continue; // une flotte Pyramide ne se rejoue pas sur une Fete Foraine
    const srcTeams = sortTeams(await db.orm.public.Team.where({ sessionId: f.sessionId }).all());
    const srcEx = exercisesFor(src);
    const ships = await db.orm.public.RefereeShip.where({ fleetId: f.id }).all();
    if (remainingSizes(spec, ships.map((s) => s.size)).length || ships.length !== spec.length) continue;

    const taken = new Set<string>();
    const plans: Plan[] = [];
    let ok = true;
    for (const s of ships) {
      const ti = srcTeams.findIndex((t) => t.id === s.startTeamId);
      const ei = srcEx.findIndex((e) => e.id === s.startExerciseId);
      if (ti === -1 || ei === -1 || !teams[ti] || !exercises[ei]) { ok = false; break; }
      const cells = computeCells(teams, exercises, s.size, s.orientation as Orientation, teams[ti].id, exercises[ei].id);
      if (!cells || cells.some((c) => taken.has(`${c.teamId}_${c.exerciseId}`))) { ok = false; break; }
      cells.forEach((c) => taken.add(`${c.teamId}_${c.exerciseId}`));
      plans.push({ size: s.size, orientation: s.orientation as Orientation, direction: s.direction ?? null, startTeamId: teams[ti].id, startExerciseId: exercises[ei].id, cells });
    }
    if (ok) return plans;
  }
  return null;
}

function randomPlans(teams: TeamRow[], exercises: ExRow[], sizes: readonly number[], avoid: Set<string>): Plan[] {
  const ships = generateRandomFleet(teams, exercises, avoid, sizes);
  return ships.map((s) => ({
    size: s.size,
    orientation: s.orientation,
    direction: s.orientation === "horizontal" ? (Math.random() < 0.5 ? "right" : "left") : Math.random() < 0.5 ? "down" : "up",
    startTeamId: s.startTeamId,
    startExerciseId: s.startExerciseId,
    cells: s.cells,
  }));
}

export type EnsureFleetResult = { created: false } | { created: true; source: "reprise" | "aleatoire"; ships: number };

// Appele a l'ouverture du Touche-Coule : garantit une flotte complete et VERROUILLEE, sans aucun clic.
export async function ensureFleet(sessionId: string, refereeId: string): Promise<EnsureFleetResult> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { created: false };
  const existing = await db.orm.public.RefereeFleet.where({ sessionId, refereeId, slot: 0 }).first();
  if (existing) {
    const ships = await db.orm.public.RefereeShip.where({ fleetId: existing.id }).all();
    if (ships.length) return { created: false }; // flotte en cours de placement ou deja verrouillee : on n'y touche pas
  }

  const teams = sortTeams(await db.orm.public.Team.where({ sessionId }).all());
  const exercises = exercisesFor(session);
  if (!teams.length || !exercises.length) return { created: false };
  const spec = fleetFor(teams.length, exercises.length);

  let plans = await planFromLastFleet(sessionId, refereeId, session.wodType, teams, exercises);
  const source: "reprise" | "aleatoire" = plans ? "reprise" : "aleatoire";
  if (!plans) {
    try {
      plans = randomPlans(teams, exercises, spec, new Set());
    } catch {
      return { created: false }; // grille trop petite : on laisse l'ecran de placement manuel
    }
  }

  try {
    await db.transaction(async (tx) => {
      const fleet = existing ?? (await tx.orm.public.RefereeFleet.create({ sessionId, refereeId, slot: 0, status: "PLACING" }));
      for (const p of plans!) {
        const ship = await tx.orm.public.RefereeShip.create({
          fleetId: fleet.id,
          size: p.size,
          orientation: p.orientation,
          direction: p.direction,
          startTeamId: p.startTeamId,
          startExerciseId: p.startExerciseId,
        });
        for (const c of p.cells) {
          await tx.orm.public.BoatPlacement.create({ sessionId, teamId: c.teamId, exerciseId: c.exerciseId, ownerId: refereeId, shipId: ship.id });
        }
      }
      await tx.orm.public.RefereeFleet.where({ id: fleet.id }).update({ status: "LOCKED", lockedAt: Temporal.Now.instant() });
    });
  } catch {
    return { created: false }; // deux onglets en meme temps : l'autre a gagne, la flotte existe
  }
  return { created: true, source, ships: plans.length };
}

export type ReconcileResult = { fleets: number; movedShips: number };

// Apres un changement de grille : les navires hors champ (equipe supprimee) ou en trop par rapport a la
// nouvelle flotte de reference sont retires puis RE-POSES ailleurs, au hasard, dans la grille restante.
export async function reconcileFleets(sessionId: string): Promise<ReconcileResult> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { fleets: 0, movedShips: 0 };
  const teams = sortTeams(await db.orm.public.Team.where({ sessionId }).all());
  const exercises = exercisesFor(session);
  const spec = fleetFor(teams.length, exercises.length);
  const teamIds = new Set(teams.map((t) => t.id));
  const exIds = new Set(exercises.map((e) => e.id));

  const fleets = await db.orm.public.RefereeFleet.where({ sessionId }).all();
  let touched = 0;
  let moved = 0;

  for (const fleet of fleets) {
    const ships = await db.orm.public.RefereeShip.where({ fleetId: fleet.id }).all();
    const allPlacements = await db.orm.public.BoatPlacement.where({ sessionId }).all();
    const cellsOf = (shipId: string) => allPlacements.filter((p) => p.shipId === shipId);

    // Un navire reste en place s'il tient encore entierement dans la grille.
    const keep: typeof ships = [];
    const drop: typeof ships = [];
    for (const s of ships) {
      const inGrid = teamIds.has(s.startTeamId) && exIds.has(s.startExerciseId)
        && !!computeCells(teams, exercises, s.size, s.orientation as Orientation, s.startTeamId, s.startExerciseId)
        && cellsOf(s.id).every((c) => teamIds.has(c.teamId) && exIds.has(c.exerciseId));
      (inGrid ? keep : drop).push(s);
    }
    // Les navires trop nombreux / trop grands pour la nouvelle flotte de reference sont retires aussi.
    const allowed = [...spec];
    const kept: typeof ships = [];
    for (const s of [...keep].sort((a, b) => b.size - a.size)) {
      const i = allowed.indexOf(s.size);
      if (i !== -1) { allowed.splice(i, 1); kept.push(s); } else drop.push(s);
    }
    if (!drop.length && !allowed.length) continue;

    for (const s of drop) await db.orm.public.RefereeShip.where({ id: s.id }).delete(); // cascade sur les cases
    const occupied = new Set(
      (await db.orm.public.BoatPlacement.where({ sessionId }).all())
        .filter((p) => p.shipId && kept.some((k) => k.id === p.shipId))
        .map((p) => `${p.teamId}_${p.exerciseId}`)
    );
    const missing = allowed; // tailles a re-poser (celles des navires retires + celles qui manquaient)
    if (missing.length) {
      let plans: Plan[] = [];
      try {
        plans = randomPlans(teams, exercises, missing, occupied);
      } catch {
        plans = []; // grille saturee : la flotte reste incomplete plutot que de disparaitre
      }
      for (const p of plans) {
        const ship = await db.orm.public.RefereeShip.create({
          fleetId: fleet.id,
          size: p.size,
          orientation: p.orientation,
          direction: p.direction,
          startTeamId: p.startTeamId,
          startExerciseId: p.startExerciseId,
        });
        for (const c of p.cells) {
          await db.orm.public.BoatPlacement.create({ sessionId, teamId: c.teamId, exerciseId: c.exerciseId, ownerId: fleet.refereeId, shipId: ship.id });
        }
        moved++;
      }
    }
    touched++;
  }
  return { fleets: touched, movedShips: moved };
}
