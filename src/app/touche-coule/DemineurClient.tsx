"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { MineView, MineStudent } from "@/lib/mine";
import { MINE_COLS, MINE_COUNT, MINE_ROWS } from "@/lib/mine-core";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { fireAction, minePulseAction, type FireResult } from "./mine-actions";
import { usePulse } from "../_components/usePulse";
import { RecentEvals } from "./RecentEvals";
import { btn, cx, ui } from "@/lib/ui";

const DIGIT: Record<number, string> = { 1: "text-blue-600", 2: "text-green-700", 3: "text-red-600", 4: "text-indigo-800", 5: "text-amber-800", 6: "text-teal-700", 7: "text-black", 8: "text-gray-600" };
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const RESULT_MS = 3000;

type Step = "student" | "exercise" | "eval" | "board";

// Demineur des arbitres (WOD Level) : eleve -> exercice -> reps + qualite -> tir sur la grille -> resultat
// 3 s -> retour au menu. Jamais deux fois d'affilee la meme equipe quand il y en a plusieurs.
export function DemineurClient({ sessionId, sessionLabel, evaluator, view, ended, ownTeamId }: {
  sessionId: string;
  sessionLabel: string;
  evaluator: { id: string; role: string; name: string };
  view: MineView;
  ended: boolean;
  ownTeamId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("student");
  const [student, setStudent] = useState<MineStudent | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [allExos, setAllExos] = useState(false);
  const [reps, setReps] = useState("");
  const [note, setNote] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(FireResult & { row: number; col: number; id: number }) | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const pulse = useCallback(() => minePulseAction(sessionId), [sessionId]);
  usePulse(pulse, 10000, step === "student" && !pending && !result);

  // Apres le tir : resultat affiche 3 s, puis retour au menu (listes rafraichies par le serveur).
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => {
      setResult(null);
      setStudent(null);
      setExerciseId(null);
      setReps("");
      setNote(null);
      setStep("student");
      router.refresh();
    }, RESULT_MS);
    return () => clearTimeout(t);
  }, [result, router]);

  const excludedTeam = view.teamsCount > 1 ? view.lastTeamId : null;
  const students = useMemo(() => view.students.filter((s) => s.userId !== evaluator.id && (!ownTeamId || s.teamId !== ownTeamId)), [view.students, evaluator.id, ownTeamId]);
  const byTeam = useMemo(() => {
    const m = new Map<string, { teamName: string; list: MineStudent[] }>();
    for (const s of students) (m.get(s.teamId) ?? m.set(s.teamId, { teamName: s.teamName, list: [] }).get(s.teamId)!).list.push(s);
    return [...m.entries()];
  }, [students]);
  const exercises = useMemo(() => (allExos ? view.exercises : view.exercises.filter((e) => e.suggested)), [view.exercises, allExos]);
  const exercise = view.exercises.find((e) => e.exerciseId === exerciseId) ?? null;
  const me = view.leaderboard.findIndex((l) => l.refereeId === evaluator.id);

  // Cellules affichees : la grille serveur + le tir et ses cases ouvertes en cascade tant que le resultat est a l'ecran.
  const cells = useMemo(() => {
    const c = view.cells.map((r) => [...r]);
    if (result) {
      c[result.row][result.col] = { mine: result.mine, n: result.n };
      for (const [r, cc, n] of result.opened) c[r][cc] = { mine: false, n };
    }
    return c;
  }, [view.cells, result]);

  function goEval() {
    if (!student || !exerciseId) return;
    setReps("");
    setNote(null);
    setError("");
    setStep("eval");
  }
  function goBoard() {
    const n = parseInt(reps, 10);
    if (!Number.isInteger(n) || n < 0) { setError("Encode les reps observées."); return; }
    if (note === null) { setError("Choisis une appréciation."); return; }
    setError("");
    setStep("board");
  }
  function fire(row: number, col: number) {
    if (!student || !exerciseId || note === null || pending || result) return;
    const n = parseInt(reps, 10);
    startTransition(async () => {
      const res = await fireAction(sessionId, student.userId, exerciseId, n, note, row, col);
      if ("error" in res) { setError(res.error); setStep("student"); setStudent(null); setExerciseId(null); router.refresh(); return; }
      setResult({ ...res, row, col, id: Date.now() });
    });
  }

  const back = evaluator.role === "STUDENT" ? "/eleve" : "/admin";

  return (
    <div className={`${ui.page} pb-6`}>
      <header className="sticky top-0 z-20 px-3 py-2 bg-card/95 backdrop-blur border-b border-line flex items-center gap-3">
        <a href={back} aria-label="Retour" className="w-9 h-9 rounded-full bg-paper hover:bg-line text-ink-2 flex items-center justify-center font-bold text-lg flex-shrink-0">‹</a>
        <div className="min-w-0 flex-1">
          <p className={ui.eyebrow}>💣 Démineur · {sessionLabel}</p>
          <p className="text-xs text-ink-2 truncate">{ended ? "WOD terminé · l'arbitrage reste ouvert" : `Carte ${view.round + 1} · ${view.foundInRound}/${MINE_COUNT} bombes trouvées`}</p>
        </div>
        <button type="button" onClick={() => setShowBoard((v) => !v)} className={cx(ui.chip, ui.chipAccent, "text-sm px-3 py-1")} title="Classement des arbitres">
          💣 {view.found}{me >= 0 && <span className="ml-1 opacity-70">#{me + 1}</span>}
        </button>
      </header>

      {showBoard && (
        <div className="px-3 pt-3">
          <div className={ui.cardPad}>
            <p className={`${ui.eyebrow} mb-1`}>Chasseurs de bombes</p>
            {view.leaderboard.length === 0 ? <p className={ui.hint}>Personne n&apos;a encore joué.</p> : (
              <ol className="space-y-0.5 text-sm">
                {view.leaderboard.map((l, i) => (
                  <li key={l.refereeId} className={cx("flex items-center gap-2", l.refereeId === evaluator.id && "font-bold")}>
                    <span className="w-5 text-ink-3 tabular-nums">{i + 1}</span><span className="flex-1 truncate">{l.name}</span><span className="tabular-nums">💣 {l.found}</span><span className={`${ui.hint} tabular-nums`}>{l.revealed} cases</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {error && <p className={`${ui.alertErr} mx-3 mt-3`}>{error}</p>}

      <main className="p-3 space-y-3">
        {/* Fil d'Ariane */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className={cx(ui.chip, step === "student" ? ui.chipBrand : ui.chipMuted)}>1 · Élève{student ? ` : ${student.name}` : ""}</span>
          <span className={cx(ui.chip, step === "exercise" ? ui.chipBrand : ui.chipMuted)}>2 · Exercice{exercise ? ` : ${cap(exercise.label)}` : ""}</span>
          <span className={cx(ui.chip, step === "eval" ? ui.chipBrand : ui.chipMuted)}>3 · Évaluation</span>
          <span className={cx(ui.chip, step === "board" ? ui.chipBrand : ui.chipMuted)}>4 · Feu</span>
        </div>

        {step === "student" && (
          <div className="space-y-3">
            <RecentEvals sessionId={sessionId} items={view.recent} />
            {byTeam.length === 0 && <p className={`${ui.cardPad} ${ui.muted}`}>Aucun élève à arbitrer pour l&apos;instant.</p>}
            {byTeam.map(([teamId, g]) => {
              const blocked = teamId === excludedTeam;
              return (
                <section key={teamId} className={cx(ui.card, "p-2", blocked && "opacity-50")}>
                  <p className="text-xs font-bold text-ink-2 px-1 mb-1">{g.teamName}{blocked && <span className="ml-2 font-normal text-ink-3">· arbitrée à l&apos;instant, revient après ta prochaine évaluation</span>}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {g.list.map((s) => (
                      <button key={s.userId} type="button" disabled={blocked || pending} onClick={() => { setStudent(s); setExerciseId(null); setStep("exercise"); }} className={cx(ui.btn, "justify-start text-left", "bg-paper border border-line-2 hover:border-brand disabled:cursor-not-allowed")}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {step === "exercise" && student && (
          <div className="space-y-2">
            <p className={ui.hint}>Exercice observé chez <b className="text-ink">{student.name}</b> ({student.teamName}). <button type="button" onClick={() => setStep("student")} className="underline">changer d&apos;élève</button></p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {exercises.map((e) => (
                <button key={e.exerciseId} type="button" onClick={() => { setExerciseId(e.exerciseId); }} className={cx(ui.btn, "justify-start text-left", exerciseId === e.exerciseId ? "bg-ink text-white" : "bg-paper border border-line-2 hover:border-brand")}>
                  {cap(e.label)}
                </button>
              ))}
            </div>
            {exercises.length === 0 && <p className={ui.hint}>Aucun exercice suggéré : affiche tous les exercices.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${ui.hint} flex items-center gap-1`}><input type="checkbox" checked={allExos} onChange={(e) => setAllExos(e.target.checked)} className={ui.check} /> tous les exercices de l&apos;échelle</label>
              <button type="button" disabled={!exerciseId} onClick={goEval} className={`${btn.primary} ml-auto`}>Évaluer →</button>
            </div>
          </div>
        )}

        {step === "eval" && student && exercise && (
          <div className={ui.cardPad}>
            <p className={ui.eyebrow}>{student.teamName}</p>
            <h2 className={ui.h2}>{student.name}</h2>
            <p className="text-sm text-ink-2 font-bold mb-3">{cap(exercise.label)}</p>
            <label className={ui.label}>Répétitions observées</label>
            <input type="number" inputMode="numeric" min={0} max={999} value={reps} onChange={(e) => setReps(e.target.value)} autoFocus className={`${ui.input} text-2xl font-display font-extrabold tabular-nums mb-3`} placeholder="0" />
            <p className={ui.label}>Qualité</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {QUALITY_LEVELS.map((q) => (
                <button key={q.code} type="button" onClick={() => setNote(q.value)} className={cx("rounded-xl border px-2 py-2 text-sm font-bold transition", note === q.value ? "bg-ink text-white border-ink" : "bg-card border-line-2 hover:border-brand")}>
                  <span className={cx("block font-display text-lg", note === q.value ? "text-white" : q.color)}>{q.code}</span>
                  <span className="block text-[10px] font-normal opacity-80">{q.label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep("exercise")} className={btn.ghost}>← Exercice</button>
              <button type="button" onClick={goBoard} className={`${btn.lgDanger} flex-1`}>🔥 Choisir une case</button>
            </div>
          </div>
        )}

        {step === "board" && (
          <div className="space-y-2">
            <p className={ui.hint}>{result ? "Résultat…" : "Tape une case grise pour tirer. Chiffre = bombes dans les 8 cases voisines."}</p>
            <div className="grid gap-1 mx-auto" style={{ gridTemplateColumns: `repeat(${MINE_COLS}, minmax(0, 1fr))`, maxWidth: 400 }}>
              {Array.from({ length: MINE_ROWS }, (_, r) => Array.from({ length: MINE_COLS }, (_, c) => {
                const cell = cells[r][c];
                const isHit = result && result.row === r && result.col === c;
                return cell === null ? (
                  <button key={`${r}_${c}`} type="button" disabled={pending || !!result} onClick={() => fire(r, c)} aria-label={`case ${r + 1}-${c + 1}`} className="aspect-square rounded-md bg-line-2/70 hover:bg-brand-soft border border-line-2 shadow-[inset_0_-2px_0_rgba(0,0,0,.12)] active:scale-95 transition disabled:opacity-70" />
                ) : cell.mine ? (
                  <span key={`${r}_${c}`} className={cx("aspect-square rounded-md bg-danger text-white flex items-center justify-center text-lg", isHit && "ring-2 ring-accent")}>💣</span>
                ) : (
                  <span key={`${r}_${c}`} className={cx("aspect-square rounded-md bg-card border border-line flex items-center justify-center font-display font-extrabold text-base", DIGIT[cell.n] ?? "text-ink-3", isHit && "ring-2 ring-accent")}>{cell.n || ""}</span>
                );
              }))}
            </div>
            {!result && <button type="button" onClick={() => setStep("eval")} className={btn.ghost}>← Revoir l&apos;évaluation</button>}
          </div>
        )}
      </main>

      <AnimatePresence>
        {result && (
          <motion.div key={result.id} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-0 top-24 z-40 flex justify-center pointer-events-none">
            <span className={cx("rounded-2xl px-5 py-3 font-display font-extrabold text-xl shadow-pop text-center", result.mine ? "bg-danger text-white" : "bg-card border border-line text-ink")}>
              {result.mine ? `💥 BOMBE trouvée ! ${result.foundInRound}/${MINE_COUNT}` : result.n ? `${result.n} bombe${result.n > 1 ? "s" : ""} autour` : `Rien autour… ${result.opened.length} case${result.opened.length > 1 ? "s" : ""} ouverte${result.opened.length > 1 ? "s" : ""}`}
              {result.roundDone && <span className="block text-sm font-bold mt-1">🏆 Carte terminée, une nouvelle t&apos;attend !</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
