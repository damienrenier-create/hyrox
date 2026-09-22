"use client";

import { useState, useEffect, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SessionPayload } from "@/lib/auth";
import { broadcastShot, listenToEvents, listenToRaceStatus } from "@/lib/firebase/firebase-sync";
import { submitEvaluationAction } from "./actions";

type Team = { id: string; name: string };
type Exercise = { id: string; label: string };

type Props = {
  evaluator: SessionPayload;
  sessionId: string;
  teams: Team[];
  exercises: Exercise[];
  myCells: string[]; // "teamId_exerciseId" des cases occupees par MA flotte (placee et verrouillee en amont)
  myScore: number;
};

export function ToucheCouleClient({ evaluator, sessionId, teams, exercises, myCells, myScore }: Props) {
  const myCellSet = new Set(myCells);

  // Modale Tir
  const [target, setTarget] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<number | null>(null);

  const [explosion, setExplosion] = useState<{ coord: string; message: string } | null>(null);
  const [globalStatus, setGlobalStatus] = useState<"PREPARATION" | "COMBAT" | "TERMINATED">("PREPARATION");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(myScore);

  useEffect(() => {
    const unsubscribe = listenToRaceStatus(sessionId, (status) => setGlobalStatus(status as typeof globalStatus));
    return () => unsubscribe();
  }, [sessionId]);

  useEffect(() => {
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
  }, [sessionId, evaluator.id]);

  const handleKeypad = (num: string) => {
    if (reps.length < 3) setReps((prev) => prev + num);
  };

  const handleFire = () => {
    if (!target || !reps || note === null) return;
    const t = target;
    const r = parseInt(reps);
    const n = note;
    setError("");
    startTransition(async () => {
      const res = await submitEvaluationAction(sessionId, t.teamId, t.exerciseId, r, n);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const coord = `${t.teamId}_${t.exerciseId}`;
      void broadcastShot(sessionId, coord, evaluator, r, n, res.hits); // diffusion live, jamais bloquante
      if (res.hits.length > 0) {
        const sunk = res.hits.some((h) => h.sunk);
        setScore((s) => s + 1 + (sunk ? 3 : 0));
        setExplosion({ coord, message: sunk ? "💥 Bateau coulé !" : "💥 Touché !" });
        setTimeout(() => setExplosion(null), 2000);
      }
      setTarget(null);
      setReps("");
      setNote(null);
    });
  };

  return (
    <div className="min-h-[100dvh] text-amber-50 font-sans flex flex-col relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_#0d3b4f_0%,_#062230_55%,_#03141c_100%)]">
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, transparent 0 18px, rgba(120,200,220,0.08) 18px 20px), repeating-linear-gradient(65deg, transparent 0 26px, rgba(120,200,220,0.06) 26px 28px)",
        }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150vw] h-[150vw] rounded-full border border-cyan-500/20 pointer-events-none opacity-20" />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        className="absolute top-1/2 left-1/2 w-[100vw] h-[2px] origin-left bg-gradient-to-r from-cyan-400 to-transparent opacity-20 pointer-events-none"
      />

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

      <header className="p-4 relative z-10 border-b border-amber-800/40 bg-[#062230]/80 backdrop-blur-md flex justify-between items-center">
        <div>
          <h1 className="text-xl font-black tracking-widest text-amber-300 uppercase drop-shadow-[0_0_6px_rgba(217,180,80,0.4)]">Touché-Coulé 🏴‍☠️</h1>
          <div className="text-[10px] text-amber-200/50">Agent: {evaluator.name} | Rôle: {evaluator.role}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 bg-amber-900/30 rounded text-xs font-bold border border-amber-700 text-amber-300">
            🏆 {score} pts
          </div>
          <div className="px-3 py-1 bg-cyan-900/30 rounded text-xs font-bold border border-cyan-800">
            {globalStatus === "TERMINATED" ? "POST-WOD" : "COMBAT"}
          </div>
        </div>
      </header>

      <main className="flex-1 p-2 relative z-10 overflow-auto flex flex-col">
        <div className="overflow-x-auto pb-8">
          <div className="flex gap-1 mb-1">
            <div className="w-16 flex-shrink-0" />
            {exercises.map((ex) => (
              <div key={ex.id} className="w-10 text-[8px] text-amber-200/40 text-center uppercase rotate-45 origin-bottom-left h-16">{ex.label}</div>
            ))}
          </div>

          {teams.map((team) => (
            <div key={team.id} className="flex gap-1 mb-1">
              <div className="w-16 flex-shrink-0 text-[10px] font-bold text-amber-200 truncate pt-2" title={team.name}>{team.name}</div>
              {exercises.map((ex) => {
                const coord = `${team.id}_${ex.id}`;
                const isOwnBoat = myCellSet.has(coord);
                const canShoot = !isOwnBoat;

                return (
                  <button
                    key={coord}
                    disabled={isOwnBoat}
                    onClick={() => { if (canShoot) setTarget({ teamId: team.id, exerciseId: ex.id }); }}
                    className={`w-10 h-10 flex-shrink-0 border border-cyan-900/40 rounded flex items-center justify-center transition-all duration-200 relative overflow-hidden ${isOwnBoat ? "bg-gradient-to-br from-[#8B5A2B] to-[#4A2C10] border-[#3a2208] cursor-not-allowed" : "bg-[#0a2a38]/50 hover:bg-[#0d3b4f]"}`}
                  >
                    {target?.teamId === team.id && target?.exerciseId === ex.id && "🎯"}
                    {isOwnBoat && <span className="text-[9px] opacity-60">🏴‍☠️</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </main>

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
                Cible : <span className="text-white">{teams.find(t => t.id === target.teamId)?.name}</span> / <span className="text-white">{exercises.find(e => e.id === target.exerciseId)?.label}</span>
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

            {error && <p className="text-red-400 text-sm mb-3 text-center">{error}</p>}

            <button
              onClick={handleFire}
              disabled={!reps || note === null || pending}
              className="w-full bg-gradient-to-r from-red-600 to-orange-600 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 text-white font-black py-5 rounded-2xl text-2xl shadow-[0_0_20px_rgba(220,38,38,0.4)] disabled:shadow-none transition-all active:scale-[0.98]"
            >
              {pending ? "…" : "FEU ! 🚀"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
