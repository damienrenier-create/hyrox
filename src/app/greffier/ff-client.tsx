"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  FF_CHEX, FF_UNITS, colorOf, colorRows, ffCsv, fmt, nextColor, num, runnerRows, teamRows, teamState,
  type FFContext, type FFTeam, type FFTeamState,
} from "@/lib/wod-engines/templates/fete-foraine-engine";
import type { FFBundle } from "@/lib/fete-foraine-context";
import type { BoardData } from "@/lib/referee-board";
import { startRaceAction, togglePauseAction } from "./race-actions";
import { finishRaceAction } from "./actions";
import { ffColorAction, ffFinisherAction, ffPenaltyAction, ffResetColorsAction, ffSettingsAction, ffTapAction, ffUndoAction } from "./ff-actions";
import { setRaceStatus } from "@/lib/firebase/firebase-sync";
import { TeamsManager, type TeamWithMembers, type RefereeView } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { ArbitrageTab } from "./ArbitrageTab";
import { SettingsPanel } from "./SettingsPanel";
import type { PendingRequest } from "./referee-decisions";
import type { SessionOption } from "./client";

type View = "race" | "results" | "runners" | "teams" | "arbitrage";

// Greffier « Fête Foraine » : port fidele du fichier WOD - FETE FORAINE.html (Course / Résultats / Coureurs),
// avec les identifiants permanents (coureurs = membres d'equipe), la persistance Postgres et les onglets communs
// (Equipes & arbitres, Arbitrage). Ecran PC projete.
export function FeteForaineClient({
  sessionId, sessionLabel, sessionOptions, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, board, exercisesAll,
}: {
  sessionId: string;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  bundle: FFBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  pendingRequests: PendingRequest[];
  board: BoardData | null;
  exercisesAll: { id: string; label: string; number: number }[];
}) {
  const router = useRouter();
  const { ctx, startedAtMs, endedAtMs, pauses } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);
  const isPaused = pauses.some((p) => p.to === null);
  const phase: "pre" | "run" | "post" = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  const [view, setView] = useState<View>(phase === "pre" && memberCount === 0 ? "teams" : "race");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, isPaused]);

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

  function refresh() {
    router.refresh();
  }
  function run(action: () => Promise<{ error: string } | { ok: true } | { ok: true; removed: boolean }>) {
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
      if (!("error" in res)) void setRaceStatus(sessionId, "COMBAT");
      return res;
    });
  }
  function handleFinish() {
    if (!confirm("Arrêter définitivement la course ? Les équipes non terminées resteront sans temps.")) return;
    setError("");
    startTransition(async () => {
      try {
        await finishRaceAction(sessionId);
        void setRaceStatus(sessionId, "TERMINATED");
        refresh();
      } catch (e) {
        setError("Impossible de terminer la course : " + (e instanceof Error ? e.message : String(e)));
      }
    });
  }
  function handleUndo() {
    const last = [...ctx.events].sort((a, b) => b.at - a.at)[0];
    if (!last) return;
    const team = ctx.teams.find((t) => t.id === last.teamId);
    const lab = last.stationId === "fin" ? "Fin du WOD" : last.stationId === "corde" ? "Corde à sauter" : ctx.exercises.find((x) => x.id === last.stationId)?.label ?? last.stationId;
    if (!confirm(`Annuler : ${team?.name ?? "équipe"} — ${lab} ?`)) return;
    run(() => ffUndoAction(sessionId));
  }
  function exportCsv() {
    const csv = ffCsv(ctx, liveMs, phase === "post" ? "terminee" : isPaused ? "en pause" : phase === "run" ? "en cours" : "pas commencee");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (n: number) => (n < 10 ? "0" : "") + n;
    a.href = url;
    a.download = `wod_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const openTeam = openTeamId ? ctx.teams.find((t) => t.id === openTeamId) ?? null : null;

  return (
    <div className="min-h-screen bg-white text-[#0E1A26] pb-24 font-sans">
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      <header className="sticky top-0 z-20 bg-white border-b-2 border-[#0E1A26] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              {sessionOptions.length > 1 ? (
                <select value={sessionId} onChange={(e) => router.push(`/greffier?session=${e.target.value}`)} className="text-sm font-black bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 max-w-[260px]">
                  {sessionOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? "" : " (fermée)"}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-black leading-tight">{sessionLabel}{classes.length > 0 && <span className="text-slate-500 font-bold"> · {classes.join(", ")}</span>}</p>
              )}
              <p className="text-xs text-[#5C6B78]">{phase === "pre" ? "Chrono à l'arrêt" : phase === "post" ? "Course terminée" : isPaused ? "EN PAUSE — pointages bloqués" : "Course en cours"}</p>
            </div>
            <p className={`text-[3rem] font-extrabold leading-none tracking-tight ${phase === "pre" ? "text-[#C9D2DA]" : isPaused ? "text-[#B8860B]" : "text-[#0E1A26]"}`}>{fmt(liveMs) || "0:00"}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {phase === "pre" && (
              <>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className="bg-slate-200 hover:bg-slate-300 px-4 py-3 rounded-xl font-bold disabled:opacity-50">⚙️ Réglages</button>
                <button onClick={handleStart} disabled={pending} className="bg-[#0B7A3B] text-white font-extrabold px-6 py-3 rounded-xl disabled:opacity-50">Début de course</button>
              </>
            )}
            {phase === "run" && (
              <>
                <button onClick={() => run(() => togglePauseAction(sessionId))} disabled={pending} className={`font-extrabold px-5 py-3 rounded-xl text-white ${isPaused ? "bg-[#0B7A3B]" : "bg-[#B8860B]"} disabled:opacity-50`}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleUndo} disabled={pending || ctx.events.length === 0} className="border border-[#C9D2DA] px-4 py-3 rounded-full font-semibold disabled:opacity-40">Annuler</button>
                <button onClick={handleFinish} disabled={pending} className="bg-[#0E1A26] text-white font-extrabold px-6 py-3 rounded-xl disabled:opacity-50">Fin de course</button>
              </>
            )}
            {phase === "post" && <span className="bg-emerald-100 text-emerald-800 font-bold px-4 py-3 rounded-xl">🏁 Course terminée</span>}
            <button onClick={exportCsv} className="bg-[#0E1A26] text-white px-4 py-3 rounded-xl font-bold">Exporter vers Excel</button>
          </div>
        </div>
        {error && <p className="text-[#A32B1C] text-sm mt-2">{error}</p>}
        <div className="flex gap-2 mt-3 flex-wrap">
          {([
            ["race", "Course"],
            ["results", "Résultats"],
            ["runners", "Coureurs"],
          ] as [View, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`text-sm font-bold px-3 py-1 rounded ${view === k ? "bg-[#0E1A26] text-white" : "bg-slate-100"}`}>{l}</button>
          ))}
          <button onClick={() => setView("teams")} className={`text-sm font-bold px-3 py-1 rounded ${view === "teams" ? "bg-[#0E1A26] text-white" : "bg-slate-100"}`}>
            Équipes &amp; arbitres <span className={`ml-1 text-[10px] px-1.5 rounded-full ${memberCount ? "bg-emerald-500 text-white" : "bg-amber-400 text-amber-950"}`}>{memberCount}</span>
            {referees.length > 0 && <span className="ml-1 text-[10px] px-1.5 rounded-full bg-[#062230] text-amber-300">🏴‍☠️ {referees.length}</span>}
          </button>
          {board && (
            <button onClick={() => setView("arbitrage")} className={`text-sm font-bold px-3 py-1 rounded ${view === "arbitrage" ? "bg-[#0E1A26] text-white" : "bg-slate-100"}`}>
              Arbitrage <span className="ml-1 text-[10px] px-1.5 rounded-full bg-amber-400 text-amber-950">{board.evaluationsCount}</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto p-4">
        {view === "race" && (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 gap-2">
              {ctx.teams.map((team) => {
                const st = teamState(ctx, team);
                const time = st.fin !== null ? fmt(st.wod) : phase !== "pre" ? fmt(liveMs) : "—";
                return (
                  <button
                    key={team.id}
                    onClick={() => setOpenTeamId(team.id)}
                    className={`rounded-xl text-white flex flex-col items-center gap-1 min-h-[104px] overflow-hidden active:scale-[.97] transition-transform ${st.fin !== null ? "bg-[#0B7A3B]" : "bg-[#16344E]"}`}
                  >
                    <span className="w-full h-1.5" style={{ background: FF_CHEX[colorOf(team)] }} />
                    <span className="text-[23px] font-extrabold leading-none mt-1">{team.order}</span>
                    {team.runners.length > 0 && <span className="text-[10px] opacity-90 max-w-full px-1 truncate">{team.runners.map((r) => r.name).join(", ")}</span>}
                    <span className="flex gap-[3px]">
                      {ctx.exercises.map((x) => <span key={x.id} className={`w-[7px] h-[7px] rounded-[2px] ${st.ex[x.id] != null ? "bg-[#FFC93C]" : "bg-white/30"}`} />)}
                    </span>
                    <span className="text-[10.5px] opacity-90">corde ×{st.corde.length} · {st.exDone}/{ctx.exercises.length}</span>
                    <span className="text-xs font-bold">{time}</span>
                    {st.pen > 0 && <span className="text-[10px] font-bold text-[#FFD9D4] pb-1">pénalité ×{st.pen}</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[#5C6B78] mt-3">Appuie sur une équipe pour ouvrir ses ateliers, ses pénalités et les Finishers de ses coureurs. Le bandeau du haut de chaque tuile donne la couleur de la macro-équipe.</p>
          </>
        )}

        {view === "results" && <ResultsView ctx={ctx} sessionId={sessionId} onChanged={refresh} hasData={phase !== "pre" || ctx.events.length > 0} />}
        {view === "runners" && <RunnersView ctx={ctx} onChanged={refresh} hasData={phase !== "pre" || ctx.events.length > 0} />}
        {view === "teams" && <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} />}
        {view === "arbitrage" && board && <ArbitrageTab board={board} />}
      </main>

      {settingsOpen && (
        <SettingsPanel
          sessionId={sessionId}
          settings={{ rep0: 5, peak: 10, step: 1, capMin: 45, afterMin: 10, penMin: 1 }}
          noStartExerciseIds={[]}
          exercises={exercisesAll}
          numTeams={ctx.teams.length}
          onClose={() => setSettingsOpen(false)}
          hidePyramid
        />
      )}

      {openTeam && (
        <TeamPanel
          key={openTeam.id}
          ctx={ctx}
          team={openTeam}
          sessionId={sessionId}
          phase={phase}
          liveMs={liveMs}
          onClose={() => { setOpenTeamId(null); refresh(); }}
        />
      )}
    </div>
  );
}

function TeamPanel({ ctx, team, sessionId, phase, liveMs, onClose }: { ctx: FFContext; team: FFTeam; sessionId: string; phase: "pre" | "run" | "post"; liveMs: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [points, setPoints] = useState<Record<string, number>>(() => Object.fromEntries(team.runners.map((r) => [r.memberId, r.points])));
  const st = useMemo(() => teamState({ ...ctx, teams: ctx.teams.map((t) => (t.id === team.id ? { ...t, runners: t.runners.map((r) => ({ ...r, points: points[r.memberId] ?? r.points })) } : t)) }, { ...team, runners: team.runners.map((r) => ({ ...r, points: points[r.memberId] ?? r.points })) }), [ctx, team, points]);

  function act(fn: () => Promise<{ error: string } | { ok: true } | { ok: true; removed: boolean }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(35);
      router.refresh();
    });
  }
  function tap(stationId: string) {
    const label = stationId === "fin" ? "Fin du WOD" : ctx.exercises.find((x) => x.id === stationId)?.label ?? stationId;
    const had = stationId === "fin" ? st.fin !== null : st.ex[stationId] != null;
    if (stationId !== "corde" && had && !confirm(`Effacer le pointage « ${label} » de ${team.name} ?`)) return;
    act(() => ffTapAction(sessionId, team.id, stationId));
  }
  function savePoints(memberId: string, v: number) {
    setPoints((p) => ({ ...p, [memberId]: v }));
    startTransition(async () => {
      await ffFinisherAction(memberId, v);
    });
  }
  const color = colorOf(team);

  return (
    <div className="fixed inset-0 z-30 bg-white flex flex-col">
      <div className="flex justify-between items-center gap-3 px-4 py-3 border-b-2 border-[#0E1A26]">
        <h3 className="text-[17px] font-extrabold leading-tight">
          {team.name}{" "}
          <button onClick={() => act(() => ffColorAction(team.id, nextColor(color)))} className="inline-block px-2.5 py-0.5 rounded-full text-white text-[11.5px] font-extrabold align-middle" style={{ background: FF_CHEX[color] }} title="Changer la couleur : jaune → vert → bleu → rouge">
            {color}
          </button>
          {team.runners.length > 0 && <span className="block text-xs font-normal text-[#5C6B78]">{team.runners.map((r) => r.name).join(", ")}</span>}
        </h3>
        <button onClick={onClose} className="font-bold">Fermer</button>
      </div>
      <div className="overflow-auto flex-1 px-4 py-3 pb-8">
        <p className={`text-[34px] font-extrabold tracking-tight mb-0.5 ${st.fin !== null ? "text-[#0B7A3B]" : ""}`}>{st.fin !== null ? fmt(st.wod) : phase !== "pre" ? fmt(liveMs) : "0:00"}</p>
        <p className="text-xs text-[#5C6B78] mb-3">{phase === "pre" ? "Lance d'abord la course." : st.fin !== null ? "WOD terminé." : "En cours"}</p>
        {error && <p className="text-[#A32B1C] text-sm mb-2 font-bold">{error}</p>}

        <button onClick={() => tap("corde")} disabled={pending} className="w-full bg-[#0F5A62] text-white rounded-xl px-4 py-4 flex justify-between items-center mb-2 disabled:opacity-60">
          <span className="text-lg font-bold">Corde à sauter <span className="text-[11.5px] font-semibold opacity-70 ml-2">100 rép.</span></span>
          <span className="text-sm font-bold">× {st.corde.length}{st.corde.length ? ` · ${fmt(st.corde[st.corde.length - 1])}` : ""}</span>
        </button>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ctx.exercises.map((x) => {
            const at = st.ex[x.id];
            return (
              <button key={x.id} onClick={() => tap(x.id)} disabled={pending} className={`text-white rounded-xl px-4 py-3 flex justify-between items-center disabled:opacity-60 ${at != null ? "bg-[#0B7A3B]" : "bg-[#16344E]"}`}>
                <span className="text-[15.5px] font-bold"><span className="inline-block w-5 opacity-75 font-extrabold">{x.n}</span>{x.label}{x.reps ? <span className="text-[11.5px] font-semibold opacity-70 ml-2">{x.reps} rép.</span> : null}</span>
                <span className="text-sm font-bold">{at != null ? fmt(at) : "—"}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => tap("fin")} disabled={pending} className={`w-full text-white rounded-xl px-4 py-3 flex justify-between items-center mt-3 disabled:opacity-60 ${st.fin !== null ? "bg-[#0B7A3B]" : "bg-[#A32B1C]"}`}>
          <span className="text-[15.5px] font-bold">Fin du WOD</span><span className="text-sm font-bold">{st.fin !== null ? fmt(st.wod) : "—"}</span>
        </button>

        <div className="mt-4 p-3 border border-[#C9D2DA] rounded-xl bg-[#F5F8FA]">
          <label className="block text-[13px] font-extrabold mb-2">Pénalités — 1 point chacune</label>
          <div className="flex items-center gap-3">
            <button onClick={() => act(() => ffPenaltyAction(team.id, -1))} disabled={pending} className="w-12 h-11 border border-[#C9D2DA] bg-white rounded-lg font-extrabold text-xl">−</button>
            <span className="text-[17px] font-extrabold min-w-[96px] text-center">{st.pen}{st.pen ? `  (+${fmt(st.penMs)})` : ""}</span>
            <button onClick={() => act(() => ffPenaltyAction(team.id, 1))} disabled={pending} className="w-12 h-11 border border-[#C9D2DA] bg-white rounded-lg font-extrabold text-xl">+</button>
          </div>
        </div>

        <div className="mt-4 p-3 border border-[#C9D2DA] rounded-xl bg-[#F5F8FA]">
          <label className="block text-[13px] font-extrabold mb-2">Finisher — points par coureur</label>
          {team.runners.length === 0 && <p className="text-xs text-[#5C6B78]">Aucun coureur encodé (onglet Équipes &amp; arbitres).</p>}
          {st.list.filter((r) => r.memberId).map((r) => (
            <div key={r.memberId} className="flex items-center gap-2 py-2 border-t first:border-t-0 border-[#E3E9ED]">
              <span className="flex-1 min-w-0 text-sm font-bold truncate">{r.name}</span>
              <input type="number" min={0} step={1} value={points[r.memberId] ?? 0} onChange={(e) => savePoints(r.memberId, Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-[70px] p-2 text-base font-bold text-center border border-[#C9D2DA] rounded-lg bg-white" />
              <span className="w-16 text-right text-[13px] font-extrabold text-[#0B7A3B]">{r.score === null ? "—" : fmt(r.score)}</span>
            </div>
          ))}
          <p className="text-xs text-[#5C6B78] mt-2">Score du coureur = temps de l&apos;équipe + pénalités − son Finisher.</p>
        </div>
        <p className="text-xs text-[#5C6B78] mt-3">Un appui sur un atelier déjà validé (vert) permet de l&apos;effacer.</p>
      </div>
    </div>
  );
}

function ResultsView({ ctx, sessionId, onChanged, hasData }: { ctx: FFContext; sessionId: string; onChanged: () => void; hasData: boolean }) {
  const [pending, startTransition] = useTransition();
  const [resetPending, startReset] = useTransition();
  function setSettings(unit: number, mode: "avg" | "sum") {
    startTransition(async () => {
      await ffSettingsAction(sessionId, unit, mode);
      onChanged();
    });
  }
  const rows = teamRows(ctx);
  let rank = 0;
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap text-[13px] mb-1">
        <span>1 point =</span>
        <select value={ctx.settings.unit} disabled={pending} onChange={(e) => setSettings(+e.target.value, ctx.settings.mode)} className="p-2 border border-[#C9D2DA] rounded-lg bg-white">
          {FF_UNITS.map((u) => <option key={u} value={u}>{u === 60 ? "1 minute" : `${u} seconde${u > 1 ? "s" : ""}`}</option>)}
        </select>
        <span>Finisher d&apos;équipe =</span>
        <select value={ctx.settings.mode} disabled={pending} onChange={(e) => setSettings(ctx.settings.unit, e.target.value as "avg" | "sum")} className="p-2 border border-[#C9D2DA] rounded-lg bg-white">
          <option value="avg">moyenne des coureurs</option>
          <option value="sum">somme des coureurs</option>
        </select>
        <button onClick={() => { if (confirm("Réattribuer les couleurs dans l'ordre jaune, vert, bleu, rouge ?")) startReset(async () => { await ffResetColorsAction(sessionId); onChanged(); }); }} disabled={resetPending} className="border border-[#C9D2DA] rounded-lg px-3 py-2 text-[13px] font-semibold bg-white">Couleurs par défaut</button>
      </div>
      <p className="text-xs text-[#5C6B78] mb-3">Score d&apos;équipe = temps du WOD + pénalités − Finisher. Une pénalité vaut 1 point.</p>

      <h3 className="text-[15px] font-extrabold mt-4 mb-1.5">Classement des couleurs</h3>
      {!hasData ? (
        <p className="text-[#5C6B78] py-4">En attente de la course.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {colorRows(ctx).map((x) => (
            <motion.div key={x.color} layout className="rounded-xl text-white px-3 py-3" style={{ background: FF_CHEX[x.color] }}>
              <div className="text-[13px] font-extrabold uppercase">{x.color}</div>
              <div className="text-[26px] font-extrabold leading-tight">{x.avg === null ? "—" : fmt(x.avg)}</div>
              <div className="text-[11px] opacity-90">{x.done}/{x.n} équipe(s) classée(s)</div>
            </motion.div>
          ))}
        </div>
      )}

      <h3 className="text-[15px] font-extrabold mt-5 mb-1.5">Classement des équipes</h3>
      {!hasData ? (
        <p className="text-[#5C6B78] py-4">Rien à afficher. Encode tes équipes, puis lance la course.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b-2 border-[#0E1A26] text-right">
                <th className="p-2 text-left">#</th><th className="p-2 text-left">Équipe</th><th className="p-2">Couleur</th><th className="p-2 text-left">Participants</th><th className="p-2">Corde</th>
                {ctx.exercises.map((x) => <th key={x.id} className="p-2">{x.label}</th>)}
                <th className="p-2">Temps WOD</th><th className="p-2">Pénalités</th><th className="p-2">Finisher</th><th className="p-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((st) => {
                if (st.score !== null) rank++;
                return (
                  <motion.tr key={st.team.id} layout className="odd:bg-[#F5F8FA] text-right border-b border-[#E6EBEF]">
                    <td className="p-2 text-left font-extrabold">{st.score !== null ? rank : "—"}</td>
                    <td className="p-2 text-left font-bold">{st.team.name}</td>
                    <td className="p-2"><span className="inline-block px-2 py-0.5 rounded-full text-white text-[11.5px] font-extrabold" style={{ background: FF_CHEX[colorOf(st.team)] }}>{colorOf(st.team)}</span></td>
                    <td className="p-2 text-left text-[#5C6B78]">{st.team.runners.map((r) => r.name).join(", ") || "—"}</td>
                    <td className="p-2">× {st.corde.length}</td>
                    {ctx.exercises.map((x) => <td key={x.id} className="p-2">{st.ex[x.id] != null ? fmt(st.ex[x.id]) : ""}</td>)}
                    <td className="p-2">{st.wod !== null ? fmt(st.wod) : "—"}</td>
                    <td className="p-2">{st.pen ? `×${st.pen} (+${fmt(st.penMs)})` : ""}</td>
                    <td className="p-2">{st.teamPts ? `${num(st.teamPts)} pt` : ""}</td>
                    <td className="p-2 font-extrabold">{st.score !== null ? fmt(st.score) : "—"}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunnersView({ ctx, onChanged, hasData }: { ctx: FFContext; onChanged: () => void; hasData: boolean }) {
  const [, startTransition] = useTransition();
  const rows = runnerRows(ctx);
  let rank = 0;
  return (
    <div>
      <p className="text-xs text-[#5C6B78] mb-3">Chaque coureur porte le temps de son équipe (pénalités comprises) moins son propre Finisher. Les points se modifient directement ici.</p>
      {!hasData ? (
        <p className="text-[#5C6B78] py-4">Rien à afficher. Encode tes équipes, puis lance la course.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b-2 border-[#0E1A26] text-right">
                <th className="p-2 text-left">#</th><th className="p-2 text-left">Coureur</th><th className="p-2 text-left">Équipe</th><th className="p-2">Couleur</th><th className="p-2">Temps équipe</th><th className="p-2">Pénalités</th><th className="p-2">Finisher</th><th className="p-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                if (r.runner.score !== null) rank++;
                return (
                  <motion.tr key={`${r.team.id}_${r.runner.memberId || r.runner.name}`} layout className="odd:bg-[#F5F8FA] text-right border-b border-[#E6EBEF]">
                    <td className="p-2 text-left font-extrabold">{r.runner.score !== null ? rank : "—"}</td>
                    <td className="p-2 text-left font-bold">{r.runner.name}</td>
                    <td className="p-2 text-left">{r.team.name}</td>
                    <td className="p-2"><span className="inline-block px-2 py-0.5 rounded-full text-white text-[11.5px] font-extrabold" style={{ background: FF_CHEX[colorOf(r.team)] }}>{colorOf(r.team)}</span></td>
                    <td className="p-2">{r.st.wod !== null ? fmt(r.st.wod) : "—"}</td>
                    <td className="p-2">{r.st.pen ? `+${fmt(r.st.penMs)}` : ""}</td>
                    <td className="p-2">
                      {r.runner.memberId ? (
                        <input type="number" min={0} step={1} defaultValue={r.runner.points} onBlur={(e) => { const v = Math.max(0, parseInt(e.target.value, 10) || 0); startTransition(async () => { await ffFinisherAction(r.runner.memberId, v); onChanged(); }); }} className="w-14 p-1.5 text-[13px] text-center border border-[#C9D2DA] rounded-md bg-white" />
                      ) : r.runner.points}
                    </td>
                    <td className="p-2 font-extrabold">{r.runner.score === null ? "—" : fmt(r.runner.score)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export type { FFTeamState };
