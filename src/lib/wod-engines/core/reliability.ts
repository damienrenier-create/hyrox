import { FirebaseShot } from "../../firebase/firebase-sync";

type EvaluationDiff = {
  evaluatorId: string;
  note: number;
  delta: number;
  isReliable: boolean;
};

// Algorithme de Fiabilité (Fin de WOD)
export function calculateReliability(shots: FirebaseShot[]): Record<string, number> {
  const reliabilityUpdates: Record<string, number> = {}; // { evaluatorId: points }

  // Trier les tirs par case (teamId_exerciseId)
  const grid: Record<string, FirebaseShot[]> = {};
  shots.forEach(shot => {
    const coord = `${shot.repsObserved}`; // Hack temporaire: dans l'app, on passera la coord depuis l'extérieur
    // En réalité, on doit traiter ça par case
  });

  return reliabilityUpdates;
}

export function resolveCaseA(adminShot: FirebaseShot, studentShots: FirebaseShot[]): Record<string, number> {
  const updates: Record<string, number> = {};
  const truth = adminShot.note;

  studentShots.forEach(shot => {
    if (shot.note === truth) {
      updates[shot.evaluatorId] = 1; // +1 Fiabilité
    } else {
      updates[shot.evaluatorId] = -1; // -1 Fiabilité (Litige)
    }
  });

  return updates;
}

export function resolveCaseB(studentShots: FirebaseShot[], teamAverage: number): Record<string, number> {
  const updates: Record<string, number> = {};
  
  if (studentShots.length === 0) return updates;
  if (studentShots.length === 1) {
    // Un seul étudiant, pas de litige possible
    updates[studentShots[0].evaluatorId] = 1;
    return updates;
  }

  // Trouver l'étudiant avec le plus grand écart par rapport à la moyenne globale de l'équipe
  let maxDelta = -1;
  let worstEvaluatorId = "";

  studentShots.forEach(shot => {
    const delta = Math.abs(shot.note - teamAverage);
    if (delta > maxDelta) {
      maxDelta = delta;
      worstEvaluatorId = shot.evaluatorId;
    }
  });

  studentShots.forEach(shot => {
    if (shot.evaluatorId === worstEvaluatorId) {
      updates[shot.evaluatorId] = -1; // Pénalisé
    } else {
      updates[shot.evaluatorId] = 1; // Récompensé
    }
  });

  return updates;
}
