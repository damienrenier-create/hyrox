import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { isTestClass, notDeleted } from "@/lib/session-roles";
import { teamLadder } from "@/lib/level-coins";
import { readChild } from "@/lib/level-context";
import {
  activeCards, coinsEarned, estimateSeconds, readPenalties, readStarSwitches, starsAtLevel, readTeamFormats, readTeamStars, teamFormatOf, teamSizeOf, teamStarsOf,
  type Format, type Loss, type PaceRef, type Stars, type Tick,
} from "@/lib/wod-engines/templates/level-engine";

// Rythme des equipes (Sartay 28/09) : temps reellement passe sur chaque niveau boucle, compare a la moyenne des
// autres equipes sur le MEME niveau du MEME parcours et du MEME format d'equipe (1-3, 4, 5+). Sert au rapport de
// fin de seance : equipes anormalement rapides (reps sautees ?) ou lentes (en difficulte ?).
// Temps d'un niveau = de la fin du niveau precedent (ou d'une vie perdue avec descente) a sa derniere fiche
// cochee, comme pour les pieces. WOD principal seulement ; classes de test (7A) jamais comptees.

export type LevelRun = {
  sessionId: string;
  teamId: string;
  teamName: string;
  stars: Stars;
  format: Format;
  members: number;
  level: number;
  boss: boolean;
  durationMs: number;
  estimateMs: number; // temps theorique du niveau pour l'effectif du format (sans transitions)
};

export async function levelRuns(onlySessionIds?: string[]): Promise<LevelRun[]> {
  const sessions = (await db.orm.public.Session.where({ wodType: "LEVEL" }).all())
    .filter(notDeleted)
    .filter((s) => !readChild(s.settings))
    .filter((s) => !onlySessionIds || onlySessionIds.includes(s.id));
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const [raceStates, teams, ticksRaw, lossesRaw] = await Promise.all([
    db.orm.public.RaceState.where((r) => r.sessionId.in(ids)).all(),
    db.orm.public.Team.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.LevelTick.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.LevelLoss.where((l) => l.sessionId.in(ids)).all(),
  ]);
  const rsIds = raceStates.map((r) => r.id);
  const teamIds = teams.map((t) => t.id);
  const [pausesRaw, members] = await Promise.all([
    rsIds.length ? db.orm.public.RacePause.where((p) => p.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    teamIds.length ? db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : Promise.resolve([]),
  ]);
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const classOf = new Map(users.map((u) => [u.id, u.className]));

  const out: LevelRun[] = [];
  for (const s of sessions) {
    const rs = raceStates.find((r) => r.sessionId === s.id);
    if (!rs?.startedAt) continue;
    const startedAtMs = toMs(rs.startedAt);
    const pauses = pausesRaw.filter((p) => p.raceStateId === rs.id).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
    const ticks: Tick[] = ticksRaw.filter((t) => t.sessionId === s.id).map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
    const losses: Loss[] = lossesRaw.filter((l) => l.sessionId === s.id).map((l) => ({ teamId: l.teamId, level: l.level, soft: !!(l as { soft?: unknown }).soft, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
    const extras = readPenalties(s.settings);
    const teamStars = readTeamStars(s.settings);
    const formats = readTeamFormats(s.settings);
    const switches = readStarSwitches(s.settings);
    for (const t of teams.filter((x) => x.sessionId === s.id)) {
      const mem = members.filter((m) => m.teamId === t.id);
      if (!mem.length || mem.some((m) => isTestClass(classOf.get(m.userId)))) continue;
      const ladder = teamLadder(s.settings, t.id);
      const format = teamFormatOf(formats, t.id, mem.length);
      const sw = switches[t.id];
      for (const c of coinsEarned(ladder, t.id, ticks, losses, extras).perLevel) {
        const lv = ladder.find((l) => l.number === c.level);
        if (!lv) continue;
        const stars: Stars = starsAtLevel(sw, teamStarsOf(teamStars, t.id), c.level);
        const est = estimateSeconds(activeCards(lv).map(({ card }) => ({ reps: card.reps, weight: card.weight })), lv.boss, teamSizeOf(format)) * 1000;
        out.push({ sessionId: s.id, teamId: t.id, teamName: t.name, stars, format, members: mem.length, level: c.level, boss: lv.boss, durationMs: c.elapsedMs, estimateMs: est });
      }
    }
  }
  return out;
}

export const paceKey = (r: Pick<LevelRun, "stars" | "format" | "level">) => `${r.format}-${r.stars}-${r.level}`;
export type PaceStat = { key: string; stars: Stars; format: Format; level: number; n: number; meanMs: number; medianMs: number; estimateMs: number };
export function paceStats(runs: LevelRun[]): PaceStat[] {
  const by = new Map<string, LevelRun[]>();
  for (const r of runs) by.set(paceKey(r), [...(by.get(paceKey(r)) ?? []), r]);
  return [...by.entries()].map(([key, rs]) => {
    const d = rs.map((r) => r.durationMs).sort((a, b) => a - b);
    return { key, stars: rs[0].stars, format: rs[0].format, level: rs[0].level, n: rs.length, meanMs: d.reduce((a, b) => a + b, 0) / d.length, medianMs: d[Math.floor(d.length / 2)], estimateMs: rs.reduce((a, r) => a + r.estimateMs, 0) / rs.length };
  }).sort((a, b) => a.format.localeCompare(b.format) || b.stars - a.stars || a.level - b.level);
}

// Rapport de fin de seance : chaque niveau boucle compare a la MEDIANE des autres equipes (toutes seances) sur le
// meme niveau, parcours et format. Moins de 3 autres passages : temps theorique x facteur observe.
// Trop vite : moins de la moitie de la reference ; trop lent : plus du double.
export const PACE_FAST = 0.5;
export const PACE_SLOW = 2;
export type PaceFlag = { teamId: string; teamName: string; level: number; boss: boolean; stars: Stars; format: Format; durationMs: number; referenceMs: number; ratio: number; basis: "moyenne" | "théorie"; n: number; kind: "fast" | "slow" };
export type PaceTeam = { teamId: string; teamName: string; stars: Stars; format: Format; levels: number; ratio: number; fast: number; slow: number };
// Chaque niveau boucle de la seance avec sa reference (recap des admins : detail des temps equipe par equipe).
export type PaceRun = { teamId: string; level: number; boss: boolean; durationMs: number; referenceMs: number; ratio: number; basis: "moyenne" | "théorie"; n: number };
// Sans assez de passages sur un niveau, la reference est le temps theorique multiplie par le facteur observe sur
// toutes les seances (les equipes mettent en pratique environ 2 fois le temps theorique : relais, deplacements).
export function observedFactor(runs: LevelRun[], boss: boolean): number {
  const r = runs.filter((x) => x.boss === boss && x.estimateMs > 0).map((x) => x.durationMs / x.estimateMs).sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length / 2)] : 1;
}
// Reference figee au coup d'envoi d'un WOD (montee « trop rapide », regles du 29/09 soir) : mediane par cle des
// seances deja jouees (au moins 3 passages), facteur observe pour le reste.
export async function buildPaceRef(): Promise<PaceRef> {
  const all = await levelRuns();
  const median: Record<string, number> = {};
  for (const s of paceStats(all)) if (s.n >= 3) median[s.key] = Math.round(s.medianMs);
  const f = (boss: boolean) => { const v = observedFactor(all, boss); return v > 0.2 && v < 10 ? Math.round(v * 100) / 100 : 2; };
  return { median, factor: { boss: f(true), level: f(false) } };
}

export async function paceReport(sessionId: string): Promise<{ flags: PaceFlag[]; teams: PaceTeam[]; runs: PaceRun[] }> {
  const all = await levelRuns();
  const mine = all.filter((r) => r.sessionId === sessionId);
  const factor = { true: observedFactor(all, true), false: observedFactor(all, false) } as Record<string, number>;
  const flags: PaceFlag[] = [];
  const runs: PaceRun[] = [];
  const perTeam = new Map<string, { run: LevelRun; ratio: number }[]>();
  for (const r of mine) {
    const others = all.filter((o) => paceKey(o) === paceKey(r) && !(o.sessionId === r.sessionId && o.teamId === r.teamId)).map((o) => o.durationMs).sort((a, b) => a - b);
    const byAvg = others.length >= 3;
    const referenceMs = byAvg ? others[Math.floor(others.length / 2)] : r.estimateMs * factor[String(r.boss)];
    if (referenceMs <= 0) continue;
    const ratio = r.durationMs / referenceMs;
    perTeam.set(r.teamId, [...(perTeam.get(r.teamId) ?? []), { run: r, ratio }]);
    runs.push({ teamId: r.teamId, level: r.level, boss: r.boss, durationMs: r.durationMs, referenceMs, ratio, basis: byAvg ? "moyenne" : "théorie", n: others.length });
    const kind = ratio < PACE_FAST ? "fast" : ratio > PACE_SLOW ? "slow" : null;
    if (kind) flags.push({ teamId: r.teamId, teamName: r.teamName, level: r.level, boss: r.boss, stars: r.stars, format: r.format, durationMs: r.durationMs, referenceMs, ratio, basis: byAvg ? "moyenne" : "théorie", n: others.length, kind });
  }
  const teams: PaceTeam[] = [...perTeam.entries()].map(([teamId, rs]) => ({
    teamId,
    teamName: rs[0].run.teamName,
    stars: rs[rs.length - 1].run.stars,
    format: rs[0].run.format,
    levels: rs.length,
    ratio: Math.exp(rs.reduce((a, x) => a + Math.log(Math.max(0.01, x.ratio)), 0) / rs.length), // moyenne geometrique
    fast: rs.filter((x) => x.ratio < PACE_FAST).length,
    slow: rs.filter((x) => x.ratio > PACE_SLOW).length,
  })).sort((a, b) => a.ratio - b.ratio);
  return { flags: flags.sort((a, b) => a.ratio - b.ratio), teams, runs };
}
