"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
export type MarkerKind = "hit" | "miss" | "target" | "selected" | "wreck";
export type SeaTile = "sea" | "sea-foam";
// `own` = cette case est a MOI (un de mes bateaux encaisse, ou mon navire est coule ici). Le sprite d'impact
// est le meme qu'on tape ou qu'on encaisse : sans ce drapeau, l'eleve ne peut pas savoir si l'epave est la
// sienne ou celle d'un adversaire. Il est rendu par un liseré rouge sur la case, lisible d'un coup d'oeil.
export type BoardMarker = { teamId: string; exerciseId: string; kind: MarkerKind; own?: boolean };
export type BoardHighlight = { teamId: string; exerciseId: string } | null;

// Position d'une case DANS LE CORPS du plateau (hors etiquettes) : le corps est un conteneur relatif
// separe des en-tetes, qui eux restent colles (sticky) pendant le defilement sur mobile.
export function cellPos(tIdx: number, eIdx: number) {
  return { left: GAP + eIdx * (CELL + GAP), top: GAP + tIdx * (CELL + GAP) };
}

// Marqueurs fixes : sprites pixel art detoures (voir scripts/build-sprites.mjs). Le point d'ancrage
// « selected » (placement de flotte) reste un glyphe : il n'a pas de sprite et doit rester tres lisible.
function MarkerSprite({ name, size = CELL }: { name: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/sprites/${name}.png`}
      alt=""
      draggable={false}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

const MARKER_ICON: Record<MarkerKind, ReactNode> = {
  hit: <MarkerSprite name="fx-hit" />,
  miss: <MarkerSprite name="fx-miss" />,
  target: <MarkerSprite name="fx-target" />,
  wreck: <MarkerSprite name="fx-wreck" />,
  selected: <span className="text-[11px] text-accent font-black drop-shadow">⚓</span>,
};

export function ShipSprite({ ship, tIdx, eIdx, animate, opacity = 1 }: { ship: BoardShip; tIdx: number; eIdx: number; animate?: boolean; opacity?: number }) {
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
          // Un navire pose ne doit pas cacher les cases qu'il couvre : l'appelant choisit sa transparence
          // (placement : bien visible ; arbitrage : discret). Un navire coule reste attenue.
          opacity: ship.dimmed ? Math.min(0.45, opacity) : opacity,
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
  tile = "sea",
  highlight = null,
  shipOpacity = 1,
  maxHeight = "72dvh",
}: {
  teams: BoardTeam[];
  exercises: BoardExercise[];
  ships: BoardShip[];
  markers: BoardMarker[];
  onCellClick?: (team: BoardTeam, exercise: BoardExercise) => void;
  isCellDisabled?: (team: BoardTeam, exercise: BoardExercise) => boolean;
  cellExtraClass?: (team: BoardTeam, exercise: BoardExercise) => string;
  animateShips?: boolean;
  overlay?: ReactNode; // calque d'animations (effets de tir), positionne dans le repere du CORPS du plateau
  tile?: SeaTile; // mer agitee au placement, mer calme en arbitrage (lisibilite des marqueurs)
  highlight?: BoardHighlight; // case en cours : sa ligne (equipe) et sa colonne (exercice) sont surlignees
  shipOpacity?: number; // transparence des navires poses (1 = opaque)
  maxHeight?: string; // hauteur max de la zone defilante (les en-tetes restent colles)
}) {
  const bodyW = GAP + exercises.length * (CELL + GAP);
  const bodyH = GAP + teams.length * (CELL + GAP);
  const tIndex = new Map(teams.map((t, i) => [t.id, i] as const));
  const eIndex = new Map(exercises.map((e, i) => [e.id, i] as const));
  const markerAt = new Map(markers.map((m) => [`${m.teamId}_${m.exerciseId}`, m] as const));
  const hlTeam = highlight?.teamId ?? null;
  const hlEx = highlight?.exerciseId ?? null;

  // Fond des en-tetes : opaque et sombre, pour rester lisibles quand la grille defile dessous.
  const headerBg = "rgba(6, 34, 48, 0.94)";

  // Zoom : la grille Pyramide fait ~596 px de large, un telephone en fait 360. On choisit au premier rendu
  // le plus grand zoom qui fait tenir TOUTE la largeur (jusqu'a 55 %), et l'arbitre ajuste avec − / +.
  // `zoom` (et non `transform`) : le conteneur defilant est recalcule et les en-tetes collants continuent de coller.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [needsZoom, setNeedsZoom] = useState(false);
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current) return;
    const avail = wrapRef.current?.clientWidth ?? 0;
    if (avail <= 0) return;
    const full = LABEL_W + bodyW;
    autoDone.current = true;
    if (full > avail) {
      setNeedsZoom(true);
      setZoom(Math.max(0.55, Math.floor((avail / full) * 100) / 100));
    }
  }, [bodyW]);

  return (
    <div ref={wrapRef}>
      {needsZoom && (
        <div className="flex items-center justify-end gap-1 mb-1">
          <span className="text-[10px] text-ink-3 mr-auto">Toute la grille tient à l&apos;écran — zoome pour viser plus large.</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}
            className="w-9 h-9 rounded-lg bg-card border border-line font-black text-ink shadow-card active:scale-95"
            aria-label="Dézoomer la grille"
          >
            −
          </button>
          <span className="text-[11px] text-ink-2 tabular-nums w-10 text-center font-bold">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.15) * 100) / 100))}
            className="w-9 h-9 rounded-lg bg-card border border-line font-black text-ink shadow-card active:scale-95"
            aria-label="Zoomer la grille"
          >
            +
          </button>
        </div>
      )}
      <div className="overflow-auto pb-2 rounded-2xl border-2 border-sea/40 shadow-card" style={{ maxHeight, WebkitOverflowScrolling: "touch" }}>
      <div
        style={{
          zoom,
          display: "grid",
          gridTemplateColumns: `${LABEL_W}px ${bodyW}px`,
          gridTemplateRows: `${HEADER_H}px ${bodyH}px`,
          width: LABEL_W + bodyW,
          height: HEADER_H + bodyH,
        }}
      >
        {/* Coin : colle en haut a gauche */}
        <div style={{ position: "sticky", top: 0, left: 0, zIndex: 30, background: headerBg }} className="flex items-end justify-center pb-1">
          <span className="text-[9px] font-bold uppercase text-white/60">éq. ↓ · exo →</span>
        </div>

        {/* En-tetes exercices : colles en haut */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: headerBg, height: HEADER_H }} className="relative">
          {exercises.map((ex, i) => {
            const on = ex.id === hlEx;
            return (
              <div
                key={ex.id}
                className={`absolute flex items-end justify-center rounded-t-md transition-colors ${on ? "bg-accent" : ""}`}
                style={{ left: GAP + i * (CELL + GAP), top: 4, width: CELL, height: HEADER_H - 4 }}
                title={ex.label}
              >
                <span
                  className={`text-[9px] font-bold uppercase leading-none pb-1 ${on ? "text-ink" : "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"}`}
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: HEADER_H - 12, overflow: "hidden" }}
                >
                  {ex.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Etiquettes equipes : collees a gauche */}
        <div style={{ position: "sticky", left: 0, zIndex: 20, background: headerBg, width: LABEL_W }} className="relative">
          {teams.map((team, i) => {
            const on = team.id === hlTeam;
            return (
              <div
                key={team.id}
                className={`absolute flex items-center px-1 text-[10px] font-bold truncate rounded-l-md transition-colors ${on ? "bg-accent text-ink" : "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"}`}
                style={{ left: 0, top: GAP + i * (CELL + GAP), width: LABEL_W, height: CELL }}
                title={team.name}
              >
                {team.name}
              </div>
            );
          })}
        </div>

        {/* Corps : mer + cases + navires + effets, dans un repere commun (cellPos) */}
        <div
          className="relative"
          style={{ width: bodyW, height: bodyH, backgroundImage: `url(/sprites/${tile}.jpg)`, backgroundSize: "256px", imageRendering: "pixelated" }}
        >
          {/* Bandes de surbrillance : toute la ligne de l'equipe et toute la colonne de l'exercice */}
          {hlTeam !== null && tIndex.has(hlTeam) && (
            <div className="absolute pointer-events-none bg-accent/25" style={{ left: 0, top: cellPos(tIndex.get(hlTeam)!, 0).top - GAP / 2, width: bodyW, height: CELL + GAP, zIndex: 1 }} />
          )}
          {hlEx !== null && eIndex.has(hlEx) && (
            <div className="absolute pointer-events-none bg-accent/25" style={{ left: cellPos(0, eIndex.get(hlEx)!).left - GAP / 2, top: 0, width: CELL + GAP, height: bodyH, zIndex: 1 }} />
          )}

          {/* Cases. Une case marquee passe AU-DESSUS des navires (z 5) : sinon l'impact sur un de mes
              propres bateaux serait masque par le sprite du bateau. */}
          {teams.map((team, ti) =>
            exercises.map((ex, ei) => {
              const { left, top } = cellPos(ti, ei);
              const marker = markerAt.get(`${team.id}_${ex.id}`);
              const kind = marker?.kind;
              // Case a moi qui encaisse : liseré rouge et fond rouge, pour la distinguer d'un coup porte
              // a un adversaire, qui utilise pourtant le meme sprite d'impact.
              const ownHit = marker?.own && (marker.kind === "hit" || marker.kind === "wreck");
              const disabled = isCellDisabled?.(team, ex) ?? false;
              const inLine = team.id === hlTeam || ex.id === hlEx;
              const isHl = team.id === hlTeam && ex.id === hlEx;
              return (
                <button
                  key={`${team.id}_${ex.id}`}
                  type="button"
                  // `aria-disabled` plutot que `disabled` : un bouton natif desactive n'emet aucun clic,
                  // donc un tap sur une case fermee ne disait RIEN sur mobile (pas de curseur pour aider).
                  // La case reste inerte, mais l'ecran peut expliquer pourquoi elle l'est.
                  aria-disabled={disabled || undefined}
                  onClick={() => onCellClick?.(team, ex)}
                  className={`absolute rounded-md border flex items-center justify-center transition-colors ${
                    isHl ? "ring-4 ring-accent border-accent bg-accent/40" : inLine ? "border-accent/70 bg-white/15" : "border-white/40 bg-white/10 hover:bg-white/35"
                  } ${kind === "selected" ? "ring-2 ring-accent bg-white/30" : ""} ${ownHit ? "ring-2 ring-danger border-danger bg-danger/35" : ""} ${cellExtraClass?.(team, ex) ?? ""}`}
                  style={{ left, top, width: CELL, height: CELL, zIndex: kind || isHl ? 6 : 2 }}
                  aria-label={`${team.name} · ${ex.label}`}
                >
                  <span>{kind ? MARKER_ICON[kind] : null}</span>
                </button>
              );
            })
          )}

          {/* Navires (au-dessus des cases, sans capter les clics) */}
          {ships.map((ship) => {
            const ti = tIndex.get(ship.startTeamId);
            const ei = eIndex.get(ship.startExerciseId);
            if (ti === undefined || ei === undefined) return null;
            return <ShipSprite key={ship.id} ship={ship} tIdx={ti} eIdx={ei} animate={animateShips} opacity={shipOpacity} />;
          })}

          {overlay}
        </div>
      </div>
      </div>
    </div>
  );
}
