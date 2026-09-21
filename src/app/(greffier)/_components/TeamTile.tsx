"use client";

import { motion } from "framer-motion";
import { TeamState } from "@/lib/wod-engines/core/types";

export function TeamTile({ team, onClick }: { team: TeamState; onClick: () => void }) {
  // Déterminer la couleur de fond (tier) en fonction de la progression
  // Logique factice pour le moment
  const bgClass = "bg-slate-800 text-white";

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`relative w-full rounded-xl p-2 flex flex-col items-center justify-center overflow-hidden min-h-[92px] ${bgClass}`}
    >
      <div className="text-xs font-bold opacity-85 leading-tight">
        {team.id}
      </div>
      <div className="text-3xl font-extrabold leading-none tracking-tight my-1">
        10 {/* Reps */}
      </div>
      <div className="text-[10.5px] opacity-90 truncate w-full px-1">
        Exo actuel
      </div>
      <div className="text-[9.5px] opacity-75 truncate w-full mt-0.5">
        {team.members.join(", ")}
      </div>

      {/* Cartes jaunes */}
      {team.yellowCards > 0 && (
        <div className="mt-1 w-full flex items-center justify-center gap-1 bg-yellow-200 text-yellow-900 text-[10px] font-bold rounded-lg px-1 py-0.5">
          <span className="w-2 h-3 bg-yellow-400 rounded-sm rotate-[-8deg] shadow-[0_0_0_1px_#A88700]"></span>
          x{team.yellowCards}
        </div>
      )}
    </motion.button>
  );
}
