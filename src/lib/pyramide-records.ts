import { db } from "@/lib/db";
import { exercisesFor } from "@/lib/session-exercises";
import {
  cardsOf, elapsed, finalScores, finishAt, lapsOf, medalOrder, peakIndex, pyramid, timeline, total,
  type RaceContext,
} from "@/lib/wod-engines/templates/pyramide-engine";
import { toMs } from "@/lib/scheduling";
import { wodLabel } from "@/lib/student-sessions";

// Records du WOD Pyramide, toutes classes et toutes seances confondues. Calcule a la demande (onglet
// Records du greffier), jamais au rendu de la page : ce balayage lit TOUTES les seances Pyramide et n'a
// rien a faire dans le chemin critique d'une course en direct.

export type TeamSex = "F" | "M" | "OPEN";
export const SEX_LABEL: Record<TeamSex, string> = { F: "Équipes de filles", M: "Équipes de gars", OPEN: "Équipes mixtes" };

export type RecordEntry = {
  key: string;
  sessionId: string;
  teamId: string;
  teamName: string;
  members: string[];
  sex: TeamSex;
  classes: string;
  sessionLabel: string;
  dateMs: number;
  display: string;
};

export type RecordBoard = { id: string; title: string; hint: string; rows: RecordEntry[] };
// « annee » = le degre scolaire (1re a 6e), lu sur le premier chiffre du nom de classe (« 5GTb » -> 5).
export type RecordFilters = { sex?: TeamSex | ""; grade?: number | null };
// `excluded` : equipes ecartees du palmares par DAMZER (chrono fausse par le greffier), toujours
// visibles pour pouvoir les retablir. Leurs tours et resultats, eux, sont intacts.
export type RecordsResult = { boards: RecordBoard[]; excluded: RecordEntry[]; grades: number[]; teamsScanned: number; sessionsScanned: number };

export function readExcludedFromRecords(settings: unknown): string[] {
  const s = settings as { excludedFromRecords?: unknown } | null;
  return Array.isArray(s?.excludedFromRecords) ? (s!.excludedFromRecords as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

export function gradeOf(className: string | null | undefined): number | null {
  const m = (className ?? "").match(/\d/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 7 ? n : null;
}

const fmtMs = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtSigned = (ms: number) => (ms < 0 ? "−" : "") + fmtMs(Math.abs(ms));

// Une ligne par equipe et par seance, avec tout ce qui peut battre un record.
type Row = {
  base: Omit<RecordEntry, "display">;
  medals1: number; // nombre de tours boucles EN PREMIER
  cards: number;
  finishMs: number | null; // null = pas arrivee
  scoreMs: number;
  fastestLapMs: number | null;
  firstLapMs: number | null;
  apexLapMs: number | null;
  lastLapMs: number | null; // seulement si l'equipe a boucle TOUS les tours
  apexReps: number;
  grade: number | null; // degre de l'equipe (null si ses membres melangent plusieurs degres)
};

export async function buildPyramideRecords(f: RecordFilters = {}): Promise<RecordsResult> {
  const sessions = (await db.orm.public.Session.where({ wodType: "PYRAMIDE_CLASSIQUE" }).all()).sort(
    (a, b) => toMs(b.createdAt) - toMs(a.createdAt)
  );
  const kept = sessions;
  if (!kept.length) return { boards: [], excluded: [], grades: [], teamsScanned: 0, sessionsScanned: 0 };

  const ids = kept.map((s) => s.id);
  const [raceStates, allTeams] = await Promise.all([
    db.orm.public.RaceState.where((r) => r.sessionId.in(ids)).all(),
    db.orm.public.Team.where((t) => t.sessionId.in(ids)).all(),
  ]);
  const rsIds = raceStates.map((r) => r.id);
  const teamIds = allTeams.map((t) => t.id);
  const [allLaps, allCards, allPauses, allMembers] = await Promise.all([
    rsIds.length ? db.orm.public.Lap.where((l) => l.raceStateId.in(rsIds)).orderBy((l) => l.at.asc()).all() : Promise.resolve([]),
    rsIds.length ? db.orm.public.YellowCard.where((c) => c.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    rsIds.length ? db.orm.public.RacePause.where((p) => p.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    teamIds.length ? db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : Promise.resolve([]),
  ]);
  const userIds = [...new Set(allMembers.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };
  const teamsBy = group(allTeams, (t) => t.sessionId);
  const membersBy = group(allMembers, (m) => m.teamId);
  const lapsBy = group(allLaps, (l) => l.raceStateId);
  const cardsBy = group(allCards, (c) => c.raceStateId);
  const pausesBy = group(allPauses, (p) => p.raceStateId);

  const rows: Row[] = [];
  const excluded: RecordEntry[] = [];
  let sessionsScanned = 0;

  for (const s of kept) {
    const rs = raceStates.find((r) => r.sessionId === s.id);
    if (!rs || !rs.startedAt) continue; // une seance jamais lancee n'a aucun record a donner
    sessionsScanned++;

    const startedAtMs = toMs(rs.startedAt);
    const pauses = (pausesBy.get(rs.id) ?? []).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
    const teams = (teamsBy.get(s.id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const startOverride = new Map<string, string>();
    const endOverride = new Map<string, string | "NONE">();
    teams.forEach((t) => {
      if (t.startExerciseId) startOverride.set(t.id, t.startExerciseId);
      if (t.endExerciseId) endOverride.set(t.id, t.endExerciseId === "NONE" ? "NONE" : t.endExerciseId);
    });

    const ctx: RaceContext = {
      settings: { rep0: rs.rep0, peak: rs.peak, step: rs.step, capMin: rs.capMin, afterMin: rs.afterMin, penMin: rs.penMin },
      teams: teams.map((t) => ({ id: t.id, order: t.order ?? 0 })),
      exercises: exercisesFor(s).map((e) => ({ id: e.id, number: e.number })),
      noStartExerciseIds: new Set((rs.noStartExerciseIds as string[]) ?? []),
      laps: (lapsBy.get(rs.id) ?? []).map((l) => ({ teamId: l.teamId, at: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 })),
      cards: (cardsBy.get(rs.id) ?? []).map((c) => ({ teamId: c.teamId, at: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 })),
      startOverride,
      endOverride,
    };

    const final = !!s.raceEndedAt;
    const tl = timeline(ctx);
    const ord = medalOrder(ctx);
    const scores = new Map(finalScores(ctx, tl, ord, final).map((x) => [x.teamId, x]));
    const T = total(ctx.settings);
    const p = pyramid(ctx.settings);
    const apexIdx = peakIndex(ctx.settings);
    const sessionLabel = s.label ?? wodLabel(s.wodType);
    const dateMs = toMs(s.createdAt);
    const excludedIds = new Set(readExcludedFromRecords(s.settings));

    for (const t of teams) {
      const n = lapsOf(ctx, t.id);
      if (n === 0) continue; // une equipe qui n'a rien valide n'entre dans aucun palmares

      const mem = (membersBy.get(t.id) ?? []).map((m) => userById.get(m.userId)).filter((u) => !!u);
      if (!mem.length) continue; // pas de membres encodes : le record ne serait attribuable a personne
      const sexes = new Set(mem.map((u) => u!.sex ?? "?"));
      const sex: TeamSex = sexes.size === 1 && sexes.has("F") ? "F" : sexes.size === 1 && sexes.has("M") ? "M" : "OPEN";

      // Les tours sont deja tries par instant : la duree du tour k est l'ecart avec le precedent,
      // le premier tour partant du coup d'envoi (toutes les equipes partent ensemble).
      const times = ctx.laps.filter((l) => l.teamId === t.id).map((l) => l.at).sort((a, b) => a - b);
      const durations = times.map((at, i) => at - (i === 0 ? 0 : times[i - 1]));

      const base = {
        key: `${s.id}_${t.id}`,
        sessionId: s.id,
        teamId: t.id,
        teamName: t.name,
        members: mem.map((u) => `${u!.firstName ?? ""}`.trim()).filter(Boolean),
        sex,
        classes: [...new Set(mem.map((u) => u!.className).filter((c): c is string => !!c))].sort().join(", "),
        sessionLabel,
        dateMs,
      };
      if (excludedIds.has(t.id)) {
        excluded.push({ ...base, display: `${n}/${T} tours` });
        continue;
      }

      rows.push({
        base,
        grade: (() => {
          const gs = new Set(mem.map((u) => gradeOf(u!.className)).filter((g): g is number => g !== null));
          return gs.size === 1 ? [...gs][0] : null;
        })(),
        medals1: (ord[t.id] ?? []).filter((m) => m && m.pos === 1).length,
        cards: cardsOf(ctx, t.id),
        finishMs: finishAt(ctx, t.id),
        scoreMs: scores.get(t.id)?.totalMs ?? Number.POSITIVE_INFINITY,
        fastestLapMs: durations.length ? Math.min(...durations) : null,
        firstLapMs: durations[0] ?? null,
        apexLapMs: durations.length > apexIdx ? durations[apexIdx] : null,
        lastLapMs: n >= T ? durations[T - 1] ?? null : null,
        apexReps: p[apexIdx] ?? ctx.settings.peak,
      });
    }
  }

  const grades = [...new Set(rows.map((r) => r.grade).filter((g): g is number => g !== null))].sort((a, b) => a - b);
  let pool = f.sex ? rows.filter((r) => r.base.sex === f.sex) : rows;
  if (f.grade) pool = pool.filter((r) => r.grade === f.grade);
  const apexReps = pool[0]?.apexReps ?? rows[0]?.apexReps ?? 0;

  const top = (
    id: string,
    title: string,
    hint: string,
    value: (r: Row) => number | null,
    lowerIsBetter: boolean,
    display: (v: number, r: Row) => string
  ): RecordBoard => {
    const scored = pool
      .map((r) => ({ r, v: value(r) }))
      .filter((x): x is { r: Row; v: number } => x.v !== null && Number.isFinite(x.v));
    scored.sort((a, b) => (lowerIsBetter ? a.v - b.v : b.v - a.v) || b.r.base.dateMs - a.r.base.dateMs);
    return { id, title, hint, rows: scored.slice(0, 5).map(({ r, v }) => ({ ...r.base, display: display(v, r) })) };
  };

  const boards: RecordBoard[] = [
    top("medals1", "🥇 Le plus de tours gagnés", "tours bouclés en premier", (r) => r.medals1, false, (v) => `${v} fois 1re`),
    top("time", "⏱️ Le temps le plus court", "du départ à l'arrivée", (r) => r.finishMs, true, (v) => fmtMs(v)),
    top("score", "🏆 Le meilleur score", "barème du Score final, le plus petit gagne", (r) => r.scoreMs, true, (v) => fmtSigned(v)),
    top("cards", "🟨 Le plus de cartes jaunes", "le palmarès dont on se passerait", (r) => r.cards, false, (v) => `${v} carte${v > 1 ? "s" : ""}`),
    top("fastestLap", "⚡ Le tour le plus rapide", "n'importe lequel des tours", (r) => r.fastestLapMs, true, (v) => fmtMs(v)),
    top("firstLap", "🚀 Le premier tour le plus rapide", "le départ canon", (r) => r.firstLapMs, true, (v) => fmtMs(v)),
    top("apexLap", `🔺 Le tour apex le plus rapide`, `le tour à ${apexReps} répétitions`, (r) => r.apexLapMs, true, (v) => fmtMs(v)),
    top("lastLap", "🏁 Le dernier tour le plus rapide", "le sprint final, équipes arrivées au bout", (r) => r.lastLapMs, true, (v) => fmtMs(v)),
  ];

  excluded.sort((a, b) => b.dateMs - a.dateMs);
  return { boards, excluded, grades, teamsScanned: pool.length, sessionsScanned };
}

