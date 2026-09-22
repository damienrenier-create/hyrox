"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Geometrie du plateau (px). Toutes les positions sont calculees a partir des INDEX d'equipe/exercice,
// mais chaque case reste identifiee par (teamId, exerciseId) : l'index ne sert qu'a dessiner.
export const CELL = 40;
export const GAP = 4;
export const LABEL_W = 64;
export const HEADER_H = 72;

export type BoardTeam = { id: string; name: string };
export type BoardExercise = { id: string; label: string };
export type BoardShip = {
  id: string;
  size: number;
  orientation: "horizontal" | "vertical";
  direction?: "right" | "left" | "down" | "up" | null;
  startTeamId: string;
  startExerciseId: string;
  ghost?: boolean;
  dimmed?: boolean;
};
export type MarkerKind = "hit" | "miss" | "target" | "selected";
export type BoardMarker = { teamId: string; exerciseId: string; kind: MarkerKind };

export function cellPos(tIdx: number, eIdx: number) {
  return { left: LABEL_W + GAP + eIdx * (CELL + GAP), top: HEADER_H + GAP + tIdx * (CELL + GAP) };
}

const MARKER_ICON: Record<MarkerKind, ReactNode> = {
  hit: <span className="text-base drop-shadow">💥</span>,
  miss: <span className="text-[13px] opacity-80">🌊</span>,
  target: <span className="text-base">🎯</span>,
  selected: <span className="text-[11px] text-amber-300 font-black">⚓</span>,
};

export function ShipSprite({ ship, tIdx, eIdx, animate }: { ship: BoardShip; tIdx: number; eIdx: number; animate?: boolean }) {
  const horizontal = ship.orientation === "horizontal";
  const length = ship.size * CELL + (ship.size - 1) * GAP;
  const { left, top } = cellPos(tIdx, eIdx);
  const boxW = horizontal ? length : CELL;
  const boxH = horizontal ? CELL : length;
  // Le sprite est dessine a l'horizontale, proue a droite. On le retourne/tourne selon la direction.
  const transform =
    ship.direction === "left" ? "scaleX(-1)" : ship.direction === "down" ? "rotate(90deg)" : ship.direction === "up" ? "rotate(-90deg)" : "none";
  const spriteIndex = Math.min(5, Math.max(1, ship.size));

  return (
    <motion.div
      initial={animate ? { scale: 0.3, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 18 }}
      className="absolute pointer-events-none"
      style={{ left, top, width: boxW, height: boxH, zIndex: 5 }}
    >
      <div
        style={{
          position: "absolute",
          left: (boxW - length) / 2,
          top: (boxH - CELL) / 2,
          width: length,
          height: CELL,
          transform,
          transformOrigin: "center",
          opacity: ship.dimmed ? 0.45 : 1,
          filter: ship.ghost ? "grayscale(0.7) sepia(0.5) brightness(0.9)" : undefined,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/sprites/ship-${spriteIndex}.png`}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "pixelated" }}
        />
      </div>
    </motion.div>
  );
}

export function Board({
  teams,
  exercises,
  ships,
  markers,
  onCellClick,
  isCellDisabled,
  cellExtraClass,
  animateShips,
  overlay,
}: {
  teams: BoardTeam[];
  exercises: BoardExercise[];
  ships: BoardShip[];
  markers: BoardMarker[];
  onCellClick?: (team: BoardTeam, exercise: BoardExercise) => void;
  isCellDisabled?: (team: BoardTeam, exercise: BoardExercise) => boolean;
  cellExtraClass?: (team: BoardTeam, exercise: BoardExercise) => string;
  animateShips?: boolean;
  overlay?: ReactNode; // calque d'animations (effets de tir), positionne dans le repere du plateau
}) {
  const width = LABEL_W + GAP + exercises.length * (CELL + GAP);
  const height = HEADER_H + GAP + teams.length * (CELL + GAP);
  const tIndex = new Map(teams.map((t, i) => [t.id, i] as const));
  const eIndex = new Map(exercises.map((e, i) => [e.id, i] as const));
  const markerAt = new Map(markers.map((m) => [`${m.teamId}_${m.exerciseId}`, m.kind] as const));

  return (
    <div className="overflow-auto pb-6">
      <div
        className="relative rounded-xl border border-cyan-900/50 shadow-[inset_0_0_40px_rgba(0,0,0,0.35)]"
        style={{ width, height, backgroundImage: "url(/sprites/sea.jpg)", backgroundSize: "256px", imageRendering: "pixelated" }}
      >
        {/* En-tetes exercices */}
        {exercises.map((ex, i) => (
          <div
            key={ex.id}
            className="absolute flex items-end justify-center"
            style={{ left: LABEL_W + GAP + i * (CELL + GAP), top: 4, width: CELL, height: HEADER_H - 8 }}
            title={ex.label}
          >
            <span
              className="text-[9px] font-bold uppercase text-amber-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] leading-none"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: HEADER_H - 10, overflow: "hidden" }}
            >
              {ex.label}
            </span>
          </div>
        ))}

        {/* Etiquettes equipes */}
        {teams.map((team, i) => (
          <div
            key={team.id}
            className="absolute flex items-center pl-1 pr-1 text-[10px] font-bold text-amber-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] truncate"
            style={{ left: 0, top: HEADER_H + GAP + i * (CELL + GAP), width: LABEL_W, height: CELL }}
            title={team.name}
          >
            {team.name}
          </div>
        ))}

        {/* Cases */}
        {teams.map((team, ti) =>
          exercises.map((ex, ei) => {
            const { left, top } = cellPos(ti, ei);
            const kind = markerAt.get(`${team.id}_${ex.id}`);
            const disabled = isCellDisabled?.(team, ex) ?? false;
            return (
              <button
                key={`${team.id}_${ex.id}`}
                type="button"
                disabled={disabled}
                onClick={() => onCellClick?.(team, ex)}
                className={`absolute rounded border border-cyan-200/20 bg-[#062230]/35 hover:bg-[#0d3b4f]/70 flex items-center justify-center transition-colors ${
                  kind === "selected" ? "ring-2 ring-amber-300" : ""
                } ${cellExtraClass?.(team, ex) ?? ""}`}
                style={{ left, top, width: CELL, height: CELL, zIndex: 2 }}
                aria-label={`${team.name} · ${ex.label}`}
              >
                <span style={{ position: "relative", zIndex: 8 }}>{kind ? MARKER_ICON[kind] : null}</span>
              </button>
            );
          })
        )}

        {/* Navires (au-dessus des cases, sans capter les clics) */}
        {ships.map((ship) => {
          const ti = tIndex.get(ship.startTeamId);
          const ei = eIndex.get(ship.startExerciseId);
          if (ti === undefined || ei === undefined) return null;
          return <ShipSprite key={ship.id} ship={ship} tIdx={ti} eIdx={ei} animate={animateShips} />;
        })}

        {overlay}
      </div>
    </div>
  );
}
