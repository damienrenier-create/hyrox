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

// Phase de placement
export async function placeBoat(sessionId: string, teamId: string, exerciseId: string, ownerId: string) {
  const boatRef = ref(db, `sessions/${sessionId}/grid/${teamId}_${exerciseId}/boats/${ownerId}`);
  await set(boatRef, true);
}

// Phase de tir (Modale)
export async function fireShot(
  sessionId: string, 
  teamId: string, 
  exerciseId: string, 
  reps: number, 
  note: number, 
  evaluator: SessionPayload
) {
  const coord = `${teamId}_${exerciseId}`;
  
  // 1. Enregistrer le tir
  const shotRef = push(ref(db, `sessions/${sessionId}/grid/${coord}/shots`));
  const shotData: FirebaseShot = {
    evaluatorId: evaluator.id,
    role: evaluator.role,
    repsObserved: reps,
    note: note,
    timestamp: Date.now()
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
