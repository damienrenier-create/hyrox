"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { refereeAccess } from "@/lib/referee-access";
import { readFrozenFromSettings } from "@/lib/level";
import { activeCards } from "@/lib/wod-engines/templates/level-engine";
import { QUALITY_VALUES } from "@/lib/wod-engines/core/quality";
import { MINE_COLS, MINE_COUNT, MINE_ROWS, ROUND_STRIDE, floodFrom, layoutForRound, numbersOf, roundsOf } from "@/lib/mine-core";
import { toMs } from "@/lib/scheduling";

export type FireResult = { ok: true; mine: boolean; n: number; opened: [number, number, number][]; found: number; foundInRound: number; roundDone: boolean };

// Demineur : evaluer un eleve sur un exercice (reps + qualite), puis tirer sur une case de la grille.
// Regles : pas soi-meme, pas sa propre equipe, et jamais deux fois d'affilee la meme equipe quand il y en a
// plusieurs. Un zero ouvre ses voisins en cascade (cases sans evaluation, jamais une bombe).
export async function fireAction(
  sessionId: string,
  targetUserId: string,
  exerciseId: string,
  reps: number,
  note: number,
  row: number,
  col: number
): Promise<{ error: string } | FireResult> {
  const user = await getSession();
  if (!user) return { error: "Non authentifié." };
  const session = await db.orm.public.Session.where({ id: sessionId, wodType: "LEVEL" }).first();
  if (!session) return { error: "Séance introuvable." };
  const access = await refereeAccess(sessionId, user);
  if (!access.allowed) return { error: access.reason ?? "Arbitrage non autorisé." };
  if (!Number.isInteger(reps) || reps < 0 || reps > 999) return { error: "Répétitions invalides (0 à 999)." };
  if (!QUALITY_VALUES.includes(note)) return { error: "Appréciation invalide." };
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= MINE_ROWS || col < 0 || col >= MINE_COLS) return { error: "Case inconnue." };
  if (targetUserId === user.id) return { error: "Tu ne t'arbitres pas toi-même 😉" };

  const levels = readFrozenFromSettings(session.settings);
  if (!levels.length) return { error: "Le WOD n'est pas lancé." };
  if (!levels.some((l) => activeCards(l).some(({ card }) => card.exerciseId === exerciseId))) return { error: "Exercice hors échelle." };

  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const membership = (await db.orm.public.TeamMember.where({ userId: targetUserId }).all()).find((m) => teams.some((t) => t.id === m.teamId));
  if (!membership) return { error: "Cet élève ne joue pas dans cette séance." };
  const teamId = membership.teamId;
  if (access.teamId && teamId === access.teamId) return { error: "Pas ta propre équipe." };
  if (teams.length > 1) {
    const last = await db.orm.public.Evaluation.where({ sessionId, evaluatorId: user.id }).orderBy((e) => e.createdAt.desc()).first();
    if (last && last.teamId === teamId) return { error: "Pas deux fois d'affilée la même équipe : arbitre une autre équipe d'abord." };
  }

  const mine = await db.orm.public.MineReveal.where({ sessionId, refereeId: user.id }).all();
  const { round } = roundsOf(sessionId, mine);
  const encodedRow = round * ROUND_STRIDE + row;
  if (mine.some((r) => r.row === encodedRow && r.col === col)) return { error: "Case déjà jouée." };

  const evaluation = await db.orm.public.Evaluation.create({ sessionId, teamId, evaluatorId: user.id, exerciseId, repsObserved: reps, note, targetUserId });
  try {
    await db.orm.public.MineReveal.create({ sessionId, refereeId: user.id, row: encodedRow, col, evaluationId: evaluation.id });
  } catch {
    await db.orm.public.Evaluation.where({ id: evaluation.id }).delete();
    return { error: "Case déjà jouée." };
  }

  const mines = layoutForRound(sessionId, round);
  const numbers = numbersOf(mines);
  const isMine = mines[row][col];
  const opened: [number, number, number][] = [];
  if (!isMine && numbers[row][col] === 0) {
    const already = new Set(mine.filter((r) => Math.floor(r.row / ROUND_STRIDE) === round).map((r) => `${r.row % ROUND_STRIDE}_${r.col}`));
    already.add(`${row}_${col}`);
    for (const [r, c] of floodFrom(mines, numbers, row, col, already)) {
      try {
        await db.orm.public.MineReveal.create({ sessionId, refereeId: user.id, row: round * ROUND_STRIDE + r, col: c, evaluationId: null });
        opened.push([r, c, numbers[r][c]]);
      } catch {
        /* deja ouverte */
      }
    }
  }
  const after = await db.orm.public.MineReveal.where({ sessionId, refereeId: user.id }).all();
  const s = roundsOf(sessionId, after);
  const foundInRound = s.round === round ? s.foundInRound : MINE_COUNT;
  return { ok: true, mine: isMine, n: numbers[row][col], opened, found: s.found, foundInRound, roundDone: s.round > round };
}

// Pouls de l'ecran demineur : cases revelees (tous arbitres), fiches cochees (les listes d'exercices suivent
// les niveaux en cours) et fin du WOD.
export async function minePulseAction(sessionId: string): Promise<string> {
  const user = await getSession();
  if (!user) return "";
  const [reveals, ticks, session] = await Promise.all([
    db.orm.public.MineReveal.where({ sessionId }).aggregate((a) => ({ n: a.count() })).catch(() => ({ n: -1 })),
    db.orm.public.LevelTick.where({ sessionId }).aggregate((a) => ({ n: a.count() })).catch(() => ({ n: -1 })),
    db.orm.public.Session.where({ id: sessionId }).first(),
  ]);
  return `${reveals.n}|${ticks.n}|${session?.raceEndedAt ? 1 : 0}|${session ? toMs(session.createdAt) : 0}`;
}
