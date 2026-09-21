"use client";

import { useState, useEffect } from "react";
import { ClockBar } from "./_components/ClockBar";
import { listenToGrid } from "@/lib/firebase/firebase-sync";
import { SessionPayload } from "@/lib/auth";
import { PyramideClassique } from "@/lib/wod-engines/templates/pyramide";
const EXERCISES = PyramideClassique.exercises;
import { TeamState } from "@/lib/wod-engines/core/types";
import { motion } from "framer-motion";

export function GreffierClient({ sessionId, initialTeams, evaluator }: { sessionId: string; initialTeams: any[]; evaluator: SessionPayload }) {
  const [grid, setGrid] = useState<Record<string, any>>({});

  useEffect(() => {
    const unsubscribe = listenToGrid(sessionId, (data) => {
      setGrid(data || {});
    });
    return () => unsubscribe();
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 font-sans">
      <ClockBar sessionId={sessionId} />
      
      <main className="max-w-[1800px] mx-auto p-4">
        <div className="mb-6 p-4 border border-slate-200 rounded-xl bg-white shadow-sm flex flex-wrap gap-6 items-center">
          <div className="text-xl font-black">TABLEAU DE BORD DU GREFFIER</div>
          <div className="text-sm text-slate-500 flex-1">
            Pyramide : Les diamants (Coach) masquent les étoiles (Élèves).
          </div>
          <button 
            onClick={() => {
              import('./actions').then(m => m.finishRaceAction(sessionId, JSON.stringify(grid)))
            }}
            className="bg-red-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-red-700 shadow-md transition-transform active:scale-95"
          >
            FIN DE COURSE (Sauvegarde)
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {initialTeams.map(team => {
            return (
              <div key={team.id} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                  <h3 className="font-black text-lg text-slate-800">{team.name}</h3>
                  <div className="flex gap-1">
                    {team.members.map((m: any) => (
                      <span key={m.id} className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">{m.user.name}</span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {EXERCISES.slice(0, 12).map(ex => {
                    const cellKey = `${team.id}_${ex.id}`;
                    const cellData = grid[cellKey];
                    const shots = cellData?.shots ? Object.values(cellData.shots) as any[] : [];
                    
                    // PARADOXE DIAMANT / ÉTOILE
                    const hasAdminShot = shots.some(s => s.role === "MASTER_ADMIN" || s.role === "ADMIN");
                    const hasStudentShot = shots.some(s => s.role === "STUDENT");

                    return (
                      <div key={ex.id} className="bg-slate-50 border border-slate-200 rounded p-2 text-center relative overflow-hidden h-16 flex flex-col items-center justify-center">
                        <div className="text-[9px] font-bold text-slate-400 mb-1 leading-tight">{ex.label.substring(0, 15)}</div>
                        
                        {shots.length === 0 ? (
                          <div className="text-slate-300 text-xs">-</div>
                        ) : hasAdminShot ? (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-xl drop-shadow-md">💎</motion.div>
                        ) : hasStudentShot ? (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-xl drop-shadow-md">⭐</motion.div>
                        ) : null}

                        {shots.length > 1 && !hasAdminShot && (
                          <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-[8px] font-bold px-1 rounded-bl">x{shots.length}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
