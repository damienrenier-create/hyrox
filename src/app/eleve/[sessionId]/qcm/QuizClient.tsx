"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QUIZ_QUESTIONS, exerciseTitle, type QuizKey, type QuizQuestion } from "@/lib/hyrox-quiz";
import { submitQuizAction } from "../../quiz-actions";
import { btn, cx, ui } from "@/lib/ui";

type Result = { checked: Record<string, string[]>; key: QuizKey; score: number; total: number; at: number };

// Formulaire du QCM (cases a cocher, une seule tentative) puis correction : chaque affirmation marquee vraie / fausse,
// avec ce que l'eleve avait coche.
export function QuizClient({ sessionId, questions, result }: { sessionId: string; questions: QuizQuestion[]; result: Result | null }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const toggle = (q: string, id: string) => setChecked((c) => { const cur = c[q] ?? []; return { ...c, [q]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }; });
  const answered = questions.filter((q) => (checked[q.id] ?? []).length > 0).length;

  function send() {
    if (answered < questions.length && !confirm(`Tu n'as rien coché pour ${questions.length - answered} question(s) : une question sans réponse compte 0. Envoyer quand même ?`)) return;
    if (!confirm("Envoyer tes réponses ? Il n'y a qu'une seule tentative.")) return;
    setError("");
    startTransition(async () => {
      const res = await submitQuizAction(sessionId, checked);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="space-y-3">
        <div className={`${ui.cardPad} text-center`}>
          <p className={ui.eyebrow}>Ton résultat</p>
          <p className="font-display text-5xl font-extrabold text-ink">{result.score}<span className="text-2xl text-ink-3"> / {result.total}</span></p>
          <p className={ui.hint}>Envoyé le {new Date(result.at).toLocaleString("fr-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })} · une question compte 1 point quand tout est juste.</p>
        </div>
        {questions.map((q, i) => {
          const truth = result.key[q.id] ?? [];
          const mine = result.checked[q.id] ?? [];
          const ok = truth.length === mine.length && truth.every((t) => mine.includes(t));
          return (
            <div key={q.id} className={`${ui.card} p-3`}>
              <p className="font-bold mb-2">{i + 1}. {exerciseTitle(q.exercise)} <span className={cx(ui.chip, ok ? ui.chipOk : ui.chipErr, "ml-1")}>{ok ? "✓ juste" : "✗"}</span></p>
              <ul className="space-y-1">
                {q.statements.map((s) => {
                  const isTrue = truth.includes(s.id);
                  const was = mine.includes(s.id);
                  return (
                    <li key={s.id} className={cx("rounded-lg px-2 py-1.5 text-sm flex gap-2", isTrue ? "bg-success-soft" : "bg-paper")}>
                      <span className="w-5 flex-shrink-0 font-extrabold">{isTrue ? "✓" : "✗"}</span>
                      <span className={cx(was !== isTrue && "text-danger-ink")}>{s.text}{was && <span className="text-xs text-ink-3"> · tu l&apos;avais cochée</span>}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={ui.cardPad}>
        <p className="font-bold">{QUIZ_QUESTIONS} questions sur les critères de réalisation vus en cours.</p>
        <p className={ui.hint}>Pour chaque exercice, coche <b>uniquement les affirmations vraies</b> (il peut y en avoir 1, 2 ou 3 sur 4). Une question vaut 1 point si tout est juste. <b>Une seule tentative</b> : réfléchis avant d&apos;envoyer.</p>
      </div>
      {error && <p className={ui.alertErr}>{error}</p>}
      {questions.map((q, i) => (
        <div key={q.id} className={`${ui.card} p-3`}>
          <p className="font-bold mb-2">{i + 1}. {exerciseTitle(q.exercise)}</p>
          <ul className="space-y-1.5">
            {q.statements.map((s) => {
              const on = (checked[q.id] ?? []).includes(s.id);
              return (
                <li key={s.id}>
                  <label className={cx("flex items-start gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer transition", on ? "border-brand bg-brand-soft" : "border-line bg-paper")}>
                    <input type="checkbox" checked={on} onChange={() => toggle(q.id, s.id)} className={`${ui.check} mt-0.5`} />
                    <span>{s.text}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button onClick={send} disabled={pending} className={`${btn.lgPrimary} w-full`}>{pending ? "Envoi…" : `Envoyer mes réponses (${answered}/${questions.length} répondues)`}</button>
    </div>
  );
}
