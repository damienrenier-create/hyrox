import { db } from "./index";
import { ref, set, push, onValue, get, child, update } from "firebase/database";
import { SessionPayload } from "@/lib/auth";

export type FirebaseShot = {
  evaluatorId: string;
  role: string;
  repsObserved: number;
  note: number;
  timestamp: number;
};

export type ShipData = {
  id: string;
  ownerId: string;
  length: number;
  orientation: "horizontal" | "vertical";
  startTeamId: string;
  startExerciseId: string;
  coords: { teamId: string; exerciseId: string }[];
};

// Phase de placement (Bateaux Multi-cases)
export async function placeShip(sessionId: string, ship: ShipData) {
  // Enregistrer l'objet Ship
  const shipRef = ref(db, `sessions/${sessionId}/ships/${ship.ownerId}/${ship.id}`);
  await set(shipRef, ship);

  // Marquer les cases occupées sur la grille globale pour affichage et collision rapides
  for (const coord of ship.coords) {
    const cellRef = ref(db, `sessions/${sessionId}/grid/${coord.teamId}_${coord.exerciseId}/boats/${ship.ownerId}`);
    await set(cellRef, ship.id);
  }
}

export async function setRaceStatus(sessionId: string, status: "PREPARATION" | "COMBAT" | "TERMINATED") {
  const statusRef = ref(db, `sessions/${sessionId}/status`);
  await set(statusRef, status);
}

// Phase de tir (Modale)
export async function fireShot(sessionId: string, teamId: string, exerciseId: string, reps: number, note: number, evaluator: SessionPayload, isPostWod: boolean = false) {
  const coord = `${teamId}_${exerciseId}`;
  
  // 1. Enregistrer le tir
  const shotRef = push(ref(db, `sessions/${sessionId}/grid/${coord}/shots`));
  const shotData = {
    evaluatorId: evaluator.id,
    evaluatorName: evaluator.name,
    role: evaluator.role,
    reps,
    note,
    timestamp: Date.now(),
    isPostWod
  };
  await set(shotRef, shotData);

  // 2. Vérifier les bateaux touchés sur cette case
  const boatsSnapshot = await get(child(ref(db), `sessions/${sessionId}/grid/${coord}/boats`));
  if (boatsSnapshot.exists()) {
    const boats = boatsSnapshot.val(); // ex: { "user_1": true, "ghost_1": true }
    const ownerIds = Object.keys(boats);
    
    // Déclencher une notification globale pour chaque bateau touché
    const updates: Record<string, any> = {};
    ownerIds.forEach(ownerId => {
      const eventId = push(ref(db, `sessions/${sessionId}/events`)).key;
      updates[`sessions/${sessionId}/events/${eventId}`] = {
        type: "BOAT_HIT",
        ownerId,
        shooterName: evaluator.name,
        coord,
        timestamp: Date.now()
      };
    });
    
    if (Object.keys(updates).length > 0) {
      await update(ref(db), updates);
    }
  }
}

// Greffier: Écouter toute la grille
export function listenToGrid(sessionId: string, callback: (gridData: any) => void) {
  const gridRef = ref(db, `sessions/${sessionId}/grid`);
  return onValue(gridRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
}

// Touché-Coulé: Écouter les événements (pour Framer Motion)
export function listenToEvents(sessionId: string, callback: (events: any) => void) {
  const eventsRef = ref(db, `sessions/${sessionId}/events`);
  return onValue(eventsRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
}
