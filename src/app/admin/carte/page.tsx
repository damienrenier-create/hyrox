import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildBoardData } from "@/lib/referee-board";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { Board, type BoardMarker } from "../../touche-coule/Board";

// Carte admin (lecture seule) : toutes les flottes (fantomes grisees), tous les tirs, classement des arbitres.
export default async function CartePage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");

  const { session: requested } = await searchParams;
  const sessions = (await db.orm.public.Session.where({ refereeMode: true }).orderBy((s) => s.createdAt.desc()).all());
  const session = (requested ? sessions.find((s) => s.id === requested) : null) ?? sessions[0] ?? null;
  const board = session ? await buildBoardData(session.id) : null;

  const markers: BoardMarker[] = [];
  if (board) {
    const last = new Map<string, "hit" | "miss">();
    for (const s of board.shots) last.set(`${s.teamId}_${s.exerciseId}`, s.hit ? "hit" : "miss");
    for (const [k, kind] of last) {
      const [teamId, exerciseId] = k.split("_");
      markers.push({ teamId, exerciseId, kind });
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-cyan-50 font-mono p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-black text-cyan-400 uppercase tracking-widest">Carte Touché-Coulé</h1>
        {user.role === "MASTER_ADMIN" && <Link href="/admin" className="text-sm text-cyan-300 underline">← Console</Link>}
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-sm text-cyan-300">Séance</label>
        <select name="session" defaultValue={session?.id ?? ""} className="bg-slate-900 border border-cyan-800 rounded p-2 text-sm">
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}{s.isActive ? " · ouverte" : ""}{s.raceEndedAt ? " · terminée" : ""}
            </option>
          ))}
        </select>
        <button type="submit" className="bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-bold px-4 py-2 rounded">Voir</button>
      </form>

      {!board ? (
        <p className="text-slate-400">Aucune séance avec arbitrage.</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
          <div className="bg-[#062230] rounded-xl p-2 text-amber-50">
            <p className="text-[11px] text-amber-100/60 px-1 mb-1">
              {board.ships.length} navire(s) · {board.shots.length} tir(s) · {board.evaluationsCount} évaluation(s). Les flottes fantômes apparaissent grisées, les navires coulés assombris.
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
            <div className="bg-slate-900 border border-cyan-900 rounded-xl p-3">
              <h2 className="font-bold text-cyan-300 mb-2">Arbitres</h2>
              {board.referees.length === 0 ? (
                <p className="text-xs text-slate-400">Aucune flotte réelle.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-cyan-900">
                      <th className="p-1">#</th><th className="p-1">Arbitre</th><th className="p-1">Pts</th><th className="p-1">💥</th><th className="p-1">☠️</th><th className="p-1">🌊</th><th className="p-1">🛡️</th><th className="p-1">Flotte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.referees.map((r, i) => (
                      <tr key={r.refereeId} className="border-b border-slate-800">
                        <td className="p-1">{i + 1}</td>
                        <td className="p-1 font-bold">{r.name} <span className="text-slate-500">{r.className ?? ""}</span></td>
                        <td className="p-1 font-black text-amber-300">{r.score}</td>
                        <td className="p-1">{r.hits}</td><td className="p-1">{r.sunk}</td><td className="p-1">{r.misses}</td><td className="p-1">{r.intact}/{r.cellsTotal}</td>
                        <td className="p-1 text-slate-400">{r.fleetLocked ? `${r.shipsTotal - r.shipsLost}/${r.shipsTotal} à flot` : "en placement"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="bg-slate-900 border border-cyan-900 rounded-xl p-3">
              <h2 className="font-bold text-cyan-300 mb-2">Navires</h2>
              <ul className="text-xs space-y-0.5 max-h-72 overflow-auto">
                {board.ships.map((s) => {
                  const t = board.teams.find((x) => x.id === s.startTeamId)?.name ?? "?";
                  const e = board.exercises.findIndex((x) => x.id === s.startExerciseId) + 1;
                  return (
                    <li key={s.id} className={s.sunk ? "text-red-300 line-through" : "text-slate-300"}>
                      {s.ghost ? "👻 " : ""}{s.refereeName} · taille {s.size} {s.orientation === "horizontal" ? "↔" : "↕"} · {t} / exo {e}{s.sunk ? " · coulé" : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
