"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeShipAction, deleteShipAction, lockFleetAction } from "./actions";
import { fleetFor } from "@/lib/wod-engines/core/fleet";
import { Board, type BoardShip, type BoardTeam, type BoardExercise, type BoardMarker } from "./Board";

// Meme flotte que le serveur : adaptee a la grille equipes x ateliers de la seance en cours.
function remainingSizes(spec: readonly number[], placed: number[]): number[] {
  const rest = [...spec];
  for (const s of placed) {
    const i = rest.indexOf(s);
    if (i !== -1) rest.splice(i, 1);
  }
  return rest;
}

function cellsOf(ship: BoardShip, teams: BoardTeam[], exercises: BoardExercise[]): string[] {
  const tIdx = teams.findIndex((t) => t.id === ship.startTeamId);
  const eIdx = exercises.findIndex((e) => e.id === ship.startExerciseId);
  const out: string[] = [];
  for (let i = 0; i < ship.size; i++) {
    if (ship.orientation === "horizontal") out.push(`${teams[tIdx]?.id}_${exercises[eIdx + i]?.id}`);
    else out.push(`${teams[tIdx + i]?.id}_${exercises[eIdx]?.id}`);
  }
  return out;
}

export function FleetPlacement({
  evaluator,
  sessionId,
  teams,
  exercises,
  ships: initialShips,
}: {
  evaluator: { name: string };
  sessionId: string;
  teams: BoardTeam[];
  exercises: BoardExercise[];
  ships: BoardShip[];
}) {
  const router = useRouter();
  const [ships, setShips] = useState<BoardShip[]>(initialShips);
  const [firstTap, setFirstTap] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const spec = fleetFor(teams.length, exercises.length);
  const remaining = remainingSizes(spec, ships.map((s) => s.size));
  const done = remaining.length === 0;

  const shipByCell = new Map<string, BoardShip>();
  ships.forEach((s) => cellsOf(s, teams, exercises).forEach((c) => shipByCell.set(c, s)));

  function handleCell(team: BoardTeam, ex: BoardExercise) {
    if (pending) return;
    setError("");
    const coord = `${team.id}_${ex.id}`;
    const existing = shipByCell.get(coord);

    if (existing) {
      if (!confirm(`Retirer ce navire de ${existing.size} case${existing.size > 1 ? "s" : ""} ?`)) return;
      startTransition(async () => {
        const res = await deleteShipAction(sessionId, existing.id);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setShips((prev) => prev.filter((s) => s.id !== existing.id));
        setFirstTap(null);
      });
      return;
    }

    if (done) return;

    if (!firstTap) {
      setFirstTap({ teamId: team.id, exerciseId: ex.id });
      return;
    }

    const from = firstTap;
    startTransition(async () => {
      const res = await placeShipAction(sessionId, from.teamId, from.exerciseId, team.id, ex.id);
      setFirstTap(null);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setShips((prev) => [
        ...prev,
        {
          id: res.shipId,
          size: res.size,
          orientation: res.orientation,
          direction: res.direction,
          startTeamId: res.startTeamId,
          startExerciseId: res.startExerciseId,
        },
      ]);
    });
  }

  function handleLock() {
    setError("");
    startTransition(async () => {
      const res = await lockFleetAction(sessionId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh(); // le serveur bascule alors vers l'ecran d'arbitrage
    });
  }

  const markers: BoardMarker[] = firstTap ? [{ teamId: firstTap.teamId, exerciseId: firstTap.exerciseId, kind: "selected" }] : [];

  return (
    <div className="min-h-[100dvh] text-amber-50 font-sans p-4 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_#0d3b4f_0%,_#062230_55%,_#03141c_100%)]">
      <div className="absolute top-3 right-4 text-3xl opacity-30 select-none pointer-events-none">🧭</div>

      <header className="mb-3 relative z-10">
        <h1 className="text-xl font-black text-amber-300 uppercase tracking-widest drop-shadow-[0_0_6px_rgba(217,180,80,0.4)]">
          Place ta flotte 🏴‍☠️
        </h1>
        <p className="text-sm text-amber-200/60">
          {evaluator.name} · grille {teams.length} équipes × {exercises.length} ateliers · flotte de {spec.length} navires ({spec.reduce((a, b) => a + b, 0)} cases)
        </p>
      </header>

      <div className="relative z-10 mb-3 bg-[#0a2a38]/80 border border-amber-800/40 p-3 rounded-xl backdrop-blur-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-amber-200/70">Navires à placer :</span>
          {remaining.length ? (
            remaining.map((s, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-[#6A4017] border border-[#3a2208] text-amber-100 font-bold text-xs">
                {s} case{s > 1 ? "s" : ""}
              </span>
            ))
          ) : (
            <span className="text-emerald-400 font-bold">⚓ Flotte complète</span>
          )}
        </div>
        <p className="text-xs text-amber-100/70">
          {done
            ? "Touche un navire pour le retirer, ou verrouille ta flotte pour commencer à arbitrer."
            : firstTap
              ? "Poupe posée ⚓ — touche maintenant la case de la proue (même ligne ou même colonne). Pour un navire d'1 case, retouche la même case."
              : "Touche la case de la poupe, puis celle de la proue. Touche un navire déjà posé pour le retirer."}
        </p>
        <div className="flex gap-2 flex-wrap">
          {firstTap && (
            <button onClick={() => setFirstTap(null)} className="bg-[#0d3b4f] border border-amber-800/40 px-3 py-2 rounded text-sm text-amber-200">
              Annuler la sélection
            </button>
          )}
          {done && (
            <button
              onClick={handleLock}
              disabled={pending}
              className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded text-sm disabled:opacity-40"
            >
              Verrouiller ma flotte
            </button>
          )}
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      <div className="relative z-10">
        <Board teams={teams} exercises={exercises} ships={ships} markers={markers} onCellClick={handleCell} animateShips />
      </div>
    </div>
  );
}
