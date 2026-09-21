"use client";

import { motion } from "framer-motion";

import { setRaceStatus } from "@/lib/firebase/firebase-sync";

export function ClockBar({ sessionId }: { sessionId: string }) {
  const startRace = async () => {
    await setRaceStatus(sessionId, "COMBAT");
  };

  return (
    <div className="sticky top-0 z-20 bg-white border-b-4 border-slate-900 px-4 py-3 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
      <div className="flex items-center gap-6">
        <h1 className="text-[3rem] font-black leading-none tracking-tight text-slate-300">
          0:00
        </h1>
        <div className="border-2 border-slate-200 rounded-xl px-3 py-1 text-right bg-white min-w-[120px]">
          <div className="text-[10px] font-extrabold tracking-widest uppercase text-slate-500">
            Temps limite
          </div>
          <div className="text-2xl font-black leading-tight text-slate-500">
            45:00
          </div>
        </div>
      </div>

      <div className="flex gap-2 w-full md:w-auto">
        <button 
          onClick={startRace}
          className="flex-1 md:flex-none bg-green-600 hover:bg-green-700 text-white font-black text-lg px-8 py-3 rounded-xl transition-colors active:scale-95"
        >
          Début de course
        </button>
      </div>
    </div>
  );
}
