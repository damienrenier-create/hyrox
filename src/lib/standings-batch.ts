import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";
import { elapsed, standings, total, finishAt, startOf, fmt, timeline, type RaceContext } from "@/lib/wod-engines/templates/pyramide-engine";
import { teamRows, colorOf, fmt as ffFmt, type FFContext, type FFTeam } from "@/lib/wod-engines/templates/fete-foraine-engine";
import { readFFSettings } from "@/lib/fete-foraine-context";
import { FF_COLORS, FF_STATIONS, type FFColor } from "@/lib/wod-engines/templates/fete-foraine-engine";
import type { SessionStandings, StandingRow } from "@/lib/session-standings";
import { toMs } from "@/lib/scheduling";
import { readFrozenFromSettings } from "@/lib/level";
import { levelLabel, progressOf, rankTeams, type Tick } from "@/lib/wod-engines/templates/level-engine";

// Classements de PLUSIEURS seances en une poignee de requetes groupees (.in) au lieu d'une cascade par
// seance / par equipe / par eleve. La page Resultats passait 14 s a faire ~520 allers-retours.

type SessionLike = { id: string; wodType: string; settings?: unknown; raceEndedAt?: unknown | null };

export async function buildStandingsForSessions(sessions: SessionLike[]): Promise<Map<string, SessionStandings>> {
  const out = new Map<string, SessionStandings>();
  if (!sessions.length) return out;
  const ids = sessions.map((s) => s.id);

  // ===== Tout ce dont les deux moteurs ont besoin, en 7 requetes groupees =====
  const [teams, raceStates, stationEvents] = await Promise.all([
    db.orm.public.Team.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.RaceState.where((r) => r.sessionId.in(ids)).all(),
    sessions.some((s) => s.wodType === "FETE_FORAINE")
      ? db.orm.public.StationEvent.where((e) => e.sessionId.in(ids)).all()
      : Promise.resolve([] as Awaited<ReturnType<typeof db.orm.public.StationEvent.where>> extends never ? never[] : { sessionId: string; teamId: string; stationId: string; at: unknown }[]),
  ]);
  const levelTicks = sessions.some((s) => s.wodType === "LEVEL") ? await db.orm.public.LevelTick.where((t) => t.sessionId.in(ids)).all() : [];
  const rsIds = raceStates.map((r) => r.id);
  const teamIds = teams.map((t) => t.id);
  const [pauses, laps, cards, members] = await Promise.all([
    rsIds.length ? db.orm.public.RacePause.where((p) => p.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    rsIds.length ? db.orm.public.Lap.where((l) => l.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    rsIds.length ? db.orm.public.YellowCard.where((c) => c.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    teamIds.length ? db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : Promise.resolve([]),
  ]);
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Regroupements en memoire
  const bySession = <T extends { sessionId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.sessionId) ?? m.set(r.sessionId, []).get(r.sessionId)!).push(r);
    return m;
  };
  const teamsBySession = bySession(teams);
  const eventsBySession = bySession(stationEvents as { sessionId: string; teamId: string; stationId: string; at: unknown }[]);
  const ticksBySession = bySession(levelTicks);
  const rsBySession = new Map(raceStates.map((r) => [r.sessionId, r]));
  const byRaceState = <T extends { raceStateId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.raceStateId) ?? m.set(r.raceStateId, []).get(r.raceStateId)!).push(r);
    return m;
  };
  const pausesByRs = byRaceState(pauses);
  const lapsByRs = byRaceState(laps);
  const cardsByRs = byRaceState(cards);
  const membersByTeam = new Map<string, typeof members>();
  for (const m of members) (membersByTeam.get(m.teamId) ?? membersByTeam.set(m.teamId, []).get(m.teamId)!).push(m);

  for (const session of sessions) {
    const rawTeams = (teamsBySession.get(session.id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const rs = rsBySession.get(session.id) ?? null;
    const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
    const sessionPauses = rs ? (pausesByRs.get(rs.id) ?? []).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })) : [];

    if (session.wodType === "LEVEL") {
      out.set(session.id, levelStandingsBatch(session, rawTeams, ticksBySession.get(session.id) ?? [], rs ? cardsByRs.get(rs.id) ?? [] : [], startedAtMs, sessionPauses));
      continue;
    }
    if (session.wodType === "FETE_FORAINE") {
      out.set(session.id, ffStandings(session, rawTeams, membersByTeam, userById, eventsBySession.get(session.id) ?? [], startedAtMs, sessionPauses));
      continue;
    }
    out.set(session.id, pyramidStandings(session, rawTeams, rs, lapsByRs, cardsByRs, startedAtMs, sessionPauses));
  }
  return out;
}

type TeamRow = { id: string; name: string; order: number | null; startExerciseId: string | null; endExerciseId: string | null; color?: string | null; penalties?: number | null };

function pyramidStandings(
  session: SessionLike,
  rawTeams: TeamRow[],
  rs: { id: string; rep0: number; peak: number; step: number; capMin: number; afterMin: number; penMin: number; noStartExerciseIds: unknown; endedAt?: unknown } | null,
  lapsByRs: Map<string, { teamId: string; at: unknown }[]>,
  cardsByRs: Map<string, { teamId: string; at: unknown }[]>,
  startedAtMs: number | null,
  pauses: { from: number; to: number | null }[]
): SessionStandings {
  const sortedEx = exercisesFor(session as { wodType: string; settings?: unknown });
  const exerciseLabels: Record<string, string> = {};
  sortedEx.forEach((e) => { exerciseLabels[e.id] = e.label; });
  const startOverride = new Map<string, string>();
  const endOverride = new Map<string, string | "NONE">();
  rawTeams.forEach((t) => {
    if (t.startExerciseId) startOverride.set(t.id, t.startExerciseId);
    if (t.endExerciseId) endOverride.set(t.id, t.endExerciseId === "NONE" ? "NONE" : t.endExerciseId);
  });

  const ctx: RaceContext = {
    settings: rs
      ? { rep0: rs.rep0, peak: rs.peak, step: rs.step, capMin: rs.capMin, afterMin: rs.afterMin, penMin: rs.penMin }
      : { rep0: 5, peak: 10, step: 1, capMin: 40, afterMin: 10, penMin: 1 },
    teams: rawTeams.map((t) => ({ id: t.id, order: t.order ?? 0 })),
    exercises: sortedEx.map((e) => ({ id: e.id, number: e.number })),
    noStartExerciseIds: new Set(rs ? ((rs.noStartExerciseIds as string[]) ?? []) : []),
    laps: rs
      ? (lapsByRs.get(rs.id) ?? [])
          .map((l) => ({ teamId: l.teamId, at: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }))
          .sort((a, b) => a.at - b.at)
      : [],
    cards: rs ? (cardsByRs.get(rs.id) ?? []).map((c) => ({ teamId: c.teamId, at: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 })) : [],
    startOverride,
    endOverride,
  };

  const ended = !!session.raceEndedAt;
  const T = total(ctx.settings);
  const tl = timeline(ctx);
  const teamName = new Map(rawTeams.map((t) => [t.id, t.name]));
  const finishedAtMs: Record<string, number> = {};
  for (const t of ctx.teams) {
    const fa = finishAt(ctx, t.id);
    if (fa !== null && startedAtMs !== null) {
      let abs = startedAtMs + fa;
      for (const p of pauses) if (p.to !== null && p.from < abs) abs += p.to - p.from;
      finishedAtMs[t.id] = abs;
    }
  }
  const rows: StandingRow[] = standings(ctx, ended).map((s, i) => ({
    rank: i + 1,
    teamId: s.team.id,
    teamName: teamName.get(s.team.id) ?? s.team.id,
    laps: Math.min(s.n, T),
    lapsTotal: T,
    time: s.done ? fmt(s.finishAt) : null,
    late: tl.late[s.team.id] != null ? fmt(tl.late[s.team.id]) : null,
    start: exerciseLabels[startOf(ctx, s.team).id] ?? "",
    reps: s.reps,
    cards: s.yellowCards,
    done: s.done,
  }));
  return { columns: { laps: "Tours", time: "Temps", reps: "Reps", cards: "🟨", start: "Départ" }, rows, finishedAtMs };
}

// Level : niveaux boucles, fiches du niveau en cours, derniere coche ; l'echelle vient de la copie figee.
function levelStandingsBatch(
  session: SessionLike,
  rawTeams: TeamRow[],
  rawTicks: { teamId: string; level: number; card: number; at: unknown }[],
  rawCards: { teamId: string }[],
  startedAtMs: number | null,
  pauses: { from: number; to: number | null }[]
): SessionStandings {
  const levels = readFrozenFromSettings(session.settings);
  const ticks: Tick[] = rawTicks.map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
  const lastAbs = new Map<string, number>();
  for (const t of rawTicks) lastAbs.set(t.teamId, Math.max(lastAbs.get(t.teamId) ?? 0, toMs(t.at)));
  const ranked = rankTeams(rawTeams.map((t) => progressOf(levels, t.id, ticks)));
  const teamName = new Map(rawTeams.map((t) => [t.id, t.name]));
  const finishedAtMs: Record<string, number> = {};
  const rows: StandingRow[] = ranked.map((p, i) => {
    if (p.finishedMs !== null && lastAbs.has(p.teamId)) finishedAtMs[p.teamId] = lastAbs.get(p.teamId)!;
    const cur = p.currentLevel ? levels.find((l) => l.number === p.currentLevel) ?? null : null;
    return {
      rank: i + 1,
      teamId: p.teamId,
      teamName: teamName.get(p.teamId) ?? p.teamId,
      laps: p.completedLevels,
      lapsTotal: levels.length,
      time: p.finishedMs !== null ? fmt(p.finishedMs) : p.lastTickMs !== null ? fmt(p.lastTickMs) : null,
      late: null,
      start: cur ? `${levelLabel(cur)} · ${p.currentDone}/${p.currentTotal}` : "🏁",
      reps: p.reps,
      cards: rawCards.filter((c) => c.teamId === p.teamId).length,
      done: p.finishedMs !== null,
    };
  });
  return { columns: { laps: "Niveaux", time: "Dernière coche", reps: "Reps", cards: "🟨", start: "En cours" }, rows, finishedAtMs };
}

function ffStandings(
  session: SessionLike,
  rawTeams: TeamRow[],
  membersByTeam: Map<string, { id: string; teamId: string; userId: string; finisherPoints?: number | null }[]>,
  userById: Map<string, { id: string; firstName?: string | null; name: string }>,
  rawEvents: { teamId: string; stationId: string; at: unknown }[],
  startedAtMs: number | null,
  pauses: { from: number; to: number | null }[]
): SessionStandings {
  const teams: FFTeam[] = rawTeams.map((t) => ({
    id: t.id,
    order: t.order ?? 0,
    name: t.name,
    color: t.color && (FF_COLORS as readonly string[]).includes(t.color) ? (t.color as FFColor) : null,
    penalties: t.penalties ?? 0,
    runners: (membersByTeam.get(t.id) ?? [])
      .map((m) => {
        const u = userById.get(m.userId);
        return { memberId: m.id, userId: m.userId, name: u?.firstName || u?.name || "?", points: m.finisherPoints ?? 0 };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const exercises = exercisesFor(session as { wodType: string; settings?: unknown })
    .filter((e) => e.id !== "corde")
    .map((e) => {
      const base = FF_STATIONS.find((s) => s.id === e.id);
      return { id: e.id, label: e.label, reps: base?.reps ?? 0, n: base?.n };
    });
  const finishedAtMs: Record<string, number> = {};
  const events = rawEvents.map((e) => {
    const abs = toMs(e.at);
    if (e.stationId === "fin") finishedAtMs[e.teamId] = abs;
    return { teamId: e.teamId, stationId: e.stationId, at: elapsed(startedAtMs, pauses, abs) ?? 0 };
  });
  const ctx: FFContext = { teams, exercises, events, settings: readFFSettings(session.settings) };

  let rank = 0;
  const rows: StandingRow[] = teamRows(ctx).map((st) => {
    const done = st.score !== null;
    if (done) rank++;
    return {
      rank: done ? rank : 0,
      teamId: st.team.id,
      teamName: st.team.name,
      laps: st.exDone,
      lapsTotal: ctx.exercises.length,
      time: done ? ffFmt(st.score) : st.wod !== null ? ffFmt(st.wod) : null,
      late: null,
      start: colorOf(st.team),
      reps: st.corde.length,
      cards: st.pen,
      done,
    };
  });
  let next = rank;
  for (const r of rows) if (!r.done) r.rank = ++next;
  return { columns: { laps: "Ateliers", time: "Score", reps: "Corde", cards: "Pén.", start: "Couleur" }, rows, finishedAtMs };
}
