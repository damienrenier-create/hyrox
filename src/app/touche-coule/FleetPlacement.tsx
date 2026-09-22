"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeShipAction, deleteShipAction, lockFleetAction, reuseLastFleetAction, randomFleetAction, type ReusableFleet } from "./actions";
import { fleetFor } from "@/lib/wod-engines/core/fleet";
import { Board, type BoardShip, type BoardTeam, type BoardExercise, type BoardMarker } from "./Board";
import { Brand } from "../_components/Brand";
import { btn, ui } from "@/lib/ui";
import { displayPseudo } from "@/lib/staff-names";

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
  reusable = null,
}: {
  evaluator: { name: string };
  sessionId: string;
  teams: BoardTeam[];
  exercises: BoardExercise[];
  ships: BoardShip[];
  reusable?: ReusableFleet | null; // flotte d'une seance precedente, rejouable en un geste
}) {
  const router = useRouter();
  const [ships, setShips] = useState<BoardShip[]>(initialShips);

  // `useState` ignore sa valeur initiale aux rendus suivants : apres un `router.refresh()`, le serveur
  // renvoyait bien les navires mais la grille restait vide, et « Verrouiller ma flotte » restait grise.
  // On resynchronise donc quand la liste DU SERVEUR change vraiment, sans ecraser un ajout local.
  const serverSig = initialShips.map((s) => s.id).sort().join(",");
  const lastServerSig = useRef(serverSig);
  useEffect(() => {
    if (lastServerSig.current === serverSig) return;
    lastServerSig.current = serverSig;
    setShips(initialShips);
  }, [serverSig, initialShips]);

  const [firstTap, setFirstTap] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null); // taille choisie dans l'inventaire (facultatif)
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const spec = fleetFor(teams.length, exercises.length);
  const remaining = remainingSizes(spec, ships.map((s) => s.size));
  const done = remaining.length === 0;

  const shipByCell = new Map<string, BoardShip>();
  ships.forEach((s) => cellsOf(s, teams, exercises).forEach((c) => shipByCell.set(c, s)));

  // Cases ou la proue peut tomber apres le 1er tap : meme ligne / meme colonne, longueur encore disponible
  // dans l'inventaire (ou exactement la taille choisie), et aucune case occupee par un de mes navires.
  const validTargets = (() => {
    if (!firstTap) return new Set<string>();
    const ti = teams.findIndex((t) => t.id === firstTap.teamId);
    const ei = exercises.findIndex((e) => e.id === firstTap.exerciseId);
    const sizes = chosen ? [chosen] : remaining;
    const out = new Set<string>();
    for (const size of sizes) {
      for (const dir of ["right", "left", "down", "up"] as const) {
        const cells: string[] = [];
        for (let i = 0; i < size; i++) {
          const t = dir === "down" ? ti + i : dir === "up" ? ti - i : ti;
          const e = dir === "right" ? ei + i : dir === "left" ? ei - i : ei;
          if (!teams[t] || !exercises[e] || t < 0 || e < 0) break;
          cells.push(`${teams[t].id}_${exercises[e].id}`);
        }
        if (cells.length !== size || cells.some((c) => shipByCell.has(c))) continue;
        out.add(cells[cells.length - 1]); // c'est la case de la proue qu'on touche
      }
    }
    return out;
  })();

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
    if (!validTargets.has(coord)) {
      setError(
        chosen
          ? `Pour un navire de ${chosen} case${chosen > 1 ? "s" : ""}, touche une case surlignée (même ligne ou même colonne, sans chevaucher un de tes navires).`
          : "Touche une case surlignée : même ligne ou même colonne, longueur encore disponible, sans chevaucher un de tes navires."
      );
      return;
    }
    startTransition(async () => {
      const res = await placeShipAction(sessionId, from.teamId, from.exerciseId, team.id, ex.id);
      setFirstTap(null);
      setChosen(null);
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

  // Les deux placements en lot affichent les navires renvoyes par le serveur tout de suite, sans attendre
  // le rechargement : l'eleve voit sa flotte apparaitre au tap et peut verrouiller dans la foulee.
  function handleReuse() {
    setError("");
    startTransition(async () => {
      const res = await reuseLastFleetAction(sessionId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setShips((prev) => [...prev, ...res.ships]);
      setFirstTap(null);
      setChosen(null);
      router.refresh();
    });
  }

  function handleRandom() {
    setError("");
    startTransition(async () => {
      const res = await randomFleetAction(sessionId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setShips((prev) => [...prev, ...res.ships]);
      setFirstTap(null);
      setChosen(null);
      router.refresh();
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
    <div className={`${ui.page} p-4 relative overflow-hidden`}>
      <div className="absolute top-3 right-4 text-3xl opacity-20 select-none pointer-events-none">🧭</div>

      <header className="mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <Brand />
          <span className="text-line-2">/</span>
          <h1 className="font-display font-extrabold text-sea-ink text-lg">Place ta flotte 🏴‍☠️</h1>
        </div>
        <p className="text-sm text-ink-2">
          {displayPseudo(evaluator.name)} · grille {teams.length} équipes × {exercises.length} ateliers · flotte de {spec.length} navires ({spec.reduce((a, b) => a + b, 0)} cases)
        </p>
      </header>

      <div className={`${ui.card} border-sea/30 relative z-10 mb-3 p-3 space-y-2`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-2">Navires à placer :</span>
          {remaining.length ? (
            remaining.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setChosen((c) => (c === s ? null : s))}
                aria-pressed={chosen === s}
                className={`${ui.chip} ${chosen === s ? ui.chipOk : ui.chipSea} text-xs px-2 py-1 ${chosen === s ? "ring-2 ring-accent" : ""}`}
              >
                {s} case{s > 1 ? "s" : ""}
              </button>
            ))
          ) : (
            <span className="text-success-ink font-bold">⚓ Flotte complète</span>
          )}
        </div>
        <p className={ui.hint}>
          {done
            ? "Touche un navire pour le retirer, ou verrouille ta flotte pour commencer à arbitrer."
            : firstTap
              ? `Poupe posée ⚓ — touche une case surlignée pour poser la proue${chosen ? ` du navire de ${chosen} case${chosen > 1 ? "s" : ""}` : ""}. Pour un navire d'1 case, retouche la même case. Le navire est enregistré aussitôt.`
              : chosen
                ? `Navire de ${chosen} case${chosen > 1 ? "s" : ""} choisi — touche la case de la poupe, puis celle de la proue.`
                : "Touche la case de la poupe, puis celle de la proue : la taille du navire est déduite de la distance. Tu peux aussi choisir sa taille ci-dessus."}
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          {reusable && ships.length === 0 && (
            <button onClick={handleReuse} disabled={pending} className={btn.accent}>
              ♻️ Reprendre ma flotte du {new Date(reusable.date).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit" })} ({reusable.ships} navires)
            </button>
          )}
          {!done && (
            <button onClick={handleRandom} disabled={pending} className={btn.ghost}>
              🎲 {ships.length === 0 ? "Flotte au hasard" : `Compléter au hasard (${remaining.length})`}
            </button>
          )}
          {firstTap && (
            <button onClick={() => setFirstTap(null)} className={btn.ghost}>
              Annuler la sélection
            </button>
          )}
          <button onClick={handleLock} disabled={pending || !done} className={done ? btn.accent : btn.ghost}>
            ⚓ Verrouiller ma flotte
          </button>
          {!done && (
            <span className={ui.hint}>
              Encore {remaining.length} navire{remaining.length > 1 ? "s" : ""} à poser avant de pouvoir verrouiller.
            </span>
          )}
        </div>
        {error && <p className={ui.alertErr}>{error}</p>}
      </div>

      <div className="relative z-10">
        <Board
          teams={teams}
          exercises={exercises}
          ships={ships}
          markers={markers}
          onCellClick={handleCell}
          cellExtraClass={(team, ex) => (validTargets.has(`${team.id}_${ex.id}`) ? "ring-2 ring-accent bg-accent/30" : "")}
          animateShips
          tile="sea-foam"
          highlight={firstTap}
          shipOpacity={0.75}
        />
      </div>
    </div>
  );
}
