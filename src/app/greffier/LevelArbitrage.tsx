"use client";

import { useMemo, useState, useTransition } from "react";
import type { LevelEval } from "@/lib/level-context";
import { QUALITY_LEVELS, qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { updateEvaluationAction, updateEvaluationCriteriaAction } from "./eval-actions";
import { dissonances, isBad, isExcellent, refereeRanking } from "@/lib/eval-insights";
import { criteriaComment, exoLabel, isLiked } from "@/lib/level-criteria";
import { CriteriaChecklist } from "../_components/CriteriaChecklist";
import { fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import { btn, cx, ui } from "@/lib/ui";

const cap = exoLabel;

// Onglet « Arbitrage » du greffier Level (Sartay 28/09) : recap de la seance pour le prof (evaluations mauvaises,
// excellentes, dissonantes, classement des arbitres), puis le detail eleve par eleve et arbitre par arbitre,
// corrigeable en place (les criteres se re-cochent, l'appreciation suit).
export function LevelArbitrage({ evaluations, onChanged }: { evaluations: LevelEval[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [reps, setReps] = useState("");
  const [note, setNote] = useState<number | null>(null);
  const [met, setMet] = useState<boolean[]>([]);
  const [liked, setLiked] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"student" | "referee">("student");
  const [pending, startTransition] = useTransition();
  const colorOf = (n: number) => QUALITY_LEVELS.find((l) => l.value === n)?.color ?? "text-ink-3";

  const dis = useMemo(() => dissonances(evaluations), [evaluations]);
  const disIds = useMemo(() => new Set(dis.flatMap((d) => [d.a.id, d.b.id])), [dis]);
  const ranking = useMemo(() => refereeRanking(evaluations), [evaluations]);
  const bad = useMemo(() => evaluations.filter((e) => isBad(e.note)), [evaluations]);
  const top = useMemo(() => evaluations.filter((e) => isExcellent(e.note)), [evaluations]);
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; sub: string; items: LevelEval[] }>();
    for (const e of evaluations) {
      const k = mode === "student" ? e.targetUserId : e.refereeId;
      const g = m.get(k) ?? { title: mode === "student" ? e.targetName : e.refereeName, sub: mode === "student" ? e.teamName : "arbitre", items: [] };
      g.items.push(e);
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => a[1].sub.localeCompare(b[1].sub, "fr", { numeric: true }) || a[1].title.localeCompare(b[1].title, "fr"));
  }, [evaluations, mode]);

  function start(e: LevelEval) {
    setEditing(e.id);
    setReps(String(e.reps));
    setNote(e.note);
    setMet((e.criteria ?? []).map((c) => c.met));
    setLiked(isLiked(e.note, e.criteria));
    setError("");
  }
  function save(e: LevelEval) {
    const r = parseInt(reps, 10);
    if (!Number.isInteger(r) || (!e.criteria && note === null)) return;
    setError("");
    startTransition(async () => {
      const res = e.criteria
        ? await updateEvaluationCriteriaAction(e.id, r, met.map((m, i) => (m ? i : -1)).filter((i) => i >= 0), liked && met.every(Boolean))
        : await updateEvaluationAction(e.id, r, note as number);
      if ("error" in res) setError(res.error);
      else { setEditing(null); onChanged(); }
    });
  }

  if (evaluations.length === 0) {
    return <p className={`${ui.cardPad} ${ui.muted}`}>Aucune évaluation du démineur pour l&apos;instant. Les arbitres encodent les reps et cochent les critères observés à chaque case jouée.</p>;
  }
  const line = (e: LevelEval, withReferee = true) => (
    <span className="text-sm">
      <b className="text-ink">{e.targetName}</b> <span className="text-ink-3">({e.teamName})</span> · {cap(e.exerciseLabel)} · <b className={colorOf(e.note)}>{qualityCodeFromValue(e.note)}</b>
      {e.criteria && <span className="text-ink-3"> {e.criteria.filter((c) => c.met).length}/{e.criteria.length}</span>}
      {withReferee && <span className="text-ink-3"> · par {e.refereeName}</span>}
    </span>
  );

  return (
    <div className="space-y-3">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-3`}>
        <span className="font-display font-extrabold text-lg">🧑‍⚖️ Récap de l&apos;arbitrage</span>
        <span className={ui.hint}>{evaluations.length} évaluation{evaluations.length > 1 ? "s" : ""} · {ranking.length} arbitre{ranking.length > 1 ? "s" : ""} · {new Set(evaluations.map((e) => e.targetUserId)).size} élève(s) évalué(s)</span>
        <span className={cx(ui.chip, ui.chipErr)}>🔻 {bad.length} TI/I</span>
        <span className={cx(ui.chip, ui.chipSea)}>🌟 {top.length} E</span>
        <span className={cx(ui.chip, ui.chipWarn)}>⚖️ {dis.length} dissonance{dis.length > 1 ? "s" : ""}</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className={`${ui.card} overflow-x-auto`}>
          <p className="px-3 pt-2 font-bold text-sm">🏅 Classement des arbitres</p>
          <table className="w-full text-sm">
            <thead><tr><th className={ui.th}>#</th><th className={ui.th}>Arbitre</th><th className={`${ui.th} text-right`}>Évals</th><th className={`${ui.th} text-right`} title="Moyenne des appréciations données, sur 5">Note moyenne donnée</th><th className={`${ui.th} text-right`} title="Évaluations à 2 appréciations ou plus d'un autre arbitre, même élève, même exercice">Dissonantes</th></tr></thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.refereeId} className={ui.tr}>
                  <td className="p-2 font-display font-extrabold">{i + 1}</td>
                  <td className="p-2 font-bold">{r.name}</td>
                  <td className="p-2 text-right tabular-nums">{r.count}</td>
                  <td className="p-2 text-right tabular-nums">{r.avgGrade.toFixed(1).replace(".", ",")}/5 <span className="text-ink-3">≈ {r.avgCode}</span></td>
                  <td className={cx("p-2 text-right tabular-nums", r.dissonant ? "text-warn-ink font-bold" : "text-ink-3")}>{r.dissonant}{r.dissonant ? ` (${Math.round(r.rate * 100)} %)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`${ui.hint} p-2`}>Les plus fiables en tête (le moins d&apos;évaluations dissonantes, en proportion). Une note moyenne très haute ou très basse signale un arbitre trop large ou trop sévère.</p>
        </section>
        <section className={`${ui.card} p-3`}>
          <p className="font-bold text-sm mb-1">⚖️ Évaluations dissonantes</p>
          <p className={`${ui.hint} mb-2`}>Même élève, même exercice, deux arbitres à 2 appréciations d&apos;écart ou plus.</p>
          {dis.length === 0 ? <p className={ui.muted}>Aucune.</p> : (
            <ul className="space-y-1">
              {dis.slice(0, 30).map((d, i) => (
                <li key={i} className={`${ui.inset} px-2 py-1 text-sm`}>
                  <b>{d.a.targetName}</b> <span className="text-ink-3">({d.a.teamName})</span> · {cap(d.a.exerciseLabel)} : <b className={colorOf(d.a.note)}>{qualityCodeFromValue(d.a.note)}</b> par {d.a.refereeName} ↔ <b className={colorOf(d.b.note)}>{qualityCodeFromValue(d.b.note)}</b> par {d.b.refereeName}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${ui.card} p-3`}>
          <p className="font-bold text-sm mb-1">🔻 Évaluations mauvaises (TI, I)</p>
          {bad.length === 0 ? <p className={ui.muted}>Aucune.</p> : <ul className="space-y-1">{bad.map((e) => <li key={e.id} className={`${ui.inset} px-2 py-1`}>{line(e)}</li>)}</ul>}
        </section>
        <section className={`${ui.card} p-3`}>
          <p className="font-bold text-sm mb-1">🌟 Évaluations excellentes (E)</p>
          {top.length === 0 ? <p className={ui.muted}>Aucune.</p> : <ul className="space-y-1">{top.map((e) => <li key={e.id} className={`${ui.inset} px-2 py-1`}>{line(e)}</li>)}</ul>}
        </section>
      </div>

      <div className="flex items-center gap-2">
        <span className={ui.eyebrow}>Détail</span>
        <div className={`${ui.segmented} inline-flex`}>
          <button type="button" onClick={() => setMode("student")} className={cx("px-3 py-1 rounded-lg text-sm font-bold", mode === "student" ? ui.segOn : ui.segOff)}>Par élève</button>
          <button type="button" onClick={() => setMode("referee")} className={cx("px-3 py-1 rounded-lg text-sm font-bold", mode === "referee" ? ui.segOn : ui.segOff)}>Par arbitre</button>
        </div>
      </div>
      {error && <p className={ui.alertErr}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {groups.map(([key, g]) => (
          <section key={key} className={`${ui.card} p-3`}>
            <p className="font-bold text-ink">{g.title} <span className="text-ink-3 font-normal text-xs">· {g.sub} · {g.items.length} obs.</span></p>
            <ul className="mt-1 space-y-1">
              {g.items.sort((a, b) => a.atMs - b.atMs).map((e) => (
                <li key={e.id} className={cx(ui.inset, "px-2 py-1.5 text-sm", disIds.has(e.id) && "border-warn/60")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold flex-1 min-w-[120px] truncate">{mode === "student" ? cap(e.exerciseLabel) : `${e.targetName} · ${cap(e.exerciseLabel)}`}</span>
                    {editing !== e.id && (
                      <>
                        <span className="tabular-nums">{e.reps} reps</span>
                        <span className={cx("font-black", colorOf(e.note))}>{qualityCodeFromValue(e.note) ?? "?"}</span>
                        {disIds.has(e.id) && <span title="Dissonante">⚖️</span>}
                        <span className={`${ui.hint} tabular-nums`}>{mode === "student" ? e.refereeName : e.teamName} · {fmt(e.atMs)}</span>
                        <button type="button" onClick={() => start(e)} className={btn.smSoft} title="Corriger">✎</button>
                      </>
                    )}
                  </div>
                  {editing !== e.id && e.criteria && <p className="text-[11px] text-ink-2 mt-0.5 leading-snug">💬 {criteriaComment(e.exerciseLabel, e.criteria, isLiked(e.note, e.criteria))}</p>}
                  {editing === e.id && (
                    <div className="mt-2 space-y-2">
                      <label className="text-xs text-ink-2 flex items-center gap-2">Reps <input type="number" min={0} max={999} value={reps} onChange={(x) => setReps(x.target.value)} className={`${ui.input} w-20 tabular-nums`} /></label>
                      {e.criteria ? (
                        <CriteriaChecklist compact labels={e.criteria.map((c) => c.label)} met={met} onToggle={(i) => { setMet((m) => m.map((x, k) => (k === i ? !x : x))); setLiked(false); }} liked={liked} onLike={e.criteria.length === 4 ? () => setLiked((v) => !v) : undefined} />
                      ) : (
                        <select value={note ?? ""} onChange={(x) => setNote(Number(x.target.value))} className={`${ui.input} w-24`}>
                          {QUALITY_LEVELS.map((q) => <option key={q.code} value={q.value}>{q.code}</option>)}
                        </select>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setEditing(null)} className={btn.smSoft}>Annuler</button>
                        <button type="button" onClick={() => save(e)} disabled={pending} className={btn.smPrimary}>Enregistrer</button>
                      </div>
                    </div>
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
