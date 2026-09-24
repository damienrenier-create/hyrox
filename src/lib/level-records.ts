import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed, fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import { activeCards, fmtIntensity, fmtTheoretical, progressOf, readEmomScores, readPenalties, type Loss, type Tick } from "@/lib/wod-engines/templates/level-engine";
import { readFrozenFromSettings } from "@/lib/level";
import { wodLabel } from "@/lib/student-sessions";
import { isTestClass } from "@/lib/session-roles";
import { readChild } from "@/lib/level-context";
import {
  BK_WINDOW, gradeOf, periodRange, readExcludedFromRecords,
  type RecordBoard, type RecordEntry, type RecordFilters, type RecordsResult, type TeamSex,
} from "@/lib/pyramide-records";

// Records du WOD Level, toutes classes et toutes seances confondues, memes filtres et meme invalidation
// que le Pyramide (Session.settings.excludedFromRecords). Calcule a la demande, jamais au rendu d'une course.

export const WINDOW_MIN = 30; // « le plus de travail en un temps donne » : les 30 premieres minutes
const MIN_REPS_FOR_INTENSITY = 200;

type Row = {
  base: Omit<RecordEntry, "display">;
  grade: number | null;
  levels: number;
  currentDone: number;
  lastTickMs: number | null;
  finishMs: number | null;
  reps: number;
  work: number;
  intensity: number | null;
  work30: number;
  reps30: number;
  losses: number; // vies perdues (mode zombies)
  bossMs: number | null; // BOSS le plus rapide (du dernier coche du niveau precedent a la coche du BOSS)
  bossNumber: number | null;
  cards: number;
  score: number | null; // finisher : maximum de cordes
};

export async function buildLevelRecords(f: RecordFilters = {}): Promise<RecordsResult> {
  const phase = f.phase ?? "wod";
  const sessions = await db.orm.public.Session.where({ wodType: "LEVEL" }).all();
  const allIds = sessions.map((s) => s.id);
  const raceStates = allIds.length ? await db.orm.public.RaceState.where((r) => r.sessionId.in(allIds)).all() : [];
  const rsBySession = new Map(raceStates.map((r) => [r.sessionId, r]));
  const dateOf = (s: (typeof sessions)[number]) => {
    const rs = rsBySession.get(s.id);
    return rs?.startedAt ? toMs(rs.startedAt) : s.opensAt ? toMs(s.opensAt) : toMs(s.createdAt);
  };
  const range = periodRange(f.period ?? "all");
  // « Cette seance » depuis le WOD principal : ses enfants comptent aussi (phase echauffement / finisher).
  const kept = sessions
    .filter((s) => (f.period === "session" && f.sessionId ? s.id === f.sessionId || readChild(s.settings)?.parentId === f.sessionId : true))
    .filter((s) => (range ? dateOf(s) >= range[0] && dateOf(s) < range[1] : true))
    .filter((s) => !!rsBySession.get(s.id)?.startedAt)
    .filter((s) => (phase === "wod" ? !readChild(s.settings) : readChild(s.settings)?.kind === phase)) // une phase a la fois
    .sort((a, b) => dateOf(b) - dateOf(a));
  if (!kept.length) return { boards: [], excluded: [], grades: [], teamsScanned: 0, sessionsScanned: 0 };

  const ids = kept.map((s) => s.id);
  const keptIds = new Set(ids);
  const rsIds = raceStates.filter((r) => keptIds.has(r.sessionId)).map((r) => r.id);
  const [allTeams, allTicks, allLosses, allPauses, allCards] = await Promise.all([
    db.orm.public.Team.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.LevelTick.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.LevelLoss.where((t) => t.sessionId.in(ids)).all(),
    rsIds.length ? db.orm.public.RacePause.where((p) => p.raceStateId.in(rsIds)).all() : Promise.resolve([]),
    rsIds.length ? db.orm.public.YellowCard.where((c) => c.raceStateId.in(rsIds)).all() : Promise.resolve([]),
  ]);
  const teamIds = allTeams.map((t) => t.id);
  const allMembers = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const userIds = [...new Set(allMembers.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };
  const teamsBy = group(allTeams, (t) => t.sessionId);
  const ticksBy = group(allTicks, (t) => t.sessionId);
  const lossesBy = group(allLosses, (l) => l.sessionId);
  const membersBy = group(allMembers, (m) => m.teamId);
  const pausesBy = group(allPauses, (p) => p.raceStateId);
  const cardsBy = group(allCards, (c) => c.raceStateId);

  const rows: Row[] = [];
  const excluded: RecordEntry[] = [];
  let sessionsScanned = 0;
  const WIN = WINDOW_MIN * 60_000;

  for (const s of kept) {
    const rs = rsBySession.get(s.id)!;
    const levels = readFrozenFromSettings(s.settings);
    if (!levels.length) continue;
    sessionsScanned++;
    const startedAtMs = toMs(rs.startedAt);
    const pauses = (pausesBy.get(rs.id) ?? []).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
    const pauseMarks = pauses.map((p) => elapsed(startedAtMs, pauses, p.from) ?? 0);
    const endMs = rs.endedAt ? elapsed(startedAtMs, pauses, toMs(rs.endedAt)) ?? 0 : null;
    const ticks: Tick[] = (ticksBy.get(s.id) ?? []).map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
    const losses: Loss[] = (lossesBy.get(s.id) ?? []).map((l) => ({ teamId: l.teamId, level: l.level, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
    const teams = (teamsBy.get(s.id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const sessionLabel = s.label ?? wodLabel(s.wodType);
    const dateMs = dateOf(s);
    const excludedIds = new Set(readExcludedFromRecords(s.settings));
    const scores = readEmomScores(s.settings);
    const cardWeight = new Map<string, { reps: number; weight: number }>();
    for (const l of levels) for (const { card, index } of activeCards(l)) cardWeight.set(`${l.number}_${index}`, { reps: card.reps, weight: card.weight });

    for (const t of teams) {
      const p = progressOf(levels, t.id, ticks, losses, readPenalties(s.settings));
      const score = scores[t.id] ?? null;
      if (p.reps === 0 && p.losses === 0 && score === null) continue;
      const mem = (membersBy.get(t.id) ?? []).map((m) => userById.get(m.userId)).filter((u) => !!u);
      if (!mem.length) continue;
      if (mem.some((u) => isTestClass(u!.className))) continue; // classe de test : jamais dans un palmares
      const sexes = new Set(mem.map((u) => u!.sex ?? "?"));
      const sex: TeamSex = sexes.size === 1 && sexes.has("F") ? "F" : sexes.size === 1 && sexes.has("M") ? "M" : "OPEN";
      const wodMs = p.finishedMs ?? endMs ?? p.lastTickMs ?? 0;
      const bk = wodMs > 0 && pauseMarks.some((m) => m >= BK_WINDOW[0] * wodMs && m <= BK_WINDOW[1] * wodMs);
      const base = {
        key: `${s.id}_${t.id}`, sessionId: s.id, teamId: t.id, bk, teamName: t.name,
        members: mem.map((u) => `${u!.firstName ?? ""}`.trim()).filter(Boolean),
        sex,
        classes: [...new Set(mem.map((u) => u!.className).filter((c): c is string => !!c))].sort().join(", "),
        sessionLabel, dateMs,
      };
      if (excludedIds.has(t.id)) {
        excluded.push({ ...base, display: `${p.completedLevels} niveau${p.completedLevels > 1 ? "x" : ""}` });
        continue;
      }
      // Travail et reps dans les 30 premieres minutes (fiches cochees avant la borne, entieres).
      let work30 = 0, reps30 = 0;
      for (const tk of ticks) {
        if (tk.teamId !== t.id || tk.atMs > WIN || !p.doneCards.has(`${tk.level}_${tk.card}`)) continue;
        const cw = cardWeight.get(`${tk.level}_${tk.card}`);
        if (cw) { work30 += cw.reps * cw.weight; reps30 += cw.reps; }
      }
      // BOSS le plus rapide : coche du BOSS moins derniere coche du niveau precedent (ou 0 si niveau 1).
      let bossMs: number | null = null, bossNumber: number | null = null;
      for (const l of levels) {
        if (!l.boss || l.number > p.completedLevels) continue;
        const bossTicks = ticks.filter((x) => x.teamId === t.id && x.level === l.number);
        const prevTicks = ticks.filter((x) => x.teamId === t.id && x.level === l.number - 1);
        if (!bossTicks.length) continue;
        const start = prevTicks.length ? Math.max(...prevTicks.map((x) => x.atMs)) : 0;
        const d = Math.max(...bossTicks.map((x) => x.atMs)) - start;
        if (d >= 0 && (bossMs === null || d < bossMs)) { bossMs = d; bossNumber = l.number; }
      }
      rows.push({
        base,
        grade: (() => { const gs = new Set(mem.map((u) => gradeOf(u!.className)).filter((g): g is number => g !== null)); return gs.size === 1 ? [...gs][0] : null; })(),
        // Une vague « max » (sans fiche) compte comme bouclee d'office : on ne compte que les niveaux a fiches.
        levels: Math.min(p.completedLevels, levels.filter((l) => activeCards(l).length > 0).length), currentDone: p.currentDone, lastTickMs: p.lastTickMs, finishMs: p.finishedMs, losses: p.losses,
        reps: p.reps, work: p.weighted, intensity: p.reps >= MIN_REPS_FOR_INTENSITY ? p.weighted / p.reps : null,
        work30, reps30, bossMs, bossNumber, cards: (cardsBy.get(rs.id) ?? []).filter((c) => c.teamId === t.id).length, score,
      });
    }
  }

  const grades = [...new Set(rows.map((r) => r.grade).filter((g): g is number => g !== null))].sort((a, b) => a - b);
  let pool = f.sex ? rows.filter((r) => r.base.sex === f.sex) : rows;
  if (f.grade) pool = pool.filter((r) => r.grade === f.grade);

  const top = (id: string, title: string, hint: string, value: (r: Row) => number | null, lowerIsBetter: boolean, display: (v: number, r: Row) => string, tie?: (a: Row, b: Row) => number): RecordBoard => {
    const scored = pool.map((r) => ({ r, v: value(r) })).filter((x): x is { r: Row; v: number } => x.v !== null && Number.isFinite(x.v));
    scored.sort((a, b) => (lowerIsBetter ? a.v - b.v : b.v - a.v) || (tie ? tie(a.r, b.r) : 0) || b.r.base.dateMs - a.r.base.dateMs);
    return { id, title, hint, rows: scored.slice(0, 5).map(({ r, v }) => ({ ...r.base, display: display(v, r) })) };
  };
  const lvlTie = (a: Row, b: Row) => a.losses - b.losses || b.currentDone - a.currentDone || (a.lastTickMs ?? Infinity) - (b.lastTickMs ?? Infinity);

  const unit = phase === "warmup" ? "série" : phase === "finisher" ? "vague" : "niv.";
  const boards: RecordBoard[] = phase === "finisher" ? [
    top("score", "🪢 Le plus de cordes au finisher", "maximum de cordes de la dernière vague", (r) => r.score, false, (v) => `${v} cordes`),
    top("levels", "🌊 Le plus de vagues bouclées", "vagues entièrement cochées, puis le moins de vagues perdues", (r) => (r.levels > 0 ? r.levels : null), false, (v, r) => `${v} vague${v > 1 ? "s" : ""}${r.losses ? ` · 💔 ${r.losses}` : ""}`, lvlTie),
    top("reps", "💪 Le plus de reps", "fiches entières validées pendant le finisher", (r) => (r.reps > 0 ? r.reps : null), false, (v) => `${v} reps`),
    top("work", "⚖️ Le plus de travail", "reps × pondération cumulées", (r) => (r.work > 0 ? r.work : null), false, (v) => fmtTheoretical(v)),
    top("lives", "🧟 Sans vague perdue", "vagues bouclées sans jamais être rattrapé", (r) => (r.losses === 0 && r.levels > 0 ? r.levels : null), false, (v) => `${v} vague${v > 1 ? "s" : ""} · 💔 0`),
    top("cards", "🟨 Le plus de cartes jaunes", "le palmarès dont on se passerait", (r) => (r.cards > 0 ? r.cards : null), false, (v) => `${v} carte${v > 1 ? "s" : ""}`),
  ] : [
    top("levels", phase === "warmup" ? "🔥 Le plus de séries bouclées" : "🧗 Le niveau le plus haut", `${unit === "niv." ? "niveaux" : "séries"} bouclé(e)s, puis le moins de vies perdues, puis le plus rapide`, (r) => r.levels, false, (v, r) => `${r.finishMs !== null ? `🏁 ${v} en ${fmt(r.finishMs)}` : `${v} ${unit} + ${r.currentDone} fiche${r.currentDone > 1 ? "s" : ""}`}${r.losses ? ` · 💔 ${r.losses}` : ""}`, lvlTie),
    top("lives", "🧟 Le plus loin sans perdre de vie", `${unit === "niv." ? "niveaux" : "séries"} bouclé(e)s sans jamais être rattrapé`, (r) => (r.losses === 0 && r.levels > 0 ? r.levels : null), false, (v) => `${v} ${unit} · 💔 0`, (a, b) => b.currentDone - a.currentDone),
    top("finish", phase === "warmup" ? "🏁 L'échauffement bouclé le plus vite" : "🏁 L'échelle bouclée le plus vite", "équipes arrivées au bout", (r) => r.finishMs, true, (v) => fmt(v)),
    top("reps", "💪 Le plus de reps", "fiches entières validées", (r) => r.reps, false, (v) => `${v} reps`),
    top("work", "⚖️ Le plus de travail", "reps × pondération cumulées", (r) => r.work, false, (v) => fmtTheoretical(v)),
    top("intensity", "🔥 L'intensité la plus haute", `pondération moyenne par rep, dès ${MIN_REPS_FOR_INTENSITY} reps`, (r) => r.intensity, false, (v) => fmtIntensity(v)),
    top("work30", `⏱️ Le plus de travail en ${WINDOW_MIN} min`, "fiches cochées dans la première demi-heure", (r) => (r.work30 > 0 ? r.work30 : null), false, (v, r) => `${fmtTheoretical(v)} · ${r.reps30} reps`),
    top("boss", "👹 Le BOSS le plus rapide", "du dernier niveau bouclé à la coche du BOSS", (r) => r.bossMs, true, (v, r) => `BOSS ${r.bossNumber} en ${fmt(v)}`),
    top("cards", "🟨 Le plus de cartes jaunes", "le palmarès dont on se passerait", (r) => (r.cards > 0 ? r.cards : null), false, (v) => `${v} carte${v > 1 ? "s" : ""}`),
  ];
  excluded.sort((a, b) => b.dateMs - a.dateMs);
  return { boards, excluded, grades, teamsScanned: pool.length, sessionsScanned };
}
