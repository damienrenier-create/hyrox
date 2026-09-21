"use client";

import { useState } from "react";
import { ClockBar } from "./_components/ClockBar";
import { TeamGrid } from "./_components/TeamGrid";
import { TeamState } from "@/lib/wod-engines/core/types";

// Données factices pour l'interface de base
const dummyTeams: TeamState[] = Array.from({ length: 24 }).map((_, i) => ({
  id: `Équipe ${i + 1}`,
  name: `Équipe ${i + 1}`,
  color: "jaune",
  members: ["Damien", "Sartay"],
  cordeJumps: 0,
  completedExercises: [],
  wodCompletedAt: null,
  penalties: 0,
  yellowCards: i % 4 === 0 ? 1 : 0, // Quelques cartes jaunes pour la démo
  finisherPoints: {},
}));

export default function GreffierDashboard() {
  const [teams, setTeams] = useState<TeamState[]>(dummyTeams);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24">
      <ClockBar />
      
      <main className="max-w-[1600px] mx-auto p-4">
        <div className="mb-6 p-4 border border-slate-200 rounded-xl bg-white shadow-sm flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-slate-700">Sommet de la pyramide</label>
            <div className="flex items-center gap-4 bg-slate-100 rounded-lg px-2 py-1">
              <button className="w-8 h-8 rounded-md bg-white border border-slate-200 font-bold hover:bg-slate-50">-</button>
              <span className="text-xl font-black min-w-[2ch] text-center">10</span>
              <button className="w-8 h-8 rounded-md bg-white border border-slate-200 font-bold hover:bg-slate-50">+</button>
            </div>
          </div>
          <div className="text-sm text-slate-500">
            Pyramide : 5 · 6 · 7 · 8 · 9 · 10 · 9 · 8 · 7 · 6 · 5
          </div>
        </div>

        <TeamGrid teams={teams} />
      </main>
    </div>
  );
}
