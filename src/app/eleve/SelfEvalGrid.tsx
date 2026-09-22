"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUALITY_LEVELS, type QualityCode } from "@/lib/wod-engines/core/quality";
import type { SelfEvalCriterion } from "@/lib/wod-engines/core/self-eval";
import { submitSelfEvaluationAction } from "./actions";

type Props = {
  sessionId: string;
  criteria: SelfEvalCriterion[];
  initial: Record<string, string> | null;
  state: "open" | "notYet" | "expired";
  closesAt: number | null;
  submittedAt: number | null;
};

// Grille d'auto-evaluation : une ligne par critere, une seule case selectionnee par ligne (tap).
export function SelfEvalGrid({ sessionId, criteria, initial, state, closesAt, submittedAt }: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, QualityCode>>(() => {
    const out: Record<string, QualityCode> = {};
    if (initial) for (const c of criteria) if (initial[c.id]) out[c.id] = initial[c.id] as QualityCode;
    return out;
  });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const editable = state === "open";
  const complete = criteria.every((c) => !!answers[c.id]);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const res = await submitSelfEvaluationAction(sessionId, answers);
      if ("error" in res) setMessage({ tone: "error", text: res.error });
      else {
        setMessage({ tone: "ok", text: "Auto-évaluation enregistrée ✅" });
        router.refresh();
      }
    });
  }

  return (
    <div>
      {state === "notYet" && (
        <p className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 mb-4">
          ⏳ L'auto-évaluation s'ouvrira dès que ton équipe aura terminé le WOD (et restera disponible 24 h).
        </p>
      )}
      {state === "expired" && (
        <p className="bg-slate-100 border border-slate-200 text-slate-600 text-sm rounded-lg p-3 mb-4">
          🔒 Le délai de 24 h est écoulé. {initial ? "Voici ce que tu avais répondu." : "Tu n'as pas rempli ton auto-évaluation."}
        </p>
      )}
      {state === "open" && closesAt && (
        <p className="text-xs text-slate-500 mb-3">
          Ouverte jusqu'au {new Date(closesAt).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })}.
          {submittedAt && <> Dernier envoi : {new Date(submittedAt).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })}.</>}
        </p>
      )}

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full min-w-[520px] border-separate border-spacing-y-2">
          <thead>
            <tr>
              <th className="text-left text-xs font-bold text-slate-500 pb-1">Critère</th>
              {QUALITY_LEVELS.map((l) => (
                <th key={l.code} className="text-center text-xs font-black text-slate-700 pb-1 w-14" title={l.label}>
                  {l.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.id}>
                <td className="pr-3 align-middle">
                  <div className="font-bold text-sm leading-tight">{c.label}</div>
                  {c.hint && <div className="text-[11px] text-slate-500 leading-tight">{c.hint}</div>}
                </td>
                {QUALITY_LEVELS.map((l) => {
                  const selected = answers[c.id] === l.code;
                  return (
                    <td key={l.code} className="text-center align-middle">
                      <button
                        type="button"
                        disabled={!editable || pending}
                        aria-pressed={selected}
                        onClick={() => setAnswers((a) => ({ ...a, [c.id]: l.code }))}
                        className={`w-12 h-12 rounded-xl border-2 font-black text-sm transition-all ${
                          selected
                            ? "bg-slate-900 border-slate-900 text-white shadow"
                            : editable
                              ? "bg-white border-slate-200 text-slate-300 hover:border-slate-500"
                              : "bg-slate-50 border-slate-100 text-slate-200"
                        }`}
                      >
                        {selected ? l.code : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-slate-500">
        {QUALITY_LEVELS.map((l) => (
          <span key={l.code}><b>{l.code}</b> = {l.label}</span>
        ))}
      </div>

      {message && (
        <p className={`text-sm mt-4 font-bold ${message.tone === "ok" ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>
      )}

      {editable && (
        <button
          onClick={submit}
          disabled={!complete || pending}
          className="mt-4 w-full bg-slate-900 disabled:bg-slate-300 text-white font-black py-4 rounded-2xl text-lg transition-transform active:scale-[0.98]"
        >
          {pending ? "…" : initial ? "Mettre à jour mon auto-évaluation" : "Envoyer mon auto-évaluation"}
        </button>
      )}
      {editable && !complete && <p className="text-xs text-slate-500 mt-2 text-center">Choisis une case par ligne pour pouvoir envoyer.</p>}
    </div>
  );
}
