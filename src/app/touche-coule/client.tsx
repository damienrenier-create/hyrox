"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SessionPayload } from "@/lib/auth";
import { placeShip, fireShot, listenToEvents, ShipData } from "@/lib/firebase/firebase-sync";
import { PyramideClassique } from "@/lib/wod-engines/templates/pyramide";
const EXERCISES = PyramideClassique.exercises;

const FLEET = [5, 4, 3, 2, 2, 1, 1, 1];

type Props = {
  evaluator: SessionPayload;
  sessionId: string;
  teams: { id: string; name: string }[];
};

export function ToucheCouleClient({ evaluator, sessionId, teams }: Props) {
  const [phase, setPhase] = useState<"PLACEMENT" | "COMBAT">("PLACEMENT");
  
  // Placement State
  const [ships, setShips] = useState<ShipData[]>([]);
  const [currentShipIndex, setCurrentShipIndex] = useState(0);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  
  // Modale Tir
  const [target, setTarget] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<number | null>(null);

  const [explosion, setExplosion] = useState<{ coord: string; message: string } | null>(null);

  const [globalStatus, setGlobalStatus] = useState<"PREPARATION" | "COMBAT" | "TERMINATED">("PREPARATION");

  useEffect(() => {
    import("firebase/database").then(({ ref, onValue, getDatabase }) => {
      const db = getDatabase();
      const statusRef = ref(db, `sessions/${sessionId}/status`);
      const unsubscribe = onValue(statusRef, (snapshot) => {
        const val = snapshot.val();
        if (val) setGlobalStatus(val);
      });
      return () => unsubscribe();
    });
  }, [sessionId]);

  useEffect(() => {
    if (phase === "COMBAT") {
      const unsubscribe = listenToEvents(sessionId, (events) => {
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

  const getCoords = (teamId: string, exId: string, length: number, orient: "horizontal" | "vertical") => {
    const tIdx = teams.findIndex(t => t.id === teamId);
    const eIdx = EXERCISES.findIndex(e => e.id === exId);
    if (tIdx === -1 || eIdx === -1) return null;

    const coords = [];
    if (orient === "horizontal") {
      if (eIdx + length > EXERCISES.length) return null;
      for (let i = 0; i < length; i++) {
        coords.push({ teamId: teams[tIdx].id, exerciseId: EXERCISES[eIdx + i].id });
      }
    } else {
      if (tIdx + length > teams.length) return null;
      for (let i = 0; i < length; i++) {
        coords.push({ teamId: teams[tIdx + i].id, exerciseId: EXERCISES[eIdx].id });
      }
    }
    return coords;
  };

  const attemptPlaceShip = (teamId: string, exId: string) => {
    if (currentShipIndex >= FLEET.length) return;
    
    const length = FLEET[currentShipIndex];
    const coords = getCoords(teamId, exId, length, orientation);
    if (!coords) return;

    // Check overlap
    const occupied = new Set(ships.flatMap(s => s.coords.map(c => `${c.teamId}_${c.exerciseId}`)));
    const hasOverlap = coords.some(c => occupied.has(`${c.teamId}_${c.exerciseId}`));
    if (hasOverlap) return;

    const newShip: ShipData = {
      id: `ship_${currentShipIndex}_${Date.now()}`,
      ownerId: evaluator.id,
      length,
      orientation,
      startTeamId: teamId,
      startExerciseId: exId,
      coords
    };

    setShips([...ships, newShip]);
    setCurrentShipIndex(currentShipIndex + 1);
  };

  const autoDeploy = () => {
    let placedShips: ShipData[] = [];
    const occupied = new Set<string>();

    for (let i = 0; i < FLEET.length; i++) {
      const length = FLEET[i];
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 2000) {
        attempts++;
        const orient = Math.random() > 0.5 ? "horizontal" : "vertical";
        const tIdx = Math.floor(Math.random() * teams.length);
        const eIdx = Math.floor(Math.random() * EXERCISES.length);
        const coords = getCoords(teams[tIdx].id, EXERCISES[eIdx].id, length, orient);
        
        if (coords) {
          const hasOverlap = coords.some(c => occupied.has(`${c.teamId}_${c.exerciseId}`));
          if (!hasOverlap) {
            coords.forEach(c => occupied.add(`${c.teamId}_${c.exerciseId}`));
            placedShips.push({
              id: `ship_${i}_${Date.now()}`,
              ownerId: evaluator.id,
              length,
              orientation: orient,
              startTeamId: teams[tIdx].id,
              startExerciseId: EXERCISES[eIdx].id,
              coords
            });
            placed = true;
          }
        }
      }
    }
    setShips(placedShips);
    setCurrentShipIndex(FLEET.length);
  };

  const handleKeypad = (num: string) => {
    if (reps.length < 3) setReps(prev => prev + num);
  };

  const confirmPlacement = async () => {
    if (ships.length < FLEET.length) return;
    for (const ship of ships) {
      await placeShip(sessionId, ship);
    }
    setPhase("COMBAT");
  };

  const handleFire = async () => {
    if (!target || !reps || note === null) return;
    await fireShot(sessionId, target.teamId, target.exerciseId, parseInt(reps), note, evaluator, globalStatus === "TERMINATED");
    setTarget(null);
    setReps("");
    setNote(null);
  };

  // Pre-compute ship cells mapping for faster rendering
  const shipCellsMap = new Map<string, { ship: ShipData, index: number }>();
  ships.forEach(s => {
    s.coords.forEach((c, idx) => {
      shipCellsMap.set(`${c.teamId}_${c.exerciseId}`, { ship: s, index: idx });
    });
  });

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-cyan-50 font-sans flex flex-col relative overflow-hidden">
      {/* Background Ocean/Radar */}
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

      <header className="p-4 relative z-10 border-b border-cyan-900/50 bg-slate-950/80 backdrop-blur-md flex justify-between items-center">
        <div>
          <h1 className="text-xl font-black tracking-widest text-cyan-400 uppercase">Touché-Coulé 🏴‍☠️</h1>
          <div className="text-[10px] text-cyan-600">Agent: {evaluator.name} | Rôle: {evaluator.role}</div>
        </div>
        <div className="px-3 py-1 bg-cyan-900/30 rounded text-xs font-bold border border-cyan-800">
          {phase}
        </div>
      </header>

      <main className="flex-1 p-2 relative z-10 overflow-auto flex flex-col">
        {phase === "PLACEMENT" && (
          <div className="mb-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-bold text-slate-300">Flotte (Reste: {FLEET.length - currentShipIndex})</span>
              <div className="flex gap-2">
                <button onClick={autoDeploy} className="bg-slate-800 hover:bg-slate-700 text-xs px-3 py-2 rounded text-cyan-400 font-bold border border-slate-700">AUTO-DÉPLOIEMENT</button>
                <button 
                  onClick={confirmPlacement} 
                  disabled={ships.length < FLEET.length}
                  className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-sm px-4 py-2 rounded font-bold transition-colors"
                >
                  VERROUILLER
                </button>
              </div>
            </div>
            
            {currentShipIndex < FLEET.length && (
              <div className="flex items-center gap-4 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400">Prochain Navire :</div>
                <div className="flex gap-1">
                  {Array.from({ length: FLEET[currentShipIndex] }).map((_, i) => (
                    <div key={i} className="w-4 h-4 bg-[#8B5A2B] rounded-sm"></div>
                  ))}
                </div>
                <button 
                  onClick={() => setOrientation(o => o === "horizontal" ? "vertical" : "horizontal")}
                  className="ml-auto bg-slate-800 p-2 rounded text-xs text-cyan-300 hover:bg-slate-700"
                >
                  Pivoter: {orientation === "horizontal" ? "↔️" : "↕️"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto pb-8">
          <div className="flex gap-1 mb-1">
            <div className="w-16 flex-shrink-0" />
            {EXERCISES.map(ex => (
              <div key={ex.id} className="w-10 text-[8px] text-slate-500 text-center uppercase rotate-45 origin-bottom-left h-16">{ex.label}</div>
            ))}
          </div>

          {teams.map(team => (
            <div key={team.id} className="flex gap-1 mb-1">
              <div className="w-16 flex-shrink-0 text-[10px] font-bold text-cyan-300 truncate pt-2" title={team.name}>{team.name}</div>
              {EXERCISES.map(ex => {
                const coord = `${team.id}_${ex.id}`;
                const segment = shipCellsMap.get(coord);
                
                // Calculer le style pirate
                let cellStyle = "bg-slate-900/40 border-slate-800 hover:bg-slate-800";
                
                if (segment && phase === "PLACEMENT") {
                  cellStyle = "bg-[#6A4017] border-[#4A2C10]"; // Bois Pirate Foncé
                  if (segment.ship.length > 1) {
                    if (segment.ship.orientation === "horizontal") {
                      if (segment.index === 0) cellStyle += " rounded-l-full border-l-2";
                      else if (segment.index === segment.ship.length - 1) cellStyle += " rounded-r-full border-r-2";
                    } else {
                      if (segment.index === 0) cellStyle += " rounded-t-full border-t-2";
                      else if (segment.index === segment.ship.length - 1) cellStyle += " rounded-b-full border-b-2";
                    }
                  } else {
                    cellStyle += " rounded-full border-2"; // Navire d'une case
                  }
                }

                // Désactiver le tir si c'est son propre bateau (Règle d'or: un arbitre ne peut pas se tirer dessus)
                const isOwnBoat = segment?.ship.ownerId === evaluator.id;
                const canShoot = phase === "COMBAT" && !isOwnBoat;

                return (
                  <button
                    key={coord}
                    disabled={phase === "COMBAT" && isOwnBoat}
                    onClick={() => {
                      if (phase === "PLACEMENT") {
                        attemptPlaceShip(team.id, ex.id);
                      } else if (canShoot) {
                        setTarget({ teamId: team.id, exerciseId: ex.id });
                      }
                    }}
                    className={`w-10 h-10 flex-shrink-0 border flex items-center justify-center transition-all duration-200 ${cellStyle} ${isOwnBoat && phase === "COMBAT" ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {segment && phase === "PLACEMENT" && <div className="w-1 h-1 bg-[#8B5A2B] rounded-full opacity-50"></div>}
                    {target?.teamId === team.id && target?.exerciseId === ex.id && "🎯"}
                    {isOwnBoat && phase === "COMBAT" && <span className="text-[8px] opacity-30">🏴‍☠️</span>}
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
            className="absolute bottom-0 left-0 right-0 z-20 bg-slate-900 border-t-4 border-cyan-600 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] rounded-t-3xl"
          >
            <div className="flex justify-between items-center mb-4 px-2">
              <div className="text-cyan-300 font-bold text-sm">
                Cible : <span className="text-white">{teams.find(t => t.id === target.teamId)?.name}</span> / <span className="text-white">{EXERCISES.find(e => e.id === target.exerciseId)?.label}</span>
              </div>
              <button onClick={() => setTarget(null)} className="text-red-400 text-sm font-black bg-red-900/20 px-3 py-1 rounded-full">X ANNULER</button>
            </div>
            
            <div className="flex gap-3 mb-6">
              <div className="flex-[1] bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-center">
                <div className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-1">Reps</div>
                <div className="text-4xl font-black text-cyan-400">{reps || "0"}</div>
              </div>
              <div className="flex-[2] grid grid-cols-5 gap-1">
                {[{l:'TI',v:-1, c:'text-red-500'}, {l:'I',v:0, c:'text-orange-500'}, {l:'S',v:3, c:'text-yellow-500'}, {l:'B',v:4, c:'text-green-400'}, {l:'TB',v:5, c:'text-emerald-400'}].map(n => (
                  <button 
                    key={n.l}
                    onClick={() => setNote(n.v)}
                    className={`text-sm font-black rounded-xl border-2 transition-all ${note === n.v ? `bg-slate-800 border-cyan-500 ${n.c} shadow-[0_0_10px_rgba(6,182,212,0.3)]` : "bg-slate-900 border-transparent text-slate-600 hover:bg-slate-800"}`}
                  >
                    {n.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[1,2,3,4,5,6,7,8,9,0].map(num => (
                <button key={num} onClick={() => handleKeypad(num.toString())} className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl text-xl font-black text-white shadow-sm transition-colors">{num}</button>
              ))}
              <button onClick={() => setReps("")} className="bg-slate-900 border border-red-900/50 py-3 rounded-xl text-red-500 font-black col-span-2 shadow-sm">EFFACER</button>
            </div>

            <button 
              onClick={handleFire}
              disabled={!reps || note === null}
              className="w-full bg-gradient-to-r from-red-600 to-orange-600 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 text-white font-black py-5 rounded-2xl text-2xl shadow-[0_0_20px_rgba(220,38,38,0.4)] disabled:shadow-none transition-all active:scale-[0.98]"
            >
              FEU ! 🚀
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
