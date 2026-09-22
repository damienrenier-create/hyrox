"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SessionPayload } from "@/lib/auth";
import { broadcastShot } from "@/lib/firebase/firebase-sync";
import { submitEvaluationAction } from "./actions";
import { Board, type BoardShip, type BoardTeam, type BoardExercise, type BoardMarker } from "./Board";

const REFRESH_MS = 5000;

type Shot = { teamId: string; exerciseId: string; hit: boolean };

type Props = {
  evaluator: SessionPayload;
  sessionId: string;
  teams: BoardTeam[];
  exercises: BoardExercise[];
  myShips: BoardShip[];
  myCells: string[]; // "teamId_exerciseId" des cases de MA flotte (verrouillee en amont)
  myShots: Shot[];
  hitsOnMyFleet: number;
  raceEnded: boolean;
  myScore: number;
};

export function ToucheCouleClient({ evaluator, sessionId, teams, exercises, myShips, myCells, myShots, hitsOnMyFleet, raceEnded, myScore }: Props) {
  const router = useRouter();
  const myCellSet = new Set(myCells);

  const [target, setTarget] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "hit" | "miss" | "alert" } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(myScore);
  const [localShots, setLocalShots] = useState<Shot[]>([]);

  // Rafraichissement automatique (remplace Firebase) : uniquement onglet visible et hors modale.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !target && !pending) router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router, target, pending]);

  // Alerte quand un de MES bateaux vient d'etre touche (detecte via le compteur serveur).
  const prevHits = useRef(hitsOnMyFleet);
  useEffect(() => {
    if (hitsOnMyFleet > prevHits.current) {
      showToast("💥 Un de tes bateaux vient d'être touché !", "alert");
    }
    prevHits.current = hitsOnMyFleet;
  }, [hitsOnMyFleet]);

  useEffect(() => {
    setScore(myScore);
    setLocalShots([]);
  }, [myScore, myShots]);

  function showToast(message: string, tone: "hit" | "miss" | "alert") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2200);
  }

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
      const hit = res.hits.length > 0;
      setLocalShots((prev) => [...prev, { teamId: t.teamId, exerciseId: t.exerciseId, hit }]);
      if (hit) {
        const sunk = res.hits.some((h) => h.sunk);
        setScore((s) => s + 1 + (sunk ? 3 : 0));
        showToast(sunk ? "💥 Bateau coulé !" : "💥 Touché !", "hit");
      } else {
        showToast("🌊 À l'eau !", "miss");
      }
      setTarget(null);
      setReps("");
      setNote(null);
      router.refresh();
    });
  };

  const shots = [...myShots, ...localShots];
  const markers: BoardMarker[] = shots.map((s) => ({ teamId: s.teamId, exerciseId: s.exerciseId, kind: s.hit ? "hit" : "miss" }));
  if (target) markers.push({ teamId: target.teamId, exerciseId: target.exerciseId, kind: "target" });

  return (
    <div className="min-h-[100dvh] text-amber-50 font-sans flex flex-col relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_#0d3b4f_0%,_#062230_55%,_#03141c_100%)]">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.message + toast.tone}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 top-24 z-50 flex justify-center pointer-events-none"
          >
            <div
              className={`px-6 py-4 rounded-full text-xl font-black shadow-2xl ${
                toast.tone === "hit"
                  ? "bg-red-600 text-red-50 shadow-[0_0_40px_rgba(220,38,38,0.9)]"
                  : toast.tone === "alert"
                    ? "bg-amber-500 text-slate-950 shadow-[0_0_40px_rgba(245,158,11,0.9)]"
                    : "bg-sky-700 text-sky-50 shadow-[0_0_30px_rgba(14,116,144,0.8)]"
              }`}
            >
              {toast.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="p-4 relative z-10 border-b border-amber-800/40 bg-[#062230]/80 backdrop-blur-md flex justify-between items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-widest text-amber-300 uppercase drop-shadow-[0_0_6px_rgba(217,180,80,0.4)]">Touché-Coulé 🏴‍☠️</h1>
          <div className="text-[10px] text-amber-200/50 truncate">{evaluator.name}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="px-3 py-1 bg-amber-900/30 rounded text-xs font-bold border border-amber-700 text-amber-300">🏆 {score} pts</div>
          <div className={`px-3 py-1 rounded text-xs font-bold border ${raceEnded ? "bg-slate-800 border-slate-600 text-slate-300" : "bg-emerald-900/40 border-emerald-700 text-emerald-300"}`}>
            {raceEnded ? "POST-WOD" : "EN COURS"}
          </div>
        </div>
      </header>

      <main className="flex-1 p-2 relative z-10 overflow-auto flex flex-col">
        <p className="text-[11px] text-amber-100/60 px-1 mb-1">Touche une case (équipe × exercice) pour évaluer, puis tirer. Tes bateaux sont affichés, les autres restent cachés.</p>
        <Board
          teams={teams}
          exercises={exercises}
          ships={myShips}
          markers={markers}
          onCellClick={(team, ex) => {
            if (pending || myCellSet.has(`${team.id}_${ex.id}`)) return;
            setTarget({ teamId: team.id, exerciseId: ex.id });
          }}
          isCellDisabled={(team, ex) => myCellSet.has(`${team.id}_${ex.id}`)}
          cellExtraClass={(team, ex) => (myCellSet.has(`${team.id}_${ex.id}`) ? "cursor-not-allowed" : "")}
        />
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
                Cible : <span className="text-white">{teams.find((t) => t.id === target.teamId)?.name}</span> / <span className="text-white">{exercises.find((e) => e.id === target.exerciseId)?.label}</span>
              </div>
              <button onClick={() => setTarget(null)} className="text-red-400 text-sm font-black bg-red-900/20 px-3 py-1 rounded-full">X ANNULER</button>
            </div>

            <div className="flex gap-3 mb-6">
              <div className="flex-[1] bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-center">
                <div className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-1">Reps</div>
                <div className="text-4xl font-black text-cyan-400">{reps || "0"}</div>
              </div>
              <div className="flex-[2] grid grid-cols-5 gap-1">
                {[{ l: "TI", v: -1, c: "text-red-500" }, { l: "I", v: 0, c: "text-orange-500" }, { l: "S", v: 3, c: "text-yellow-500" }, { l: "B", v: 4, c: "text-green-400" }, { l: "TB", v: 5, c: "text-emerald-400" }].map((n) => (
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
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((num) => (
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
