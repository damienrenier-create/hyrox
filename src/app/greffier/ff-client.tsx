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
import { Brand } from "../_components/Brand";
import { btn, cx, ui } from "@/lib/ui";

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
                <span className={ui.eyebrow}>Greffier · Fête Foraine</span>
              </div>
              {sessionOptions.length > 1 ? (
                <select value={sessionId} onChange={(e) => router.push(`/greffier?session=${e.target.value}`)} className={`${ui.input} w-auto max-w-[280px] py-1.5 font-bold`}>
                  {sessionOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? "" : " (fermée)"}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-bold leading-tight">{sessionLabel}{classes.length > 0 && <span className="text-ink-2 font-semibold"> · {classes.join(", ")}</span>}</p>
              )}
              <p className="text-xs text-ink-2">{phase === "pre" ? "Chrono à l'arrêt" : phase === "post" ? "Course terminée" : isPaused ? "EN PAUSE — pointages bloqués" : "Course en cours"}</p>
            </div>
            <p className={cx("font-display text-[3rem] font-extrabold leading-none tracking-tight tabular-nums", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : "text-ink")}>{fmt(liveMs) || "0:00"}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {phase === "pre" && (
              <>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.lgGhost}>⚙️ Réglages</button>
                <button onClick={handleStart} disabled={pending} className={btn.lgSuccess}>Début de course</button>
              </>
            )}
            {phase === "run" && (
              <>
                <button onClick={() => run(() => togglePauseAction(sessionId))} disabled={pending} className={isPaused ? btn.lgSuccess : btn.lgAccent}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleUndo} disabled={pending || ctx.events.length === 0} className={btn.lgGhost}>Annuler</button>
                <button onClick={handleFinish} disabled={pending} className={btn.lgDanger}>Fin de course</button>
              </>
            )}
            {phase === "post" && <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 Course terminée</span>}
            <button onClick={exportCsv} className={btn.lgDark}>Exporter vers Excel</button>
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
        <div className={`${ui.segmented} mt-3 flex-wrap`}>
          {([
            ["race", "Course"],
            ["results", "Résultats"],
            ["runners", "Coureurs"],
          ] as [View, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={tabBtn(view === k)}>{l}</button>
          ))}
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
                    className={cx("rounded-2xl text-white flex flex-col items-center gap-1 min-h-[104px] overflow-hidden shadow-card active:scale-[.97] transition-transform", st.fin !== null ? "bg-success" : "bg-brand")}
                  >
                    <span className="w-full h-1.5" style={{ background: FF_CHEX[colorOf(team)] }} />
                    <span className="font-display text-[23px] font-extrabold leading-none mt-1">{team.order}</span>
                    {team.runners.length > 0 && <span className="text-[10px] opacity-90 max-w-full px-1 truncate">{team.runners.map((r) => r.name).join(", ")}</span>}
                    <span className="flex gap-[3px]">
                      {ctx.exercises.map((x) => <span key={x.id} className={cx("w-[7px] h-[7px] rounded-[2px]", st.ex[x.id] != null ? "bg-accent" : "bg-white/30")} />)}
                    </span>
                    <span className="text-[10.5px] opacity-90">corde ×{st.corde.length} · {st.exDone}/{ctx.exercises.length}</span>
                    <span className="text-xs font-bold tabular-nums">{time}</span>
                    {st.pen > 0 && <span className="text-[10px] font-bold text-white/90 pb-1">pénalité ×{st.pen}</span>}
                  </button>
                );
              })}
            </div>
            <p className={`${ui.hint} mt-3`}>Appuie sur une équipe pour ouvrir ses ateliers, ses pénalités et les Finishers de ses coureurs. Le bandeau du haut de chaque tuile donne la couleur de la macro-équipe.</p>
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
          settings={{ rep0: 5, peak: 10, step: 1, capMin: 40, afterMin: 10, penMin: 1 }}
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
  const stepBtn = "w-12 h-11 border border-line-2 bg-card rounded-xl font-extrabold text-xl hover:bg-paper transition";

  return (
    <div className="fixed inset-0 z-30 bg-paper flex flex-col">
      <div className="flex justify-between items-center gap-3 px-4 py-3 bg-card border-b border-line">
        <h3 className="font-display text-[17px] font-extrabold leading-tight">
          {team.name}{" "}
          <button onClick={() => act(() => ffColorAction(team.id, nextColor(color)))} className="inline-block px-2.5 py-0.5 rounded-full text-white text-[11.5px] font-extrabold align-middle font-sans" style={{ background: FF_CHEX[color] }} title="Changer la couleur : jaune → vert → bleu → rouge">
            {color}
          </button>
          {team.runners.length > 0 && <span className="block text-xs font-normal font-sans text-ink-2">{team.runners.map((r) => r.name).join(", ")}</span>}
        </h3>
        <button onClick={onClose} className={btn.ghost}>Fermer</button>
      </div>
      <div className="overflow-auto flex-1 px-4 py-3 pb-8 max-w-3xl w-full mx-auto">
        <p className={cx("font-display text-[34px] font-extrabold tracking-tight tabular-nums mb-0.5", st.fin !== null ? "text-success" : "text-ink")}>{st.fin !== null ? fmt(st.wod) : phase !== "pre" ? fmt(liveMs) : "0:00"}</p>
        <p className={`${ui.hint} mb-3`}>{phase === "pre" ? "Lance d'abord la course." : st.fin !== null ? "WOD terminé." : "En cours"}</p>
        {error && <p className={`${ui.alertErr} mb-2`}>{error}</p>}

        <button onClick={() => tap("corde")} disabled={pending} className="w-full bg-sea hover:bg-sea-hover text-white rounded-2xl px-4 py-4 flex justify-between items-center mb-2 shadow-card disabled:opacity-60 transition">
          <span className="text-lg font-bold">Corde à sauter <span className="text-[11.5px] font-semibold opacity-70 ml-2">100 rép.</span></span>
          <span className="text-sm font-bold tabular-nums">× {st.corde.length}{st.corde.length ? ` · ${fmt(st.corde[st.corde.length - 1])}` : ""}</span>
        </button>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ctx.exercises.map((x) => {
            const at = st.ex[x.id];
            return (
              <button key={x.id} onClick={() => tap(x.id)} disabled={pending} className={cx("text-white rounded-2xl px-4 py-3 flex justify-between items-center shadow-card disabled:opacity-60 transition", at != null ? "bg-success" : "bg-brand hover:bg-brand-hover")}>
                <span className="text-[15.5px] font-bold"><span className="inline-block w-5 opacity-75 font-extrabold">{x.n}</span>{x.label}{x.reps ? <span className="text-[11.5px] font-semibold opacity-70 ml-2">{x.reps} rép.</span> : null}</span>
                <span className="text-sm font-bold tabular-nums">{at != null ? fmt(at) : "—"}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => tap("fin")} disabled={pending} className={cx("w-full text-white rounded-2xl px-4 py-3 flex justify-between items-center mt-3 shadow-card disabled:opacity-60 transition", st.fin !== null ? "bg-success" : "bg-danger hover:bg-danger/90")}>
          <span className="text-[15.5px] font-bold">Fin du WOD</span><span className="text-sm font-bold tabular-nums">{st.fin !== null ? fmt(st.wod) : "—"}</span>
        </button>

        <div className={`${ui.cardPad} mt-4`}>
          <label className="block text-[13px] font-extrabold mb-2">Pénalités — 1 point chacune</label>
          <div className="flex items-center gap-3">
            <button onClick={() => act(() => ffPenaltyAction(team.id, -1))} disabled={pending} className={stepBtn}>−</button>
            <span className="font-display text-[17px] font-extrabold min-w-[96px] text-center tabular-nums">{st.pen}{st.pen ? `  (+${fmt(st.penMs)})` : ""}</span>
            <button onClick={() => act(() => ffPenaltyAction(team.id, 1))} disabled={pending} className={stepBtn}>+</button>
          </div>
        </div>

        <div className={`${ui.cardPad} mt-4`}>
          <label className="block text-[13px] font-extrabold mb-2">Finisher — points par coureur</label>
          {team.runners.length === 0 && <p className={ui.hint}>Aucun coureur encodé (onglet Équipes &amp; arbitres).</p>}
          {st.list.filter((r) => r.memberId).map((r) => (
            <div key={r.memberId} className="flex items-center gap-2 py-2 border-t first:border-t-0 border-line">
              <span className="flex-1 min-w-0 text-sm font-bold truncate">{r.name}</span>
              <input type="number" min={0} step={1} value={points[r.memberId] ?? 0} onChange={(e) => savePoints(r.memberId, Math.max(0, parseInt(e.target.value, 10) || 0))} className={`${ui.input} w-[76px] text-base font-bold text-center`} />
              <span className="w-16 text-right text-[13px] font-extrabold text-success-ink tabular-nums">{r.score === null ? "—" : fmt(r.score)}</span>
            </div>
          ))}
          <p className={`${ui.hint} mt-2`}>Score du coureur = temps de l&apos;équipe + pénalités − son Finisher.</p>
        </div>
        <p className={`${ui.hint} mt-3`}>Un appui sur un atelier déjà validé (vert) permet de l&apos;effacer.</p>
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
  const thR = `${ui.th} text-right`;
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap text-[13px] mb-1">
        <span>1 point =</span>
        <select value={ctx.settings.unit} disabled={pending} onChange={(e) => setSettings(+e.target.value, ctx.settings.mode)} className={`${ui.input} w-auto py-2`}>
          {FF_UNITS.map((u) => <option key={u} value={u}>{u === 60 ? "1 minute" : `${u} seconde${u > 1 ? "s" : ""}`}</option>)}
        </select>
        <span>Finisher d&apos;équipe =</span>
        <select value={ctx.settings.mode} disabled={pending} onChange={(e) => setSettings(ctx.settings.unit, e.target.value as "avg" | "sum")} className={`${ui.input} w-auto py-2`}>
          <option value="avg">moyenne des coureurs</option>
          <option value="sum">somme des coureurs</option>
        </select>
        <button onClick={() => { if (confirm("Réattribuer les couleurs dans l'ordre jaune, vert, bleu, rouge ?")) startReset(async () => { await ffResetColorsAction(sessionId); onChanged(); }); }} disabled={resetPending} className={btn.smGhost}>Couleurs par défaut</button>
      </div>
      <p className={`${ui.hint} mb-3`}>Score d&apos;équipe = temps du WOD + pénalités − Finisher. Une pénalité vaut 1 point.</p>

      <h3 className={`${ui.h3} mt-4 mb-1.5`}>Classement des couleurs</h3>
      {!hasData ? (
        <p className={`${ui.muted} py-4`}>En attente de la course.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {colorRows(ctx).map((x) => (
            <motion.div key={x.color} layout className="rounded-2xl text-white px-3 py-3 shadow-card" style={{ background: FF_CHEX[x.color] }}>
              <div className="text-[13px] font-extrabold uppercase">{x.color}</div>
              <div className="font-display text-[26px] font-extrabold leading-tight tabular-nums">{x.avg === null ? "—" : fmt(x.avg)}</div>
              <div className="text-[11px] opacity-90">{x.done}/{x.n} équipe(s) classée(s)</div>
            </motion.div>
          ))}
        </div>
      )}

      <h3 className={`${ui.h3} mt-5 mb-1.5`}>Classement des équipes</h3>
      {!hasData ? (
        <p className={`${ui.muted} py-4`}>Rien à afficher. Encode tes équipes, puis lance la course.</p>
      ) : (
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead>
              <tr>
                <th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={thR}>Couleur</th><th className={ui.th}>Participants</th><th className={thR}>Corde</th>
                {ctx.exercises.map((x) => <th key={x.id} className={thR}>{x.label}</th>)}
                <th className={thR}>Temps WOD</th><th className={thR}>Pénalités</th><th className={thR}>Finisher</th><th className={thR}>Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((st) => {
                if (st.score !== null) rank++;
                return (
                  <motion.tr key={st.team.id} layout className={`${ui.tr} text-right tabular-nums`}>
                    <td className="p-2 text-left font-display font-extrabold">{st.score !== null ? rank : "—"}</td>
                    <td className="p-2 text-left font-bold">{st.team.name}</td>
                    <td className="p-2"><span className="inline-block px-2 py-0.5 rounded-full text-white text-[11.5px] font-extrabold" style={{ background: FF_CHEX[colorOf(st.team)] }}>{colorOf(st.team)}</span></td>
                    <td className="p-2 text-left text-ink-2">{st.team.runners.map((r) => r.name).join(", ") || "—"}</td>
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
  const thR = `${ui.th} text-right`;
  return (
    <div>
      <p className={`${ui.hint} mb-3`}>Chaque coureur porte le temps de son équipe (pénalités comprises) moins son propre Finisher. Les points se modifient directement ici.</p>
      {!hasData ? (
        <p className={`${ui.muted} py-4`}>Rien à afficher. Encode tes équipes, puis lance la course.</p>
      ) : (
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead>
              <tr>
                <th className={ui.th}>#</th><th className={ui.th}>Coureur</th><th className={ui.th}>Équipe</th><th className={thR}>Couleur</th><th className={thR}>Temps équipe</th><th className={thR}>Pénalités</th><th className={thR}>Finisher</th><th className={thR}>Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                if (r.runner.score !== null) rank++;
                return (
                  <motion.tr key={`${r.team.id}_${r.runner.memberId || r.runner.name}`} layout className={`${ui.tr} text-right tabular-nums`}>
                    <td className="p-2 text-left font-display font-extrabold">{r.runner.score !== null ? rank : "—"}</td>
                    <td className="p-2 text-left font-bold">{r.runner.name}</td>
                    <td className="p-2 text-left">{r.team.name}</td>
                    <td className="p-2"><span className="inline-block px-2 py-0.5 rounded-full text-white text-[11.5px] font-extrabold" style={{ background: FF_CHEX[colorOf(r.team)] }}>{colorOf(r.team)}</span></td>
                    <td className="p-2">{r.st.wod !== null ? fmt(r.st.wod) : "—"}</td>
                    <td className="p-2">{r.st.pen ? `+${fmt(r.st.penMs)}` : ""}</td>
                    <td className="p-2">
                      {r.runner.memberId ? (
                        <input type="number" min={0} step={1} defaultValue={r.runner.points} onBlur={(e) => { const v = Math.max(0, parseInt(e.target.value, 10) || 0); startTransition(async () => { await ffFinisherAction(r.runner.memberId, v); onChanged(); }); }} className={`${ui.input} w-16 py-1.5 text-[13px] text-center`} />
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
