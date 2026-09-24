"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { MineView } from "@/lib/mine";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { minePulseAction, revealCellAction } from "./mine-actions";
import { usePulse } from "../_components/usePulse";
import { RecentEvals } from "./RecentEvals";
import { btn, cx, ui } from "@/lib/ui";

const DIGIT: Record<number, string> = { 1: "text-blue-600", 2: "text-green-700", 3: "text-red-600", 4: "text-indigo-800", 5: "text-amber-800", 6: "text-teal-700", 7: "text-black", 8: "text-gray-600" };
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Demineur des arbitres (WOD Level) : lignes = eleves, colonnes = exercices. Une case cachee se joue en
// encodant les reps observees et la qualite, puis « Feu ». Chiffre = mines dans les 8 cases voisines.
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
  const [target, setTarget] = useState<{ row: number; col: number } | null>(null);
  const [reps, setReps] = useState("");
  const [note, setNote] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<{ id: number; mine: boolean; n: number } | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const pulse = useCallback(() => minePulseAction(sessionId), [sessionId]);
  usePulse(pulse, 10000, !target && !pending);

  const cells = view.cells;
  const me = useMemo(() => view.leaderboard.findIndex((l) => l.refereeId === evaluator.id), [view.leaderboard, evaluator.id]);
  const playable = (r: number, c: number) => !cells[r][c] && view.rows[r].userId !== evaluator.id && (!ownTeamId || view.rows[r].teamId !== ownTeamId);

  function open(r: number, c: number) {
    if (!playable(r, c)) return;
    setTarget({ row: r, col: c });
    setReps("");
    setNote(null);
    setError("");
  }
  function fire() {
    if (!target) return;
    const n = parseInt(reps, 10);
    if (!Number.isInteger(n) || n < 0) { setError("Encode les reps observées."); return; }
    if (note === null) { setError("Choisis une appréciation."); return; }
    setError("");
    startTransition(async () => {
      const res = await revealCellAction(sessionId, target.row, target.col, n, note);
      if ("error" in res) { setError(res.error); return; }
      setFlash({ id: Date.now(), mine: res.mine, n: res.n });
      setTarget(null);
      router.refresh();
      setTimeout(() => setFlash(null), 1800);
    });
  }

  const t = target ? { row: view.rows[target.row], col: view.cols[target.col] } : null;
  const back = evaluator.role === "STUDENT" ? "/eleve" : "/admin";

  return (
    <div className={`${ui.page} pb-6`}>
      <header className="sticky top-0 z-20 px-3 py-2 bg-card/95 backdrop-blur border-b border-line flex items-center gap-3">
        <a href={back} aria-label="Retour" className="w-9 h-9 rounded-full bg-paper hover:bg-line text-ink-2 flex items-center justify-center font-bold text-lg flex-shrink-0">‹</a>
        <div className="min-w-0 flex-1">
          <p className={ui.eyebrow}>💣 Démineur · {sessionLabel}</p>
          <p className="text-xs text-ink-2 truncate">{ended ? "WOD terminé · l'arbitrage reste ouvert" : "Encode les reps et la qualité, puis feu. Les chiffres comptent les bombes voisines."}</p>
        </div>
        <button type="button" onClick={() => setShowBoard((v) => !v)} className={cx(ui.chip, ui.chipAccent, "text-sm px-3 py-1")} title="Classement des arbitres">
          💣 {view.found} / {view.total}{me >= 0 && <span className="ml-1 opacity-70">#{me + 1}</span>}
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

      <div className="p-3">
        <RecentEvals sessionId={sessionId} items={view.recent} />
      </div>

      <div className="overflow-auto px-3 pb-3">
        <table className="border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-paper text-left text-[10px] text-ink-3 font-bold pr-2">Élève</th>
              {view.cols.map((c) => (
                <th key={c.exerciseId} className="align-bottom pb-1">
                  <span className="block w-9 text-[9px] font-bold text-ink-2 leading-tight break-words text-center" title={c.label}>{shortLabel(c.label)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r, ri) => {
              const mine = r.userId === evaluator.id || (!!ownTeamId && r.teamId === ownTeamId);
              return (
                <tr key={r.userId} className={cx(mine && "opacity-40")}>
                  <th className="sticky left-0 z-10 bg-paper text-left pr-2 whitespace-nowrap">
                    <span className="block text-xs font-bold text-ink leading-tight">{r.name}</span>
                    <span className="block text-[9px] text-ink-3 leading-tight">{r.teamName}</span>
                  </th>
                  {view.cols.map((c, ci) => {
                    const cell = cells[ri][ci];
                    return (
                      <td key={c.exerciseId} className="p-0">
                        {cell === null ? (
                          <button
                            type="button"
                            onClick={() => open(ri, ci)}
                            disabled={mine || pending}
                            aria-label={`${r.name} · ${c.label}`}
                            className="w-9 h-9 rounded-md bg-line-2/70 hover:bg-brand-soft border border-line-2 shadow-[inset_0_-2px_0_rgba(0,0,0,.12)] active:scale-95 transition disabled:cursor-not-allowed"
                          />
                        ) : cell.mine ? (
                          <span className="w-9 h-9 rounded-md bg-danger text-white flex items-center justify-center text-lg" title="Bombe trouvée">💣</span>
                        ) : (
                          <span className={cx("w-9 h-9 rounded-md bg-card border border-line flex items-center justify-center font-display font-extrabold text-base", DIGIT[cell.n] ?? "text-ink-3")}>{cell.n || ""}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className={`${ui.hint} mt-2`}>Case grise = à jouer · chiffre = bombes dans les 8 cases voisines · 💣 = bombe trouvée. Lignes grisées : toi-même et ta propre équipe. {view.total} bombes cachées, les mêmes pour tous les arbitres.</p>
      </div>

      <AnimatePresence>
        {flash && (
          <motion.div key={flash.id} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-0 top-24 z-40 flex justify-center pointer-events-none">
            <span className={cx("rounded-2xl px-5 py-3 font-display font-extrabold text-xl shadow-pop", flash.mine ? "bg-danger text-white" : "bg-card border border-line text-ink")}>
              {flash.mine ? "💥 BOMBE trouvée !" : flash.n ? `${flash.n} bombe${flash.n > 1 ? "s" : ""} autour` : "Rien autour…"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {t && (
        <div className={ui.backdrop} onClick={() => !pending && setTarget(null)}>
          <div className={ui.sheet} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <p className={ui.eyebrow}>{t.row.teamName}</p>
                <h2 className={ui.h2}>{t.row.name}</h2>
                <p className="text-sm text-ink-2 font-bold">{cap(t.col.label)}</p>
              </div>
              <button type="button" onClick={() => setTarget(null)} className={ui.close} aria-label="Fermer">✕</button>
            </div>
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
            {error && <p className={`${ui.alertErr} mb-3`}>{error}</p>}
            <button type="button" onClick={fire} disabled={pending} className={`${btn.lgDanger} w-full`}>🔥 Feu !</button>
          </div>
        </div>
      )}
    </div>
  );
}

function shortLabel(s: string): string {
  const t = cap(s);
  return t.length <= 10 ? t : t.replace(/[aeiouy]/gi, (m, i) => (i === 0 ? m : "")).slice(0, 10);
}
