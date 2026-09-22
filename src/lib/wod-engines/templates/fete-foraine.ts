import { WodTemplate, WodEngineResult } from "../core/types";
import { FF_STATIONS } from "./fete-foraine-engine";

// Seance « Fête Foraine » du cycle Hyrox : 6 ateliers + corde a sauter entre chaque = 7 colonnes pour le
// Touche-Coule (la corde est une colonne comme les autres pour les arbitres). Le comptage greffier vit dans
// fete-foraine-engine.ts (module pur) ; calculateScores de l'ancienne interface n'est plus utilise.
export const FeteForaine: WodTemplate = {
  id: "FETE_FORAINE",
  name: "Fête Foraine (6 ateliers + corde)",
  exercises: FF_STATIONS.map((s, i) => ({ id: s.id, label: s.label, number: i + 1 })),
  calculateScores(): WodEngineResult {
    return { teamScores: {}, runnerScores: {} };
  },
};
