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
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { SettingsPanel } from "./SettingsPanel";
import { ArbitrageTab } from "./ArbitrageTab";
import type { BoardData } from "@/lib/referee-board";
import { motion } from "framer-motion";
import type { PendingRequest } from "./referee-decisions";
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
import { Brand } from "../_components/Brand";
import { btn, cx, ui } from "@/lib/ui";

// Paliers de la pyramide (bronze → diamant) : fond + couleur de texte lisible sur chacun.
const TIER_COLORS: Record<string, string> = { b: "#8a5226", s: "#7b8794", g: "#d9ad00", p: "#8fb0c8", d: "#5fcdeb" };
const TIER_TEXT: Record<string, string> = { b: "#ffffff", s: "#ffffff", g: "#1d1b18", p: "#1d1b18", d: "#1d1b18" };
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
        className="inline-block w-2 h-2 rounded-full mr-[1px] mb-[1px] ring-1 ring-white/60"
        style={{ background: TIER_COLORS[TIER_LETTERS[info.tier]], opacity }}
      />
    );
  }
  return <span className="flex flex-wrap max-w-[64px]">{dots}</span>;
}

export type SessionOption = { id: string; label: string; classes: string[]; open: boolean };

export function GreffierClient({
  sessionId, sessionLabel, sessionOptions, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, board,
}: {
  sessionId: string;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  bundle: RaceContextBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  pendingRequests: PendingRequest[];
  board: BoardData | null;
}) {
  const router = useRouter();
  const { ctx, startedAtMs, endedAtMs, pauses, teamNames, exerciseLabels } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);

  const isPaused = pauses.some((p) => p.to === null);
  const phase: "pre" | "run" | "post" = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  // Avant le depart et sans aucun eleve encode, on ouvre directement sur la preparation des equipes.
  const [view, setView] = useState<"grid" | "results" | "teams" | "arbitrage">(phase === "pre" && memberCount === 0 ? "teams" : "grid");

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
  const tabBtn = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg transition", on ? ui.segOn : ui.segOff);

  return (
    <div className={`${ui.page} pb-24`}>
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-5 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Brand />
                <span className="text-line-2">/</span>
                <span className={ui.eyebrow}>Greffier</span>
              </div>
              {sessionOptions.length > 1 ? (
                <select
                  value={sessionId}
                  onChange={(e) => router.push(`/greffier?session=${e.target.value}`)}
                  className={`${ui.input} w-auto max-w-[280px] py-1.5 font-bold`}
                >
                  {sessionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? "" : " (fermée)"}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-bold leading-tight">
                  {sessionLabel}
                  {classes.length > 0 && <span className="text-ink-2 font-semibold"> · {classes.join(", ")}</span>}
                  {sessionOptions[0] && !sessionOptions[0].open && <span className="text-ink-3 font-normal"> (fermée)</span>}
                </p>
              )}
            </div>
            <p className={cx("font-display text-[3rem] font-extrabold leading-none tracking-tight tabular-nums", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : "text-ink")}>
              {fmt(liveMs)}
            </p>
            {phase !== "pre" && (
              <div className={cx("border rounded-xl px-3 py-1.5 text-right min-w-[130px]", overtime ? "border-danger bg-danger-soft" : "border-line bg-paper")}>
                <div className={ui.eyebrow}>
                  {phase === "post" ? "WOD" : overtime ? "Temps supp." : tl.count ? "Fin dans" : "Temps limite"}
                </div>
                <div className={cx("font-display text-2xl font-extrabold leading-tight tabular-nums", overtime ? "text-danger" : "text-ink")}>
                  {phase === "post" ? "terminé" : overtime ? `−${fmtUp(-rest)}` : fmtDown(rest)}
                </div>
                <div className="text-[11px] text-ink-2">{finishedCount}/{ctx.teams.length} arrivées</div>
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {phase === "pre" && (
              <>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.lgGhost}>
                  ⚙️ Réglages
                </button>
                <button onClick={handleStart} disabled={pending} className={btn.lgSuccess}>
                  Début de course
                </button>
              </>
            )}
            {phase === "run" && (
              <>
                <button onClick={handlePause} disabled={pending} className={isPaused ? btn.lgSuccess : btn.lgAccent}>
                  {isPaused ? "Reprendre" : "Pause"}
                </button>
                <button onClick={handleUndo} disabled={pending} className={btn.lgGhost}>
                  Annuler le dernier
                </button>
                <button onClick={handleFinish} disabled={pending} className={btn.lgDanger}>
                  Fin de course
                </button>
              </>
            )}
            {phase === "post" && (
              <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 WOD terminé</span>
            )}
            <button onClick={exportCsv} className={btn.lgDark}>Exporter CSV</button>
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
        <div className={`${ui.segmented} mt-3 flex-wrap`}>
          <button onClick={() => setView("grid")} className={tabBtn(view === "grid")}>Grille</button>
          <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Résultats</button>
          <button onClick={() => setView("teams")} className={tabBtn(view === "teams")}>
            Équipes &amp; arbitres <span className={cx(ui.chip, "ml-1", memberCount ? ui.chipOk : ui.chipWarn)}>{memberCount}</span>
            {referees.length > 0 && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>🏴‍☠️ {referees.length}</span>}
          </button>
          {board && (
            <button onClick={() => setView("arbitrage")} className={tabBtn(view === "arbitrage")}>
              Arbitrage <span className={`${ui.chip} ${ui.chipAccent} ml-1`}>{board.evaluationsCount}</span>
            </button>
          )}
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
              const tierKey = tier > 0 && !isDone ? TIER_LETTERS[tier - 1] : null;
              return (
                <div key={team.id} className="flex flex-col gap-1">
                  <button
                    onClick={() => handleLap(team.id)}
                    className={cx(
                      "rounded-2xl p-2 min-h-[92px] flex flex-col items-center justify-center shadow-card transition-transform active:scale-95",
                      isDone ? "bg-success text-white" : tierKey ? "" : "bg-brand text-white"
                    )}
                    style={tierKey ? { background: TIER_COLORS[tierKey], color: TIER_TEXT[tierKey] } : undefined}
                  >
                    <span className="text-[11px] font-bold opacity-85">{teamNames[team.id] ?? team.id}</span>
                    {phase === "pre" && (
                      <span className="text-[9px] opacity-70 leading-tight text-center line-clamp-1">
                        {teamsWithMembers.find((t) => t.id === team.id)?.members.map((m) => m.firstName).join(", ") || "—"}
                      </span>
                    )}
                    <span className="font-display text-2xl font-extrabold leading-tight tabular-nums">
                      {phase === "pre" ? exerciseLabels[startOf(ctx, team).id]?.slice(0, 10) : isDone ? fmt(fa) : level ?? n}
                    </span>
                    <span className="text-[10px] opacity-80">
                      {phase === "pre" ? "départ" : isDone ? `🏁 ${arrivalRank(ctx, team.id)}e` : `tour ${n + 1}/${T}`}
                    </span>
                    {phase !== "pre" && <MedalDots settings={ctx.settings} n={n} />}
                  </button>
                  <button
                    onClick={(e) => handleCard(team.id, e)}
                    className={cx("text-[10px] font-bold rounded-lg py-1 transition", yc ? "bg-warn text-warn-ink" : "bg-line/70 text-ink-3 hover:bg-line hover:text-ink")}
                  >
                    {yc ? `🟨 ×${yc}` : "+ carton"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : view === "results" ? (
          <ResultsTable ctx={ctx} phase={phase} teamNames={teamNames} exerciseLabels={exerciseLabels} tl={tl} />
        ) : view === "arbitrage" && board ? (
          <ArbitrageTab board={board} />
        ) : (
          <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} />
        )}
      </main>

      {settingsOpen && (
        <SettingsPanel
          sessionId={sessionId}
          settings={ctx.settings}
          noStartExerciseIds={[...ctx.noStartExerciseIds]}
          exercises={ctx.exercises.map((e) => ({ id: e.id, number: e.number, label: exerciseLabels[e.id] ?? e.id }))}
          numTeams={ctx.teams.length}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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
    <div className={`${ui.card} overflow-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={ui.th}>#</th>
            <th className={ui.th}>Équipe</th>
            <th className={ui.th}>Tours</th>
            <th className={ui.th}>Temps</th>
            <th className={ui.th}>Temps sup.</th>
            <th className={ui.th}>Départ</th>
            <th className={ui.th}>Total reps</th>
            <th className={ui.th}>Cartes</th>
          </tr>
        </thead>
        <tbody>
          {st.map((s, i) => (
            <motion.tr key={s.team.id} layout transition={{ type: "spring", stiffness: 350, damping: 30 }} className={ui.tr}>
              <td className="p-2 font-display font-bold">{i + 1}</td>
              <td className="p-2 font-bold">{teamNames[s.team.id] ?? s.team.id}</td>
              <td className="p-2">{Math.min(s.n, T)} / {T}</td>
              <td className="p-2 tabular-nums">{s.done ? `🏁 ${fmt(s.finishAt)}` : "—"}</td>
              <td className="p-2 tabular-nums">{tl.late[s.team.id] != null ? `+${fmt(tl.late[s.team.id])}` : ""}</td>
              <td className="p-2">{exerciseLabels[startOf(ctx, s.team).id]}</td>
              <td className="p-2 font-bold">{s.reps}</td>
              <td className="p-2">{s.yellowCards}</td>
            </motion.tr>
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

  const choice = "border border-line-2 rounded-xl py-2 text-sm font-semibold bg-card hover:bg-paper transition disabled:opacity-50";

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className={ui.h2}>{teamName}</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>

        {!finished ? (
          <>
            <p className="text-sm font-bold mb-2">Dernier exercice entièrement terminé ?</p>
            <p className={`${ui.hint} mb-3`}>Départ : {exerciseLabels[startEx.id]}{partial != null ? ` · actuellement ${partial} exercice(s) du dernier tour` : ""}</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setEnd(null)} disabled={pending} className={choice}>aucun</button>
              {ctx.exercises.map((ex) => (
                <button key={ex.id} onClick={() => setEnd(ex.id)} disabled={pending} className={choice}>
                  {ex.number} · {exerciseLabels[ex.id]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-success-ink font-bold mb-4">🏁 Équipe arrivée.</p>
        )}

        <p className="text-sm font-bold mb-2">Changer le départ</p>
        <div className="grid grid-cols-2 gap-2">
          {ctx.exercises.map((ex) => (
            <button
              key={ex.id}
              onClick={() => setStart(ex.id)}
              disabled={pending}
              className={cx(choice, startEx.id === ex.id && "border-brand bg-brand text-white hover:bg-brand-hover")}
            >
              {ex.number} · {exerciseLabels[ex.id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
