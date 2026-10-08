"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  AMRAP_MAX_EXERCISES, AMRAP_UNITS, amountText, amrapCapMs, amrapCsv, fmt, rankRows, ranks, teamState,
  type AmrapContext, type AmrapLap, type AmrapSettings, type AmrapTeamState,
} from "@/lib/wod-engines/templates/amrap-engine";
import type { AmrapBundle } from "@/lib/amrap-context";
import { resetSessionAction, startRaceAction, togglePauseAction, deleteLapAction, undoLastAction } from "./race-actions";
import { finishRaceAction } from "./actions";
import { amrapCapFinishAction, amrapLapAction, amrapSettingsAction } from "./amrap-actions";
import { setTeamCountAction } from "./settings-actions";
import { greffierPulseAction } from "@/lib/pulse";
import { usePulse } from "../_components/usePulse";
import { TeamsManager, type TeamWithMembers, type RefereeView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import type { PendingRequest } from "./referee-decisions";
import { SessionStep, sessionDay, type SessionOption } from "./client";
import { btn, cx, ui } from "@/lib/ui";

type View = "race" | "results" | "teams";
type Phase = "pre" | "run" | "post";
type ActionResult = { error: string } | { ok: true };
const COLS = 5;
const MEDALS = ["🥇", "🥈", "🥉"];
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// Greffier « AMRAP » (Sartay 08/10) : le plus de tours possible en 20 minutes. Chrono a rebours en haut, une fiche par
// equipe (5 colonnes, tout l'ecran) : UN CLIC = un tour de plus, quand l'equipe vient a l'ordi a la fin de son tour.
// « ⋯ » ouvre le detail (temps de chaque tour, annuler un tour). A droite : le circuit. A la fin du temps, la course
// s'arrete toute seule. Ecran PC projete.
export function AmrapClient({
  sessionId, sessionLabel, sessionOptions, olderSession, newerSession, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, picker, showConsole = false,
}: {
  showConsole?: boolean;
  sessionId: string;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  olderSession: SessionOption | null;
  newerSession: SessionOption | null;
  bundle: AmrapBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  pendingRequests: PendingRequest[];
  picker: PickerData;
}) {
  const router = useRouter();
  const { ctx, startedAtMs, endedAtMs, pauses } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);
  const isPaused = pauses.some((p) => p.to === null);
  const phase: Phase = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  const [view, setView] = useState<View>(phase === "pre" && memberCount === 0 ? "teams" : "race");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase, isPaused]);
  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(h);
  }, [flash]);

  const pulse = useCallback(() => greffierPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 10000, phase !== "post" && !openTeamId && !pending);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    return elapsed(startedAtMs, pauses, phase === "post" ? endedAtMs! : now) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);
  const capMs = amrapCapMs(ctx.settings);
  const remainMs = capMs - liveMs;

  // Fin du temps : la course s'arrete toute seule. Le serveur reverifie avec son horloge ; s'il dit « pas encore »
  // (PC en avance), on redemande 2 s plus tard.
  const capReached = phase === "run" && !isPaused && remainMs <= 0;
  const [capTry, setCapTry] = useState(0);
  const capAsked = useRef(-1);
  useEffect(() => {
    if (!capReached || capAsked.current === capTry) return;
    capAsked.current = capTry;
    amrapCapFinishAction(sessionId).then((res) => {
      if ("error" in res) { setError(res.error); return; }
      if (!res.ended) { setTimeout(() => setCapTry((n) => n + 1), 2000); return; }
      router.refresh();
    });
  }, [capReached, capTry, sessionId, router]);

  // Tours OPTIMISTES : au clic, la fiche gagne son tour tout de suite ; le serveur confirme ensuite. On retient, par
  // equipe, le nombre de tours attendu et l'heure de chaque clic en attente ; des que le serveur a rattrape, l'entree
  // tombe (pendant le rendu, quand le bundle change).
  const [local, setLocal] = useState<Record<string, { count: number; ats: number[] }>>({});
  const [seenBundle, setSeenBundle] = useState(bundle);
  const serverCount = (laps: AmrapLap[], teamId: string) => laps.filter((l) => l.teamId === teamId).length;
  if (seenBundle !== bundle) {
    setSeenBundle(bundle);
    setLocal((l) => Object.fromEntries(Object.entries(l).filter(([teamId, x]) => serverCount(bundle.ctx.laps, teamId) < x.count)));
  }
  const liveCtx = useMemo<AmrapContext>(() => {
    const extra: AmrapLap[] = [];
    for (const [teamId, x] of Object.entries(local)) {
      const missing = x.count - serverCount(ctx.laps, teamId);
      if (missing > 0) x.ats.slice(-missing).forEach((at, i) => extra.push({ id: `local-${teamId}-${i}`, teamId, at, abs: null }));
    }
    return extra.length ? { ...ctx, laps: [...ctx.laps, ...extra] } : ctx;
  }, [ctx, local]);

  const teams = useMemo(() => [...ctx.teams].sort((a, b) => a.order - b.order), [ctx.teams]);
  const states = useMemo(() => new Map(liveCtx.teams.map((t) => [t.id, teamState(liveCtx, t)])), [liveCtx]);
  const ranking = useMemo(() => rankRows(liveCtx), [liveCtx]);
  const rankOf = useMemo(() => {
    const r = ranks(ranking);
    return new Map(ranking.map((st, i) => [st.team.id, st.laps > 0 ? r[i] : null]));
  }, [ranking]);
  const startByTeam = useMemo(() => Object.fromEntries(teams.map((t) => { const i = states.get(t.id)!.startIndex; return [t.id, { number: i + 1, label: ctx.settings.exercises[i]?.label ?? "" }]; })), [teams, states, ctx.settings.exercises]);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 1200);
  }
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  function run(action: () => Promise<ActionResult>) {
    setError("");
    startTransition(async () => {
      const res = await action();
      if ("error" in res) setError(res.error);
      else {
        setLocal({});
        router.refresh();
      }
    });
  }
  function lap(teamId: string) {
    setError("");
    if (capReached) { setError("Le temps est écoulé : le tour en cours ne compte pas."); return; }
    const at = liveMs;
    const count = serverCount(ctx.laps, teamId);
    setLocal((l) => ({ ...l, [teamId]: { count: Math.max(l[teamId]?.count ?? 0, count) + 1, ats: [...(l[teamId]?.ats ?? []), at] } }));
    setFlash(teamId);
    startTransition(async () => {
      const res = await amrapLapAction(sessionId, teamId);
      if ("error" in res) {
        setLocal((l) => {
          const cur = l[teamId];
          if (!cur) return l;
          const rest = { ...l };
          if (cur.ats.length <= 1) delete rest[teamId];
          else rest[teamId] = { count: cur.count - 1, ats: cur.ats.slice(0, -1) };
          return rest;
        });
        setError(res.error);
        return;
      }
      scheduleRefresh();
    });
  }
  function handleStart() {
    if (memberCount === 0 && !confirm("Aucun élève n'est encodé dans les équipes. Lancer le chrono quand même ?")) return;
    run(() => startRaceAction(sessionId));
  }
  function handleReset() {
    if (!confirm("Remettre ce WOD à zéro ? Chrono et tours seront effacés. Les équipes et les réglages restent, et la séance est rouverte.")) return;
    if (!confirm("Vraiment ? Les tours de ce WOD seront perdus, sans retour en arrière.")) return;
    run(() => resetSessionAction(sessionId));
  }
  function handleFinish() {
    if (!confirm("Arrêter le WOD maintenant ? Le classement est figé avec les tours déjà validés.")) return;
    setError("");
    startTransition(async () => {
      try {
        await finishRaceAction(sessionId);
        router.refresh();
      } catch (e) {
        setError("Impossible de terminer : " + (e instanceof Error ? e.message : String(e)));
      }
    });
  }
  function handleUndo() {
    const last = [...ctx.laps].sort((a, b) => b.at - a.at)[0];
    if (!last) return;
    const team = ctx.teams.find((t) => t.id === last.teamId);
    if (!confirm(`Annuler le dernier tour validé : ${team?.name ?? "équipe"} (${fmt(last.at)}) ?`)) return;
    run(() => undoLastAction(sessionId));
  }
  function exportCsv() {
    const csv = amrapCsv(ctx, liveMs, phase === "post" ? "termine" : isPaused ? "en pause" : phase === "run" ? "en cours" : "pas commence");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (n: number) => (n < 10 ? "0" : "") + n;
    a.href = url;
    a.download = `amrap_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const openSt = openTeamId ? states.get(openTeamId) ?? null : null;
  const tabBtn = (on: boolean) => cx("text-xs font-bold px-2.5 py-1 rounded-lg transition", on ? ui.segOn : ui.segOff);
  const rows = Math.max(1, Math.ceil(teams.length / COLS));
  const totalLaps = liveCtx.laps.filter((l) => l.at <= capMs).length;

  return (
    <div className={cx(ui.page, "h-dvh flex flex-col overflow-hidden")}>
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      <header className="shrink-0 z-20 bg-card/95 backdrop-blur border-b border-line px-3 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <span className={ui.eyebrow}>Greffier · AMRAP {ctx.settings.capMin} min</span>
              <div className="flex items-center gap-1.5 min-w-0">
                <SessionStep to={olderSession} dir="older" />
                {sessionOptions.length > 1 ? (
                  <select value={sessionId} onChange={(e) => router.push(`/greffier?session=${e.target.value}`)} className={`${ui.input} w-auto max-w-[260px] py-1 text-sm font-bold`}>
                    {sessionOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? " — ouverte" : ` — ${sessionDay(o.dateMs)}`}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm font-bold leading-tight">{sessionLabel}{classes.length > 0 && <span className="text-ink-2 font-semibold"> · {classes.join(", ")}</span>}</p>
                )}
                <SessionStep to={newerSession} dir="newer" />
              </div>
            </div>
            <div className="flex items-end gap-3">
              {/* Compte a rebours : le temps qu'il reste, en grand (le temps ecoule en petit). */}
              <p className={cx("font-display text-[2.6rem] font-extrabold leading-none tracking-tight tabular-nums", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : remainMs <= 60_000 && phase === "run" ? "text-danger" : "text-ink")}>
                {phase === "pre" ? `${ctx.settings.capMin}:00` : fmt(Math.max(0, remainMs)) || "0:00"}
              </p>
              <div className="pb-0.5 leading-tight">
                {phase !== "pre" && <p className="font-display text-lg font-extrabold tabular-nums text-ink-3">{fmt(Math.min(liveMs, capMs)) || "0:00"} écoulées</p>}
                <p className={cx("text-[11px]", isPaused ? "text-accent-ink font-bold" : "text-ink-2")}>
                  {phase === "pre" ? `Chrono à l'arrêt · ${ctx.settings.capMin} min · ${plural(ctx.settings.exercises.length, "exercice", "exercices")} par tour` : phase === "post" ? `WOD terminé · ${plural(totalLaps, "tour", "tours")} en tout` : isPaused ? "EN PAUSE — tours bloqués" : "Un clic sur la fiche = un tour de plus"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {phase === "pre" && (
              <>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.smGhost}>⚙️ Réglages</button>
                <button onClick={handleStart} disabled={pending} className={btn.smSuccess}>▶ Début du WOD</button>
              </>
            )}
            {phase === "run" && (
              <>
                <button onClick={() => run(() => togglePauseAction(sessionId))} disabled={pending} className={isPaused ? btn.smSuccess : btn.accent}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleUndo} disabled={pending || ctx.laps.length === 0} className={btn.smGhost} title="Annuler le tout dernier tour validé (quelle que soit l'équipe)">↶ Annuler</button>
                <button onClick={handleFinish} disabled={pending} className={btn.smDanger}>Fin du WOD</button>
                <button onClick={handleReset} disabled={pending} className={btn.smGhost} title="Lancé par erreur : tout remettre à zéro (double confirmation)">↺</button>
              </>
            )}
            {phase === "post" && (
              <>
                <span className={`${ui.btnSm} bg-success-soft text-success-ink`}>🏁 WOD terminé</span>
                <button onClick={handleReset} disabled={pending} className={btn.smGhost} title="Terminé par erreur : tout remettre à zéro (double confirmation)">↺ Remettre à zéro</button>
              </>
            )}
            <a href={`/admin/amrap/dias?session=${sessionId}`} target="_blank" rel="noopener" className={btn.smGhost} title="Les dias à projeter : le principe, le circuit, les exercices">📄 Dias ↗</a>
            {showConsole && <a href="/admin" target="_blank" rel="noopener" className={btn.smGhost} title="Ouvrir la console dans un nouvel onglet : le WOD reste ouvert ici">🏠 Console ↗</a>}
            <button onClick={exportCsv} className={btn.smGhost} title="Exporter vers Excel (CSV)">⬇ Excel</button>
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-1 py-1 text-sm`}>{error}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <div className={`${ui.segmented} flex-wrap`}>
            <button onClick={() => setView("race")} className={tabBtn(view === "race")}>Course</button>
            <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Classement</button>
            <button onClick={() => setView("teams")} className={tabBtn(view === "teams")}>
              Équipes &amp; arbitres <span className={cx(ui.chip, "ml-1", memberCount ? ui.chipOk : ui.chipWarn)}>{memberCount}</span>
            </button>
          </div>
        </div>
      </header>

      <main className={cx("flex-1 min-h-0 w-full max-w-[1900px] mx-auto", view === "race" ? "p-2" : "p-4 overflow-auto")}>
        {view === "race" && (
          teams.length === 0 ? (
            <p className={`${ui.muted} py-6 text-center`}>Aucune équipe : règle le nombre d&apos;équipes dans ⚙️ Réglages.</p>
          ) : (
            <div className="flex h-full gap-1.5">
              <div className="grid flex-1 min-w-0 h-full gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
                {teams.map((team) => {
                  const st = states.get(team.id)!;
                  return (
                    <Tile
                      key={team.id}
                      st={st}
                      rank={rankOf.get(team.id) ?? null}
                      start={startByTeam[team.id]}
                      phase={phase}
                      liveMs={Math.min(liveMs, capMs)}
                      compact={rows >= 5}
                      flashing={flash === team.id}
                      disabled={isPaused || pending && flash === team.id}
                      onClick={() => (phase === "run" ? lap(team.id) : setOpenTeamId(team.id))}
                      onMore={() => setOpenTeamId(team.id)}
                    />
                  );
                })}
              </div>
              <CircuitColumn settings={ctx.settings} />
            </div>
          )
        )}
        {view === "results" && <ResultsView ranking={ranking} settings={ctx.settings} hasData={phase !== "pre"} />}
        {view === "teams" && (
          <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} startByTeam={startByTeam} picker={picker} />
        )}
      </main>

      {settingsOpen && (
        <SettingsSheet sessionId={sessionId} settings={ctx.settings} numTeams={ctx.teams.length} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); router.refresh(); }} />
      )}
      {openSt && (
        <TeamPanel key={openSt.team.id} st={openSt} laps={liveCtx.laps.filter((l) => l.teamId === openSt.team.id).sort((a, b) => a.at - b.at)} settings={ctx.settings} sessionId={sessionId} phase={phase} isPaused={isPaused} onLap={() => lap(openSt.team.id)} onClose={() => { setOpenTeamId(null); router.refresh(); }} />
      )}
    </div>
  );
}

function Tile({ st, rank, start, phase, liveMs, compact, flashing, disabled, onClick, onMore }: { st: AmrapTeamState; rank: number | null; start: { number: number; label: string }; phase: Phase; liveMs: number; compact: boolean; flashing: boolean; disabled: boolean; onClick: () => void; onMore: () => void }) {
  const since = phase === "run" ? liveMs - (st.lastMs ?? 0) : null;
  const medal = rank !== null && rank <= 3 ? MEDALS[rank - 1] : null;
  return (
    <div className={cx("relative min-h-0 rounded-2xl border-2 transition-colors overflow-hidden", flashing ? "bg-success border-success text-white" : st.laps > 0 ? "bg-card border-brand/40" : "bg-card border-line")}>
      <button type="button" onClick={onClick} disabled={disabled} className="absolute inset-0 w-full h-full flex flex-col justify-between text-left p-2 disabled:opacity-60">
        <span className="flex items-center gap-1.5 min-w-0 pr-7">
          <span className={cx("font-display font-extrabold uppercase tracking-wider truncate", compact ? "text-xs" : "text-sm")}>{st.team.name}</span>
          {medal && <span className="text-base leading-none">{medal}</span>}
          {rank !== null && !medal && <span className="text-[11px] font-bold text-ink-3">{rank}e</span>}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className={cx("font-display font-extrabold leading-none tabular-nums", compact ? "text-4xl" : "text-6xl")}>{st.laps}</span>
          <span className={cx("font-bold", compact ? "text-xs" : "text-sm")}>{st.laps > 1 ? "tours" : "tour"}</span>
          {since !== null && <span className={cx("ml-auto font-display font-bold tabular-nums", compact ? "text-sm" : "text-lg", flashing ? "text-white" : "text-ink-3")} title="Depuis le dernier tour (ou le départ)">⏱ {fmt(since)}</span>}
        </span>
        <span className={cx("truncate", compact ? "text-[10px]" : "text-[11px]", flashing ? "text-white/90" : "text-ink-2")}>
          départ {start.number} · {start.label}{st.team.members.length ? ` · ${st.team.members.map((m) => m.name.split(" ")[0]).join(", ")}` : ""}
        </span>
      </button>
      <button type="button" onClick={onMore} className="absolute top-1 right-1 w-7 h-7 rounded-lg bg-paper/80 text-ink-2 font-bold text-sm hover:bg-paper" title="Détail : temps de chaque tour, annuler un tour">⋯</button>
    </div>
  );
}

function CircuitColumn({ settings }: { settings: AmrapSettings }) {
  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 rounded-2xl border border-line bg-card p-2 min-h-0 overflow-auto">
      <p className={`${ui.eyebrow} mb-1`}>Un tour = {settings.exercises.length} exercices</p>
      <ol className="space-y-1">
        {settings.exercises.map((e, i) => (
          <li key={e.id} className="flex items-center gap-2 text-sm">
            <span className="w-6 h-6 shrink-0 rounded-md bg-brand text-white text-xs font-extrabold flex items-center justify-center">{i + 1}</span>
            <span className="font-bold truncate flex-1">{e.label}</span>
            <span className="text-ink-2 text-xs whitespace-nowrap">{amountText(e)}</span>
          </li>
        ))}
      </ol>
      <p className={`${ui.hint} mt-2`}>{settings.staggered ? "Départ décalé : chaque équipe commence à SON exercice, puis suit l'ordre." : "Tout le monde commence au 1."} Fin du tour : l&apos;équipe vient à l&apos;ordi.</p>
    </aside>
  );
}

function ResultsView({ ranking, settings, hasData }: { ranking: AmrapTeamState[]; settings: AmrapSettings; hasData: boolean }) {
  const r = ranks(ranking);
  if (!hasData) return <p className={`${ui.muted} py-6 text-center`}>Le classement apparaîtra dès le début du WOD.</p>;
  return (
    <div className={`${ui.cardPad} max-w-4xl mx-auto`}>
      <h3 className={`${ui.h3} mb-1`}>Classement · AMRAP {settings.capMin} min</h3>
      <p className={`${ui.hint} mb-3`}>Le plus de tours ; à égalité, l&apos;équipe qui les a bouclés le plus tôt.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={`${ui.th} text-right`}>Tours</th><th className={`${ui.th} text-right`}>Dernier tour à</th><th className={`${ui.th} text-right`}>Tour moyen</th><th className={`${ui.th} text-right`}>Meilleur tour</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((st, i) => (
              <tr key={st.team.id} className="border-t border-line">
                <td className="p-2 font-bold">{st.laps ? (r[i] <= 3 ? MEDALS[r[i] - 1] : r[i]) : "—"}</td>
                <td className="p-2"><b>{st.team.name}</b>{st.team.members.length > 0 && <span className="text-ink-2"> · {st.team.members.map((m) => m.name).join(", ")}</span>}</td>
                <td className="p-2 text-right font-display text-lg font-extrabold tabular-nums">{st.laps}</td>
                <td className="p-2 text-right tabular-nums">{fmt(st.lastMs)}</td>
                <td className="p-2 text-right tabular-nums">{fmt(st.avgMs)}</td>
                <td className="p-2 text-right tabular-nums">{fmt(st.bestMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamPanel({ st, laps, settings, sessionId, phase, isPaused, onLap, onClose }: { st: AmrapTeamState; laps: AmrapLap[]; settings: AmrapSettings; sessionId: string; phase: Phase; isPaused: boolean; onLap: () => void; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  function remove(l: AmrapLap, n: number) {
    if (l.id.startsWith("local-")) return;
    if (!confirm(`Annuler le tour ${n} de ${st.team.name} (${fmt(l.at)}) ?`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteLapAction(sessionId, l.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  const order = settings.exercises.map((_, i) => settings.exercises[(st.startIndex + i) % settings.exercises.length]);
  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={cx(ui.sheet, "sm:max-w-xl")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className={ui.h3}>{st.team.name} · {plural(st.laps, "tour", "tours")}</h2>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {st.team.members.length > 0 && <p className={`${ui.muted} mb-2`}>{st.team.members.map((m) => m.name).join(", ")}</p>}
        <p className={`${ui.hint} mb-3`}>Son tour : {order.map((e) => e.label).join(" → ")}</p>
        {error && <p className={`${ui.alertErr} mb-2`}>{error}</p>}
        {laps.length === 0 ? (
          <p className={ui.muted}>Aucun tour validé.</p>
        ) : (
          <ul className="divide-y divide-line mb-3">
            {laps.map((l, i) => {
              const split = l.at - (i ? laps[i - 1].at : 0);
              const quick = i > 0 && split < 90_000;
              return (
                <li key={l.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="font-bold w-16">Tour {i + 1}</span>
                  <span className="tabular-nums w-20">à {fmt(l.at)}</span>
                  <span className={cx("tabular-nums flex-1", quick ? "text-danger-ink font-bold" : "text-ink-2")}>en {fmt(split)}{quick ? " (rapide !)" : ""}</span>
                  {!l.id.startsWith("local-") && <button onClick={() => remove(l, i + 1)} disabled={pending} className={btn.smGhost}>Annuler</button>}
                </li>
              );
            })}
          </ul>
        )}
        {phase === "run" && <button onClick={() => { onLap(); onClose(); }} disabled={pending || isPaused} className={btn.primary}>+1 tour</button>}
      </div>
    </div>
  );
}

function SettingsSheet({ sessionId, settings, numTeams, onClose, onSaved }: { sessionId: string; settings: AmrapSettings; numTeams: number; onClose: () => void; onSaved: () => void }) {
  const [capMin, setCapMin] = useState(settings.capMin);
  const [staggered, setStaggered] = useState(settings.staggered);
  const [list, setList] = useState(settings.exercises.map((e) => ({ label: e.label, reps: e.reps, unit: e.unit })));
  const [teamsN, setTeamsN] = useState(numTeams);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const set = (i: number, patch: Partial<(typeof list)[number]>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => setList((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  function save() {
    setError("");
    startTransition(async () => {
      const res = await amrapSettingsAction(sessionId, { capMin, staggered, exercises: list });
      if ("error" in res) { setError(res.error); return; }
      if (teamsN !== numTeams) {
        const t = await setTeamCountAction(sessionId, teamsN);
        if ("error" in t) { setError(t.error); return; }
      }
      onSaved();
    });
  }
  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={cx(ui.sheet, "sm:max-w-2xl")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className={ui.h3}>⚙️ Réglages de l&apos;AMRAP</h2>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {error && <p className={`${ui.alertErr} mb-2`}>{error}</p>}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="text-xs"><span className={ui.label}>Durée (minutes)</span><input type="number" min={5} max={60} value={capMin} onChange={(e) => setCapMin(Number(e.target.value))} className={ui.input} /></label>
          <label className="text-xs"><span className={ui.label}>Nombre d&apos;équipes</span><input type="number" min={1} max={50} value={teamsN} onChange={(e) => setTeamsN(Number(e.target.value))} className={ui.input} /></label>
        </div>
        <label className="flex items-start gap-2 text-sm mb-3"><input type="checkbox" checked={staggered} onChange={(e) => setStaggered(e.target.checked)} className={`${ui.check} mt-0.5`} /><span>Départ décalé : l&apos;équipe 1 commence au 1, la 2 au 2… (pas de bouchon aux exercices). Sinon, tout le monde commence au 1.</span></label>
        <p className={`${ui.label} mb-1`}>Le circuit (une info pour les élèves : l&apos;ordi ne compte que les tours)</p>
        <ul className="space-y-1.5 mb-2">
          {list.map((e, i) => (
            <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_5rem_5.5rem_auto_auto_auto] items-center gap-1.5">
              <span className="text-center font-bold text-sm">{i + 1}</span>
              <input value={e.label} onChange={(ev) => set(i, { label: ev.target.value })} placeholder="Exercice" className={`${ui.input} py-1`} />
              <input type="number" min={1} max={999} value={e.reps} onChange={(ev) => set(i, { reps: Number(ev.target.value) })} className={`${ui.input} py-1`} />
              <select value={e.unit} onChange={(ev) => set(i, { unit: ev.target.value })} className={`${ui.input} py-1`}>
                {AMRAP_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <button type="button" onClick={() => move(i, -1)} className={btn.smGhost} aria-label="Monter">↑</button>
              <button type="button" onClick={() => move(i, 1)} className={btn.smGhost} aria-label="Descendre">↓</button>
              <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} disabled={list.length <= 1} className={btn.smGhost} aria-label="Retirer">✕</button>
            </li>
          ))}
        </ul>
        {list.length < AMRAP_MAX_EXERCISES && <button type="button" onClick={() => setList((l) => [...l, { label: "", reps: 10, unit: "rép." }])} className={`${btn.smGhost} mb-3`}>+ Exercice</button>}
        <p className={`${ui.hint} mb-3`}>Les quantités comptent pour toute l&apos;équipe, qui se répartit le travail.</p>
        <div className="flex gap-2">
          <button onClick={save} disabled={pending} className={btn.primary}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
          <button onClick={onClose} className={btn.ghost}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
