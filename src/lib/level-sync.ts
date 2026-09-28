import { loadZombieContext, persistReplay, replayFromContext } from "@/lib/zombies";
import { catchUpAll, replayOps, type ReplayOp, type ReplayResult } from "@/lib/wod-engines/templates/level-replay";

// Greffier « hors ligne » (Sartay 28/09) : l'ecran garde les coches sur le PC, avec l'heure exacte du clic (temps de
// course), et calcule lui-meme zombies, vies et fusees (`level-replay.ts`). Il n'envoie le lot qu'a la Pause, a la
// Fin du WOD, avant un bouton qui passe par le serveur, ou sur demande. Ici, le lot est rejoue EN MEMOIRE avec le
// meme code que l'ecran (zombies de l'equipe constates jusqu'a l'heure de chaque clic, puis verification et coche),
// puis tout est ecrit en une transaction : quelques requetes, quel que soit le nombre de coches.
// `catchUp` (envoye par l'ecran du greffier, pas par l'envoi de fermeture de page) : zombies de TOUTES les equipes
// constates jusqu'a maintenant, pour que la base soit exactement ce que l'ecran montre avant un bouton serveur
// (fusee, allegement...). Un seul greffier pendant la course (Sartay 28/09) : ses coches sont toutes dans le lot.

export type LevelOp = ReplayOp;
export type LevelOpResult = ReplayResult;
export const MAX_OPS = 5000; // un WOD entier sans pause : environ 25 niveaux x 6 fiches x 8 equipes

export async function applyLevelOps(sessionId: string, by: string, ops: LevelOp[], opts: { catchUp?: boolean } = {}): Promise<LevelOpResult[]> {
  const clean = (Array.isArray(ops) ? ops : []).filter((o) => o && typeof o.id === "string" && (o.kind === "tick" || o.kind === "untick") && typeof o.teamId === "string" && Number.isInteger(o.level) && Number.isInteger(o.card) && Number.isFinite(o.atMs)).slice(0, MAX_OPS);
  if (!clean.length && !opts.catchUp) return [];
  const ctx = await loadZombieContext(sessionId);
  if (!ctx || ctx.session.wodType !== "LEVEL") return clean.map((o) => ({ id: o.id, ok: false, error: "Séance introuvable." }));
  if (!ctx.rs?.startedAt) return clean.map((o) => ({ id: o.id, ok: false, error: "Lance d'abord la course." }));
  // Course terminee : les coches arrivees apres coup comptent a leur heure (bornee a la fin), comme avant.
  const r = replayFromContext(ctx, { allowEnded: true });
  if (!r) return clean.map((o) => ({ id: o.id, ok: false, error: "Séance introuvable." }));
  if (ctx.rs.endedAt || ctx.session.raceEndedAt) { r.cfg.zombies = false; r.cfg.spending = false; } // fin du WOD deja constatee : plus de rattrapage ni de fusee
  const results = replayOps(r.cfg, r.st, clean, r.nowRaceMs);
  if (opts.catchUp) catchUpAll(r.cfg, r.st, r.nowRaceMs); // sans effet si le WOD est termine (zombies coupes)
  await persistReplay(sessionId, r, by);
  return results;
}
