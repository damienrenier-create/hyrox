import { WodTemplate, WodEngineResult } from "../core/types";
import { HX_DEFAULT_STATIONS } from "./hyrox-engine";

// Seance « Eval » (ex-« Hyrox », Sartay 01-03/10 ; identifiant HYROX inchange) : 9 stations, un run apres chaque station,
// 2 tours, equipes de 3, depart decale, 50 min. Les stations sont des emplacements st1..stN regles par seance
// (Session.settings.hyrox) : elles servent aussi de colonnes au Touche-Coule des arbitres (session-exercises.ts). Le
// comptage vit dans hyrox-engine.ts (module pur) ; calculateScores de l'ancienne interface n'est pas utilise.
export const HyroxWod: WodTemplate = {
  id: "HYROX",
  name: "Eval (stations + runs, 2 tours, par 3)",
  exercises: HX_DEFAULT_STATIONS.map((s, i) => ({ id: s.id, label: s.label, number: i + 1 })),
  raceDefaults: { rep0: 5, peak: 10, step: 1, capMin: 50, afterMin: 0, penMin: 1 },
  defaultTeams: 16,
  calculateScores(): WodEngineResult {
    return { teamScores: {}, runnerScores: {} };
  },
};
