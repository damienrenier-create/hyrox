import { WodTemplate, WodEngineResult } from "../core/types";
import { AMRAP_DEFAULT_EXERCISES, AMRAP_DEFAULTS } from "./amrap-engine";

// Seance « AMRAP » (Sartay 08/10) : le plus de tours possible en 20 minutes, 20 equipes, un clic du greffier par tour.
// Le comptage vit dans amrap-engine.ts (module pur) ; calculateScores de l'ancienne interface n'est pas utilise.
// Pas de taille d'equipe fixe : la seance s'ouvre avec 20 equipes (ou le nombre de la seance-type).
export const AmrapWod: WodTemplate = {
  id: "AMRAP",
  name: "AMRAP (le plus de tours en 20 min)",
  exercises: AMRAP_DEFAULT_EXERCISES.map((e, i) => ({ id: e.id, label: e.label, number: i + 1 })),
  raceDefaults: { rep0: 5, peak: 10, step: 1, capMin: AMRAP_DEFAULTS.capMin, afterMin: 0, penMin: 1 },
  defaultTeams: 20,
  calculateScores(): WodEngineResult {
    return { teamScores: {}, runnerScores: {} };
  },
};
