import { getSession } from "@/lib/session-server";
import { applyLevelOps, type LevelOp } from "@/lib/level-sync";
import { levelLiveAction } from "../level-actions";

export const dynamic = "force-dynamic";

// Sauvegarde du greffier Level (toutes les minutes, ou plus tot) : rejoue les coches en attente a leur heure
// reelle, puis renvoie l'etat vivant complet et l'heure du serveur (l'ecran recale son horloge dessus).
// POST JSON { sessionId, ops } ; aussi appele en sendBeacon a la fermeture de la page. Depuis le 28/09 (soir) :
// seulement a la Pause, a la Fin du WOD, avant un bouton serveur ou sur demande (plus de sauvegarde a la minute).
export async function POST(req: Request) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  let body: { sessionId?: unknown; ops?: unknown; catchUp?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête illisible." }, { status: 400 });
  }
  if (typeof body.sessionId !== "string") return Response.json({ error: "Séance manquante." }, { status: 400 });
  const results = await applyLevelOps(body.sessionId, user.name, (Array.isArray(body.ops) ? body.ops : []) as LevelOp[], { catchUp: body.catchUp === true });
  const live = await levelLiveAction(body.sessionId);
  return Response.json({ results, live, serverNow: Date.now() });
}
