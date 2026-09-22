"use client";

import { useState, useEffect, useRef, useTransition, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SessionPayload } from "@/lib/auth";
import { broadcastShot } from "@/lib/firebase/firebase-sync";
import { submitEvaluationAction } from "./actions";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { Board, type BoardShip, type BoardTeam, type BoardExercise, type BoardMarker } from "./Board";
import { BoardEffectsLayer, ScoreBadge, RefereeLeaderboard, EFFECT_STYLES, type BoardEffect, type LeaderboardRow } from "./Effects";
import { Brand } from "../_components/Brand";
import { btn, cx, ui } from "@/lib/ui";

const REFRESH_MS = 5000;

const key = (c: Cell) => `${c.teamId}_${c.exerciseId}`;

type Cell = { teamId: string; exerciseId: string };
type Shot = Cell & { hit: boolean };

type Props = {
  evaluator: SessionPayload;
  sessionId: string;
  teams: BoardTeam[];
  exercises: BoardExercise[];
  myShips: BoardShip[];
  myCells: string[]; // "teamId_exerciseId" des cases de MA flotte (verrouillee en amont)
  myShots: Shot[];
  hitsOnMyFleet: number;
  damagedCells: Cell[]; // cases de MA flotte deja touchees par les autres
  wreckCells: Cell[]; // cases des navires coules (reveles a tout le monde)
  raceEnded: boolean;
  myScore: number;
  ownTeam?: { id: string; name: string } | null; // arbitre issu d'une equipe (DNF...) : ne peut pas evaluer sa propre equipe
  leaderboard: LeaderboardRow[];
};

export function ToucheCouleClient({ evaluator, sessionId, teams, exercises, myShips, myCells, myShots, hitsOnMyFleet, damagedCells, wreckCells, raceEnded, myScore, ownTeam = null, leaderboard }: Props) {
  const router = useRouter();
  const myCellSet = new Set(myCells);
  const isBlocked = (teamId: string, exerciseId: string) => myCellSet.has(`${teamId}_${exerciseId}`) || teamId === ownTeam?.id;
  const tIndex = useMemo(() => new Map(teams.map((t, i) => [t.id, i] as const)), [teams]);
  const eIndex = useMemo(() => new Map(exercises.map((e, i) => [e.id, i] as const)), [exercises]);

  const [target, setTarget] = useState<{ teamId: string; exerciseId: string } | null>(null);
  const [reps, setReps] = useState<string>("");
  const [note, setNote] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "hit" | "miss" | "alert" } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(myScore);
  const [localShots, setLocalShots] = useState<Shot[]>([]);
  const [effects, setEffects] = useState<BoardEffect[]>([]);
  const [shake, setShake] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  const removeEffect = useCallback((id: string) => setEffects((fx) => fx.filter((f) => f.id !== id)), []);

  // Rafraichissement automatique (remplace Firebase) : uniquement onglet visible et hors modale.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !target && !pending) router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router, target, pending]);

  // Alerte + secousse + explosion SUR la case quand un de MES bateaux vient d'etre touche.
  // Les degats arrivent par le rafraichissement serveur (5 s) : on compare la liste des cases touchees.
  const prevDamaged = useRef(damagedCells.map(key));
  useEffect(() => {
    const before = new Set(prevDamaged.current);
    const fresh = damagedCells.filter((c) => !before.has(key(c)));
    prevDamaged.current = damagedCells.map(key);
    if (!fresh.length) return;
    setEffects((fx) => [...fx, ...fresh.map((c) => ({ id: `dmg_${Date.now()}_${key(c)}`, ...c, kind: "hit" as const }))]);
    showToast(`💥 ${fresh.length > 1 ? "Tes bateaux encaissent" : "Un de tes bateaux vient d'être touché"} !`, "alert");
    setShake(true);
    const t = setTimeout(() => setShake(false), 500);
    return () => clearTimeout(t);
  }, [damagedCells]);

  useEffect(() => {
    setScore(myScore);
    setLocalShots([]);
  }, [myScore, myShots]);

  function showToast(message: string, tone: "hit" | "miss" | "alert") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2200);
  }

  const handleKeypad = (num: string) => {
    if (reps.length < 3) setReps((prev) => prev + num);
  };

  const handleFire = () => {
    if (!target || !reps || note === null) return;
    const t = target;
    const r = parseInt(reps);
    const n = note;
    setError("");
    startTransition(async () => {
      const res = await submitEvaluationAction(sessionId, t.teamId, t.exerciseId, r, n);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const coord = `${t.teamId}_${t.exerciseId}`;
      void broadcastShot(sessionId, coord, evaluator, r, n, res.hits); // diffusion live, jamais bloquante
      const hit = res.hits.length > 0;
      const sunkCount = res.hits.filter((h) => h.sunk).length;
      const sunk = sunkCount > 0;
      setLocalShots((prev) => [...prev, { teamId: t.teamId, exerciseId: t.exerciseId, hit }]);
      setEffects((fx) => [...fx, { id: `${Date.now()}_${coord}`, teamId: t.teamId, exerciseId: t.exerciseId, kind: hit ? (sunk ? "sunk" : "hit") : "splash" }]);
      if (hit) {
        // Les flottes se superposent (calques par arbitre) : un seul tir peut toucher plusieurs navires.
        // Meme bareme que le serveur (+1 par navire touche, +3 par navire coule), sinon le score saute
        // au rafraichissement suivant.
        setScore((s) => s + res.hits.length + 3 * sunkCount);
        showToast(sunk ? (sunkCount > 1 ? `☠️ ${sunkCount} bateaux coulés !` : "☠️ Bateau coulé !") : res.hits.length > 1 ? `💥 ${res.hits.length} bateaux touchés !` : "💥 Touché !", "hit");
      } else {
        showToast("🌊 À l'eau !", "miss");
      }
      setTarget(null);
      setReps("");
      setNote(null);
      router.refresh();
    });
  };

  // Ordre = priorite d'affichage (la derniere entree gagne sur une meme case) :
  // mes tirs < degats encaisses < epaves des navires coules < case actuellement visee.
  const shots = [...myShots, ...localShots];
  const markers: BoardMarker[] = shots.map((s) => ({ teamId: s.teamId, exerciseId: s.exerciseId, kind: s.hit ? "hit" : "miss" }));
  damagedCells.forEach((c) => markers.push({ ...c, kind: "hit" }));
  wreckCells.forEach((c) => markers.push({ ...c, kind: "wreck" }));
  if (target) markers.push({ teamId: target.teamId, exerciseId: target.exerciseId, kind: "target" });
  const myRank = leaderboard.findIndex((r) => r.refereeId === evaluator.id) + 1;

  return (
    <div className={cx(ui.page, "flex flex-col relative overflow-hidden", shake && "tc-shake")}>
      <style>{EFFECT_STYLES}</style>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.message + toast.tone}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 top-24 z-50 flex justify-center pointer-events-none"
          >
            <div
              className={cx(
                "px-6 py-4 rounded-full font-display text-xl font-extrabold shadow-pop",
                toast.tone === "hit" ? "bg-danger text-white" : toast.tone === "alert" ? "bg-accent text-ink" : "bg-sea text-white"
              )}
            >
              {toast.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="px-4 py-3 relative z-10 bg-card/95 backdrop-blur border-b border-line flex justify-between items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Brand />
            <span className="text-line-2">/</span>
            <h1 className="font-display font-extrabold text-sea-ink truncate">Touché-Coulé 🏴‍☠️</h1>
          </div>
          <div className="text-[11px] text-ink-2 truncate">
            {evaluator.name}
            {evaluator.role === "STUDENT" && <> · <a href="/eleve" className="underline text-brand">mon espace</a></>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowBoard((v) => !v)} className={btn.smGhost} title="Classement des arbitres">
            {myRank ? `#${myRank}` : "—"}
          </button>
          <ScoreBadge score={score} />
          {hitsOnMyFleet > 0 && (
            <div className={cx(ui.chip, "py-1", ui.chipErr)} title="Cases de ta flotte touchées">
              💥 {hitsOnMyFleet}
            </div>
          )}
          <div className={cx(ui.chip, "py-1", raceEnded ? ui.chipMuted : ui.chipOk)}>
            {raceEnded ? "POST-WOD" : "EN COURS"}
          </div>
        </div>
      </header>

      <main className="flex-1 p-2 relative z-10 overflow-auto flex flex-col">
        <AnimatePresence>
          {showBoard && (
            <motion.section initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-2">
              <div className={`${ui.card} p-2 border-sea/30`}>
                <div className={`${ui.eyebrow} text-sea-ink mb-1`}>Classement des arbitres</div>
                {leaderboard.length === 0 ? <p className={ui.hint}>Personne n&apos;a encore verrouillé sa flotte.</p> : <RefereeLeaderboard rows={leaderboard} meId={evaluator.id} compact />}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
        <p className="text-[11px] text-ink-2 px-1 mb-1">
          Touche une case (équipe × exercice) pour évaluer, puis tirer. Tes bateaux sont affichés, les autres restent cachés.
          {ownTeam && <> <span className="text-accent-ink font-bold">Ta propre équipe ({ownTeam.name}) ne peut pas être arbitrée par toi.</span></>}
        </p>
        <Board
          teams={teams}
          exercises={exercises}
          ships={myShips}
          markers={markers}
          onCellClick={(team, ex) => {
            if (pending || isBlocked(team.id, ex.id)) return;
            setTarget({ teamId: team.id, exerciseId: ex.id });
          }}
          isCellDisabled={(team, ex) => isBlocked(team.id, ex.id)}
          cellExtraClass={(team, ex) => (team.id === ownTeam?.id ? "cursor-not-allowed opacity-40" : myCellSet.has(`${team.id}_${ex.id}`) ? "cursor-not-allowed" : "")}
          overlay={<BoardEffectsLayer effects={effects} tIndex={tIndex} eIndex={eIndex} onDone={removeEffect} />}
        />
      </main>

      <AnimatePresence>
        {target && (
          <motion.div
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 z-20 bg-card border-t-4 border-accent p-4 shadow-pop rounded-t-3xl"
          >
            <div className="flex justify-between items-center mb-4 px-1">
              <div className="text-sm text-ink-2 font-semibold">
                Cible : <span className="text-ink font-extrabold">{teams.find((t) => t.id === target.teamId)?.name}</span> / <span className="text-ink font-extrabold">{exercises.find((e) => e.id === target.exerciseId)?.label}</span>
              </div>
              <button onClick={() => setTarget(null)} className={btn.smDanger}>✕ Annuler</button>
            </div>

            <div className="flex gap-3 mb-5">
              <div className="flex-[1] bg-paper border border-line rounded-2xl p-3 flex flex-col items-center justify-center">
                <div className={ui.eyebrow}>Reps</div>
                <div className="font-display text-4xl font-extrabold text-brand tabular-nums">{reps || "0"}</div>
              </div>
              <div className="flex-[2] grid grid-cols-6 gap-1">
                {QUALITY_LEVELS.map((n) => (
                  <button
                    key={n.code}
                    onClick={() => setNote(n.value)}
                    title={n.label}
                    className={cx(
                      "text-sm font-black rounded-xl border-2 transition-all",
                      n.color,
                      note === n.value ? "bg-card border-brand ring-2 ring-brand/20 shadow-sm" : "bg-paper border-transparent opacity-70 hover:opacity-100 hover:bg-line"
                    )}
                  >
                    {n.code}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((num) => (
                <button key={num} onClick={() => handleKeypad(num.toString())} className="bg-paper hover:bg-line border border-line py-3 rounded-xl font-display text-xl font-extrabold text-ink transition-colors active:scale-95">{num}</button>
              ))}
              <button onClick={() => setReps("")} className="bg-danger-soft hover:bg-danger hover:text-white py-3 rounded-xl text-danger-ink font-black col-span-2 transition">Effacer</button>
            </div>

            {error && <p className={`${ui.alertErr} mb-3 text-center`}>{error}</p>}

            <button
              onClick={handleFire}
              disabled={!reps || note === null || pending}
              className="w-full bg-accent hover:bg-accent-hover disabled:bg-line disabled:text-ink-3 text-ink font-display font-extrabold py-5 rounded-2xl text-2xl shadow-card disabled:shadow-none transition-all active:scale-[0.98]"
            >
              {pending ? "…" : "FEU ! 🚀"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
