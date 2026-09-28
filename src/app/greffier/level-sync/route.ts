import { getSession } from "@/lib/session-server";
import { applyLevelOps, type LevelOp } from "@/lib/level-sync";
import { levelLiveAction } from "../level-actions";

export const dynamic = "force-dynamic";

// Sauvegarde du greffier Level (toutes les minutes, ou plus tot) : rejoue les coches en attente a leur heure
// reelle, puis renvoie l'etat vivant complet et l'heure du serveur (l'ecran recale son horloge dessus).
// POST JSON { sessionId, ops, catchTeams? } ; aussi appele en sendBeacon a la fermeture de la page.
export async function POST(req: Request) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  let body: { sessionId?: unknown; ops?: unknown; catchTeams?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête illisible." }, { status: 400 });
  }
  if (typeof body.sessionId !== "string") return Response.json({ error: "Séance manquante." }, { status: 400 });
  const results = await applyLevelOps(body.sessionId, user.name, (Array.isArray(body.ops) ? body.ops : []) as LevelOp[]);
  const catchTeams = Array.isArray(body.catchTeams) ? body.catchTeams.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
  const live = await levelLiveAction(body.sessionId, { catchTeams });
  return Response.json({ results, live, serverNow: Date.now() });
}
