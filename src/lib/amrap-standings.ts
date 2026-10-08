import type { SessionStandings, StandingRow } from "@/lib/session-standings";
import { fmt, rankRows, ranks, type AmrapContext } from "@/lib/wod-engines/templates/amrap-engine";

// Classement « generique » d'une seance AMRAP (espace eleve, resultats) : tours, fin du dernier tour, depart.
// Module pur (partage par session-standings et standings-batch).
export function amrapRows(ctx: AmrapContext, ended: boolean, finishedAtMs: Record<string, number>): SessionStandings {
  const list = rankRows(ctx);
  const r = ranks(list);
  const n = ctx.settings.exercises.length;
  const rows: StandingRow[] = list.map((st, i) => ({
    rank: r[i],
    teamId: st.team.id,
    teamName: st.team.name,
    laps: st.laps,
    lapsTotal: 0, // pas de total : le plus de tours possible
    time: st.lastMs !== null ? fmt(st.lastMs) : null,
    late: null,
    start: `${st.startIndex + 1} · ${ctx.settings.exercises[st.startIndex]?.label ?? ""}`,
    reps: st.laps * n,
    cards: 0,
    done: ended,
  }));
  return { columns: { laps: "Tours", time: "Dernier tour", reps: "Exercices", cards: "🟨", start: "Départ" }, rows, finishedAtMs };
}
