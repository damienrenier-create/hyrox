"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUALITY_LEVELS, type QualityCode } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { deleteReviewAction, saveReviewAction, type ReviewView } from "./review-actions";
import { btn, cx, ui } from "@/lib/ui";

export type ReviewTarget = {
  sessionId: string;
  studentId: string;
  studentName: string;
  className: string;
  sessionLabel: string;
  studentAnswers: Record<string, string> | null; // ce que l'eleve a coche, pour comparer
  review: ReviewView | null;
};

const ON: Record<QualityCode, string> = {
  TI: "bg-red-600 border-red-700 text-white",
  I: "bg-orange-500 border-orange-600 text-white",
  S: "bg-yellow-400 border-yellow-500 text-ink",
  B: "bg-lime-600 border-lime-700 text-white",
  TB: "bg-emerald-600 border-emerald-700 text-white",
  E: "bg-sky-600 border-sky-700 text-white",
};

// Bouton dans la liste des auto-evaluations, qui ouvre la fenetre de revue.
export function ReviewButton({ target }: { target: ReviewTarget }) {
  const [open, setOpen] = useState(false);
  const r = target.review;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(btn.smGhost, r && "border-brand/60")}
        title={r ? `Revu par ${r.reviewerName}${r.visible ? " · visible par l'élève" : " · non visible"}` : "Donner ton avis sur cette séance"}
      >
        {r ? (r.visible ? "👁 Revu" : "✓ Revu") : "Revoir"}
      </button>
      {open && <ReviewPanel target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

// La meme grille que l'eleve, remplie par le prof, avec la case de l'eleve signalee pour comparer.
export function ReviewPanel({ target, onClose }: { target: ReviewTarget; onClose: () => void }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, QualityCode>>(() => {
    const out: Record<string, QualityCode> = {};
    for (const c of SELF_EVAL_CRITERIA) {
      const v = target.review?.answers[c.id];
      if (v) out[c.id] = v as QualityCode;
    }
    return out;
  });
  const [visible, setVisible] = useState(target.review?.visible ?? false);
  const [comment, setComment] = useState(target.review?.comment ?? "");
  const [commentVisible, setCommentVisible] = useState(target.review?.commentVisible ?? false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const filled = Object.keys(answers).length;

  function save() {
    setError("");
    startTransition(async () => {
      const res = await saveReviewAction({ sessionId: target.sessionId, studentId: target.studentId, answers, visible, comment, commentVisible });
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }
  function remove() {
    if (!confirm("Retirer ton avis sur cette séance ? L'auto-évaluation de l'élève n'est pas touchée.")) return;
    startTransition(async () => {
      await deleteReviewAction(target.sessionId, target.studentId);
      router.refresh();
      onClose();
    });
  }

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-3xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className={ui.eyebrow}>Avis du prof</div>
            <h3 className={`${ui.h2} leading-tight`}>{target.studentName}</h3>
            <p className={ui.hint}>{target.className} · {target.sessionLabel}</p>
          </div>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">×</button>
        </div>

        <p className={`${ui.hint} mb-3`}>
          Une case par ligne. Le point <span className="inline-block w-2 h-2 rounded-full bg-ink align-middle" /> marque ce que l&apos;élève a coché
          {target.studentAnswers ? "" : " (il n'a pas rendu son auto-évaluation)"}.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className={`${ui.th} text-left`}>Critère</th>
                {QUALITY_LEVELS.map((l) => (
                  <th key={l.code} className={`${ui.th} text-center`} title={l.label}>{l.code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SELF_EVAL_CRITERIA.map((c) => (
                <tr key={c.id} className={ui.tr}>
                  <td className="p-2 font-bold text-ink whitespace-nowrap">{c.label}</td>
                  {QUALITY_LEVELS.map((l) => {
                    const on = answers[c.id] === l.code;
                    const student = target.studentAnswers?.[c.id] === l.code;
                    return (
                      <td key={l.code} className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => setAnswers((a) => (a[c.id] === l.code ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== c.id)) : { ...a, [c.id]: l.code }))}
                          title={c.levels[l.code]}
                          className={cx(
                            "relative w-10 h-9 rounded-lg border-2 font-black transition",
                            on ? ON[l.code] : "bg-card border-line-2 text-ink-2 hover:border-brand"
                          )}
                        >
                          {l.code}
                          {student && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-ink ring-2 ring-card" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <label className={cx("flex items-start gap-3 rounded-xl border p-3 cursor-pointer", visible ? "bg-success-soft border-success/50" : "bg-paper border-line")}>
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className={`${ui.check} mt-0.5`} />
            <span className="text-sm">
              <b className="block">L&apos;élève voit ta grille</b>
              <span className={ui.hint}>Décoché, ton avis reste entre profs.</span>
            </span>
          </label>
          <label className={cx("flex items-start gap-3 rounded-xl border p-3 cursor-pointer", commentVisible && comment.trim() ? "bg-success-soft border-success/50" : "bg-paper border-line")}>
            <input type="checkbox" checked={commentVisible} disabled={!comment.trim()} onChange={(e) => setCommentVisible(e.target.checked)} className={`${ui.check} mt-0.5`} />
            <span className="text-sm">
              <b className="block">L&apos;élève voit ton commentaire</b>
              <span className={ui.hint}>{comment.trim() ? "Il apparaîtra sous sa grille." : "Écris d'abord un commentaire."}</span>
            </span>
          </label>
        </div>

        <label className="block mt-3">
          <span className={ui.label}>Commentaire (facultatif)</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Un mot pour l'élève, ou une note pour toi."
            className={`${ui.input} resize-y`}
          />
        </label>

        {error && <p className={`${ui.alertErr} mt-3`}>{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          {target.review ? (
            <button type="button" onClick={remove} disabled={pending} className={btn.smDanger}>Retirer mon avis</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btn.ghost}>Annuler</button>
            <button type="button" onClick={save} disabled={pending || (filled === 0 && !comment.trim())} className={btn.primary}>
              {pending ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
