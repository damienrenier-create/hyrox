import { db } from "./index";
import { ref, set, push, onValue } from "firebase/database";
import { SessionPayload } from "@/lib/auth";

// Postgres est la seule source de verite pour les evaluations/tirs (voir touche-coule/actions.ts).
// Ce module ne sert plus qu'a la diffusion live : dashboard Greffier + animations "bateau touche"
// chez les arbitres concernes. Rien ici n'est plus jamais relu pour calculer la fiabilite ou l'historique.

export type FirebaseShot = {
  evaluatorId: string;
  role: string;
  repsObserved: number;
  note: number;
  timestamp: number;
};

export async function setRaceStatus(sessionId: string, status: "PREPARATION" | "COMBAT" | "TERMINATED") {
  const statusRef = ref(db, `sessions/${sessionId}/status`);
  await set(statusRef, status);
}

export type HitInfo = { refereeId: string; refereeName: string; shipId: string; sunk: boolean };

// A appeler UNIQUEMENT apres que submitEvaluationAction a confirme et persiste le tir cote serveur.
export async function broadcastShot(
  sessionId: string,
  coord: string,
  shooter: SessionPayload,
  reps: number,
  note: number,
  hits: HitInfo[]
) {
  const shotRef = push(ref(db, `sessions/${sessionId}/grid/${coord}/shots`));
  await set(shotRef, {
    evaluatorId: shooter.id,
    evaluatorName: shooter.name,
    role: shooter.role,
    reps,
    note,
    timestamp: Date.now(),
  });

  for (const hit of hits) {
    const eventId = push(ref(db, `sessions/${sessionId}/events`)).key;
    await set(ref(db, `sessions/${sessionId}/events/${eventId}`), {
      type: "BOAT_HIT",
      ownerId: hit.refereeId,
      shooterName: shooter.name,
      coord,
      sunk: hit.sunk,
      timestamp: Date.now(),
    });
  }
}

// Greffier : ecouter toute la grille (affichage diamant/etoile, purement visuel)
export function listenToGrid(sessionId: string, callback: (gridData: any) => void) {
  const gridRef = ref(db, `sessions/${sessionId}/grid`);
  return onValue(gridRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
}

// Touche-Coule : ecouter les evenements (notifications "bateau touche")
export function listenToEvents(sessionId: string, callback: (events: any) => void) {
  const eventsRef = ref(db, `sessions/${sessionId}/events`);
  return onValue(eventsRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
}
