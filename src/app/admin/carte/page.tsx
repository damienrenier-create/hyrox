import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildBoardData } from "@/lib/referee-board";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { Board, type BoardMarker } from "../../touche-coule/Board";
import { TopBar } from "../../_components/TopBar";
import { btn, ui } from "@/lib/ui";

// Carte admin (lecture seule) : toutes les flottes (fantomes grisees), tous les tirs, classement des arbitres.
export default async function CartePage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");

  const { session: requested } = await searchParams;
  const sessions = (await db.orm.public.Session.where({ refereeMode: true }).orderBy((s) => s.createdAt.desc()).all());
  const session = (requested ? sessions.find((s) => s.id === requested) : null) ?? sessions[0] ?? null;
  const board = session ? await buildBoardData(session.id) : null;

  // Dernier tir connu par case. On garde les identifiants tels quels : les reconstruire en coupant
  // la cle sur "_" casserait des qu'un moteur utiliserait un id d'exercice contenant un souligne.
  const markers: BoardMarker[] = [];
  if (board) {
    const last = new Map<string, BoardMarker>();
    for (const s of board.shots) {
      last.set(`${s.teamId}_${s.exerciseId}`, { teamId: s.teamId, exerciseId: s.exerciseId, kind: s.hit ? "hit" : "miss" });
    }
    markers.push(...last.values());
  }

  return (
    <div className={ui.page}>
      <TopBar title="Carte Touché-Coulé" wide back={user.role === "MASTER_ADMIN" ? { href: "/admin", label: "Console" } : undefined}>
        <form className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-ink-2">Séance</label>
          <select name="session" defaultValue={session?.id ?? ""} className={`${ui.input} w-auto max-w-full`}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}{s.isActive ? " · ouverte" : ""}{s.raceEndedAt ? " · terminée" : ""}
              </option>
            ))}
          </select>
          <button type="submit" className={btn.primary}>Voir</button>
        </form>
      </TopBar>

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6">
        {!board ? (
          <p className={ui.muted}>Aucune séance avec arbitrage.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
            <div className={`${ui.card} p-3`}>
              <p className={`${ui.hint} px-1 mb-2`}>
                <b className="text-ink">{board.ships.length}</b> navire(s) · <b className="text-ink">{board.shots.length}</b> tir(s) · <b className="text-ink">{board.evaluationsCount}</b> évaluation(s). Les flottes fantômes apparaissent grisées, les navires coulés assombris.
              </p>
              <Board
                teams={board.teams}
                exercises={board.exercises}
                ships={board.ships.map((s) => ({ ...s, dimmed: s.sunk }))}
                markers={markers}
                isCellDisabled={() => true}
              />
            </div>
            <aside className="space-y-4">
              <div className={`${ui.card} p-3`}>
                <h2 className={`${ui.h3} mb-2`}>Arbitres</h2>
                {board.referees.length === 0 ? (
                  <p className={ui.hint}>Aucune flotte réelle.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className={ui.th}>#</th><th className={ui.th}>Arbitre</th><th className={ui.th}>Pts</th><th className={ui.th}>💥</th><th className={ui.th}>☠️</th><th className={ui.th}>🌊</th><th className={ui.th}>🛡️</th><th className={ui.th}>Flotte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.referees.map((r, i) => (
                        <tr key={r.refereeId} className={ui.tr}>
                          <td className="p-1.5">{i + 1}</td>
                          <td className="p-1.5 font-bold">{r.name} <span className="text-ink-3 font-normal">{r.className ?? ""}</span></td>
                          <td className="p-1.5 font-black text-brand">{r.score}</td>
                          <td className="p-1.5">{r.hits}</td><td className="p-1.5">{r.sunk}</td><td className="p-1.5">{r.misses}</td><td className="p-1.5">{r.intact}/{r.cellsTotal}</td>
                          <td className="p-1.5 text-ink-2">{r.fleetLocked ? `${r.shipsTotal - r.shipsLost}/${r.shipsTotal} à flot` : "en placement"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className={`${ui.card} p-3`}>
                <h2 className={`${ui.h3} mb-2`}>Navires</h2>
                <ul className="text-xs space-y-0.5 max-h-72 overflow-auto">
                  {board.ships.map((s) => {
                    const t = board.teams.find((x) => x.id === s.startTeamId)?.name ?? "?";
                    const e = board.exercises.findIndex((x) => x.id === s.startExerciseId) + 1;
                    return (
                      <li key={s.id} className={s.sunk ? "text-danger line-through" : "text-ink-2"}>
                        {s.ghost ? "👻 " : ""}{s.refereeName} · taille {s.size} {s.orientation === "horizontal" ? "↔" : "↕"} · {t} / exo {e}{s.sunk ? " · coulé" : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
