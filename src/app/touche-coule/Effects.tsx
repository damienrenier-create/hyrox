"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CELL, cellPos } from "./Board";

// Animations du Touche-Coule : eclaboussure (a l'eau), explosion (touche), naufrage (coule),
// points qui sautent, classement anime. Tout est CSS/Framer, sans asset supplementaire.

export type EffectKind = "splash" | "hit" | "sunk";
export type BoardEffect = { id: string; teamId: string; exerciseId: string; kind: EffectKind };

export const EFFECT_STYLES = `
@keyframes tc-ring { 0% { transform: scale(0.2); opacity: 0.9 } 100% { transform: scale(2.6); opacity: 0 } }
@keyframes tc-drop { 0% { transform: translate(0,0) scale(1); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0 } }
@keyframes tc-burst { 0% { transform: scale(0.2); opacity: 1 } 60% { transform: scale(1.4); opacity: 1 } 100% { transform: scale(1.9); opacity: 0 } }
@keyframes tc-spark { 0% { transform: translate(0,0) rotate(0deg); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) rotate(180deg); opacity: 0 } }
@keyframes tc-sink { 0% { transform: translateY(0) rotate(0deg); opacity: 1 } 100% { transform: translateY(26px) rotate(25deg); opacity: 0 } }
@keyframes tc-shake { 0%,100% { transform: translate(0,0) } 20% { transform: translate(-6px,2px) } 40% { transform: translate(6px,-2px) } 60% { transform: translate(-4px,1px) } 80% { transform: translate(4px,-1px) } }
.tc-shake { animation: tc-shake 0.45s ease-in-out; }
`;

const DROPS = [0, 45, 90, 135, 180, 225, 270, 315];

function Splash() {
  return (
    <>
      {[0, 120, 240].map((d) => (
        <span key={d} className="absolute inset-0 rounded-full border-2 border-sky-200/90" style={{ animation: `tc-ring 0.8s ease-out ${d}ms forwards` }} />
      ))}
      {DROPS.map((a) => {
        const r = 22;
        const dx = Math.cos((a * Math.PI) / 180) * r;
        const dy = Math.sin((a * Math.PI) / 180) * r - 10;
        return (
          <span
            key={a}
            className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-sky-100"
            style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px`, animation: "tc-drop 0.6s ease-out forwards" }}
          />
        );
      })}
    </>
  );
}

function Burst({ sunk }: { sunk: boolean }) {
  return (
    <>
      <span className={`absolute inset-0 rounded-full ${sunk ? "bg-red-500" : "bg-orange-400"}`} style={{ animation: "tc-burst 0.5s ease-out forwards", boxShadow: "0 0 24px 8px rgba(251,146,60,0.7)" }} />
      <span className="absolute inset-1 rounded-full bg-yellow-200" style={{ animation: "tc-burst 0.4s ease-out 60ms forwards" }} />
      {DROPS.map((a) => {
        const r = sunk ? 34 : 26;
        const dx = Math.cos((a * Math.PI) / 180) * r;
        const dy = Math.sin((a * Math.PI) / 180) * r;
        return (
          <span
            key={a}
            className={`absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-sm ${sunk ? "bg-red-300" : "bg-amber-300"}`}
            style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px`, animation: "tc-spark 0.7s ease-out forwards" }}
          />
        );
      })}
      {sunk && (
        <span className="absolute inset-0 flex items-center justify-center text-2xl" style={{ animation: "tc-sink 1.1s ease-in 250ms forwards" }}>
          ☠️
        </span>
      )}
    </>
  );
}

// Calque d'effets a placer DANS le conteneur relatif du plateau (prop `overlay` de Board).
export function BoardEffectsLayer({ effects, tIndex, eIndex, onDone }: { effects: BoardEffect[]; tIndex: Map<string, number>; eIndex: Map<string, number>; onDone: (id: string) => void }) {
  return (
    <>
      {effects.map((fx) => {
        const ti = tIndex.get(fx.teamId);
        const ei = eIndex.get(fx.exerciseId);
        if (ti === undefined || ei === undefined) return null;
        const { left, top } = cellPos(ti, ei);
        return <EffectAt key={fx.id} fx={fx} left={left} top={top} onDone={onDone} />;
      })}
    </>
  );
}

function EffectAt({ fx, left, top, onDone }: { fx: BoardEffect; left: number; top: number; onDone: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDone(fx.id), fx.kind === "sunk" ? 1500 : 900);
    return () => clearTimeout(t);
  }, [fx.id, fx.kind, onDone]);
  return (
    <div className="absolute pointer-events-none" style={{ left, top, width: CELL, height: CELL, zIndex: 9 }}>
      {fx.kind === "splash" ? <Splash /> : <Burst sunk={fx.kind === "sunk"} />}
    </div>
  );
}

// Badge de score : rebondit et affiche « +n » a chaque gain.
export function ScoreBadge({ score }: { score: number }) {
  const prev = useRef(score);
  const [delta, setDelta] = useState<{ id: number; value: number } | null>(null);
  useEffect(() => {
    const d = score - prev.current;
    prev.current = score;
    if (d > 0) {
      setDelta({ id: Date.now(), value: d });
      const t = setTimeout(() => setDelta(null), 1200);
      return () => clearTimeout(t);
    }
  }, [score]);
  return (
    <div className="relative">
      <motion.div
        key={score}
        initial={{ scale: 1.5, backgroundColor: "rgba(245,158,11,0.6)" }}
        animate={{ scale: 1, backgroundColor: "rgba(120,53,15,0.3)" }}
        transition={{ type: "spring", stiffness: 300, damping: 14 }}
        className="px-3 py-1 rounded text-xs font-bold border border-amber-700 text-amber-300"
      >
        🏆 {score} pts
      </motion.div>
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.id}
            initial={{ y: 0, opacity: 1, scale: 0.8 }}
            animate={{ y: -28, opacity: 0, scale: 1.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            className="absolute -top-1 right-0 text-amber-300 font-black text-base drop-shadow pointer-events-none"
          >
            +{delta.value}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export type LeaderboardRow = { refereeId: string; name: string; score: number; hits: number; sunk: number; intact: number };

// Classement des arbitres, lignes qui se reordonnent en glissant (layout animation).
export function RefereeLeaderboard({ rows, meId, compact }: { rows: LeaderboardRow[]; meId?: string | null; compact?: boolean }) {
  const shown = compact ? rows.slice(0, 5).concat(rows.slice(5).filter((r) => r.refereeId === meId)) : rows;
  const rankOf = new Map(rows.map((r, i) => [r.refereeId, i + 1]));
  return (
    <ul className="space-y-1">
      <AnimatePresence initial={false}>
        {shown.map((r) => {
          const rank = rankOf.get(r.refereeId) ?? 0;
          const me = r.refereeId === meId;
          return (
            <motion.li
              key={r.refereeId}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${me ? "bg-amber-400/20 border border-amber-400/60" : "bg-black/20 border border-transparent"}`}
            >
              <span className={`w-6 text-center font-black ${rank === 1 ? "text-yellow-300" : rank === 2 ? "text-slate-200" : rank === 3 ? "text-amber-600" : "text-slate-400"}`}>
                {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
              </span>
              <span className="flex-1 truncate font-bold">{r.name}{me ? " (toi)" : ""}</span>
              <span className="text-[10px] text-slate-300/80 whitespace-nowrap">💥{r.hits} ☠️{r.sunk} 🛡️{r.intact}</span>
              <motion.span key={r.score} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="font-black text-amber-300 w-12 text-right">
                {r.score}
              </motion.span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
