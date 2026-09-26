import { db } from "@/lib/db";
import { isScheduled, toMs } from "@/lib/scheduling";

// Remise a zero et nettoyage des donnees de test.
// Regle absolue : on ne touche JAMAIS a la liste des eleves. La programmation (cycles, seances-types,
// creneaux) est gardee par defaut et ne part QUE sur `resetProgramme`, une remise a blanc avant lancement.
// Les suppressions respectent l'ordre des cles etrangeres, et `.delete()` ne supprimant
// qu'une ligne a la fois, chaque lot est parcouru.

async function deleteAll<T extends { id: string }>(rows: T[], del: (id: string) => Promise<unknown>) {
  for (const r of rows) await del(r.id);
  return rows.length;
}

// ===== Remise a zero de la course d'une seance (elle redevient « pas commencee ») =====
export type ResetOptions = {
  clearReferees?: boolean; // vider aussi l'arbitrage : flottes, tirs, evaluations
  keepFleets?: boolean; // avec clearReferees : tirs et evaluations effaces, mais les flottes placees restent
  clearMembers?: boolean; // vider aussi la composition des equipes
};
export type ResetResult = { laps: number; cards: number; pauses: number; stations: number; evaluations: number; shots: number; fleets: number; placements: number; members: number };

export async function resetRace(sessionId: string, opts: ResetOptions = {}): Promise<{ error: string } | { ok: true; deleted: ResetResult }> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };

  const deleted: ResetResult = { laps: 0, cards: 0, pauses: 0, stations: 0, evaluations: 0, shots: 0, fleets: 0, placements: 0, members: 0 };

  // Chronometre : tours, cartes, pauses, pointages Fete Foraine, puis l'etat de course lui-meme.
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs) {
    deleted.laps = await deleteAll(await db.orm.public.Lap.where({ raceStateId: rs.id }).all(), (id) => db.orm.public.Lap.where({ id }).delete());
    deleted.cards = await deleteAll(await db.orm.public.YellowCard.where({ raceStateId: rs.id }).all(), (id) => db.orm.public.YellowCard.where({ id }).delete());
    deleted.pauses = await deleteAll(await db.orm.public.RacePause.where({ raceStateId: rs.id }).all(), (id) => db.orm.public.RacePause.where({ id }).delete());
    await db.orm.public.RaceState.where({ id: rs.id }).update({ startedAt: null, endedAt: null });
  }
  deleted.stations = await deleteAll(await db.orm.public.StationEvent.where({ sessionId }).all(), (id) => db.orm.public.StationEvent.where({ id }).delete());
  // Donnees de course portees par les equipes : dernier exercice saisi apres la fin (Pyramide), penalites et
  // points Finisher (Fete Foraine). Les equipes et leurs membres restent.
  const raceTeams = await db.orm.public.Team.where({ sessionId }).all();
  for (const t of raceTeams) if (t.endExerciseId || t.penalties) await db.orm.public.Team.where({ id: t.id }).update({ endExerciseId: null, penalties: 0 });
  const raceTeamIds = raceTeams.map((t) => t.id);
  if (raceTeamIds.length) for (const m of await db.orm.public.TeamMember.where((x) => x.teamId.in(raceTeamIds)).all()) if (m.finisherPoints) await db.orm.public.TeamMember.where({ id: m.id }).update({ finisherPoints: 0 });
  // WOD Level : fiches cochees, cases du demineur (et l'ancienne carte), echelle figee (re-figee au prochain depart).
  await deleteAll(await db.orm.public.LevelTick.where({ sessionId }).all(), (id) => db.orm.public.LevelTick.where({ id }).delete());
  await deleteAll(await db.orm.public.LevelLoss.where({ sessionId }).all(), (id) => db.orm.public.LevelLoss.where({ id }).delete());
  await deleteAll(await db.orm.public.MineReveal.where({ sessionId }).all(), (id) => db.orm.public.MineReveal.where({ id }).delete());
  await deleteAll(await db.orm.public.MineBoard.where({ sessionId }).all(), (id) => db.orm.public.MineBoard.where({ id }).delete());
  if (session.wodType === "LEVEL") {
    const prev = (session.settings as Record<string, unknown> | null) ?? {};
    const raceKeys = ["levels", "penalties", "emomScores", "children", "coinEvents", "gifts", "discounts", "coinsCarry"];
    if (raceKeys.some((k) => k in prev)) {
      const rest = { ...prev };
      for (const k of raceKeys) delete rest[k];
      await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify(rest)) });
    }
  }

  if (opts.clearReferees) {
    // Ordre impose par les cles etrangeres : Shot -> Evaluation, puis les flottes (cascade navires + cases).
    deleted.shots = await deleteAll(await db.orm.public.Shot.where({ sessionId }).all(), (id) => db.orm.public.Shot.where({ id }).delete());
    deleted.evaluations = await deleteAll(await db.orm.public.Evaluation.where({ sessionId }).all(), (id) => db.orm.public.Evaluation.where({ id }).delete());
    if (!opts.keepFleets) {
      deleted.fleets = await deleteAll(await db.orm.public.RefereeFleet.where({ sessionId }).all(), (id) => db.orm.public.RefereeFleet.where({ id }).delete());
      deleted.placements = await deleteAll(await db.orm.public.BoatPlacement.where({ sessionId }).all(), (id) => db.orm.public.BoatPlacement.where({ id }).delete());
    }
  }

  if (opts.clearMembers) {
    const teams = await db.orm.public.Team.where({ sessionId }).all();
    const teamIds = teams.map((t) => t.id);
    if (teamIds.length) {
      deleted.members = await deleteAll(
        await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all(),
        (id) => db.orm.public.TeamMember.where({ id }).delete()
      );
    }
  }

  // La seance redevient exploitable : plus de fin de WOD, et elle est reactivee.
  // Une seance PREPAREE (opensAt encore a venir) retrouve telle quelle son statut « en attente de son
  // heure ». Une seance dont la fenetre est deja passee verrait au contraire listOpenSessions() la
  // refermer aussitot : on efface donc ses bornes pour qu'elle soit vraiment rouverte.
  const now = Date.now();
  const patch: { raceEndedAt: null; isActive: true; opensAt?: null; closesAt?: null } = { raceEndedAt: null, isActive: true };
  if (session.closesAt && toMs(session.closesAt) <= now) {
    patch.closesAt = null;
    if (session.opensAt && toMs(session.opensAt) <= now) patch.opensAt = null;
  }
  await db.orm.public.Session.where({ id: sessionId }).update(patch);
  return { ok: true, deleted };
}

// ===== Suppression complete d'une seance =====
export async function deleteSession(sessionId: string): Promise<number> {
  let n = 0;
  n += await deleteAll(await db.orm.public.Shot.where({ sessionId }).all(), (id) => db.orm.public.Shot.where({ id }).delete());
  n += await deleteAll(await db.orm.public.Evaluation.where({ sessionId }).all(), (id) => db.orm.public.Evaluation.where({ id }).delete());
  n += await deleteAll(await db.orm.public.SelfEvaluation.where({ sessionId }).all(), (id) => db.orm.public.SelfEvaluation.where({ id }).delete());
  n += await deleteAll(await db.orm.public.SelfEvalReview.where({ sessionId }).all(), (id) => db.orm.public.SelfEvalReview.where({ id }).delete());
  n += await deleteAll(await db.orm.public.RefereeFleet.where({ sessionId }).all(), (id) => db.orm.public.RefereeFleet.where({ id }).delete());
  n += await deleteAll(await db.orm.public.BoatPlacement.where({ sessionId }).all(), (id) => db.orm.public.BoatPlacement.where({ id }).delete());
  n += await deleteAll(await db.orm.public.SessionReferee.where({ sessionId }).all(), (id) => db.orm.public.SessionReferee.where({ id }).delete());
  n += await deleteAll(await db.orm.public.StationEvent.where({ sessionId }).all(), (id) => db.orm.public.StationEvent.where({ id }).delete());

  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length) {
    n += await deleteAll(await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all(), (id) => db.orm.public.TeamMember.where({ id }).delete());
    n += await deleteAll(await db.orm.public.Score.where((s) => s.teamId.in(teamIds)).all(), (id) => db.orm.public.Score.where({ id }).delete());
  }
  n += await deleteAll(teams, (id) => db.orm.public.Team.where({ id }).delete());

  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs) {
    n += await deleteAll(await db.orm.public.Lap.where({ raceStateId: rs.id }).all(), (id) => db.orm.public.Lap.where({ id }).delete());
    n += await deleteAll(await db.orm.public.YellowCard.where({ raceStateId: rs.id }).all(), (id) => db.orm.public.YellowCard.where({ id }).delete());
    n += await deleteAll(await db.orm.public.RacePause.where({ raceStateId: rs.id }).all(), (id) => db.orm.public.RacePause.where({ id }).delete());
    await db.orm.public.RaceState.where({ id: rs.id }).delete();
    n++;
  }
  await db.orm.public.Session.where({ id: sessionId }).delete();
  return n + 1;
}

// ===== Inventaire : ce qui serait supprime, ce qui est garde =====
export type CleanupInventory = {
  sessions: {
    id: string; label: string; dateMs: number; opensAtMs: number | null; wodType: string; refereeMode: boolean;
    state: "ouverte" | "programmée" | "terminée"; started: boolean; ended: boolean;
    teams: number; members: number; laps: number; cards: number; evals: number; shots: number; selfEvals: number; fleets: number;
  }[];
  pinCount: number;
  reliabilityCount: number;
  kept: { cycles: string[]; plans: string[]; slots: number; students: number };
};

export async function cleanupInventory(): Promise<CleanupInventory> {
  const now = Date.now();
  const [sessions, students, cycles, plans, slots] = await Promise.all([
    db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all(),
    db.orm.public.User.where({ role: "STUDENT" }).all(),
    db.orm.public.Cycle.where({}).all(),
    db.orm.public.CyclePlan.where({}).all(),
    db.orm.public.ClassSlot.where({}).all(),
  ]);
  const ids = sessions.map((s) => s.id);
  const [allTeams, allEvals, allShots, allSelf, allFleets] = await Promise.all([
    ids.length ? db.orm.public.Team.where((t) => t.sessionId.in(ids)).all() : Promise.resolve([]),
    ids.length ? db.orm.public.Evaluation.where((e) => e.sessionId.in(ids)).all() : Promise.resolve([]),
    ids.length ? db.orm.public.Shot.where((s) => s.sessionId.in(ids)).all() : Promise.resolve([]),
    ids.length ? db.orm.public.SelfEvaluation.where((e) => e.sessionId.in(ids)).all() : Promise.resolve([]),
    ids.length ? db.orm.public.RefereeFleet.where((f) => f.sessionId.in(ids)).all() : Promise.resolve([]),
  ]);
  const allTeamIds = allTeams.map((t) => t.id);
  const allMembers = allTeamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(allTeamIds)).all() : [];
  const raceStates = ids.length ? await db.orm.public.RaceState.where((r) => r.sessionId.in(ids)).all() : [];
  const rsIds = raceStates.map((r) => r.id);
  const [allLaps, allCards] = await Promise.all([
    rsIds.length ? db.orm.public.Lap.where((l) => l.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    rsIds.length ? db.orm.public.YellowCard.where((c) => c.raceStateId.in(rsIds)).all() : Promise.resolve([]),
  ]);

  const teamsOf = (sid: string) => allTeams.filter((t) => t.sessionId === sid);
  return {
    sessions: sessions.map((s) => {
      const teams = teamsOf(s.id);
      const teamIds = new Set(teams.map((t) => t.id));
      const rs = raceStates.find((r) => r.sessionId === s.id);
      return {
        id: s.id,
        label: s.label ?? s.wodType,
        dateMs: toMs(s.createdAt),
        opensAtMs: s.opensAt ? toMs(s.opensAt) : null,
        wodType: String(s.wodType),
        refereeMode: s.refereeMode,
        state: (isScheduled(s, now) ? "programmée" : s.isActive ? "ouverte" : "terminée") as "ouverte" | "programmée" | "terminée",
        started: !!rs?.startedAt,
        ended: !!s.raceEndedAt,
        teams: teams.length,
        members: allMembers.filter((m) => teamIds.has(m.teamId)).length,
        laps: rs ? allLaps.filter((l) => l.raceStateId === rs.id).length : 0,
        cards: rs ? allCards.filter((c) => c.raceStateId === rs.id).length : 0,
        evals: allEvals.filter((e) => e.sessionId === s.id).length,
        shots: allShots.filter((x) => x.sessionId === s.id).length,
        selfEvals: allSelf.filter((e) => e.sessionId === s.id).length,
        fleets: allFleets.filter((f) => f.sessionId === s.id).length,
      };
    }),
    pinCount: students.filter((u) => u.pinCode).length,
    reliabilityCount: students.filter((u) => u.reliability !== 0).length,
    kept: {
      cycles: cycles.map((c) => c.name + (c.isCurrent ? " (en cours)" : "")),
      plans: plans.map((p) => p.label),
      slots: slots.length,
      students: students.length,
    },
  };
}

// ===== Grand menage =====
export type PurgeOptions = {
  sessionIds: string[]; // seances a supprimer entierement
  resetPins?: boolean; // remettre les codes PIN a zero (chaque eleve en recreera un a sa prochaine connexion)
  resetReliability?: boolean;
  resetProgramme?: boolean; // remise a blanc AVANT un lancement : cycles, seances-types et creneaux partent aussi
};
export type PurgeResult = { sessions: number; rows: number; pins: number; reliability: number; cycles: number; plans: number; slots: number };

export async function purge(opts: PurgeOptions): Promise<PurgeResult> {
  const res: PurgeResult = { sessions: 0, rows: 0, pins: 0, reliability: 0, cycles: 0, plans: 0, slots: 0 };
  for (const id of opts.sessionIds) {
    res.rows += await deleteSession(id);
    res.sessions++;
  }
  // La programmation part APRES les seances, qui la referencent.
  if (opts.resetProgramme) {
    res.plans = await deleteAll(await db.orm.public.CyclePlan.where({}).all(), (id) => db.orm.public.CyclePlan.where({ id }).delete());
    res.cycles = await deleteAll(await db.orm.public.Cycle.where({}).all(), (id) => db.orm.public.Cycle.where({ id }).delete());
    res.slots = await deleteAll(await db.orm.public.ClassSlot.where({}).all(), (id) => db.orm.public.ClassSlot.where({ id }).delete());
  }
  if (opts.resetPins) {
    const withPin = (await db.orm.public.User.where({ role: "STUDENT" }).all()).filter((u) => u.pinCode);
    for (const u of withPin) await db.orm.public.User.where({ id: u.id }).update({ pinCode: null });
    res.pins = withPin.length;
  }
  if (opts.resetReliability) {
    const rated = (await db.orm.public.User.where({ role: "STUDENT" }).all()).filter((u) => u.reliability !== 0);
    for (const u of rated) await db.orm.public.User.where({ id: u.id }).update({ reliability: 0 });
    res.reliability = rated.length;
  }
  return res;
}

export { toMs };
