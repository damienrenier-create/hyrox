import { db } from "./index";
import { ref, set, push, onValue } from "firebase/database";
import { SessionPayload } from "@/lib/auth";

// Postgres est la seule source de verite pour les evaluations/tirs (voir touche-coule/actions.ts).
// Ce module ne sert plus qu'a la diffusion live : dashboard Greffier + animations "bateau touche"
// chez les arbitres concernes. Rien ici n'est plus jamais relu pour calculer la fiabilite ou l'historique.
//
// IMPORTANT : Firebase est optionnel et NE DOIT JAMAIS bloquer une action. Si la Realtime Database
// n'est pas configuree (databaseURL absente / instance inexistante), toutes les fonctions ci-dessous
// echouent silencieusement (warning console) et l'application continue sur Postgres seul.

export type FirebaseShot = {
  evaluatorId: string;
  role: string;
  repsObserved: number;
  note: number;
  timestamp: number;
};

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[firebase] ${label} ignoré (diffusion live indisponible) :`, e);
  }
}

function safeListen(label: string, subscribe: () => () => void): () => void {
  try {
    return subscribe();
  } catch (e) {
    console.warn(`[firebase] ${label} indisponible :`, e);
    return () => {};
  }
}

export async function setRaceStatus(sessionId: string, status: "PREPARATION" | "COMBAT" | "TERMINATED") {
  await safe("setRaceStatus", async () => {
    await set(ref(db, `sessions/${sessionId}/status`), status);
  });
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
  await safe("broadcastShot", async () => {
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
  });
}

// Statut de course (COMBAT / TERMINATED) pour le badge live des arbitres.
export function listenToRaceStatus(sessionId: string, callback: (status: string) => void) {
  return safeListen("listenToRaceStatus", () =>
    onValue(ref(db, `sessions/${sessionId}/status`), (snapshot) => {
      const val = snapshot.val();
      if (val) callback(val);
    })
  );
}

// Greffier : ecouter toute la grille (affichage diamant/etoile, purement visuel)
export function listenToGrid(sessionId: string, callback: (gridData: any) => void) {
  return safeListen("listenToGrid", () =>
    onValue(ref(db, `sessions/${sessionId}/grid`), (snapshot) => {
      callback(snapshot.val() || {});
    })
  );
}

// Touche-Coule : ecouter les evenements (notifications "bateau touche")
export function listenToEvents(sessionId: string, callback: (events: any) => void) {
  return safeListen("listenToEvents", () =>
    onValue(ref(db, `sessions/${sessionId}/events`), (snapshot) => {
      callback(snapshot.val() || {});
    })
  );
}
