"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { refereeAccess } from "@/lib/referee-access";
import { ensureMineBoard } from "@/lib/mine";
import { QUALITY_VALUES } from "@/lib/wod-engines/core/quality";

// Demineur : reveler une case = encoder une evaluation individuelle (eleve x exercice), puis « feu ».
export async function revealCellAction(
  sessionId: string,
  row: number,
  col: number,
  reps: number,
  note: number
): Promise<{ error: string } | { ok: true; mine: boolean; n: number; found: number }> {
  const user = await getSession();
  if (!user) return { error: "Non authentifié." };
  const session = await db.orm.public.Session.where({ id: sessionId, wodType: "LEVEL" }).first();
  if (!session) return { error: "Séance introuvable." };
  const access = await refereeAccess(sessionId, user);
  if (!access.allowed) return { error: access.reason ?? "Arbitrage non autorisé." };
  if (!Number.isInteger(reps) || reps < 0 || reps > 999) return { error: "Répétitions invalides (0 à 999)." };
  if (!QUALITY_VALUES.includes(note)) return { error: "Appréciation invalide." };

  const board = await ensureMineBoard(sessionId);
  if (!board) return { error: "La carte n'existe pas encore : le WOD doit être lancé." };
  const target = board.rows[row];
  const ex = board.cols[col];
  if (!target || !ex) return { error: "Case inconnue." };
  if (target.userId === user.id) return { error: "Tu ne t'arbitres pas toi-même 😉" };
  if (access.teamId && target.teamId === access.teamId) return { error: "Pas ta propre équipe." };
  if (await db.orm.public.MineReveal.where({ sessionId, refereeId: user.id, row, col }).first()) return { error: "Case déjà jouée." };

  const evaluation = await db.orm.public.Evaluation.create({
    sessionId,
    teamId: target.teamId,
    evaluatorId: user.id,
    exerciseId: ex.exerciseId,
    repsObserved: reps,
    note,
    targetUserId: target.userId,
  });
  try {
    await db.orm.public.MineReveal.create({ sessionId, refereeId: user.id, row, col, evaluationId: evaluation.id });
  } catch {
    await db.orm.public.Evaluation.where({ id: evaluation.id }).delete();
    return { error: "Case déjà jouée." };
  }
  const mine = board.mines[row][col];
  const mineCount = (await db.orm.public.MineReveal.where({ sessionId, refereeId: user.id }).all()).filter((r) => board.mines[r.row]?.[r.col]).length;
  return { ok: true, mine, n: board.numbers[row][col], found: mineCount };
}

// Pouls de l'ecran demineur : cases revelees (tous arbitres) + fin du WOD.
export async function minePulseAction(sessionId: string): Promise<string> {
  const user = await getSession();
  if (!user) return "";
  const [reveals, session] = await Promise.all([
    db.orm.public.MineReveal.where({ sessionId }).aggregate((a) => ({ n: a.count() })).catch(() => ({ n: -1 })),
    db.orm.public.Session.where({ id: sessionId }).first(),
  ]);
  return `${reveals.n}|${session?.raceEndedAt ? 1 : 0}`;
}
