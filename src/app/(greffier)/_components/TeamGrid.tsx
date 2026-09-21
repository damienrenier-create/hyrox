"use client";

import { TeamState } from "@/lib/wod-engines/core/types";
import { TeamTile } from "./TeamTile";

export function TeamGrid({ teams }: { teams: TeamState[] }) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 gap-2">
      {teams.map((team) => (
        <TeamTile 
          key={team.id} 
          team={team} 
          onClick={() => console.log("Clicked team", team.id)} 
        />
      ))}
    </div>
  );
}
