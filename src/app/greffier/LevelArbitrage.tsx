"use client";

import { useMemo, useState, useTransition } from "react";
import type { LevelEval } from "@/lib/level-context";
import { QUALITY_LEVELS, qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { updateEvaluationAction } from "./eval-actions";
import { fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import { btn, cx, ui } from "@/lib/ui";

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Onglet « Arbitrage » du greffier Level : ce que le demineur a produit, eleve par eleve (reps observees,
// qualite, arbitre), corrigeable en place par le staff. Un resume par arbitre en tete.
export function LevelArbitrage({ evaluations, onChanged }: { evaluations: LevelEval[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [reps, setReps] = useState("");
  const [note, setNote] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const colorOf = (n: number) => QUALITY_LEVELS.find((l) => l.value === n)?.color ?? "text-ink-3";

  const byStudent = useMemo(() => {
    const m = new Map<string, { name: string; teamName: string; items: LevelEval[] }>();
    for (const e of evaluations) {
      const g = m.get(e.targetUserId) ?? { name: e.targetName, teamName: e.teamName, items: [] };
      g.items.push(e);
      m.set(e.targetUserId, g);
    }
    return [...m.entries()].sort((a, b) => a[1].teamName.localeCompare(b[1].teamName, "fr", { numeric: true }) || a[1].name.localeCompare(b[1].name, "fr"));
  }, [evaluations]);
  const byReferee = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of evaluations) m.set(e.refereeName, (m.get(e.refereeName) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [evaluations]);

  function save(id: string) {
    const r = parseInt(reps, 10);
    if (!Number.isInteger(r) || note === null) return;
    setError("");
    startTransition(async () => {
      const res = await updateEvaluationAction(id, r, note);
      if ("error" in res) setError(res.error);
      else {
        setEditing(null);
        onChanged();
      }
    });
  }

  if (evaluations.length === 0) {
    return <p className={`${ui.cardPad} ${ui.muted}`}>Aucune évaluation du démineur pour l&apos;instant. Les arbitres encodent reps et qualité à chaque case jouée.</p>;
  }
  return (
    <div className="space-y-3">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-2`}>
        <span className={ui.eyebrow}>Arbitres</span>
        {byReferee.map(([name, n]) => <span key={name} className={cx(ui.chip, ui.chipSea)}>{name} · {n}</span>)}
        <span className={`${ui.hint} ml-auto`}>{evaluations.length} évaluation{evaluations.length > 1 ? "s" : ""} · {byStudent.length} élève{byStudent.length > 1 ? "s" : ""} évalué{byStudent.length > 1 ? "s" : ""}</span>
      </div>
      {error && <p className={ui.alertErr}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {byStudent.map(([userId, g]) => (
          <section key={userId} className={`${ui.card} p-3`}>
            <p className="font-bold text-ink">{g.name} <span className="text-ink-3 font-normal text-xs">· {g.teamName} · {g.items.length} obs.</span></p>
            <ul className="mt-1 space-y-1">
              {g.items.sort((a, b) => a.atMs - b.atMs).map((e) => (
                <li key={e.id} className={`${ui.inset} px-2 py-1.5 text-sm flex flex-wrap items-center gap-2`}>
                  <span className="font-bold flex-1 min-w-[120px] truncate">{cap(e.exerciseLabel)}</span>
                  {editing === e.id ? (
                    <>
                      <input type="number" min={0} max={999} value={reps} onChange={(x) => setReps(x.target.value)} className={`${ui.input} w-20 tabular-nums`} />
                      <select value={note ?? ""} onChange={(x) => setNote(Number(x.target.value))} className={`${ui.input} w-24`}>
                        {QUALITY_LEVELS.map((q) => <option key={q.code} value={q.value}>{q.code}</option>)}
                      </select>
                      <button type="button" onClick={() => save(e.id)} disabled={pending} className={btn.smPrimary}>OK</button>
                      <button type="button" onClick={() => setEditing(null)} className={btn.smSoft}>✕</button>
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums">{e.reps} reps</span>
                      <span className={cx("font-black", colorOf(e.note))}>{qualityCodeFromValue(e.note) ?? "?"}</span>
                      <span className={`${ui.hint} tabular-nums`}>{e.refereeName} · {fmt(e.atMs)}</span>
                      <button type="button" onClick={() => { setEditing(e.id); setReps(String(e.reps)); setNote(e.note); }} className={btn.smSoft} title="Corriger">✎</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
