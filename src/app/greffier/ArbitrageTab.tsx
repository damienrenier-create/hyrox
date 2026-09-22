"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { QUALITY_LEVELS, qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import type { BoardData } from "@/lib/referee-board";
import { RefereeLeaderboard } from "../touche-coule/Effects";
import { ui } from "@/lib/ui";

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
  const colorOf = (note: number) => QUALITY_LEVELS.find((l) => l.value === note)?.color ?? "text-ink-3";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <div className={`${ui.card} overflow-auto`}>
        <div className="px-3 py-2 text-xs text-ink-2 border-b border-line flex flex-wrap gap-3">
          <span><b className="text-ink">{board.evaluationsCount}</b> évaluation(s) · <b className="text-ink">{board.shots.length}</b> tir(s) · <b className="text-ink">{board.referees.length}</b> arbitre(s)</span>
          <span>Case = reps médianes <b>×nb d&apos;évals</b> + pastilles de qualité (TI→E). 💥 touché · 🌊 à l&apos;eau</span>
          <span>💎 vue par un prof ou un coach · ⭐ vue seulement par des élèves · case vide = personne</span>
        </div>
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className={`${ui.th} sticky left-0 bg-card p-1`}>Équipe</th>
              {board.exercises.map((e, i) => (
                <th key={e.id} className={`${ui.th} p-1 max-w-[64px] truncate`} title={e.label}>
                  {i + 1}. {e.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.teams.map((t) => (
              <tr key={t.id} className="odd:bg-paper/60">
                <td className="sticky left-0 bg-inherit p-1 font-bold whitespace-nowrap border-r border-line">{t.name}</td>
                {board.exercises.map((e) => {
                  const c = cellMap.get(`${t.id}_${e.id}`);
                  const sh = shotsByCell.get(`${t.id}_${e.id}`);
                  return (
                    <td key={e.id} className="p-0.5 border border-line/70 align-top min-w-[52px] h-[44px]">
                      {c ? (
                        <motion.div key={c.count} initial={{ scale: 1.15, backgroundColor: "#fff0e5" }} animate={{ scale: 1, backgroundColor: "#ffffff00" }} className="rounded px-1 py-0.5 leading-tight">
                          <div className="font-display font-extrabold text-sm text-ink flex items-center justify-center gap-1">
                            {/* Le diamant du coach masque l'etoile des eleves : une case vue par un adulte est arbitree. */}
                            <span className="text-[11px] leading-none" title={c.byStaff ? "Évaluée par un prof ou un coach" : "Évaluée seulement par des élèves"}>
                              {c.byStaff ? "💎" : "⭐"}
                            </span>
                            {c.medianReps}<span className="text-[9px] text-ink-3 font-sans font-bold">×{c.count}</span>
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
                        <div className="text-[10px] text-ink-3 px-1">{sh.hits ? `💥${sh.hits}` : ""}{sh.misses ? ` 🌊${sh.misses}` : ""}</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className={`${ui.card} p-3 self-start border-sea/30`}>
        <h3 className="font-display font-bold text-sea-ink text-sm mb-2">🏴‍☠️ Classement des arbitres</h3>
        {board.referees.length === 0 ? (
          <p className={ui.hint}>Aucune flotte verrouillée pour l&apos;instant.</p>
        ) : (
          <RefereeLeaderboard rows={board.referees} />
        )}
        <p className={`${ui.hint} mt-2`}>+1 touché · +3 coulé · +1 par case intacte de sa flotte</p>
      </aside>
    </div>
  );
}
