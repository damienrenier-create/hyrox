import { WodTemplate, WodEngineResult } from "../core/types";

// Seance « Badminton » (Sartay 20/10 : « le prochain cycle de Damien Renier avec les 3-4-5-6, c'est Badminton ; pour le
// premier cours, les eleves encodent les resultats de leurs matchs et contre qui ils ont joue »). Pas d'equipes, pas de
// chrono : des matchs en simple encodes sur les telephones (src/lib/badminton.ts, /eleve/badminton, /admin/badminton).
export const BadmintonWod: WodTemplate = {
  id: "BADMINTON",
  name: "Badminton (matchs encodés par les élèves)",
  exercises: [],
  raceDefaults: { rep0: 5, peak: 10, step: 1, capMin: 50, afterMin: 0, penMin: 1 },
  defaultTeams: 1,
  noTeams: true,
  calculateScores(): WodEngineResult {
    return { teamScores: {}, runnerScores: {} };
  },
};
