"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUALITY_LEVELS, type QualityCode } from "@/lib/wod-engines/core/quality";
import type { SelfEvalCriterion } from "@/lib/wod-engines/core/self-eval";
import { submitSelfEvaluationAction } from "./actions";
import { btn, cx, ui } from "@/lib/ui";

type Props = {
  sessionId: string;
  criteria: SelfEvalCriterion[];
  instruction: string;
  initial: Record<string, string> | null;
  state: "open" | "notYet" | "expired";
  closesAt: number | null;
  submittedAt: number | null;
};

// Couleurs de la grille papier (TI rouge -> E bleu), version mobile : une carte par niveau, on touche pour cocher.
const LEVEL_STYLE: Record<QualityCode, { idle: string; on: string }> = {
  TI: { idle: "bg-red-50 border-red-100", on: "bg-red-600 border-red-700 text-white" },
  I: { idle: "bg-orange-50 border-orange-100", on: "bg-orange-500 border-orange-600 text-white" },
  S: { idle: "bg-yellow-50 border-yellow-100", on: "bg-yellow-400 border-yellow-500 text-ink" },
  B: { idle: "bg-lime-50 border-lime-100", on: "bg-lime-600 border-lime-700 text-white" },
  TB: { idle: "bg-emerald-50 border-emerald-100", on: "bg-emerald-600 border-emerald-700 text-white" },
  E: { idle: "bg-sky-50 border-sky-100", on: "bg-sky-600 border-sky-700 text-white" },
};

export function SelfEvalGrid({ sessionId, criteria, instruction, initial, state, closesAt, submittedAt }: Props) {
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
  const fmt = (ms: number) => new Date(ms).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" });

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
        <p className={`${ui.alertWarn} mb-4`}>
          ⏳ L&apos;auto-évaluation s&apos;ouvrira dès que ton équipe aura terminé le WOD (et restera disponible 24 h).
        </p>
      )}
      {state === "expired" && (
        <p className="bg-paper border border-line text-ink-2 text-sm rounded-xl p-3 mb-4">
          🔒 Le délai de 24 h est écoulé. {initial ? "Voici ce que tu avais coché." : "Tu n'as pas rempli ton auto-évaluation."}
        </p>
      )}
      {state === "open" && (
        <p className={`${ui.hint} mb-3`}>
          {closesAt && <>Ouverte jusqu&apos;au {fmt(closesAt)}.</>}
          {submittedAt && <> Dernier envoi : {fmt(submittedAt)}.</>}
        </p>
      )}

      <p className="text-sm italic text-ink-2 mb-4"><b className="text-ink not-italic">Consigne :</b> {instruction}</p>

      <div className="space-y-5">
        {criteria.map((c, idx) => {
          const chosen = answers[c.id];
          return (
            <section key={c.id} className={`${ui.card} overflow-hidden`}>
              <header className="flex items-center justify-between gap-2 px-3 py-2 bg-paper border-b border-line">
                <h3 className="font-display font-bold text-sm">{idx + 1}. {c.label}</h3>
                <span className={cx(ui.chip, chosen ? "bg-brand text-white" : ui.chipMuted)}>
                  {chosen ? QUALITY_LEVELS.find((l) => l.code === chosen)?.label : "à cocher"}
                </span>
              </header>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2">
                {QUALITY_LEVELS.map((l) => {
                  const selected = chosen === l.code;
                  const style = LEVEL_STYLE[l.code];
                  return (
                    <button
                      key={l.code}
                      type="button"
                      disabled={!editable || pending}
                      aria-pressed={selected}
                      onClick={() => setAnswers((a) => ({ ...a, [c.id]: l.code }))}
                      className={cx("text-left rounded-xl border-2 px-3 py-2 transition-all flex gap-2 items-start", selected ? `${style.on} shadow-md scale-[1.01]` : `${style.idle} ${editable ? "hover:border-ink-3" : "opacity-60"}`)}
                    >
                      <span className={cx("mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-[11px] font-black", selected ? "bg-white text-ink border-white" : "border-ink-3/60 text-transparent")}>✓</span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-black uppercase tracking-wide opacity-80">{l.label} · {l.code}</span>
                        <span className="block text-xs leading-snug">{c.levels[l.code].replace(" [~]", "")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {message && (
        <p className={cx("mt-4", message.tone === "ok" ? ui.alertOk : ui.alertErr)}>{message.text}</p>
      )}

      {editable && (
        <button
          onClick={submit}
          disabled={!complete || pending}
          className={`${btn.lgPrimary} mt-4 w-full py-4 text-lg rounded-2xl`}
        >
          {pending ? "…" : initial ? "Mettre à jour mon auto-évaluation" : "Envoyer mon auto-évaluation"}
        </button>
      )}
      {editable && !complete && (
        <p className={`${ui.hint} mt-2 text-center`}>
          Encore {criteria.filter((c) => !answers[c.id]).length} ligne(s) à cocher pour pouvoir envoyer.
        </p>
      )}
    </div>
  );
}
