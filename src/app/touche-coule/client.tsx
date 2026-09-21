"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SessionPayload } from "@/lib/auth";
import { placeBoat, fireShot, listenToEvents } from "@/lib/firebase/firebase-sync";
import { PyramideClassique } from "@/lib/wod-engines/templates/pyramide";
const EXERCISES = PyramideClassique.exercises;

type Props = {
  evaluator: SessionPayload;
  sessionId: string;
  teams: { id: string; name: string }[];
};

export function ToucheCouleClient({ evaluator, sessionId, teams }: Props) {
  const [phase, setPhase] = useState<"PLACEMENT" | "COMBAT">("PLACEMENT");
  const [boats, setBoats] = useState<Set<string>>(new Set());
  
  // Modale
  const [target, setTarget] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<number | null>(null);

  // Animations/Events
  const [explosion, setExplosion] = useState<{ coord: string; message: string } | null>(null);

  useEffect(() => {
    if (phase === "COMBAT") {
      const unsubscribe = listenToEvents(sessionId, (events) => {
        // Obtenir le dernier événement
        const eventKeys = Object.keys(events || {});
        if (eventKeys.length > 0) {
          const lastEvent = events[eventKeys[eventKeys.length - 1]];
          if (lastEvent.type === "BOAT_HIT" && lastEvent.ownerId === evaluator.id) {
            setExplosion({ coord: lastEvent.coord, message: `💥 Bateau touché par ${lastEvent.shooterName} !` });
            setTimeout(() => setExplosion(null), 3000);
          }
        }
      });
      return () => unsubscribe();
    }
  }, [phase, sessionId, evaluator.id]);

  const toggleBoat = (teamId: string, exId: string) => {
    const key = `${teamId}_${exId}`;
    setBoats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmPlacement = async () => {
    // Placer les bateaux sur Firebase
    for (const key of boats) {
      const [tId, eId] = key.split("_");
      await placeBoat(sessionId, tId, eId, evaluator.id);
    }
    setPhase("COMBAT");
  };

  const handleKeypad = (num: string) => {
    if (reps.length < 3) setReps(prev => prev + num);
  };

  const handleFire = async () => {
    if (!target || !reps || note === null) return;
    await fireShot(sessionId, target.teamId, target.exerciseId, parseInt(reps), note, evaluator);
    setTarget(null);
    setReps("");
    setNote(null);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-cyan-50 font-mono flex flex-col relative overflow-hidden">
      {/* Background Radar */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150vw] h-[150vw] rounded-full border border-cyan-500/30" />
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/2 left-1/2 w-[100vw] h-[2px] origin-left bg-gradient-to-r from-cyan-400 to-transparent opacity-50"
        />
      </div>

      {explosion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-900/50 backdrop-blur-sm pointer-events-none">
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-4xl font-black text-red-100 bg-red-600 p-8 rounded-full shadow-[0_0_50px_rgba(220,38,38,1)]"
          >
            {explosion.message}
          </motion.div>
        </div>
      )}

      <header className="p-4 relative z-10 border-b border-cyan-900/50 bg-slate-950/80 backdrop-blur-md">
        <h1 className="text-xl font-black tracking-widest text-cyan-400 uppercase">Touché-Coulé</h1>
        <div className="text-[10px] text-cyan-600">
          Agent: {evaluator.name} | Rôle: {evaluator.role} | Phase: {phase}
        </div>
      </header>

      <main className="flex-1 p-2 relative z-10 overflow-auto">
        {phase === "PLACEMENT" && (
          <div className="mb-4 flex justify-between items-center">
            <span className="text-sm text-cyan-300">Placez vos navires stratégiquement</span>
            <button onClick={confirmPlacement} className="bg-cyan-600 px-4 py-2 rounded text-sm font-bold">VERROUILLER</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="flex gap-1 mb-1">
            <div className="w-16 flex-shrink-0" />
            {EXERCISES.map(ex => (
              <div key={ex.id} className="w-12 text-[8px] text-cyan-500 text-center uppercase rotate-45 origin-bottom-left h-16">{ex.label}</div>
            ))}
          </div>

          {teams.map(team => (
            <div key={team.id} className="flex gap-1 mb-1">
              <div className="w-16 flex-shrink-0 text-[10px] font-bold text-cyan-300 truncate pt-2">{team.name}</div>
              {EXERCISES.map(ex => {
                const coord = `${team.id}_${ex.id}`;
                const hasBoat = boats.has(coord);
                return (
                  <button
                    key={coord}
                    onClick={() => phase === "PLACEMENT" ? toggleBoat(team.id, ex.id) : setTarget({ teamId: team.id, exerciseId: ex.id })}
                    className={`w-12 h-12 flex-shrink-0 border rounded flex items-center justify-center transition-colors ${
                      hasBoat && phase === "PLACEMENT" ? "bg-cyan-600 border-cyan-400" : "bg-slate-900/50 border-cyan-900/30 hover:border-cyan-500"
                    }`}
                  >
                    {hasBoat && phase === "PLACEMENT" && "🚢"}
                    {target?.teamId === team.id && target?.exerciseId === ex.id && "🎯"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </main>

      {/* Modale de Tir */}
      <AnimatePresence>
        {target && (
          <motion.div
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 z-20 bg-slate-900 border-t border-cyan-800 p-4 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-4">
              <div className="text-cyan-300 font-bold">Cible: {teams.find(t => t.id === target.teamId)?.name} / {EXERCISES.find(e => e.id === target.exerciseId)?.label}</div>
              <button onClick={() => setTarget(null)} className="text-red-500 font-bold">ANNULER</button>
            </div>
            
            <div className="flex gap-2 mb-4">
              <div className="flex-1 bg-slate-950 rounded p-2 text-center">
                <div className="text-[10px] text-cyan-600">Reps</div>
                <div className="text-2xl font-black">{reps || "0"}</div>
              </div>
              <div className="flex-[2] grid grid-cols-5 gap-1">
                {[{l:'TI',v:-1}, {l:'I',v:0}, {l:'S',v:3}, {l:'B',v:4}, {l:'TB',v:5}].map(n => (
                  <button 
                    key={n.l}
                    onClick={() => setNote(n.v)}
                    className={`text-xs font-bold rounded ${note === n.v ? "bg-cyan-500 text-slate-900" : "bg-slate-800 text-cyan-300"}`}
                  >
                    {n.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[1,2,3,4,5,6,7,8,9,0].map(num => (
                <button key={num} onClick={() => handleKeypad(num.toString())} className="bg-slate-800 py-2 rounded text-lg font-bold">{num}</button>
              ))}
              <button onClick={() => setReps("")} className="bg-red-900/50 py-2 rounded text-red-400 font-bold col-span-2">DEL</button>
            </div>

            <button 
              onClick={handleFire}
              disabled={!reps || note === null}
              className="w-full bg-orange-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-black py-4 rounded text-xl shadow-[0_0_15px_rgba(234,88,12,0.3)] disabled:shadow-none"
            >
              FEU !
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
