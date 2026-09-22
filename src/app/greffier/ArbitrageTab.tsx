"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { QUALITY_LEVELS, qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import type { BoardData } from "@/lib/referee-board";
import { RefereeLeaderboard } from "../touche-coule/Effects";

// Onglet « Arbitrage » du greffier (ecran projete) : ce que les arbitres ont observe case par case
// (reps medianes + qualite), et le classement pirate des arbitres, rafraichi toutes les 5 s.
export function ArbitrageTab({ board }: { board: BoardData }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [router]);

  const cellMap = new Map(board.cells.map((c) => [`${c.teamId}_${c.exerciseId}`, c]));
  const shotsByCell = new Map<string, { hits: number; misses: number }>();
  for (const s of board.shots) {
    const k = `${s.teamId}_${s.exerciseId}`;
    const v = shotsByCell.get(k) ?? { hits: 0, misses: 0 };
    if (s.hit) v.hits++;
    else v.misses++;
    shotsByCell.set(k, v);
  }
  const colorOf = (note: number) => QUALITY_LEVELS.find((l) => l.value === note)?.color ?? "text-slate-400";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <div className="overflow-auto bg-white rounded-xl border border-slate-200">
        <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100 flex flex-wrap gap-3">
          <span><b className="text-slate-900">{board.evaluationsCount}</b> évaluation(s) · <b className="text-slate-900">{board.shots.length}</b> tir(s) · <b className="text-slate-900">{board.referees.length}</b> arbitre(s)</span>
          <span>Case = reps médianes <b>×nb d'évals</b> + pastilles de qualité (TI→E). 💥 touché · 🌊 à l'eau</span>
        </div>
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-1 text-left border-b-2 border-slate-900">Équipe</th>
              {board.exercises.map((e, i) => (
                <th key={e.id} className="p-1 border-b-2 border-slate-900 font-bold text-[10px] uppercase max-w-[64px] truncate" title={e.label}>
                  {i + 1}. {e.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.teams.map((t) => (
              <tr key={t.id} className="odd:bg-slate-50">
                <td className="sticky left-0 bg-inherit p-1 font-bold whitespace-nowrap border-r border-slate-200">{t.name}</td>
                {board.exercises.map((e) => {
                  const c = cellMap.get(`${t.id}_${e.id}`);
                  const sh = shotsByCell.get(`${t.id}_${e.id}`);
                  return (
                    <td key={e.id} className="p-0.5 border border-slate-100 align-top min-w-[52px] h-[44px]">
                      {c ? (
                        <motion.div key={c.count} initial={{ scale: 1.15, backgroundColor: "#fef3c7" }} animate={{ scale: 1, backgroundColor: "#ffffff00" }} className="rounded px-1 py-0.5 leading-tight">
                          <div className="font-black text-sm text-slate-900">
                            {c.medianReps}<span className="text-[9px] text-slate-400 font-bold"> ×{c.count}</span>
                          </div>
                          <div className="flex flex-wrap gap-[2px]">
                            {c.notes.map((n, i) => (
                              <span key={i} className={`text-[9px] font-black ${colorOf(n)}`} title={QUALITY_LEVELS.find((l) => l.value === n)?.label}>
                                {qualityCodeFromValue(n) ?? "?"}
                              </span>
                            ))}
                          </div>
                        </motion.div>
                      ) : sh ? (
                        <div className="text-[10px] text-slate-400 px-1">{sh.hits ? `💥${sh.hits}` : ""}{sh.misses ? ` 🌊${sh.misses}` : ""}</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="bg-[#062230] text-amber-50 rounded-xl p-3 self-start">
        <h3 className="font-black text-amber-300 uppercase tracking-widest text-sm mb-2">🏴‍☠️ Classement des arbitres</h3>
        {board.referees.length === 0 ? (
          <p className="text-xs text-amber-100/60">Aucune flotte verrouillée pour l'instant.</p>
        ) : (
          <RefereeLeaderboard rows={board.referees} />
        )}
        <p className="text-[10px] text-amber-100/50 mt-2">+1 touché · +3 coulé · +1 par case intacte de sa flotte</p>
      </aside>
    </div>
  );
}
