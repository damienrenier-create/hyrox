import { WodTemplate, WodEngineResult } from "../core/types";
import { HX_DEFAULT_STATIONS } from "./hyrox-engine";

// Seance « Hyrox » (Sartay 01/10) : 8 stations + runs, equipes de 2, depart decale, 50 min puis Cindy. Les stations
// sont des emplacements fixes st1..st8 (libelles et reps regles par seance dans Session.settings.hyrox) : elles servent
// aussi de colonnes au Touche-Coule des arbitres. Le comptage vit dans hyrox-engine.ts (module pur) ;
// calculateScores de l'ancienne interface n'est pas utilise.
export const HyroxWod: WodTemplate = {
  id: "HYROX",
  name: "Hyrox (8 stations + runs, par 2)",
  exercises: HX_DEFAULT_STATIONS.map((s, i) => ({ id: s.id, label: s.label, number: i + 1 })),
  raceDefaults: { rep0: 5, peak: 10, step: 1, capMin: 50, afterMin: 0, penMin: 1 },
  defaultTeams: 20,
  calculateScores(): WodEngineResult {
    return { teamScores: {}, runnerScores: {} };
  },
};
