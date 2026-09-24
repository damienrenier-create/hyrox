import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { readFrozenFromSettings } from "@/lib/level";
import { progressOf, zombieDeadlineMs, zombieSpeedLevel, type Loss, type Tick } from "@/lib/wod-engines/templates/level-engine";

// Mode zombies du WOD Level (regle de Sartay) : sur chaque niveau, un zombie part de la gauche et avance au
// rythme « duree estimee du niveau + 3 min » vers le coeur de l'equipe ; chaque fiche cochee eloigne le
// coeur (la ligne se retrecit vers la droite). S'il l'atteint, l'equipe perd une vie et retombe au niveau
// precedent (ses fiches des niveaux >= niveau-1 sont effacees), et le zombie repart.
// Le rattrapage est constate ici, cote serveur, a partir du chrono de course : les ecrans ne font que
// l'afficher. Appele avant chaque lecture d'etat (bundle, pouls) et avant chaque coche.

export function readZombies(settings: unknown): boolean {
  const v = (settings as { zombies?: unknown } | null)?.zombies;
  return v !== false; // active par defaut
}

// Instant absolu correspondant a un instant du chrono de course (les pauses decalent).
export function absoluteFromRace(startedAtMs: number, pauses: { from: number; to: number | null }[], raceMs: number, nowMs: number): number {
  let abs = startedAtMs + raceMs;
  for (const p of [...pauses].sort((a, b) => a.from - b.from)) {
    if (p.from <= abs) abs += (p.to ?? nowMs) - p.from;
  }
  return abs;
}

export async function applyZombieCatches(sessionId: string, onlyTeamId?: string): Promise<number> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "LEVEL" || !readZombies(session.settings) || session.raceEndedAt) return 0;
  const levels = readFrozenFromSettings(session.settings);
  if (!levels.length) return 0;
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt || rs.endedAt) return 0;
  const startedAtMs = toMs(rs.startedAt);
  const pauses = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  if (pauses.some((p) => p.to === null)) return 0; // en pause : le chrono n'avance pas, le zombie non plus
  const nowMs = Date.now();
  const nowRace = elapsed(startedAtMs, pauses, nowMs) ?? 0;

  // Une coche ne verifie que son equipe (4 requetes legeres) ; le pouls et le rendu verifient tout le monde.
  const teams = onlyTeamId ? [{ id: onlyTeamId }] : await db.orm.public.Team.where({ sessionId }).all();
  const rawTicks = onlyTeamId ? await db.orm.public.LevelTick.where({ sessionId, teamId: onlyTeamId }).all() : await db.orm.public.LevelTick.where({ sessionId }).all();
  const rawLosses = onlyTeamId ? await db.orm.public.LevelLoss.where({ sessionId, teamId: onlyTeamId }).all() : await db.orm.public.LevelLoss.where({ sessionId }).all();
  let ticks: (Tick & { id: string })[] = rawTicks.map((t) => ({ id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
  const losses: Loss[] = rawLosses.map((l) => ({ teamId: l.teamId, level: l.level, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  let applied = 0;

  for (const t of teams) {
    for (let guard = 0; guard < 20; guard++) {
      const p = progressOf(levels, t.id, ticks, losses);
      if (p.currentLevel === null) break;
      const level = levels.find((l) => l.number === p.currentLevel);
      if (!level) break;
      const deadline = p.attemptStartMs + zombieDeadlineMs(level, p.currentDone, zombieSpeedLevel(level.number, p.losses));
      if (nowRace < deadline) break;
      // Rattrape : vie perdue a l'instant exact ou le zombie a touche le coeur, retour au niveau precedent.
      const catchAbs = absoluteFromRace(startedAtMs, pauses, deadline, nowMs);
      await db.orm.public.LevelLoss.create({ sessionId, teamId: t.id, level: p.currentLevel, at: Temporal.Instant.fromEpochMilliseconds(Math.round(catchAbs)) });
      const floor = Math.max(1, p.currentLevel - 1);
      const doomed = ticks.filter((x) => x.teamId === t.id && x.level >= floor);
      for (const x of doomed) await db.orm.public.LevelTick.where({ id: x.id }).delete();
      ticks = ticks.filter((x) => !doomed.includes(x));
      losses.push({ teamId: t.id, level: p.currentLevel, atMs: deadline });
      applied++;
    }
  }
  return applied;
}
