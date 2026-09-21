"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type CellState = "water" | "hit" | "miss" | "target";

// Données factices pour l'interface
const TEAMS = Array.from({ length: 12 }).map((_, i) => ({
  id: `T${i + 1}`,
  name: `Équipe ${i + 1}`,
}));

export default function ToucheCouleApp() {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [reps, setReps] = useState<string>("");
  const [shots, setShots] = useState<Record<string, CellState>>({});

  const handleKeypad = (num: string) => {
    if (reps.length < 3) setReps(prev => prev + num);
  };

  const handleFire = () => {
    if (!selectedTeam || !reps) return;
    
    // Logique factice: si reps > 10, c'est Touché, sinon Coulé à l'eau
    const isHit = parseInt(reps) > 10;
    
    setShots(prev => ({
      ...prev,
      [selectedTeam]: isHit ? "hit" : "miss"
    }));
    
    setSelectedTeam(null);
    setReps("");
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-cyan-50 font-mono flex flex-col relative overflow-hidden">
      {/* Background Radar Effect */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150vw] h-[150vw] rounded-full border border-cyan-500/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] h-[100vw] rounded-full border border-cyan-500/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50vw] h-[50vw] rounded-full border border-cyan-500/30 bg-cyan-900/10" />
        {/* Ligne radar qui tourne */}
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/2 left-1/2 w-[100vw] h-[2px] origin-left bg-gradient-to-r from-cyan-400 to-transparent opacity-50"
        />
      </div>

      <header className="p-4 relative z-10 border-b border-cyan-900/50 bg-slate-950/80 backdrop-blur-md flex justify-between items-center">
        <div>
          <h1 className="text-xl font-black tracking-widest text-cyan-400 uppercase">Touché-Coulé</h1>
          <div className="text-[10px] text-cyan-600">Module Arbitrage • Radar Actif</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-orange-500">240</div>
          <div className="text-[10px] uppercase tracking-wider text-orange-700">Points Gagnés</div>
        </div>
      </header>

      <main className="flex-1 p-4 relative z-10 flex flex-col">
        <div className="text-xs text-center text-cyan-500 mb-4 uppercase tracking-widest">
          Sélectionnez une cible (Équipe)
        </div>

        {/* Grille de Bataille Navale */}
        <div className="grid grid-cols-4 gap-2 mb-8">
          {TEAMS.map(team => {
            const state = shots[team.id] || "water";
            const isSelected = selectedTeam === team.id;
            
            return (
              <motion.button
                key={team.id}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedTeam(team.id)}
                className={`
                  relative aspect-square rounded-lg border-2 flex items-center justify-center overflow-hidden
                  ${isSelected ? "border-cyan-300 bg-cyan-900/50 shadow-[0_0_15px_rgba(34,211,238,0.5)]" : "border-cyan-900/40 bg-slate-900"}
                `}
              >
                <div className="z-10 text-xs font-bold">{team.id}</div>
                
                {/* Effet d'eau (Radar) */}
                {state === "water" && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.1)_0%,transparent_70%)]" />
                )}

                {/* Hit (Touché - Explosion) */}
                {state === "hit" && (
                  <div className="absolute inset-0 bg-orange-600 flex items-center justify-center">
                    <span className="text-2xl">🔥</span>
                  </div>
                )}

                {/* Miss (À l'eau) */}
                {state === "miss" && (
                  <div className="absolute inset-0 bg-blue-900/80 flex items-center justify-center">
                    <span className="text-xl opacity-50">🌊</span>
                  </div>
                )}

                {/* Crosshair si sélectionné */}
                {isSelected && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-1/2 left-0 w-full h-[1px] bg-cyan-400" />
                    <div className="absolute left-1/2 top-0 h-full w-[1px] bg-cyan-400" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border border-cyan-400" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Panneau de Tir (Keypad) */}
        <AnimatePresence>
          {selectedTeam && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-slate-900 border border-cyan-800 p-4 rounded-3xl shadow-2xl mb-4"
            >
              <div className="flex justify-between items-end mb-4">
                <div>
                  <div className="text-xs text-cyan-600 uppercase tracking-wider">Cible Verrouillée</div>
                  <div className="text-xl font-bold text-cyan-300">{selectedTeam}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-cyan-600 uppercase tracking-wider">Reps Observées</div>
                  <div className="text-3xl font-black text-white h-10">{reps || "0"}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                  <button 
                    key={num}
                    onClick={() => handleKeypad(num.toString())}
                    className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-xl font-bold border border-slate-700 active:bg-cyan-900"
                  >
                    {num}
                  </button>
                ))}
                <button 
                  onClick={() => setReps("")}
                  className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-sm font-bold border border-slate-700 text-red-400 active:bg-red-900"
                >
                  DEL
                </button>
                <button 
                  onClick={() => handleKeypad("0")}
                  className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-xl font-bold border border-slate-700 active:bg-cyan-900"
                >
                  0
                </button>
                <button 
                  onClick={handleFire}
                  disabled={!reps}
                  className="bg-orange-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:border-slate-700 hover:bg-orange-500 py-3 rounded-xl text-lg font-black tracking-widest border border-orange-500 active:scale-95 transition-all text-white shadow-[0_0_15px_rgba(234,88,12,0.5)]"
                >
                  FEU!
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
