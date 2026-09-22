export type TeamState = {
  id: string;
  name: string;
  color: "jaune" | "vert" | "bleu" | "rouge";
  members: string[];
  
  // Progression
  cordeJumps: number; // Nombre de fois que la corde à sauter a été validée
  completedExercises: string[]; // IDs des exercices validés
  wodCompletedAt: number | null; // Timestamp de fin de WOD
  
  // Pénalités, cartons et scores
  penalties: number;
  yellowCards: number; // Cartons jaunes
  finisherPoints: Record<string, number>; // Points de finisher par membre
};

export type WodEngineResult = {
  teamScores: Record<string, {
    score: number | null; // Score final de l'équipe
    wodTimeMs: number | null;
    penaltyMs: number;
  }>;
  runnerScores: Record<string, {
    score: number | null; // Score final du coureur
  }>;
};

export interface WodTemplate {
  id: string;
  name: string;
  exercises: { id: string; label: string; number: number }[];
  // Ateliers ou PERSONNE ne commence (NOSTART du fichier d'origine) : le round-robin des departs les saute.
  noStartExerciseIds?: string[];
  
  // Calcul du score à partir de l'état
  calculateScores(
    teams: TeamState[], 
    startTime: number, 
    unitMs: number, 
    mode: "avg" | "sum"
  ): WodEngineResult;
}
