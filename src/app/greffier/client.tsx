"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  RaceSettings,
  pyramid,
  total,
  levelOf,
  lapsOf,
  cardsOf,
  finishAt,
  arrivalRank,
  partialOf,
  totalReps,
  timeline,
  standings,
  medalInfo,
  maxMedals,
  tierOf,
  startOf,
  elapsed,
  fmt,
  fmtDown,
  fmtUp,
  Standing,
} from "@/lib/wod-engines/templates/pyramide-engine";
import type { RaceContextBundle } from "@/lib/race-context";
import { TeamsManager, type TeamWithMembers, type RefereeView } from "./TeamsManager";
import {
  startRaceAction,
  togglePauseAction,
  validateLapAction,
  giveCardAction,
  undoLastAction,
  setTeamStartAction,
  setTeamEndAction,
} from "./race-actions";
import { setRaceStatus } from "@/lib/firebase/firebase-sync";
import { finishRaceAction } from "./actions";

const TIER_COLORS: Record<string, string> = { b: "#8a5226", s: "#8f9aa5", g: "#caa000", p: "#8fb0c8", d: "#5fcdeb" };
const TIER_LETTERS = ["b", "s", "g", "p", "d"];

function MedalDots({ settings, n }: { settings: RaceSettings; n: number }) {
  const count = Math.min(n, maxMedals(settings));
  const dots = [];
  for (let k = 0; k < count; k++) {
    const info = medalInfo(settings, k);
    const opacity = info.size === 1 ? 1 : 0.45 + (info.variant / 2) * 0.55;
    dots.push(
      <span
        key={k}
        className="inline-block w-2 h-2 rounded-full mr-[1px] mb-[1px]"
        style={{ background: TIER_COLORS[TIER_LETTERS[info.tier]], opacity }}
      />
    );
  }
  return <span className="flex flex-wrap max-w-[64px]">{dots}</span>;
}

export type SessionOption = { id: string; label: string; classes: string[]; open: boolean };

export function GreffierClient({
  sessionId, sessionLabel, sessionOptions, bundle, teamsWithMembers, classes, allClasses, referees,
}: {
  sessionId: string;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  bundle: RaceContextBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
}) {
  const router = useRouter();
  const { ctx, startedAtMs, endedAtMs, pauses, teamNames, exerciseLabels } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);

  const isPaused = pauses.some((p) => p.to === null);
  const phase: "pre" | "run" | "post" = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  // Avant le depart et sans aucun eleve encode, on ouvre directement sur la preparation des equipes.
  const [view, setView] = useState<"grid" | "results" | "teams">(phase === "pre" && memberCount === 0 ? "teams" : "grid");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase, isPaused]);

  // Rafraichissement automatique des donnees (tours/cartes saisis depuis un autre appareil, ecran projete).
  useEffect(() => {
    if (phase !== "run") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !openTeamId && !pending) router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [phase, openTeamId, pending, router]);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    const ref = phase === "post" ? endedAtMs! : now;
    return elapsed(startedAtMs, pauses, ref) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);

  const tl = useMemo(() => timeline(ctx), [ctx]);
  const finishedCount = useMemo(() => ctx.teams.filter((t) => finishAt(ctx, t.id) !== null).length, [ctx]);
  const T = total(ctx.settings);

  function refresh() {
    router.refresh();
  }

  function run(action: () => Promise<{ error: string } | { ok: true }>) {
    setError("");
    startTransition(async () => {
      const res = await action();
      if ("error" in res) setError(res.error);
      else refresh();
    });
  }

  function handleStart() {
    run(async () => {
      const res = await startRaceAction(sessionId);
      if (!("error" in res)) void setRaceStatus(sessionId, "COMBAT"); // diffusion live, jamais bloquante
      return res;
    });
  }
  function handlePause() {
    run(() => togglePauseAction(sessionId));
  }
  function handleLap(teamId: string) {
    if (phase !== "run" || isPaused) {
      setOpenTeamId(teamId);
      return;
    }
    if (finishAt(ctx, teamId) !== null) return;
    run(() => validateLapAction(sessionId, teamId));
  }
  function handleCard(teamId: string, e: React.MouseEvent) {
    e.stopPropagation();
    run(() => giveCardAction(sessionId, teamId));
  }
  function handleUndo() {
    run(() => undoLastAction(sessionId));
  }
  function handleFinish() {
    if (!confirm("Terminer le WOD ? Les évaluations en cours seront closes (fiabilité calculée) et la séance clôturée.")) return;
    setError("");
    startTransition(async () => {
      try {
        await finishRaceAction(sessionId);
        void setRaceStatus(sessionId, "TERMINATED"); // diffusion live, jamais bloquante
        refresh();
      } catch (e) {
        setError("Impossible de terminer la course : " + (e instanceof Error ? e.message : String(e)));
      }
    });
  }

  function exportCsv() {
    const L: string[] = [];
    const p = pyramid(ctx.settings);
    const st = standings(ctx, phase === "post");
    L.push("Classement");
    L.push(["Rang", "Equipe", "Tours", "Temps final", "Temps supplementaire", "Depart", "Total reps", "Cartes jaunes"].join(";"));
    st.forEach((s, i) => {
      const startEx = startOf(ctx, s.team);
      L.push(
        [
          i + 1,
          teamNames[s.team.id] ?? s.team.id,
          Math.min(s.n, T),
          s.done ? fmt(s.finishAt) : "",
          tl.late[s.team.id] != null ? fmt(tl.late[s.team.id]) : "",
          exerciseLabels[startEx.id] ?? "",
          s.reps,
          s.yellowCards,
        ].join(";")
      );
    });
    L.push("");
    L.push("Journal");
    L.push(["Temps", "Equipe", "Tour"].join(";"));
    const cnt: Record<string, number> = {};
    [...ctx.laps].sort((a, b) => a.at - b.at).forEach((l) => {
      cnt[l.teamId] = (cnt[l.teamId] || 0) + 1;
      L.push([fmt(l.at), teamNames[l.teamId] ?? l.teamId, cnt[l.teamId]].join(";"));
    });
    L.push("");
    L.push("Cartes");
    L.push(["Temps", "Equipe"].join(";"));
    [...ctx.cards].sort((a, b) => a.at - b.at).forEach((c) => {
      L.push([fmt(c.at), teamNames[c.teamId] ?? c.teamId].join(";"));
    });
    L.push("");
    L.push("Reglages");
    L.push(["Cle", "Valeur"].join(";"));
    L.push(["Reps depart", ctx.settings.rep0].join(";"));
    L.push(["Sommet", ctx.settings.peak].join(";"));
    L.push(["Pas", ctx.settings.step].join(";"));
    L.push(["Duree max (min)", ctx.settings.capMin].join(";"));
    L.push(["Apres 1re arrivee (min)", ctx.settings.afterMin].join(";"));
    L.push(["Retrait par arrivee (min)", ctx.settings.penMin].join(";"));
    L.push(["Temps ecoule", fmt(liveMs)].join(";"));
    L.push(["Etat", phase === "post" ? "terminee" : isPaused ? "en pause" : phase === "run" ? "en cours" : "pas commencee"].join(";"));

    const blob = new Blob(["﻿" + L.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Wod Pyramide.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const rest = tl.end - liveMs;
  const overtime = phase === "run" && rest <= 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 font-sans">
      <header className="sticky top-0 z-20 bg-white border-b-4 border-slate-900 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              {sessionOptions.length > 1 ? (
                <select
                  value={sessionId}
                  onChange={(e) => router.push(`/greffier?session=${e.target.value}`)}
                  className="text-sm font-black bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 max-w-[260px]"
                >
                  {sessionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? "" : " (fermée)"}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-black leading-tight">
                  {sessionLabel}
                  {classes.length > 0 && <span className="text-slate-500 font-bold"> · {classes.join(", ")}</span>}
                  {sessionOptions[0] && !sessionOptions[0].open && <span className="text-slate-400 font-normal"> (fermée)</span>}
                </p>
              )}
            </div>
            <p className={`text-[3rem] font-black leading-none tracking-tight ${phase === "pre" ? "text-slate-300" : isPaused ? "text-amber-500" : "text-slate-900"}`}>
              {fmt(liveMs)}
            </p>
            {phase !== "pre" && (
              <div className={`border-2 rounded-xl px-3 py-1 text-right min-w-[130px] ${overtime ? "border-red-600 bg-red-50" : "border-slate-200 bg-white"}`}>
                <div className="text-[10px] font-extrabold tracking-widest uppercase text-slate-500">
                  {phase === "post" ? "WOD" : overtime ? "Temps supp." : tl.count ? "Fin dans" : "Temps limite"}
                </div>
                <div className={`text-2xl font-black leading-tight ${overtime ? "text-red-600" : "text-slate-700"}`}>
                  {phase === "post" ? "terminé" : overtime ? `−${fmtUp(-rest)}` : fmtDown(rest)}
                </div>
                <div className="text-[11px] text-slate-500">{finishedCount}/{ctx.teams.length} arrivées</div>
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {phase === "pre" && (
              <button onClick={handleStart} disabled={pending} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-6 py-3 rounded-xl disabled:opacity-50">
                Début de course
              </button>
            )}
            {phase === "run" && (
              <>
                <button onClick={handlePause} disabled={pending} className={`font-black px-5 py-3 rounded-xl text-white ${isPaused ? "bg-emerald-600" : "bg-amber-500"} disabled:opacity-50`}>
                  {isPaused ? "Reprendre" : "Pause"}
                </button>
                <button onClick={handleUndo} disabled={pending} className="bg-slate-200 px-4 py-3 rounded-xl font-bold disabled:opacity-50">
                  Annuler le dernier
                </button>
                <button onClick={handleFinish} disabled={pending} className="bg-red-600 hover:bg-red-700 text-white font-black px-6 py-3 rounded-xl disabled:opacity-50">
                  FIN DE COURSE
                </button>
              </>
            )}
            {phase === "post" && (
              <span className="bg-emerald-100 text-emerald-800 font-bold px-4 py-3 rounded-xl">🏁 WOD terminé</span>
            )}
            <button onClick={exportCsv} className="bg-slate-800 text-white px-4 py-3 rounded-xl font-bold">Exporter CSV</button>
          </div>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={() => setView("grid")} className={`text-sm font-bold px-3 py-1 rounded ${view === "grid" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>Grille</button>
          <button onClick={() => setView("results")} className={`text-sm font-bold px-3 py-1 rounded ${view === "results" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>Résultats</button>
          <button onClick={() => setView("teams")} className={`text-sm font-bold px-3 py-1 rounded ${view === "teams" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
            Équipes &amp; arbitres <span className={`ml-1 text-[10px] px-1.5 rounded-full ${memberCount ? "bg-emerald-500 text-white" : "bg-amber-400 text-amber-950"}`}>{memberCount}</span>
            {referees.length > 0 && <span className="ml-1 text-[10px] px-1.5 rounded-full bg-[#062230] text-amber-300">🏴‍☠️ {referees.length}</span>}
          </button>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto p-4">
        {view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-2">
            {ctx.teams.map((team) => {
              const n = lapsOf(ctx, team.id);
              const fa = finishAt(ctx, team.id);
              const level = levelOf(ctx, team.id);
              const tier = tierOf(ctx.settings, n);
              const yc = cardsOf(ctx, team.id);
              const isDone = fa !== null;
              return (
                <div key={team.id} className="flex flex-col gap-1">
                  <button
                    onClick={() => handleLap(team.id)}
                    className={`rounded-xl p-2 min-h-[92px] flex flex-col items-center justify-center text-white transition-transform active:scale-95 ${
                      isDone ? "bg-emerald-700" : tier > 0 ? "" : "bg-slate-700"
                    }`}
                    style={tier > 0 && !isDone ? { background: TIER_COLORS[TIER_LETTERS[tier - 1]] } : undefined}
                  >
                    <span className="text-[11px] font-bold opacity-85">{teamNames[team.id] ?? team.id}</span>
                    {phase === "pre" && (
                      <span className="text-[9px] opacity-70 leading-tight text-center line-clamp-1">
                        {teamsWithMembers.find((t) => t.id === team.id)?.members.map((m) => m.firstName).join(", ") || "—"}
                      </span>
                    )}
                    <span className="text-2xl font-black leading-tight">
                      {phase === "pre" ? exerciseLabels[startOf(ctx, team).id]?.slice(0, 10) : isDone ? fmt(fa) : level ?? n}
                    </span>
                    <span className="text-[10px] opacity-80">
                      {phase === "pre" ? "départ" : isDone ? `🏁 ${arrivalRank(ctx, team.id)}e` : `tour ${n + 1}/${T}`}
                    </span>
                    {phase !== "pre" && <MedalDots settings={ctx.settings} n={n} />}
                  </button>
                  <button
                    onClick={(e) => handleCard(team.id, e)}
                    className={`text-[10px] font-bold rounded py-1 ${yc ? "bg-amber-300 text-amber-900" : "bg-slate-100 text-slate-400"}`}
                  >
                    {yc ? `🟨 ×${yc}` : "+ carton"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : view === "results" ? (
          <ResultsTable ctx={ctx} phase={phase} teamNames={teamNames} exerciseLabels={exerciseLabels} tl={tl} />
        ) : (
          <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} />
        )}
      </main>

      {openTeamId && (
        <TeamPanel
          teamId={openTeamId}
          ctx={ctx}
          exerciseLabels={exerciseLabels}
          teamName={teamNames[openTeamId] ?? openTeamId}
          onClose={() => {
            setOpenTeamId(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ResultsTable({
  ctx, phase, teamNames, exerciseLabels, tl,
}: {
  ctx: import("@/lib/wod-engines/templates/pyramide-engine").RaceContext;
  phase: "pre" | "run" | "post";
  teamNames: Record<string, string>;
  exerciseLabels: Record<string, string>;
  tl: ReturnType<typeof timeline>;
}) {
  const st: Standing[] = standings(ctx, phase === "post");
  const T = total(ctx.settings);
  return (
    <div className="overflow-auto bg-white rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className="p-2">#</th>
            <th className="p-2">Équipe</th>
            <th className="p-2">Tours</th>
            <th className="p-2">Temps</th>
            <th className="p-2">Temps sup.</th>
            <th className="p-2">Départ</th>
            <th className="p-2">Total reps</th>
            <th className="p-2">Cartes</th>
          </tr>
        </thead>
        <tbody>
          {st.map((s, i) => (
            <tr key={s.team.id} className="border-b border-slate-100 odd:bg-slate-50">
              <td className="p-2">{i + 1}</td>
              <td className="p-2 font-bold">{teamNames[s.team.id] ?? s.team.id}</td>
              <td className="p-2">{Math.min(s.n, T)} / {T}</td>
              <td className="p-2">{s.done ? `🏁 ${fmt(s.finishAt)}` : "—"}</td>
              <td className="p-2">{tl.late[s.team.id] != null ? `+${fmt(tl.late[s.team.id])}` : ""}</td>
              <td className="p-2">{exerciseLabels[startOf(ctx, s.team).id]}</td>
              <td className="p-2 font-bold">{s.reps}</td>
              <td className="p-2">{s.yellowCards}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamPanel({
  teamId, ctx, exerciseLabels, teamName, onClose,
}: {
  teamId: string;
  ctx: import("@/lib/wod-engines/templates/pyramide-engine").RaceContext;
  exerciseLabels: Record<string, string>;
  teamName: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const team = ctx.teams.find((t) => t.id === teamId)!;
  const startEx = startOf(ctx, team);
  const finished = finishAt(ctx, teamId) !== null;
  const partial = partialOf(ctx, team);

  function setStart(exerciseId: string) {
    startTransition(async () => {
      await setTeamStartAction(teamId, exerciseId);
      onClose();
    });
  }
  function setEnd(value: string | null) {
    startTransition(async () => {
      await setTeamEndAction(teamId, value);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black text-lg">{teamName}</h3>
          <button onClick={onClose} className="text-slate-400 font-bold">✕</button>
        </div>

        {!finished ? (
          <>
            <p className="text-sm font-bold mb-2">Dernier exercice entièrement terminé ?</p>
            <p className="text-xs text-slate-500 mb-3">Départ : {exerciseLabels[startEx.id]}{partial != null ? ` · actuellement ${partial} exercice(s) du dernier tour` : ""}</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setEnd(null)} disabled={pending} className="border border-slate-200 rounded-lg py-2 text-sm">aucun</button>
              {ctx.exercises.map((ex) => (
                <button key={ex.id} onClick={() => setEnd(ex.id)} disabled={pending} className="border border-slate-200 rounded-lg py-2 text-sm">
                  {ex.number} · {exerciseLabels[ex.id]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-emerald-700 font-bold mb-4">🏁 Équipe arrivée.</p>
        )}

        <p className="text-sm font-bold mb-2">Changer le départ</p>
        <div className="grid grid-cols-2 gap-2">
          {ctx.exercises.map((ex) => (
            <button
              key={ex.id}
              onClick={() => setStart(ex.id)}
              disabled={pending}
              className={`border rounded-lg py-2 text-sm ${startEx.id === ex.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200"}`}
            >
              {ex.number} · {exerciseLabels[ex.id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
