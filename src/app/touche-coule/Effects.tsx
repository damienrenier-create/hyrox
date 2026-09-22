"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CELL, cellPos } from "./Board";
import { cx } from "@/lib/ui";

// Animations du Touche-Coule : eclaboussure (a l'eau), explosion (touche), naufrage (coule),
// points qui sautent, classement anime.
// Les trois effets de tir sont des planches de 4 frames (public/sprites/fx-*.png, generees par
// scripts/build-sprites.mjs) jouees en steps(4) : une frame occupe exactement une case du plateau.

export type EffectKind = "splash" | "hit" | "sunk";
export type BoardEffect = { id: string; teamId: string; exerciseId: string; kind: EffectKind };

const FRAMES = 4;

// Chaque planche fait 4 frames carrees ; a l'ecran une frame = une case (CELL px).
const SHEET: Record<EffectKind, { src: string; ms: number }> = {
  splash: { src: "/sprites/fx-splash.png", ms: 640 },
  hit: { src: "/sprites/fx-fire.png", ms: 760 },
  sunk: { src: "/sprites/fx-sink.png", ms: 1250 },
};

export const EFFECT_STYLES = `
@keyframes tc-frames { from { background-position: 0 0 } to { background-position: -${CELL * FRAMES}px 0 } }
@keyframes tc-shake { 0%,100% { transform: translate(0,0) } 20% { transform: translate(-6px,2px) } 40% { transform: translate(6px,-2px) } 60% { transform: translate(-4px,1px) } 80% { transform: translate(4px,-1px) } }
.tc-shake { animation: tc-shake 0.45s ease-in-out; }
.tc-sheet {
  width: ${CELL}px; height: ${CELL}px;
  background-repeat: no-repeat;
  background-size: ${CELL * FRAMES}px ${CELL}px;
  image-rendering: pixelated;
  animation-name: tc-frames;
  animation-timing-function: steps(${FRAMES});
  animation-fill-mode: forwards;
}
@media (prefers-reduced-motion: reduce) { .tc-sheet { animation-duration: 1ms !important } }
`;

function SheetFx({ kind }: { kind: EffectKind }) {
  const { src, ms } = SHEET[kind];
  return <span className="tc-sheet block" style={{ backgroundImage: `url(${src})`, animationDuration: `${ms}ms` }} />;
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
    // On retire l'effet quand sa derniere frame a fini de s'afficher (+ une marge).
    const t = setTimeout(() => onDone(fx.id), SHEET[fx.kind].ms + 150);
    return () => clearTimeout(t);
  }, [fx.id, fx.kind, onDone]);
  return (
    <div className="absolute pointer-events-none" style={{ left, top, width: CELL, height: CELL, zIndex: 9 }}>
      <SheetFx kind={fx.kind} />
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
    if (d !== 0) {
      // Le score peut baisser : chaque case encore intacte de sa flotte vaut 1 point, donc
      // encaisser un tir coute un point. On le montre plutot que de laisser le chiffre glisser.
      setDelta({ id: Date.now(), value: d });
      const t = setTimeout(() => setDelta(null), 1200);
      return () => clearTimeout(t);
    }
  }, [score]);
  return (
    <div className="relative">
      <motion.div
        key={score}
        initial={{ scale: 1.5, backgroundColor: "rgba(255,122,47,0.85)" }}
        animate={{ scale: 1, backgroundColor: "rgba(255,240,229,1)" }}
        transition={{ type: "spring", stiffness: 300, damping: 14 }}
        className="px-3 py-1 rounded-full text-xs font-bold border border-accent/50 text-accent-ink"
      >
        🏆 {score} pts
      </motion.div>
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.id}
            initial={{ y: 0, opacity: 1, scale: 0.8 }}
            animate={{ y: delta.value > 0 ? -28 : 28, opacity: 0, scale: 1.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            className={cx(
              "absolute -top-1 right-0 font-display font-extrabold text-base pointer-events-none",
              delta.value > 0 ? "text-accent-ink" : "text-danger-ink"
            )}
          >
            {delta.value > 0 ? `+${delta.value}` : delta.value}
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
              className={cx("flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm border", me ? "bg-accent-soft border-accent/60" : "bg-paper border-transparent")}
            >
              <span className={cx("w-6 text-center font-black", rank === 1 ? "text-warn-ink" : rank === 2 ? "text-ink-2" : rank === 3 ? "text-amber-800" : "text-ink-3")}>
                {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
              </span>
              <span className="flex-1 truncate font-bold text-ink">{r.name}{me ? " (toi)" : ""}</span>
              <span className="text-[10px] text-ink-3 whitespace-nowrap">💥{r.hits} ☠️{r.sunk} 🛡️{r.intact}</span>
              <motion.span key={r.score} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="font-display font-extrabold text-brand w-12 text-right tabular-nums">
                {r.score}
              </motion.span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
