import { WodTemplate, TeamState, WodEngineResult } from "../core/types";

export const PyramideClassique: WodTemplate = {
  id: "PYRAMIDE_CLASSIQUE",
  name: "Pyramide 24 Équipes",
  exercises: [
    { id: "ex1", label: "Commando bras", number: 1 },
    { id: "ex2", label: "Fentes disque", number: 2 },
    { id: "ex3", label: "Kettlebell swing", number: 3 },
    { id: "ex4", label: "Burpees", number: 4 },
    { id: "ex5", label: "Hélicoptère", number: 5 },
    { id: "ex6", label: "Box jump", number: 6 },
    { id: "ex7", label: "Tractions", number: 7 },
    { id: "ex8", label: "Pompes", number: 8 },
    { id: "ex9", label: "Squats", number: 9 },
    { id: "ex10", label: "Snatch", number: 10 },
    { id: "ex11", label: "Corde à sauter", number: 11 },
    { id: "ex12", label: "Commando jambes", number: 12 }
  ],

  // « var NOSTART = { "Hélicoptère":1, "Corde à sauter":1 } » du fichier d'origine : personne ne demarre
  // sur ces deux ateliers, le round-robin des departs les saute (ex5 et ex11).
  noStartExerciseIds: ["ex5", "ex11"],

  calculateScores(teams: TeamState[], startTime: number, unitMs: number, mode: "avg" | "sum"): WodEngineResult {
    const result: WodEngineResult = {
      teamScores: {},
      runnerScores: {}
    };

    for (const team of teams) {
      const wodTimeMs = team.wodCompletedAt ? team.wodCompletedAt - startTime : null;
      const penaltyMs = team.penalties * unitMs;
      const baseTimeMs = wodTimeMs !== null ? wodTimeMs + penaltyMs : null;

      // Calcul du Finisher d'équipe
      let sumFinisher = 0;
      team.members.forEach(memberId => {
        sumFinisher += team.finisherPoints[memberId] || 0;
      });

      const avgFinisher = team.members.length ? sumFinisher / team.members.length : 0;
      const teamFinisherPts = mode === "sum" ? sumFinisher : avgFinisher;

      // Score d'équipe = Temps + Pénalités - Finisher (en ms)
      const teamScore = baseTimeMs !== null 
        ? Math.max(0, baseTimeMs - (teamFinisherPts * unitMs))
        : null;

      result.teamScores[team.id] = {
        score: teamScore,
        wodTimeMs,
        penaltyMs
      };

      // Score individuel = Temps d'équipe (avec pénalités) - Finisher individuel
      team.members.forEach(memberId => {
        const memberPts = team.finisherPoints[memberId] || 0;
        const runnerScore = baseTimeMs !== null
          ? Math.max(0, baseTimeMs - (memberPts * unitMs))
          : null;
          
        result.runnerScores[memberId] = {
          score: runnerScore
        };
      });
    }

    return result;
  }
};
