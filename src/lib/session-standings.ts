import { buildRaceContext, teamFinishedAtMs } from "@/lib/race-context";
import { buildFFBundle } from "@/lib/fete-foraine-context";
import { standings, total, finishAt, startOf, fmt, timeline } from "@/lib/wod-engines/templates/pyramide-engine";
import { teamRows, fmt as ffFmt, colorOf } from "@/lib/wod-engines/templates/fete-foraine-engine";
import { buildLevelBundle, levelStandings, phaseExtras, teamFinishedAbsMs } from "@/lib/level-context";
import { levelLabel } from "@/lib/wod-engines/templates/level-engine";

// Classement « generique » d'une seance, quel que soit son moteur (Pyramide = tours, Fete Foraine = ateliers/score),
// pour l'espace eleve et la consultation admin. Les colonnes portent leur libelle selon le moteur.

export type StandingRow = {
  rank: number;
  teamId: string;
  teamName: string;
  laps: number;
  lapsTotal: number;
  time: string | null;
  late: string | null;
  start: string;
  reps: number;
  cards: number;
  done: boolean;
};

export type SessionStandings = {
  columns: { laps: string; time: string; reps: string; cards: string; start: string };
  rows: StandingRow[];
  finishedAtMs: Record<string, number>; // teamId -> heure absolue d'arrivee (fenetre d'auto-evaluation)
};

type SessionLike = { id: string; wodType: string; settings?: unknown; raceEndedAt?: unknown | null };

export async function buildSessionStandings(session: SessionLike): Promise<SessionStandings> {
  if (session.wodType === "LEVEL") {
    const b = await buildLevelBundle(session.id);
    const ranked = levelStandings(b);
    const finishedAtMs: Record<string, number> = {};
    const rows: StandingRow[] = ranked.map((p, i) => {
      const t = b.teams.find((x) => x.id === p.teamId);
      const abs = teamFinishedAbsMs(b, p);
      if (abs !== null) finishedAtMs[p.teamId] = abs;
      const cur = p.currentLevel ? b.levels.find((l) => l.number === p.currentLevel) ?? null : null;
      return {
        rank: i + 1,
        teamId: p.teamId,
        teamName: t?.name ?? p.teamId,
        laps: p.completedLevels,
        lapsTotal: b.levels.length,
        time: p.finishedMs !== null ? fmt(p.finishedMs) : p.lastTickMs !== null ? fmt(p.lastTickMs) : null,
        late: null,
        start: cur ? `${levelLabel(cur)} · ${p.currentDone}/${p.currentTotal}` : "🏁",
        reps: p.reps + phaseExtras(b, t?.order ?? -1).reps,
        cards: b.yellowCards.filter((c) => c.teamId === p.teamId).length + phaseExtras(b, t?.order ?? -1).cards,
        done: p.finishedMs !== null,
      };
    });
    return { columns: { laps: "Niveaux", time: "Dernière coche", reps: "Reps", cards: "🟨", start: "En cours" }, rows, finishedAtMs };
  }
  if (session.wodType === "FETE_FORAINE") {
    const b = await buildFFBundle(session.id);
    let rank = 0;
    const rows: StandingRow[] = teamRows(b.ctx).map((st) => {
      const done = st.score !== null;
      if (done) rank++;
      return {
        rank: done ? rank : 0,
        teamId: st.team.id,
        teamName: st.team.name,
        laps: st.exDone,
        lapsTotal: b.ctx.exercises.length,
        time: done ? ffFmt(st.score) : st.wod !== null ? ffFmt(st.wod) : null,
        late: null,
        start: colorOf(st.team),
        reps: st.corde.length,
        cards: st.pen,
        done,
      };
    });
    // Les equipes non classees prennent les rangs suivants, dans l'ordre d'affichage.
    let next = rank;
    for (const r of rows) if (!r.done) r.rank = ++next;
    return { columns: { laps: "Ateliers", time: "Score", reps: "Corde", cards: "Pén.", start: "Couleur" }, rows, finishedAtMs: b.finAbsMs };
  }

  const bundle = await buildRaceContext(session.id);
  const { ctx, teamNames, exerciseLabels } = bundle;
  const ended = !!session.raceEndedAt;
  const T = total(ctx.settings);
  const tl = timeline(ctx);
  const st = standings(ctx, ended);
  const finishedAtMs: Record<string, number> = {};
  for (const t of ctx.teams) {
    const abs = teamFinishedAtMs(bundle, finishAt(ctx, t.id));
    if (abs !== null) finishedAtMs[t.id] = abs;
  }
  const rows: StandingRow[] = st.map((s, i) => ({
    rank: i + 1,
    teamId: s.team.id,
    teamName: teamNames[s.team.id] ?? s.team.id,
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
