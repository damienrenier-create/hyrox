"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUALITY_LEVELS, qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { updateMyEvaluationAction, updateMyEvaluationCriteriaAction } from "./actions";
import { CriteriaChecklist } from "../_components/CriteriaChecklist";
import { isLiked, type CriterionCheck } from "@/lib/level-criteria";
import { btn, cx, ui } from "@/lib/ui";

export type RecentEval = { id: string; teamName: string; exerciseLabel: string; reps: number; note: number; atMs: number; criteria?: CriterionCheck[] | null };

// Les cinq dernieres evaluations de l'arbitre, repliees sous un bouton, chacune corrigeable en place.
export function RecentEvals({ sessionId, items }: { sessionId: string; items: RecentEval[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [reps, setReps] = useState("");
  const [note, setNote] = useState<number | null>(null);
  const [met, setMet] = useState<boolean[]>([]);
  const [liked, setLiked] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!items.length) return null;

  function start(e: RecentEval) {
    setEditing(e.id);
    setReps(String(e.reps));
    setNote(e.note);
    setMet((e.criteria ?? []).map((c) => c.met));
    setLiked(isLiked(e.note, e.criteria));
    setError("");
  }
  function save(e: RecentEval) {
    const r = parseInt(reps, 10);
    if (!Number.isInteger(r) || (!e.criteria && note === null)) return;
    setError("");
    startTransition(async () => {
      const res = e.criteria
        ? await updateMyEvaluationCriteriaAction(sessionId, e.id, r, met.map((m, i) => (m ? i : -1)).filter((i) => i >= 0), liked && met.every(Boolean))
        : await updateMyEvaluationAction(sessionId, e.id, r, note as number);
      if ("error" in res) { setError(res.error); return; }
      setEditing(null);
      router.refresh();
    });
  }
  const colorOf = (n: number) => QUALITY_LEVELS.find((l) => l.value === n)?.color ?? "text-ink-3";

  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className={cx(btn.smGhost, "w-full justify-between")}>
        <span>✏️ Mes {items.length} dernière{items.length > 1 ? "s" : ""} évaluation{items.length > 1 ? "s" : ""} · corriger un misclic</span>
        <span className="text-ink-3">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className={`${ui.card} mt-1 divide-y divide-line`}>
          {items.map((e) => (
            <li key={e.id} className="p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <b className="text-ink">{e.teamName}</b> <span className="text-ink-2">· {e.exerciseLabel}</span>
                </span>
                {editing === e.id ? null : (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <b className="text-ink tabular-nums">{e.reps} reps</b>
                    {e.criteria ? <b className="text-ink-2">{e.criteria.filter((c) => c.met).length}/{e.criteria.length} critères{isLiked(e.note, e.criteria) ? " ❤️" : ""}</b> : <b className={colorOf(e.note)}>{qualityCodeFromValue(e.note) ?? "?"}</b>}
                    <button type="button" onClick={() => start(e)} className={btn.smSoft}>Corriger</button>
                  </span>
                )}
              </div>
              {editing === e.id && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-ink-2">Reps</label>
                    <input
                      inputMode="numeric"
                      value={reps}
                      onChange={(ev) => setReps(ev.target.value.replace(/\D/g, "").slice(0, 3))}
                      className={`${ui.input} w-20 text-center font-bold`}
                      autoFocus
                    />
                  </div>
                  {e.criteria ? (
                    <CriteriaChecklist compact labels={e.criteria.map((c) => c.label)} met={met} onToggle={(i) => { setMet((m) => m.map((x, k) => (k === i ? !x : x))); setLiked(false); }} liked={liked} onLike={e.criteria.length === 4 ? () => setLiked((v) => !v) : undefined} />
                  ) : (
                  <div className="flex flex-wrap gap-1">
                    {QUALITY_LEVELS.map((l) => (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => setNote(l.value)}
                        className={cx(ui.pill, "px-2 py-1", note === l.value ? ui.pillOn : ui.pillOff)}
                        title={l.label}
                      >
                        {l.code}
                      </button>
                    ))}
                  </div>
                  )}
                  {error && <p className={ui.alertErr}>{error}</p>}
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setEditing(null)} className={btn.smGhost}>Annuler</button>
                    <button type="button" onClick={() => save(e)} disabled={pending || !reps || (!e.criteria && note === null)} className={btn.smPrimary}>
                      {pending ? "…" : "Enregistrer"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
