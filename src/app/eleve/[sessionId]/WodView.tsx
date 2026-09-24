"use client";

import { useState } from "react";
import { QUALITY_LEVELS, type QualityCode } from "@/lib/wod-engines/core/quality";
import type { SelfEvalCriterion } from "@/lib/wod-engines/core/self-eval";
import { SelfEvalGrid } from "../SelfEvalGrid";
import { cx, ui } from "@/lib/ui";

export type ResultRow = {
  rank: number;
  teamId: string;
  teamName: string;
  laps: number;
  lapsTotal: number;
  time: string | null;
  late: string | null;
  start: string;
  reps: number;
  cards: number;
  done: boolean;
  mine: boolean;
};

export type ResultColumns = { laps: string; time: string; reps: string; cards: string; start: string };

export type RefereeEvalRow = {
  exerciseId: string;
  exerciseNumber: number;
  exerciseLabel: string;
  reps: number;
  quality: QualityCode | null;
  at: number;
};

type Tab = "results" | "referees" | "self";

type Props = {
  sessionId: string;
  ended: boolean;
  myTeamName: string;
  individual?: boolean; // WOD Level : evaluations de l'eleve lui-meme, pas de son equipe
  columns: ResultColumns;
  results: ResultRow[];
  refereeEvals: RefereeEvalRow[];
  criteria: SelfEvalCriterion[];
  instruction: string;
  selfEval: { initial: Record<string, string> | null; state: "open" | "notYet" | "expired"; closesAt: number | null; submittedAt: number | null };
  // Avis du prof, deja filtre par le serveur : grille absente si non visible, commentaire absent si non visible.
  review?: { answers: Record<string, string> | null; comment: string | null; reviewerName: string } | null;
};

export function WodView({ sessionId, ended, myTeamName, columns, results, refereeEvals, criteria, instruction, selfEval, review = null, individual = false }: Props) {
  const [tab, setTab] = useState<Tab>(selfEval.state === "open" && !selfEval.initial ? "self" : "results");
  const mine = results.find((r) => r.mine);
  const todo = selfEval.state === "open" && !selfEval.initial;

  const tabs: { id: Tab; label: string }[] = [
    { id: "results", label: "Résultats" },
    { id: "referees", label: "Arbitrages" },
    { id: "self", label: "Auto-éval" },
  ];

  const stat = "font-display text-2xl font-extrabold tabular-nums";

  return (
    <div>
      {mine && (
        <div className={`${ui.card} border-brand/40 p-4 mb-4 grid grid-cols-3 gap-2 text-center`}>
          <div>
            <div className={ui.eyebrow}>Rang</div>
            <div className={cx(stat, "text-brand")}>{mine.done || ended ? `${mine.rank}e` : "—"}</div>
          </div>
          <div>
            <div className={ui.eyebrow}>{columns.laps}</div>
            <div className={stat}>{mine.laps}<span className="text-sm text-ink-3 font-sans">/{mine.lapsTotal}</span></div>
          </div>
          <div>
            <div className={ui.eyebrow}>{mine.time ? columns.time : columns.reps}</div>
            <div className={stat}>{mine.time ?? mine.reps}</div>
          </div>
        </div>
      )}

      <div className={`${ui.segmented} w-full mb-4`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx("flex-1 relative text-sm font-bold py-2 rounded-lg transition", tab === t.id ? ui.segOn : ui.segOff)}
          >
            {t.label}
            {t.id === "self" && todo && <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === "results" && (
        <div className={`${ui.card} overflow-x-auto`}>
          {!ended && <p className="text-xs text-warn-ink bg-warn-soft px-3 py-2 border-b border-warn/30">WOD en cours : classement provisoire (encodé par le greffier).</p>}
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={ui.th}>#</th>
                <th className={ui.th}>Équipe</th>
                <th className={ui.th}>{columns.laps}</th>
                <th className={ui.th}>{columns.time}</th>
                <th className={ui.th}>{columns.reps}</th>
                <th className={ui.th}>{columns.cards}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.teamId} className={cx("border-b border-line/70", r.mine ? "bg-brand-soft font-extrabold" : "odd:bg-paper/60")}>
                  <td className="p-2">{r.done || ended ? r.rank : "—"}</td>
                  <td className="p-2">{r.teamName}{r.mine ? " ★" : ""}</td>
                  <td className="p-2">{r.laps}/{r.lapsTotal}</td>
                  <td className="p-2 tabular-nums">{r.time ? `🏁 ${r.time}` : "—"}{r.late ? <span className="text-xs text-ink-3"> +{r.late}</span> : null}</td>
                  <td className="p-2">{r.reps}</td>
                  <td className="p-2">{r.cards || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "referees" && (
        <div>
          <p className={`${ui.hint} mb-3`}>
            {individual ? <>Ce que les arbitres ont observé <b className="text-ink">sur toi</b>, exercice par exercice (reps comptées et qualité d&apos;exécution).</> : <>Ce que les arbitres ont observé sur <b className="text-ink">{myTeamName}</b>, exercice par exercice (reps comptées et qualité d&apos;exécution).</>}
          </p>
          {refereeEvals.length === 0 ? (
            <p className={`${ui.cardPad} ${ui.muted}`}>{individual ? "Aucun arbitre ne t'a encore évalué." : "Aucun arbitre n'a encore évalué ton équipe."}</p>
          ) : (
            <div className={`${ui.card} overflow-hidden`}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={ui.th}>Exercice</th>
                    <th className={ui.th}>Reps vues</th>
                    <th className={ui.th}>Qualité</th>
                  </tr>
                </thead>
                <tbody>
                  {refereeEvals.map((e, i) => {
                    const level = QUALITY_LEVELS.find((l) => l.code === e.quality);
                    return (
                      <tr key={i} className={ui.tr}>
                        <td className="p-2"><span className="text-ink-3">{e.exerciseNumber}.</span> {e.exerciseLabel}</td>
                        <td className="p-2 font-bold">{e.reps}</td>
                        <td className="p-2">
                          {level ? (
                            <span className={`font-black ${level.color}`} title={level.label}>{level.code}</span>
                          ) : (
                            "—"
                          )}
                          {level && <span className="text-xs text-ink-3"> {level.label}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "self" && (
        <div className={ui.cardPad}>
          <h2 className={`${ui.h2} mb-1`}>Auto-évaluation – Cycle Hyrox</h2>
          <p className={`${ui.hint} mb-4`}>Éducation Physique et Sportive · une case par critère.</p>
          <SelfEvalGrid
            sessionId={sessionId}
            criteria={criteria}
            instruction={instruction}
            initial={selfEval.initial}
            state={selfEval.state}
            closesAt={selfEval.closesAt}
            submittedAt={selfEval.submittedAt}
          />

          {/* L'avis du prof, uniquement ce qu'il a choisi de montrer. */}
          {review && (
            <section className="mt-6 rounded-2xl border-2 border-brand/40 bg-brand-soft/40 p-4">
              <div className={ui.eyebrow}>L&apos;avis de {review.reviewerName}</div>
              {review.answers && (
                <ul className="mt-2 space-y-1.5">
                  {criteria.map((c) => {
                    const code = review.answers?.[c.id];
                    if (!code) return null;
                    const mine = selfEval.initial?.[c.id];
                    return (
                      <li key={c.id} className="bg-card rounded-xl border border-line px-3 py-2 text-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold text-ink">{c.label}</span>
                          <span className="font-display font-extrabold text-brand-ink whitespace-nowrap">
                            {code}
                            {mine && mine !== code && <span className="text-ink-3 font-sans font-semibold text-xs"> · toi : {mine}</span>}
                          </span>
                        </div>
                        <p className="text-xs text-ink-2 leading-snug mt-0.5">{c.levels[code as keyof typeof c.levels]}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {review.comment && (
                <p className="mt-3 bg-card rounded-xl border border-line px-3 py-2 text-sm text-ink whitespace-pre-line">
                  💬 {review.comment}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
