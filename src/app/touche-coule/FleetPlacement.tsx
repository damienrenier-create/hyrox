"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { placeShipAction, undoLastShipAction, lockFleetAction } from "./actions";

type Ship = {
  id: string;
  size: number;
  orientation: "horizontal" | "vertical";
  startTeamId: string;
  startExerciseId: string;
};
type Team = { id: string; name: string };
type Exercise = { id: string; label: string };

const FLEET = [5, 4, 3, 2, 2, 1, 1, 1];

function getCells(ship: Ship, teams: Team[], exercises: Exercise[]): string[] {
  const tIdx = teams.findIndex((t) => t.id === ship.startTeamId);
  const eIdx = exercises.findIndex((e) => e.id === ship.startExerciseId);
  const cells: string[] = [];
  for (let i = 0; i < ship.size; i++) {
    if (ship.orientation === "horizontal") cells.push(`${teams[tIdx]?.id}_${exercises[eIdx + i]?.id}`);
    else cells.push(`${teams[tIdx + i]?.id}_${exercises[eIdx]?.id}`);
  }
  return cells;
}

// Forme du segment de coque pirate selon sa position dans le navire (proue/milieu/poupe).
function hullShape(ship: Ship, index: number): string {
  if (ship.size === 1) return "rounded-full";
  const isFirst = index === 0;
  const isLast = index === ship.size - 1;
  if (ship.orientation === "horizontal") {
    if (isFirst) return "rounded-l-full";
    if (isLast) return "rounded-r-full";
  } else {
    if (isFirst) return "rounded-t-full";
    if (isLast) return "rounded-b-full";
  }
  return "";
}

export function FleetPlacement({
  evaluator,
  sessionId,
  teams,
  exercises,
  ships: initialShips,
}: {
  evaluator: { name: string };
  sessionId: string;
  teams: Team[];
  exercises: Exercise[];
  ships: Ship[];
}) {
  const router = useRouter();
  const [ships, setShips] = useState(initialShips);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const currentIndex = ships.length;
  const done = currentIndex >= FLEET.length;

  const cellMap = new Map<string, { ship: Ship; index: number }>();
  ships.forEach((s) => {
    getCells(s, teams, exercises).forEach((c, i) => cellMap.set(c, { ship: s, index: i }));
  });

  function handleClick(teamId: string, exerciseId: string) {
    if (done || pending) return;
    setError("");
    startTransition(async () => {
      const res = await placeShipAction(sessionId, orientation, teamId, exerciseId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const size = FLEET[currentIndex];
      setShips((prev) => [
        ...prev,
        { id: `tmp_${prev.length}`, size, orientation, startTeamId: teamId, startExerciseId: exerciseId },
      ]);
    });
  }

  function handleUndo() {
    setError("");
    startTransition(async () => {
      const res = await undoLastShipAction(sessionId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setShips((prev) => prev.slice(0, -1));
    });
  }

  function handleLock() {
    setError("");
    startTransition(async () => {
      const res = await lockFleetAction(sessionId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh(); // le serveur bascule alors vers l'ecran d'arbitrage
    });
  }

  return (
    <div className="min-h-screen text-amber-50 font-sans p-4 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_#0d3b4f_0%,_#062230_55%,_#03141c_100%)]">
      {/* Ocean texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, transparent 0 18px, rgba(120,200,220,0.08) 18px 20px), repeating-linear-gradient(65deg, transparent 0 26px, rgba(120,200,220,0.06) 26px 28px)",
        }}
      />
      <div className="absolute top-3 right-4 text-3xl opacity-30 select-none pointer-events-none">🧭</div>

      <header className="mb-4 relative z-10">
        <h1 className="text-xl font-black text-amber-300 uppercase tracking-widest drop-shadow-[0_0_6px_rgba(217,180,80,0.4)]">
          Place ta flotte 🏴‍☠️
        </h1>
        <p className="text-sm text-amber-200/60">{evaluator.name}</p>
      </header>

      <div className="relative z-10 mb-4 bg-[#0a2a38]/80 border border-amber-800/40 p-4 rounded-xl flex items-center justify-between gap-4 flex-wrap backdrop-blur-sm">
        {!done ? (
          <>
            <div className="text-sm text-amber-100">
              Prochain navire : <b className="text-amber-300">{FLEET[currentIndex]}</b> case
              {FLEET[currentIndex] > 1 ? "s" : ""} ({currentIndex + 1}/{FLEET.length})
            </div>
            <button
              onClick={() => setOrientation((o) => (o === "horizontal" ? "vertical" : "horizontal"))}
              className="bg-[#0d3b4f] border border-amber-800/40 px-3 py-2 rounded text-amber-200 text-sm"
            >
              Orientation : {orientation === "horizontal" ? "↔️ horizontal" : "↕️ vertical"}
            </button>
          </>
        ) : (
          <div className="text-sm text-emerald-400 font-bold">⚓ Flotte complète — verrouille pour commencer à arbitrer.</div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            disabled={pending || ships.length === 0}
            className="bg-[#0d3b4f] border border-amber-800/40 px-3 py-2 rounded text-sm text-amber-200 disabled:opacity-40"
          >
            Annuler le dernier
          </button>
          {done && (
            <button
              onClick={handleLock}
              disabled={pending}
              className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded text-sm disabled:opacity-40"
            >
              Verrouiller ma flotte
            </button>
          )}
        </div>
      </div>

      {error && <p className="relative z-10 text-red-400 text-sm mb-3">{error}</p>}

      <div className="relative z-10 overflow-x-auto pb-8">
        <div className="flex gap-1 mb-1">
          <div className="w-16 flex-shrink-0" />
          {exercises.map((ex) => (
            <div
              key={ex.id}
              className="w-10 text-[8px] text-amber-200/50 text-center uppercase rotate-45 origin-bottom-left h-16"
            >
              {ex.label}
            </div>
          ))}
        </div>
        {teams.map((team) => (
          <div key={team.id} className="flex gap-1 mb-1">
            <div className="w-16 flex-shrink-0 text-[10px] font-bold text-amber-200 truncate pt-2" title={team.name}>
              {team.name}
            </div>
            {exercises.map((ex) => {
              const coord = `${team.id}_${ex.id}`;
              const segment = cellMap.get(coord);
              return (
                <button
                  key={coord}
                  disabled={!!segment || done || pending}
                  onClick={() => handleClick(team.id, ex.id)}
                  className="w-10 h-10 flex-shrink-0 border border-cyan-900/40 bg-[#0a2a38]/60 hover:bg-[#0d3b4f] rounded flex items-center justify-center relative"
                >
                  <AnimatePresence>
                    {segment && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 18 }}
                        className={`absolute inset-[3px] bg-gradient-to-br from-[#8B5A2B] to-[#4A2C10] border border-[#3a2208] shadow-inner ${hullShape(
                          segment.ship,
                          segment.index
                        )}`}
                      />
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
