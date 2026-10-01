"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  HX_UNITS, cindyRows, fmt, hxCsv, segmentLabel, segmentStats, teamState, timeRows,
  type HXContext, type HXSettings, type HXStat, type HXTeamState,
} from "@/lib/wod-engines/templates/hyrox-engine";
import type { HXBundle } from "@/lib/hyrox-context";
import type { BoardData } from "@/lib/referee-board";
import { resetSessionAction, startRaceAction, togglePauseAction } from "./race-actions";
import { finishRaceAction } from "./actions";
import { hxCardAction, hxSetStartAction, hxSettingsAction, hxTapAction, hxUndoAction, hxUndoTeamAction, type HXSettingsInput } from "./hx-actions";
import { setTeamCountAction } from "./settings-actions";
import { setRaceStatus } from "@/lib/firebase/firebase-sync";
import { greffierPulseAction } from "@/lib/pulse";
import { usePulse } from "../_components/usePulse";
import { TeamsManager, type TeamWithMembers, type RefereeView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { ArbitrageTab } from "./ArbitrageTab";
import type { PendingRequest } from "./referee-decisions";
import { SessionStep, sessionDay, type SessionOption } from "./client";
import { btn, cx, ui } from "@/lib/ui";

type View = "race" | "cards" | "results" | "stats" | "teams" | "arbitrage";
type Phase = "pre" | "run" | "post";
type ActionResult = { error: string } | { ok: true } | { ok: true; key: string };

// Greffier « Hyrox » (Sartay 01/10) : chrono et temps limite en haut, pave 5 x 5 des equipes (numero + segment en cours :
// « 3 · Wall ball » ou « Run → 4 »), un clic ouvre l'equipe (progression, gros bouton Valider, retour arriere), onglet
// cartes jaunes (choisir l'equipe), classements (temps / Cindy), statistiques par station et par run. Ecran PC projete.
export function HyroxClient({
  sessionId, sessionLabel, sessionOptions, olderSession, newerSession, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, board, picker, showConsole = false,
}: {
  showConsole?: boolean;
  sessionId: string;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  olderSession: SessionOption | null;
  newerSession: SessionOption | null;
  bundle: HXBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  pendingRequests: PendingRequest[];
  board: BoardData | null;
  picker: PickerData;
}) {
  const router = useRouter();
  const { ctx, startedAtMs, endedAtMs, pauses, locked } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);
  const isPaused = pauses.some((p) => p.to === null);
  const phase: Phase = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  const [view, setView] = useState<View>(phase === "pre" && memberCount === 0 ? "teams" : "race");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, isPaused]);

  const pulse = useCallback(() => greffierPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 10000, phase !== "post" && !openTeamId && !pending);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    const ref = phase === "post" ? endedAtMs! : now;
    return elapsed(startedAtMs, pauses, ref) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);
  const capMs = ctx.settings.capMin * 60_000;
  const remainMs = capMs - liveMs;

  const states = useMemo(() => new Map(ctx.teams.map((t) => [t.id, teamState(ctx, t)])), [ctx]);
  const teams = useMemo(() => [...ctx.teams].sort((a, b) => a.order - b.order), [ctx.teams]);
  // Station de depart annoncee aux eleves pendant l'encodage (onglet Equipes & arbitres, ecran projete).
  const startByTeam = useMemo(() => Object.fromEntries(teams.map((t) => { const s0 = states.get(t.id)!.segments[0]; return [t.id, { number: s0.stationNo, label: s0.short }]; })), [teams, states]);
  const totalCards = ctx.cards.length;

  function refresh() {
    router.refresh();
  }
  function run(action: () => Promise<ActionResult>) {
    setError("");
    startTransition(async () => {
      const res = await action();
      if ("error" in res) setError(res.error);
      else refresh();
    });
  }
  function handleStart() {
    if (memberCount === 0 && !confirm("Aucun élève n'est encodé dans les équipes. Lancer la course quand même ?")) return;
    run(async () => {
      const res = await startRaceAction(sessionId);
      if (!("error" in res)) void setRaceStatus(sessionId, "COMBAT");
      return res;
    });
  }
  function handleReset() {
    if (!confirm("Remettre cette course à zéro ? Chrono, validations, cartes jaunes, tirs et évaluations du Touché-Coulé seront effacés. Les équipes, les arbitres, leurs flottes et les réglages restent, et la séance est rouverte.")) return;
    if (!confirm("Vraiment ? Les résultats de cette course seront perdus, sans retour en arrière.")) return;
    run(() => resetSessionAction(sessionId));
  }
  function handleFinish() {
    if (!confirm("Arrêter définitivement la course ? Les équipes non arrivées resteront classées par segments faits.")) return;
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
    if (!confirm(`Annuler la dernière validation : ${team?.name ?? "équipe"} — ${segmentLabel(ctx, last.teamId, last.key)} (${fmt(last.at)}) ?`)) return;
    run(() => hxUndoAction(sessionId));
  }
  function exportCsv() {
    const csv = hxCsv(ctx, liveMs, phase === "post" ? "terminee" : isPaused ? "en pause" : phase === "run" ? "en cours" : "pas commencee");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (n: number) => (n < 10 ? "0" : "") + n;
    a.href = url;
    a.download = `hyrox_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const openSt = openTeamId ? states.get(openTeamId) ?? null : null;
  const tabBtn = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg transition", on ? ui.segOn : ui.segOff);
  const padded = teams.length ? Math.ceil(teams.length / 5) * 5 - teams.length : 0;

  return (
    <div className={`${ui.page} pb-24`}>
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-5 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={ui.eyebrow}>Greffier · Hyrox</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <SessionStep to={olderSession} dir="older" />
                {sessionOptions.length > 1 ? (
                  <select value={sessionId} onChange={(e) => router.push(`/greffier?session=${e.target.value}`)} className={`${ui.input} w-auto max-w-[280px] py-1.5 font-bold`}>
                    {sessionOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? " — ouverte" : ` — ${sessionDay(o.dateMs)}`}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm font-bold leading-tight">{sessionLabel}{classes.length > 0 && <span className="text-ink-2 font-semibold"> · {classes.join(", ")}</span>}</p>
                )}
                <SessionStep to={newerSession} dir="newer" />
              </div>
              <p className="text-xs text-ink-2">{phase === "pre" ? `Chrono à l'arrêt · ${ctx.settings.capMin} min` : phase === "post" ? "Course terminée" : isPaused ? "EN PAUSE — validations bloquées" : "Course en cours"}</p>
            </div>
            <div className="flex items-end gap-4">
              <p className={cx("font-display text-[3rem] font-extrabold leading-none tracking-tight tabular-nums", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : "text-ink")}>{fmt(liveMs) || "0:00"}</p>
              {phase !== "pre" && (
                <p className={cx("font-display text-xl font-extrabold leading-none tabular-nums pb-1", remainMs < 0 ? "text-danger" : remainMs < 5 * 60_000 ? "text-accent" : "text-ink-3")} title={`Temps limite : ${ctx.settings.capMin} min`}>
                  {remainMs >= 0 ? `reste ${fmt(remainMs)}` : `+${fmt(-remainMs)} après ${ctx.settings.capMin} min`}
                </p>
              )}
            </div>
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
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.lgGhost}>⚙️</button>
                <button onClick={handleFinish} disabled={pending} className={btn.lgDanger}>Fin de course</button>
                <button onClick={handleReset} disabled={pending} className={btn.lgGhost} title="Course lancée par erreur : tout remettre à zéro (double confirmation)">↺ Remettre à zéro</button>
              </>
            )}
            {phase === "post" && (
              <>
                <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 Course terminée</span>
                <button onClick={handleReset} disabled={pending} className={btn.lgGhost} title="Terminée par erreur : tout remettre à zéro et repartir (double confirmation)">↺ Remettre à zéro</button>
              </>
            )}
            {showConsole && <a href="/admin" target="_blank" rel="noopener" className={btn.lgGhost} title="Ouvrir la console dans un nouvel onglet : le WOD reste ouvert ici">🏠 Console ↗</a>}
            <button onClick={exportCsv} className={btn.lgDark}>Exporter vers Excel</button>
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
        <div className={`${ui.segmented} mt-3 flex-wrap`}>
          <button onClick={() => setView("race")} className={tabBtn(view === "race")}>Course</button>
          <button onClick={() => setView("cards")} className={tabBtn(view === "cards")}>🟨 Cartes jaunes{totalCards > 0 && <span className={`${ui.chip} ${ui.chipWarn} ml-1`}>{totalCards}</span>}</button>
          <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Classement</button>
          <button onClick={() => setView("stats")} className={tabBtn(view === "stats")}>Stats</button>
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
            {/* Pave 5 x 5 : l'equipe 1 en haut a gauche, puis en ligne ; le greffier trouve une equipe d'un coup d'oeil. */}
            <div className="grid grid-cols-5 gap-2">
              {teams.map((team) => <TeamTile key={team.id} st={states.get(team.id)!} phase={phase} onOpen={() => setOpenTeamId(team.id)} />)}
              {Array.from({ length: padded }).map((_, i) => <div key={`pad${i}`} className="rounded-2xl border border-dashed border-line min-h-[118px]" />)}
            </div>
            {teams.length === 0 && <p className={`${ui.muted} py-6 text-center`}>Aucune équipe : règle le nombre d&apos;équipes dans ⚙️ Réglages.</p>}
            <p className={`${ui.hint} mt-3`}>
              Chaque case : numéro d&apos;équipe, station en cours (numéro · exercice) ou run vers la station suivante, segments faits. Touche la case pour valider ou corriger.
              {ctx.settings.runDetail && <> · <b>{ctx.settings.runLabel}</b> = {ctx.settings.runDetail}.</>}
            </p>
          </>
        )}
        {view === "cards" && <CardsView states={states} teams={teams} sessionId={sessionId} phase={phase} penSec={ctx.settings.penSec} onRun={run} pending={pending} />}
        {view === "results" && <ResultsView ctx={ctx} hasData={phase !== "pre" || ctx.events.length > 0} />}
        {view === "stats" && <StatsView ctx={ctx} />}
        {view === "teams" && <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} startByTeam={startByTeam} picker={picker} />}
        {view === "arbitrage" && board && <ArbitrageTab board={board} />}
      </main>

      {settingsOpen && (
        <SettingsSheet sessionId={sessionId} settings={ctx.settings} locked={locked} numTeams={ctx.teams.length} canResize={phase === "pre"} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); refresh(); }} />
      )}

      {openSt && (
        <TeamPanel key={openSt.team.id} ctx={ctx} st={openSt} sessionId={sessionId} phase={phase} isPaused={isPaused} liveMs={liveMs} onClose={() => { setOpenTeamId(null); refresh(); }} />
      )}
    </div>
  );
}

// Une case du pave : numero (lisible du fond de la salle), prenoms, segment en cours, progression.
function TeamTile({ st, phase, onOpen }: { st: HXTeamState; phase: Phase; onOpen: () => void }) {
  const { team, current, finishedMs, cindy, cards, done, segments } = st;
  const finished = finishedMs !== null;
  const bg = finished ? "bg-success text-white" : phase === "pre" ? "bg-card text-ink border border-line-2" : current?.kind === "run" ? "bg-sea text-white" : "bg-brand text-white";
  const main = phase === "pre" ? `Départ · ${segments[0].label}` : finished ? `🏁 ${fmt(finishedMs)}` : current ? (current.kind === "run" ? `🏃 ${current.label}` : current.label) : "";
  const detail = phase === "pre" ? segments[0].detail : finished ? `${st.team.members.length ? "" : ""}Cindy ×${cindy.length}` : current?.detail ?? "";
  const pct = segments.length ? Math.round((done / segments.length) * 100) : 0;
  return (
    <button onClick={onOpen} className={cx("relative rounded-2xl text-left p-2.5 min-h-[118px] flex flex-col shadow-card active:scale-[.98] transition-transform overflow-hidden", bg)}>
      <span className="flex items-start justify-between gap-1">
        <span className="font-display text-[34px] font-extrabold leading-none">{team.order}</span>
        {cards > 0 && <span className="text-[11px] font-extrabold bg-yellow-300 text-yellow-900 rounded-md px-1.5 py-0.5">🟨 ×{cards}</span>}
      </span>
      <span className="text-[11px] opacity-80 truncate leading-tight mt-0.5">{team.members.map((m) => m.name).join(" & ") || "—"}</span>
      <span className="font-extrabold text-[15px] leading-tight mt-1.5 line-clamp-2">{main}</span>
      <span className="text-[11px] opacity-85 truncate">{detail}</span>
      <span className="mt-auto pt-1.5 flex items-center gap-1.5 text-[11px] font-bold tabular-nums">
        <span className="flex-1 h-1.5 rounded-full bg-black/15 overflow-hidden"><span className="block h-full bg-white/90" style={{ width: `${pct}%` }} /></span>
        <span>{done}/{segments.length}</span>
      </span>
    </button>
  );
}

// Panneau d'une equipe : progression, gros bouton Valider (segment en cours ou tour de Cindy), retour arriere,
// cartes jaunes, station de depart avant la course.
function TeamPanel({ ctx, st, sessionId, phase, isPaused, liveMs, onClose }: { ctx: HXContext; st: HXTeamState; sessionId: string; phase: Phase; isPaused: boolean; liveMs: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const { team, segments, times, splits, done, current, finishedMs, cindy, cards } = st;
  const finished = finishedMs !== null;
  const canValidate = phase === "run" && !isPaused;

  function act(fn: () => Promise<ActionResult>, closeAfter = false) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(35);
      if (closeAfter) onClose();
      else router.refresh();
    });
  }
  function undo() {
    const last = cindy.length ? "Tour de Cindy" : done ? segments[done - 1].label : null;
    if (!last) return;
    if (!confirm(`Annuler la dernière validation de ${team.name} : ${last} ?`)) return;
    act(() => hxUndoTeamAction(sessionId, team.id));
  }

  return (
    <div className="fixed inset-0 z-30 bg-paper flex flex-col">
      <div className="flex justify-between items-center gap-3 px-4 py-3 bg-card border-b border-line">
        <h3 className="font-display text-[22px] font-extrabold leading-tight">
          {team.name}
          {team.members.length > 0 && <span className="block text-sm font-normal font-sans text-ink-2">{team.members.map((m) => m.name).join(" & ")}</span>}
        </h3>
        <div className="flex items-center gap-3">
          <span className={cx("font-display text-[30px] font-extrabold tabular-nums", finished ? "text-success" : "text-ink")}>{finished ? fmt(finishedMs) : phase !== "pre" ? fmt(liveMs) : "0:00"}</span>
          <button onClick={onClose} className={btn.ghost}>Fermer</button>
        </div>
      </div>
      <div className="overflow-auto flex-1 px-4 py-3 pb-8 max-w-3xl w-full mx-auto">
        {error && <p className={`${ui.alertErr} mb-2`}>{error}</p>}

        {phase === "pre" && (
          <div className={`${ui.cardPad} mb-3`}>
            <p className="text-sm font-bold mb-1">Station de départ</p>
            <div className="grid grid-cols-4 gap-1.5">
              {ctx.settings.stations.map((s, i) => (
                <button key={s.id} type="button" disabled={pending} onClick={() => act(() => hxSetStartAction(sessionId, team.id, s.id))} className={cx("rounded-xl px-2 py-2 text-sm font-bold border transition", st.startIndex === i ? "bg-brand text-white border-brand" : "bg-card border-line hover:border-brand")}>
                  <span className="font-display text-lg font-extrabold mr-1">{i + 1}</span><span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
            <p className={`${ui.hint} mt-2`}>Sans choix : station {((Math.max(1, team.order) - 1) % ctx.settings.stations.length) + 1} (numéro d&apos;équipe). Le numéro et la station sont annoncés dans Équipes &amp; arbitres.</p>
          </div>
        )}

        {/* Segment en cours : LE bouton du greffier. */}
        <div className={cx("rounded-2xl p-4 mb-3 text-white shadow-card", finished ? "bg-success" : current?.kind === "run" ? "bg-sea" : "bg-brand")}>
          <p className="text-xs font-extrabold uppercase tracking-wide opacity-80">{finished ? "Parcours terminé" : `En cours · segment ${done + 1}/${segments.length}`}</p>
          <p className="font-display text-[28px] font-extrabold leading-tight">{finished ? `🏁 ${fmt(finishedMs)} · Cindy ×${cindy.length}` : current ? (current.kind === "run" ? `🏃 ${current.label}` : current.label) : ""}</p>
          <p className="text-sm opacity-90 mb-3">{finished ? ctx.settings.cindyLabel : current?.detail}</p>
          <button
            onClick={() => act(() => hxTapAction(sessionId, team.id), true)}
            disabled={pending || !canValidate}
            className="w-full rounded-2xl bg-white text-ink font-display font-extrabold text-xl py-4 shadow-sm disabled:opacity-50 active:scale-[.98] transition"
          >
            {finished ? `➕ Tour de Cindy n° ${cindy.length + 1}` : `✅ Valider : ${current?.kind === "run" ? current.label : current?.short ?? ""}`}
          </button>
          {!canValidate && <p className="text-xs opacity-90 mt-2">{phase === "pre" ? "Lance d'abord la course." : phase === "post" ? "Course terminée." : "Course en pause."}</p>}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={undo} disabled={pending || (done === 0 && cindy.length === 0)} className={btn.ghost}>↶ Annuler la dernière validation</button>
          <span className={`${ui.inset} flex items-center gap-2 px-3 py-1.5`}>
            <span className="text-sm font-bold">🟨 Cartes jaunes</span>
            <button onClick={() => act(() => hxCardAction(sessionId, team.id, -1))} disabled={pending || cards === 0 || phase === "pre"} className="w-8 h-8 rounded-lg border border-line-2 font-extrabold">−</button>
            <span className="font-display font-extrabold text-lg tabular-nums w-6 text-center">{cards}</span>
            <button onClick={() => { if (confirm(`Carte jaune pour ${team.name} ?`)) act(() => hxCardAction(sessionId, team.id, 1)); }} disabled={pending || phase === "pre"} className="w-8 h-8 rounded-lg border border-line-2 font-extrabold">+</button>
            {cards > 0 && <span className="text-xs text-ink-3">+{fmt(st.penMs)}</span>}
          </span>
        </div>

        <div className={`${ui.card} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead><tr><th className={ui.th}>#</th><th className={ui.th}>Segment</th><th className={ui.th}>Consigne</th><th className={`${ui.th} text-right`}>Validé à</th><th className={`${ui.th} text-right`}>Durée</th></tr></thead>
            <tbody>
              {segments.map((seg, i) => {
                const state = i < done ? "done" : i === done && !finished ? "current" : "todo";
                return (
                  <tr key={seg.key} className={cx(ui.tr, state === "current" && "bg-brand-soft", state === "todo" && "text-ink-3")}>
                    <td className="p-2 font-display font-extrabold">{seg.n}</td>
                    <td className="p-2 font-bold">{seg.kind === "run" ? "🏃 " : ""}{seg.label}</td>
                    <td className="p-2 text-ink-2">{seg.detail}</td>
                    <td className="p-2 text-right tabular-nums">{i < done ? fmt(times[i]) : ""}</td>
                    <td className="p-2 text-right tabular-nums font-bold">{i < done ? fmt(splits[i]) : ""}</td>
                  </tr>
                );
              })}
              {cindy.map((c, i) => (
                <tr key={`cindy${i}`} className={`${ui.tr} text-success-ink`}>
                  <td className="p-2 font-display font-extrabold">C{i + 1}</td>
                  <td className="p-2 font-bold" colSpan={2}>Tour de Cindy</td>
                  <td className="p-2 text-right tabular-nums">{fmt(c)}</td>
                  <td className="p-2 text-right tabular-nums font-bold">{fmt(c - (i ? cindy[i - 1] : finishedMs ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Onglet cartes jaunes : choisir l'equipe, confirmer. Une carte ajoute penSec secondes au temps.
function CardsView({ states, teams, sessionId, phase, penSec, onRun, pending }: { states: Map<string, HXTeamState>; teams: HXContext["teams"]; sessionId: string; phase: Phase; penSec: number; onRun: (a: () => Promise<ActionResult>) => void; pending: boolean }) {
  return (
    <div>
      <p className={`${ui.hint} mb-3`}>Touche une équipe pour lui donner une carte jaune ({penSec} s ajoutées à son temps). « retirer » enlève la dernière.</p>
      {phase === "pre" && <p className={`${ui.alertWarn} mb-3`}>Les cartes jaunes se donnent une fois la course lancée.</p>}
      <div className="grid grid-cols-5 gap-2">
        {teams.map((team) => {
          const st = states.get(team.id)!;
          return (
            <div key={team.id} className={cx("rounded-2xl border p-2.5 min-h-[96px] flex flex-col", st.cards ? "bg-yellow-50 border-yellow-400" : "bg-card border-line")}>
              <button onClick={() => { if (confirm(`Carte jaune pour ${team.name} ?`)) onRun(() => hxCardAction(sessionId, team.id, 1)); }} disabled={pending || phase === "pre"} className="text-left flex-1 disabled:opacity-50">
                <span className="font-display text-[30px] font-extrabold leading-none">{team.order}</span>
                <span className="block text-[11px] text-ink-2 truncate">{team.members.map((m) => m.name).join(" & ") || "—"}</span>
                <span className="block font-bold mt-1">🟨 ×{st.cards}{st.cards ? <span className="text-xs text-ink-3 font-normal"> (+{fmt(st.penMs)})</span> : null}</span>
              </button>
              {st.cards > 0 && <button onClick={() => onRun(() => hxCardAction(sessionId, team.id, -1))} disabled={pending} className={`${btn.smGhost} mt-1 self-start`}>retirer</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Deux classements separes (Sartay) : le temps du WOD, et les tours de Cindy. Le bareme de bonus viendra plus tard.
function ResultsView({ ctx, hasData }: { ctx: HXContext; hasData: boolean }) {
  const thR = `${ui.th} text-right`;
  if (!hasData) return <p className={`${ui.muted} py-4`}>Rien à afficher. Encode tes équipes, puis lance la course.</p>;
  let rank = 0;
  const members = (t: HXContext["teams"][number]) => t.members.map((m) => m.name).join(" & ");
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 items-start">
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>⏱ Classement au temps</h3>
        <p className={`${ui.hint} mb-2`}>Temps à la dernière station, + {ctx.settings.penSec} s par carte jaune. Les équipes non arrivées suivent, classées par segments faits.</p>
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead><tr><th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={ui.th}>Élèves</th><th className={thR}>Départ</th><th className={thR}>Stations</th><th className={thR}>Runs</th><th className={thR}>Temps</th><th className={thR}>🟨</th><th className={thR}>Score</th></tr></thead>
            <tbody>
              {timeRows(ctx).map((st) => {
                if (st.scoreMs !== null) rank++;
                return (
                  <tr key={st.team.id} className={`${ui.tr} text-right tabular-nums`}>
                    <td className="p-2 text-left font-display font-extrabold">{st.scoreMs !== null ? rank : "—"}</td>
                    <td className="p-2 text-left font-bold">{st.team.name}</td>
                    <td className="p-2 text-left text-ink-2">{members(st.team) || "—"}</td>
                    <td className="p-2">{st.startIndex + 1}</td>
                    <td className="p-2">{st.stationsDone}/{ctx.settings.stations.length}</td>
                    <td className="p-2">{st.runsDone}</td>
                    <td className="p-2">{st.finishedMs !== null ? fmt(st.finishedMs) : st.lastMs !== null ? `(${fmt(st.lastMs)})` : "—"}</td>
                    <td className="p-2">{st.cards ? `×${st.cards} (+${fmt(st.penMs)})` : ""}</td>
                    <td className="p-2 font-extrabold">{st.scoreMs !== null ? fmt(st.scoreMs) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>💪 Classement Cindy</h3>
        <p className={`${ui.hint} mb-2`}>{ctx.settings.cindyLabel} · tours validés après le parcours ; à égalité, l&apos;arrivée la plus rapide devant.</p>
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead><tr><th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={thR}>Tours</th><th className={thR}>Temps WOD</th></tr></thead>
            <tbody>
              {cindyRows(ctx).map((st, i) => (
                <tr key={st.team.id} className={`${ui.tr} text-right tabular-nums`}>
                  <td className="p-2 text-left font-display font-extrabold">{st.cindy.length ? i + 1 : "—"}</td>
                  <td className="p-2 text-left font-bold">{st.team.name}</td>
                  <td className="p-2 font-extrabold">{st.cindy.length}</td>
                  <td className="p-2">{st.scoreMs !== null ? fmt(st.scoreMs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Tableau de statistiques d'un type de segment : equipes passees, meilleur, moyen.
function StatTable({ title, rows }: { title: string; rows: HXStat[] }) {
  const thR = `${ui.th} text-right`;
  return (
    <div>
      <h3 className={`${ui.h3} mb-1.5`}>{title}</h3>
      <div className={`${ui.card} overflow-auto`}>
        <table className="w-full text-[13px] border-collapse whitespace-nowrap">
          <thead><tr><th className={ui.th}>Segment</th><th className={thR}>Équipes</th><th className={thR}>Meilleur</th><th className={thR}>Moyen</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key} className={`${ui.tr} text-right tabular-nums`}>
                <td className="p-2 text-left font-bold">{s.label}</td><td className="p-2">{s.n}</td><td className="p-2 font-extrabold text-success-ink">{s.best !== null ? fmt(s.best) : "—"}</td><td className="p-2">{s.avg !== null ? fmt(s.avg) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Statistiques : par station et par run (meilleur, moyen), puis le detail des durees par equipe.
function StatsView({ ctx }: { ctx: HXContext }) {
  const stats = useMemo(() => segmentStats(ctx), [ctx]);
  const thR = `${ui.th} text-right`;
  const nRuns = stats.runs.length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <StatTable title="Stations" rows={stats.stations} />
        <StatTable title="Runs" rows={stats.runs} />
      </div>
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>Durées par équipe</h3>
        <p className={`${ui.hint} mb-2`}>S1…S{ctx.settings.stations.length} = durée passée à chaque station (dans l&apos;ordre des stations, pas du parcours de l&apos;équipe) ; R1…R{nRuns} = runs dans l&apos;ordre du parcours.</p>
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[12px] border-collapse whitespace-nowrap">
            <thead>
              <tr>
                <th className={ui.th}>Équipe</th>
                {ctx.settings.stations.map((s, i) => <th key={s.id} className={thR} title={s.label}>S{i + 1}</th>)}
                {stats.runs.map((r, i) => <th key={r.key} className={thR}>R{i + 1}</th>)}
                <th className={thR}>Temps</th><th className={thR}>Cindy</th>
              </tr>
            </thead>
            <tbody>
              {[...ctx.teams].sort((a, b) => a.order - b.order).map((t) => {
                const st = teamState(ctx, t);
                const d = stats.byTeam[t.id] ?? {};
                return (
                  <tr key={t.id} className={`${ui.tr} text-right tabular-nums`}>
                    <td className="p-2 text-left font-bold">{t.name}</td>
                    {ctx.settings.stations.map((s) => <td key={s.id} className="p-2">{d[`st:${s.id}`] !== undefined ? fmt(d[`st:${s.id}`]) : ""}</td>)}
                    {stats.runs.map((r) => <td key={r.key} className="p-2">{d[r.key] !== undefined ? fmt(d[r.key]) : ""}</td>)}
                    <td className="p-2 font-extrabold">{st.finishedMs !== null ? fmt(st.finishedMs) : ""}</td>
                    <td className="p-2">{st.cindy.length || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Reglages de la seance : les 8 stations (libelle, reps, unite), le run, le temps limite, la carte jaune, Cindy, le
// nombre d'equipes. Stations et runs se figent a la premiere validation.
function SettingsSheet({ sessionId, settings, locked, numTeams, canResize, onClose, onSaved }: { sessionId: string; settings: HXSettings; locked: boolean; numTeams: number; canResize: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<HXSettingsInput>({
    stations: settings.stations.map((s) => ({ label: s.label, reps: s.reps, unit: s.unit })),
    runLabel: settings.runLabel,
    runDetail: settings.runDetail,
    runAfterLast: settings.runAfterLast,
    capMin: settings.capMin,
    penSec: settings.penSec,
    cindyLabel: settings.cindyLabel,
  });
  const [teams, setTeams] = useState(numTeams);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const setStation = (i: number, patch: Partial<HXSettingsInput["stations"][number]>) => setForm((f) => ({ ...f, stations: f.stations.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));

  function save() {
    setError("");
    startTransition(async () => {
      const res = await hxSettingsAction(sessionId, form);
      if ("error" in res) { setError(res.error); return; }
      if (canResize && teams !== numTeams) {
        const r2 = await setTeamCountAction(sessionId, teams);
        if ("error" in r2) { setError(r2.error); return; }
      }
      onSaved();
    });
  }

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className={ui.h2}>⚙️ Réglages du Hyrox</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {locked && <p className={`${ui.alertWarn} mb-3`}>Des validations existent déjà : les stations et les runs sont figés. Temps limite, carte jaune et libellé de Cindy restent modifiables.</p>}
        {error && <p className={`${ui.alertErr} mb-3`}>{error}</p>}

        <p className="text-sm font-bold mb-1">Les {form.stations.length} stations</p>
        <div className="space-y-1.5 mb-4">
          {form.stations.map((s, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_80px_90px] gap-1.5 items-center">
              <span className="font-display font-extrabold text-lg text-ink-3">{i + 1}</span>
              <input value={s.label} disabled={locked} onChange={(e) => setStation(i, { label: e.target.value })} className={ui.input} placeholder="Exercice" />
              <input type="number" min={0} value={s.reps} disabled={locked} onChange={(e) => setStation(i, { reps: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${ui.input} text-right`} />
              <select value={s.unit} disabled={locked} onChange={(e) => setStation(i, { unit: e.target.value })} className={ui.input}>
                {HX_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                {!(HX_UNITS as readonly string[]).includes(s.unit) && <option value={s.unit}>{s.unit}</option>}
              </select>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 mb-2">
          <label className="text-xs"><span className={ui.label}>Nom du run</span><input value={form.runLabel} disabled={locked} onChange={(e) => setForm({ ...form, runLabel: e.target.value })} className={ui.input} /></label>
          <label className="text-xs"><span className={ui.label}>Ce qu&apos;est un run (affiché aux élèves)</span><input value={form.runDetail} onChange={(e) => setForm({ ...form, runDetail: e.target.value })} className={ui.input} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm mb-4"><input type="checkbox" checked={form.runAfterLast} disabled={locked} onChange={(e) => setForm({ ...form, runAfterLast: e.target.checked })} className={ui.check} /> Un run aussi après la dernière station (sinon : {form.stations.length - 1} runs, entre les stations)</label>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <label className="text-xs"><span className={ui.label}>Temps limite (min)</span><input type="number" min={5} max={180} value={form.capMin} onChange={(e) => setForm({ ...form, capMin: parseInt(e.target.value, 10) || 50 })} className={ui.input} /></label>
          <label className="text-xs"><span className={ui.label}>Carte jaune (s)</span><input type="number" min={0} max={600} value={form.penSec} onChange={(e) => setForm({ ...form, penSec: parseInt(e.target.value, 10) || 0 })} className={ui.input} /></label>
          <label className="text-xs col-span-2"><span className={ui.label}>Cindy (après le parcours)</span><input value={form.cindyLabel} onChange={(e) => setForm({ ...form, cindyLabel: e.target.value })} className={ui.input} /></label>
        </div>
        <label className="text-xs block mb-4"><span className={ui.label}>Nombre d&apos;équipes {canResize ? "" : "(figé : course lancée)"}</span><input type="number" min={1} max={50} value={teams} disabled={!canResize} onChange={(e) => setTeams(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))} className={`${ui.input} w-28`} /></label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btn.ghost}>Annuler</button>
          <button onClick={save} disabled={pending} className={btn.primary}>{pending ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}
