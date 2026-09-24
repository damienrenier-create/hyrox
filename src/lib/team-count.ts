import { db } from "@/lib/db";
import { reconcileFleets } from "@/lib/fleet-autopilot";

// Nombre d'equipes d'une seance (avant le depart) : en plus -> equipes vides ; en moins -> la carte est croppee
// et les navires hors champ sont RE-POSES ailleurs dans la grille restante (la flotte n'est jamais perdue).
// Refuse si une equipe a retirer a deja des evaluations.
export async function setTeamCount(sessionId: string, n: number): Promise<{ error: string } | { ok: true; removedTeams: number; movedShips: number }> {
  if (!Number.isInteger(n) || n < 1 || n > 50) return { error: "Nombre d'équipes : entier entre 1 et 50." };
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };

  const teams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  let removedTeams = 0;

  if (n > teams.length) {
    for (let i = teams.length + 1; i <= n; i++) {
      await db.orm.public.Team.create({ name: `Équipe ${i}`, order: i, sessionId });
    }
  } else if (n < teams.length) {
    const removed = teams.slice(n);
    const removedIds = new Set(removed.map((t) => t.id));
    for (const t of removed) {
      if (await db.orm.public.Evaluation.where({ teamId: t.id }).first()) {
        return { error: `${t.name} a déjà des évaluations : impossible de la supprimer.` };
      }
    }
    // Les cases posees sur une equipe supprimee disparaissent ; reconcileFleets re-posera les navires ailleurs.
    const placements = (await db.orm.public.BoatPlacement.where({ sessionId }).all()).filter((p) => removedIds.has(p.teamId));
    for (const p of placements) await db.orm.public.BoatPlacement.where({ id: p.id }).delete();
    for (const t of removed) {
      await db.orm.public.Team.where({ id: t.id }).delete(); // cascade membres
      removedTeams++;
    }
  }

  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, numTeams: n } });
  const { movedShips } = await reconcileFleets(sessionId);
  return { ok: true, removedTeams, movedShips };
}

// Suppression d'UNE equipe precise (le greffier s'est trompe, une equipe ne s'est pas presentee...).
// Tout ce qui lui appartient part avec elle : membres, tours, cartes jaunes, evaluations recues,
// tirs qui la visaient, bateaux poses sur sa ligne. Les equipes suivantes ne sont pas renumerotees
// (« Équipe 7 » reste « Équipe 7 »), mais la carte du Touche-Coule retrecit d'une ligne, donc les
// navires hors champ sont re-poses ailleurs par reconcileFleets.
export type DeleteTeamCount = { members: number; laps: number; cards: number; evaluations: number; shots: number; placements: number; ticks: number };

export async function teamDeletionPreview(teamId: string): Promise<{ error: string } | { ok: true; name: string; counts: DeleteTeamCount }> {
  const team = await db.orm.public.Team.where({ id: teamId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const rs = await db.orm.public.RaceState.where({ sessionId: team.sessionId }).first();
  const [members, evaluations, shots, placements, ticks] = await Promise.all([
    db.orm.public.TeamMember.where({ teamId }).all(),
    db.orm.public.Evaluation.where({ teamId }).all(),
    db.orm.public.Shot.where({ sessionId: team.sessionId, targetTeamId: teamId }).all(),
    db.orm.public.BoatPlacement.where({ sessionId: team.sessionId, teamId }).all(),
    db.orm.public.LevelTick.where({ sessionId: team.sessionId, teamId }).all(),
  ]);
  const [laps, cards] = rs
    ? await Promise.all([
        db.orm.public.Lap.where({ raceStateId: rs.id, teamId }).all(),
        db.orm.public.YellowCard.where({ raceStateId: rs.id, teamId }).all(),
      ])
    : [[], []];
  return {
    ok: true,
    name: team.name,
    counts: { members: members.length, laps: laps.length, cards: cards.length, evaluations: evaluations.length, shots: shots.length, placements: placements.length, ticks: ticks.length },
  };
}

export async function deleteTeam(teamId: string): Promise<{ error: string } | { ok: true; name: string; counts: DeleteTeamCount; movedShips: number; remaining: number }> {
  const pre = await teamDeletionPreview(teamId);
  if ("error" in pre) return pre;
  const team = (await db.orm.public.Team.where({ id: teamId }).first())!;
  const sessionId = team.sessionId;

  // Ordre impose par les cles etrangeres : le tir pointe vers l'evaluation, donc il part en premier.
  for (const s of await db.orm.public.Shot.where({ sessionId, targetTeamId: teamId }).all()) {
    await db.orm.public.Shot.where({ id: s.id }).delete();
  }
  for (const e of await db.orm.public.Evaluation.where({ teamId }).all()) {
    await db.orm.public.Evaluation.where({ id: e.id }).delete();
  }
  for (const p of await db.orm.public.BoatPlacement.where({ sessionId, teamId }).all()) {
    await db.orm.public.BoatPlacement.where({ id: p.id }).delete();
  }
  for (const t of await db.orm.public.LevelTick.where({ sessionId, teamId }).all()) {
    await db.orm.public.LevelTick.where({ id: t.id }).delete();
  }
  for (const l of await db.orm.public.LevelLoss.where({ sessionId, teamId }).all()) {
    await db.orm.public.LevelLoss.where({ id: l.id }).delete();
  }
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs) {
    for (const l of await db.orm.public.Lap.where({ raceStateId: rs.id, teamId }).all()) {
      await db.orm.public.Lap.where({ id: l.id }).delete();
    }
    for (const c of await db.orm.public.YellowCard.where({ raceStateId: rs.id, teamId }).all()) {
      await db.orm.public.YellowCard.where({ id: c.id }).delete();
    }
  }
  await db.orm.public.Team.where({ id: teamId }).delete(); // cascade membres et scores

  const remaining = (await db.orm.public.Team.where({ sessionId }).all()).length;
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  const prev = (session?.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, numTeams: remaining } });
  const { movedShips } = await reconcileFleets(sessionId);
  return { ok: true, name: pre.name, counts: pre.counts, movedShips, remaining };
}
