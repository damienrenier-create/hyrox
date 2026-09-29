import { loadZombieContext, persistReplay, readAppliedOps, replayFromContext } from "@/lib/zombies";
import { catchUpAll, nowRace, replayOps, type OpKind, type ReplayOp, type ReplayResult } from "@/lib/wod-engines/templates/level-replay";

// Greffier « hors ligne » (Sartay 28-29/09) : une fois le WOD lance, tout ce que fait l'ecran est une operation datee
// gardee sur le PC (coche, carte jaune, allegement, fusee, cordes, pause, reprise, fin) et appliquee localement avec
// le code du serveur (`level-replay.ts`). Le lot part a la Fin du WOD (ou plus tot si le greffier le demande). Ici,
// il est rejoue EN MEMOIRE avec le meme code, puis tout est ecrit en une transaction : quelques requetes, quel que
// soit le nombre d'operations. `catchUp` (envoye par l'ecran du greffier, pas par l'envoi de fermeture de page) :
// zombies de TOUTES les equipes constates jusqu'a maintenant, pour que la base soit exactement ce que l'ecran montre.

export type LevelOp = ReplayOp;
export type LevelOpResult = ReplayResult;
export const MAX_OPS = 5000; // un WOD entier sans pause : environ 25 niveaux x 6 fiches x 8 equipes
const KINDS = new Set<OpKind>(["tick", "untick", "yellow", "discount", "rocket", "scores", "pause", "resume", "end"]);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

function validOp(o: unknown): o is LevelOp {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  if (typeof x.id !== "string" || !KINDS.has(x.kind as OpKind)) return false;
  if (!num(x.absMs) && !num(x.atMs)) return false;
  const team = typeof x.teamId === "string";
  switch (x.kind as OpKind) {
    case "tick": case "untick": return team && Number.isInteger(x.level) && Number.isInteger(x.card);
    case "yellow": return team && (x.delta === 1 || x.delta === -1);
    case "discount": return team && num(x.reps);
    case "rocket": return team && num(x.draw);
    case "scores": return team && !!x.scores && typeof x.scores === "object" && !Array.isArray(x.scores);
    default: return true; // pause, resume, end
  }
}

export async function applyLevelOps(sessionId: string, by: string, ops: LevelOp[], opts: { catchUp?: boolean } = {}): Promise<LevelOpResult[]> {
  const clean = (Array.isArray(ops) ? ops : []).filter(validOp).slice(0, MAX_OPS);
  if (!clean.length && !opts.catchUp) return [];
  const ctx = await loadZombieContext(sessionId);
  if (!ctx || ctx.session.wodType !== "LEVEL") return clean.map((o) => ({ id: o.id, ok: false, error: "Séance introuvable." }));
  if (!ctx.rs?.startedAt) return clean.map((o) => ({ id: o.id, ok: false, error: "Lance d'abord la course." }));
  // Course terminee : les coches arrivees apres coup comptent a leur heure (bornee a la fin), les cordes se saisissent
  // encore ; plus de zombie ni de fusee.
  const r = replayFromContext(ctx, { allowEnded: true });
  if (!r) return clean.map((o) => ({ id: o.id, ok: false, error: "Séance introuvable." }));
  if (ctx.rs.endedAt || ctx.session.raceEndedAt) { r.cfg.zombies = false; r.cfg.spending = false; }
  // Lot renvoye (reponse perdue) : les operations deja appliquees sont acquittees sans etre rejouees.
  const applied = new Set(readAppliedOps(ctx.session.settings));
  const fresh = clean.filter((o) => !applied.has(o.id));
  const results = [...clean.filter((o) => applied.has(o.id)).map((o) => ({ id: o.id, ok: true })), ...replayOps(r.cfg, r.st, fresh)];
  if (opts.catchUp) catchUpAll(r.cfg, r.st, nowRace(r.cfg, r.st)); // sans effet si le WOD est termine (zombies coupes)
  await persistReplay(sessionId, r, by, fresh.map((o) => o.id));
  return results;
}
