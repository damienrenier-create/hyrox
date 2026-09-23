"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUALITY_LEVELS, qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import type { CellSummary } from "@/lib/referee-board";
import { updateEvaluationAction } from "./eval-actions";
import { btn, cx, ui } from "@/lib/ui";

// Fenetre du greffier sur une case : toutes les evaluations recues, chacune corrigeable (reps, appreciation).
export function EvalEditor({ cell, teamName, exerciseLabel, onClose }: { cell: CellSummary; teamName: string; exerciseLabel: string; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [reps, setReps] = useState("");
  const [note, setNote] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const colorOf = (n: number) => QUALITY_LEVELS.find((l) => l.value === n)?.color ?? "text-ink-3";

  function save(id: string) {
    const r = parseInt(reps, 10);
    if (!Number.isInteger(r) || note === null) return;
    setError("");
    startTransition(async () => {
      const res = await updateEvaluationAction(id, r, note);
      if ("error" in res) { setError(res.error); return; }
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className={ui.eyebrow}>Évaluations reçues</div>
            <h3 className={`${ui.h2} leading-tight`}>{teamName} · {exerciseLabel}</h3>
            <p className={ui.hint}>Corrige un misclic d&apos;arbitre. Le tir, lui, ne bouge pas.</p>
          </div>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">×</button>
        </div>
        <ul className="divide-y divide-line">
          {cell.items.map((it) => (
            <li key={it.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-ink truncate">{it.refereeName}</span>
                {editing === it.id ? null : (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <b className="tabular-nums">{it.reps} reps</b>
                    <b className={colorOf(it.note)}>{qualityCodeFromValue(it.note) ?? "?"}</b>
                    <button type="button" onClick={() => { setEditing(it.id); setReps(String(it.reps)); setNote(it.note); setError(""); }} className={btn.smSoft}>Corriger</button>
                  </span>
                )}
              </div>
              {editing === it.id && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-ink-2">Reps</label>
                    <input inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${ui.input} w-24 text-center font-bold`} autoFocus />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {QUALITY_LEVELS.map((l) => (
                      <button key={l.code} type="button" onClick={() => setNote(l.value)} title={l.label} className={cx(ui.pill, "px-2 py-1", note === l.value ? ui.pillOn : ui.pillOff)}>
                        {l.code}
                      </button>
                    ))}
                  </div>
                  {error && <p className={ui.alertErr}>{error}</p>}
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setEditing(null)} className={btn.smGhost}>Annuler</button>
                    <button type="button" onClick={() => save(it.id)} disabled={pending || !reps || note === null} className={btn.smPrimary}>{pending ? "…" : "Enregistrer"}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
