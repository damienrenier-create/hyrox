"use client";

import { useState } from "react";
import { QUALITY_LEVELS, type QualityCode } from "@/lib/wod-engines/core/quality";
import type { SelfEvalCriterion } from "@/lib/wod-engines/core/self-eval";
import { SelfEvalGrid } from "../SelfEvalGrid";

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
  columns: ResultColumns;
  results: ResultRow[];
  refereeEvals: RefereeEvalRow[];
  criteria: SelfEvalCriterion[];
  instruction: string;
  selfEval: { initial: Record<string, string> | null; state: "open" | "notYet" | "expired"; closesAt: number | null; submittedAt: number | null };
};

export function WodView({ sessionId, ended, myTeamName, columns, results, refereeEvals, criteria, instruction, selfEval }: Props) {
  const [tab, setTab] = useState<Tab>(selfEval.state === "open" && !selfEval.initial ? "self" : "results");
  const mine = results.find((r) => r.mine);
  const todo = selfEval.state === "open" && !selfEval.initial;

  const tabs: { id: Tab; label: string }[] = [
    { id: "results", label: "Résultats" },
    { id: "referees", label: "Arbitrages" },
    { id: "self", label: "Auto-éval" },
  ];

  return (
    <div>
      {mine && (
        <div className="bg-white border-2 border-slate-900 rounded-2xl p-4 mb-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Rang</div>
            <div className="text-2xl font-black">{mine.done || ended ? `${mine.rank}e` : "—"}</div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{columns.laps}</div>
            <div className="text-2xl font-black">{mine.laps}<span className="text-sm text-slate-400">/{mine.lapsTotal}</span></div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{mine.time ? columns.time : columns.reps}</div>
            <div className="text-2xl font-black">{mine.time ?? mine.reps}</div>
          </div>
        </div>
      )}

      <div className="flex gap-1 bg-slate-200 rounded-xl p-1 mb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 relative text-sm font-black py-2 rounded-lg transition-colors ${tab === t.id ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}
          >
            {t.label}
            {t.id === "self" && todo && <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-red-500" />}
          </button>
        ))}
      </div>

      {tab === "results" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {!ended && <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 border-b border-amber-100">WOD en cours : classement provisoire (encodé par le greffier).</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-900 text-left">
                <th className="p-2">#</th>
                <th className="p-2">Équipe</th>
                <th className="p-2">{columns.laps}</th>
                <th className="p-2">{columns.time}</th>
                <th className="p-2">{columns.reps}</th>
                <th className="p-2">{columns.cards}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.teamId} className={`border-b border-slate-100 ${r.mine ? "bg-emerald-50 font-black" : "odd:bg-slate-50"}`}>
                  <td className="p-2">{r.done || ended ? r.rank : "—"}</td>
                  <td className="p-2">{r.teamName}{r.mine ? " ★" : ""}</td>
                  <td className="p-2">{r.laps}/{r.lapsTotal}</td>
                  <td className="p-2">{r.time ? `🏁 ${r.time}` : "—"}{r.late ? <span className="text-xs text-slate-400"> +{r.late}</span> : null}</td>
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
          <p className="text-xs text-slate-500 mb-3">
            Ce que les arbitres ont observé sur <b>{myTeamName}</b>, exercice par exercice (reps comptées et qualité d'exécution).
          </p>
          {refereeEvals.length === 0 ? (
            <p className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-500">Aucun arbitre n'a encore évalué ton équipe.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-left">
                    <th className="p-2">Exercice</th>
                    <th className="p-2">Reps vues</th>
                    <th className="p-2">Qualité</th>
                  </tr>
                </thead>
                <tbody>
                  {refereeEvals.map((e, i) => {
                    const level = QUALITY_LEVELS.find((l) => l.code === e.quality);
                    return (
                      <tr key={i} className="border-b border-slate-100 odd:bg-slate-50">
                        <td className="p-2"><span className="text-slate-400">{e.exerciseNumber}.</span> {e.exerciseLabel}</td>
                        <td className="p-2 font-bold">{e.reps}</td>
                        <td className="p-2">
                          {level ? (
                            <span className={`font-black ${level.color}`} title={level.label}>{level.code}</span>
                          ) : (
                            "—"
                          )}
                          {level && <span className="text-xs text-slate-400"> {level.label}</span>}
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
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-black mb-1">Auto-évaluation – Cycle Hyrox</h2>
          <p className="text-xs text-slate-500 mb-4">Éducation Physique et Sportive · une case par critère.</p>
          <SelfEvalGrid
            sessionId={sessionId}
            criteria={criteria}
            instruction={instruction}
            initial={selfEval.initial}
            state={selfEval.state}
            closesAt={selfEval.closesAt}
            submittedAt={selfEval.submittedAt}
          />
        </div>
      )}
    </div>
  );
}
