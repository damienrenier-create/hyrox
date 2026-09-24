import { WodTemplate, WodEngineResult } from "../core/types";

// WOD « Level » : des equipes de 1 a 6 eleves enchainent des niveaux de fiches (exercice x reps) le plus vite
// possible, avec un niveau BOSS tous les BOSS_EVERY niveaux. Les exercices ne sont pas fixes : ils viennent
// du catalogue pondere (table LevelExercise) et de l'echelle des niveaux, figee dans Session.settings.levels
// au coup d'envoi. `exercises` reste vide : ce WOD n'utilise pas le Touche-Coule mais le demineur.
// Le comptage vit dans level-engine.ts (module pur) ; calculateScores de l'ancienne interface est inutilise.
export const LevelWod: WodTemplate = {
  id: "LEVEL",
  name: "Level (niveaux de fiches)",
  exercises: [],
  defaultTeams: 6,
  calculateScores(): WodEngineResult {
    return { teamScores: {}, runnerScores: {} };
  },
};
