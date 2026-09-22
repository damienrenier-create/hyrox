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
