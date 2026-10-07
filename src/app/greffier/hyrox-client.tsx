"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  HX_LEVELS, HX_MAX_LAPS, HX_MAX_RUN_PARTS, HX_MAX_STATIONS, HX_MIN_STATIONS, HX_UNITS, amountText, clockText, fmt, hxCsv, hxIntensity, hxLevelReps, hxStationKey, hxStationReps, parcoursTops, segmentLabel, segmentStats, teamState, timeRows,
  type HXCard, type HXContext, type HXEvent, type HXSettings, type HXStat, type HXTeamState, type HXTop,
} from "@/lib/wod-engines/templates/hyrox-engine";
import type { HXBundle, HXRecord } from "@/lib/hyrox-context";
import type { BoardData } from "@/lib/referee-board";
import { resetSessionAction, startRaceAction, togglePauseAction } from "./race-actions";
import { finishRaceAction } from "./actions";
import { hxCapFinishAction, hxCardAction, hxSetLevelAction, hxSetStartAction, hxSettingsAction, hxTapAction, hxUndoAction, hxUndoTeamAction, type HXSettingsInput } from "./hx-actions";
import { setTeamCountAction } from "./settings-actions";
import { setRaceStatus } from "@/lib/firebase/firebase-sync";
import { greffierPulseAction } from "@/lib/pulse";
import { usePulse } from "../_components/usePulse";
import { Snowfall } from "../_components/Snowfall";
import { EvalBaremeTable } from "../_components/EvalBareme";
import { EVAL_BASE_GROUP, EVAL_DEFAULT_STARS, evalGroupDefaultStars, evalNote, isEvalGroup, noteText, starsText } from "@/lib/eval-bareme";
import { evalExpectedMs } from "@/lib/eval-reference";
import { CARD_REASONS } from "@/lib/observation-types";
import type { Stars } from "@/lib/wod-engines/templates/level-engine";
import { TeamsManager, type TeamWithMembers, type RefereeView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { ArbitrageTab } from "./ArbitrageTab";
import type { PendingRequest } from "./referee-decisions";
import { SessionStep, sessionDay, type SessionOption } from "./client";
import { btn, cx, ui } from "@/lib/ui";

type View = "race" | "cards" | "results" | "stats" | "levels" | "teams" | "arbitrage";
type Phase = "pre" | "run" | "post";
type ActionResult = { error: string } | { ok: true } | { ok: true; key: string };
const COLS = 5;
// Une couleur par TOUR (Sartay 03/10) : tour 1 bleu, tour 2 violet (puis sarcelle, rose) ; le run est la nuance foncee.
const LAP_STYLE = [
  { station: "bg-brand text-white", run: "bg-sea text-white" },
  { station: "bg-violet-600 text-white", run: "bg-violet-900 text-white" },
  { station: "bg-teal-600 text-white", run: "bg-teal-800 text-white" },
  { station: "bg-rose-600 text-white", run: "bg-rose-800 text-white" },
];
const lapStyle = (lap: number) => LAP_STYLE[(Math.max(1, lap) - 1) % LAP_STYLE.length];
// Validations locales en attente de confirmation : nombre total attendu pour l'equipe, heure (ms ecoulees) de chaque clic.
type LocalTaps = { count: number; ats: number[] };
function eventCounts(events: HXEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) m.set(e.teamId, (m.get(e.teamId) ?? 0) + 1);
  return m;
}
const MEDALS = ["🥇", "🥈", "🥉"];

// Greffier « Eval » (WOD HYROX ; Sartay 01-03/10) : chrono et temps limite en haut, pave de 5 colonnes qui remplit
// l'ecran (toutes les equipes visibles d'un coup), chaque fiche = « ÉQUIPE X » (police panneau) + l'exercice en cours
// (police display) + un chrono depuis le dernier clic, dans la couleur de son tour. UN CLIC sur la fiche = validation,
// l'exercice suivant s'affiche aussitot ; « ⋯ » ouvre le detail. A droite : le top 3 de chaque station. Onglets cartes
// jaunes, classement au temps, statistiques. Ecran PC projete.
export function HyroxClient({
  sessionId, sessionLabel, sessionOptions, olderSession, newerSession, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, board, obsCounts = null, picker, showConsole = false, winter = false, records = null,
}: {
  showConsole?: boolean;
  winter?: boolean; // saison winter arc : flocons
  records?: Record<string, Record<number, HXRecord>> | null; // avant le depart : records des classes precedentes (station, parcours)
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
  obsCounts?: { observations: number; entries: number } | null; // arbitrage de l'Eval (observations d'eleves, series comptees)
  picker: PickerData;
}) {
  const router = useRouter();
  const { ctx, startedAtMs, endedAtMs, pauses, locked } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardSheet, setCardSheet] = useState(false); // 🟨 carte en un geste, sans quitter la course
  const [flash, setFlash] = useState<string | null>(null); // fiche qui vient d'etre validee (animation)
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);
  const isPaused = pauses.some((p) => p.to === null);
  const phase: Phase = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  const [view, setView] = useState<View>(phase === "pre" && memberCount === 0 ? "teams" : "race");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
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
    const ref = phase === "post" ? endedAtMs! : now;
    return elapsed(startedAtMs, pauses, ref) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);
  const capMs = ctx.settings.capMin * 60_000; // fin officielle
  const hardMin = ctx.settings.capMin + ctx.settings.extraMin;
  const remainMs = capMs - liveMs;
  const hardRemainMs = hardMin * 60_000 - liveMs;
  // Prolongation (Sartay 05/10 : « fin du wod officiel a 55 min, mais le chrono va jusqu'a 60 si jamais on a le
  // temps ») : passe la fin officielle, on valide encore, hors classement.
  const overtime = ctx.settings.extraMin > 0 && phase === "run" && remainMs <= 0;
  // Limite de temps (Sartay 05/10 : « le wod dure 50 minutes pour tout le monde ») : a la fin de la prolongation la
  // course s'arrete toute seule. Le serveur reverifie avec son horloge ; s'il dit « pas encore » (PC en avance), on
  // redemande 2 s plus tard.
  const capReached = phase === "run" && !isPaused && hardRemainMs <= 0;
  const [capTry, setCapTry] = useState(0);
  const capAsked = useRef(-1);
  useEffect(() => {
    if (!capReached || capAsked.current === capTry) return;
    capAsked.current = capTry;
    hxCapFinishAction(sessionId).then((res) => {
      if ("error" in res) { setError(res.error); return; }
      if (!res.ended) { setTimeout(() => setCapTry((n) => n + 1), 2000); return; }
      void setRaceStatus(sessionId, "TERMINATED");
      router.refresh();
    });
  }, [capReached, capTry, sessionId, router]);

  // Validation OPTIMISTE : au clic, la fiche passe tout de suite a l'exercice suivant et son chrono repart de l'instant
  // du clic ; le serveur confirme ensuite. Pour chaque equipe on retient le NOMBRE de validations attendu et l'heure de
  // chaque clic en attente : tant que le serveur en montre moins, on complete localement ; des qu'il a rattrape, l'entree
  // tombe (pattern « ajuster l'etat quand une prop change », pendant le rendu). Deux clics rapproches sur deux equipes ne
  // se marchent donc pas dessus, meme si leurs reponses arrivent dans le desordre.
  const [local, setLocal] = useState<Record<string, LocalTaps>>({});
  const [seenBundle, setSeenBundle] = useState(bundle);
  if (seenBundle !== bundle) {
    setSeenBundle(bundle);
    const counts = eventCounts(bundle.ctx.events);
    setLocal((l) => Object.fromEntries(Object.entries(l).filter(([teamId, x]) => (counts.get(teamId) ?? 0) < x.count)));
  }
  const liveCtx = useMemo<HXContext>(() => {
    const counts = eventCounts(ctx.events);
    const extra: HXEvent[] = [];
    for (const [teamId, x] of Object.entries(local)) {
      const t = ctx.teams.find((y) => y.id === teamId);
      const missing = x.count - (counts.get(teamId) ?? 0);
      if (!t || missing <= 0) continue;
      const st = teamState(ctx, t);
      x.ats.slice(-missing).forEach((at, i) => {
        const idx = st.done + i;
        if (idx < st.segments.length) extra.push({ id: `local-${teamId}-${i}`, teamId, key: st.segments[idx].key, at, abs: null });
      });
    }
    return extra.length ? { ...ctx, events: [...ctx.events, ...extra] } : ctx;
  }, [ctx, local]);

  const states = useMemo(() => new Map(liveCtx.teams.map((t) => [t.id, teamState(liveCtx, t)])), [liveCtx]);
  const teams = useMemo(() => [...ctx.teams].sort((a, b) => a.order - b.order), [ctx.teams]);
  // Top 3 par station : sur les validations confirmees par le serveur (pas les clics en attente).
  const stats = useMemo(() => segmentStats(ctx), [ctx]);
  // Station de depart annoncee aux eleves pendant l'encodage (onglet Equipes & arbitres, ecran projete).
  const startByTeam = useMemo(() => Object.fromEntries(teams.map((t) => { const s0 = states.get(t.id)!.segments[0]; return [t.id, { number: s0.stationNo, label: s0.short }]; })), [teams, states]);
  const totalCards = ctx.cards.length;
  const lastCard = totalCards ? ctx.cards.reduce((a, c) => (c.at > a.at ? c : a)) : null;

  function refresh() {
    router.refresh();
  }
  // Rechargement groupe apres des validations : la fiche est deja a jour localement, inutile de relancer tout le rendu
  // serveur a chaque clic (une equipe valide toutes les quelques secondes).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 1200);
  }
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  // Actions de l'en-tete (pause, annuler, remise a zero…) : les validations locales en attente sont oubliees, le serveur fait foi.
  function run(action: () => Promise<ActionResult>) {
    setError("");
    startTransition(async () => {
      const res = await action();
      if ("error" in res) setError(res.error);
      else {
        setLocal({});
        refresh();
      }
    });
  }
  // Un clic sur une fiche = le segment en cours est valide. Parcours fini : le clic ouvre le detail de l'equipe.
  function validate(teamId: string) {
    setError("");
    if (states.get(teamId)?.finishedMs != null) { setOpenTeamId(teamId); return; }
    if (capReached) { setError(`Temps limite atteint (${hardMin} min) : le WOD est terminé pour tout le monde.`); return; }
    const at = liveMs;
    const serverCount = eventCounts(ctx.events).get(teamId) ?? 0;
    setLocal((l) => ({ ...l, [teamId]: { count: Math.max(l[teamId]?.count ?? 0, serverCount) + 1, ats: [...(l[teamId]?.ats ?? []), at] } }));
    setFlash(teamId);
    startTransition(async () => {
      const res = await hxTapAction(sessionId, teamId);
      if ("error" in res) {
        // Refuse (double clic, pause…) : la validation locale est retiree, la fiche revient a l'etat du serveur.
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
    a.download = `eval_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const openSt = openTeamId ? states.get(openTeamId) ?? null : null;
  const tabBtn = (on: boolean) => cx("text-xs font-bold px-2.5 py-1 rounded-lg transition", on ? ui.segOn : ui.segOff);
  const rows = Math.max(1, Math.ceil(teams.length / COLS));
  const compact = rows >= 5;
  const laps = ctx.settings.laps;

  return (
    <div className={cx(ui.page, "h-dvh flex flex-col overflow-hidden")}>
      {winter && <Snowfall />}
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      {/* En-tete compact : tout tient sur deux lignes pour laisser l'ecran aux fiches. */}
      <header className="shrink-0 z-20 bg-card/95 backdrop-blur border-b border-line px-3 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <span className={ui.eyebrow}>Greffier · Eval S.O.R.O</span>
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
              <p className={cx("font-display text-[2.6rem] font-extrabold leading-none tracking-tight tabular-nums", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : "text-ink")}>{fmt(liveMs) || "0:00"}</p>
              <div className="pb-0.5 leading-tight">
                {phase !== "pre" && (
                  <p className={cx("font-display text-lg font-extrabold tabular-nums", remainMs <= 0 ? "text-danger" : remainMs < 5 * 60_000 ? "text-accent" : "text-ink-3")} title={`Fin officielle : ${ctx.settings.capMin} min${ctx.settings.extraMin ? ` · fin du chrono : ${hardMin} min` : ""}`}>
                    {overtime ? `prolongation · reste ${fmt(Math.max(0, hardRemainMs))}` : remainMs >= 0 ? `reste ${fmt(remainMs)}` : `+${fmt(-remainMs)} après ${ctx.settings.capMin} min`}
                  </p>
                )}
                <p className={cx("text-[11px]", overtime && !isPaused ? "text-danger-ink font-bold" : "text-ink-2")}>{phase === "pre" ? `Chrono à l'arrêt · ${ctx.settings.capMin} min${ctx.settings.extraMin ? ` (+ ${ctx.settings.extraMin} de prolongation)` : ""} · ${ctx.settings.stations.length} stations × ${laps} tour${laps > 1 ? "s" : ""}` : phase === "post" ? "Course terminée" : isPaused ? "EN PAUSE — validations bloquées" : overtime ? `FIN OFFICIELLE PASSÉE · hors classement jusqu'à ${hardMin}:00` : "Course en cours · un clic sur la fiche = validé"}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {phase === "pre" && (
              <>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.smGhost}>⚙️ Réglages</button>
                <button onClick={handleStart} disabled={pending} className={btn.smSuccess}>▶ Début de course</button>
              </>
            )}
            {phase === "run" && (
              <>
                <button onClick={() => setCardSheet(true)} disabled={pending} className={`${ui.btnSm} bg-yellow-300 text-yellow-950 hover:bg-yellow-400 shadow-sm`} title="Donner une carte jaune à une équipe">🟨 Carte</button>
                <button onClick={() => run(() => togglePauseAction(sessionId))} disabled={pending} className={isPaused ? btn.smSuccess : btn.accent}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleUndo} disabled={pending || ctx.events.length === 0} className={btn.smGhost} title="Annuler la toute dernière validation (quelle que soit l'équipe)">↶ Annuler</button>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.smGhost}>⚙️</button>
                <button onClick={handleFinish} disabled={pending} className={btn.smDanger}>Fin de course</button>
                <button onClick={handleReset} disabled={pending} className={btn.smGhost} title="Course lancée par erreur : tout remettre à zéro (double confirmation)">↺</button>
              </>
            )}
            {phase === "post" && (
              <>
                <span className={`${ui.btnSm} bg-success-soft text-success-ink`}>🏁 Course terminée</span>
                <button onClick={handleReset} disabled={pending} className={btn.smGhost} title="Terminée par erreur : tout remettre à zéro et repartir (double confirmation)">↺ Remettre à zéro</button>
              </>
            )}
            {showConsole && <a href="/admin" target="_blank" rel="noopener" className={btn.smGhost} title="Ouvrir la console dans un nouvel onglet : le WOD reste ouvert ici">🏠 Console ↗</a>}
            <button onClick={exportCsv} className={btn.smGhost} title="Exporter vers Excel (CSV)">⬇ Excel</button>
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-1 py-1 text-sm`}>{error}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <div className={`${ui.segmented} flex-wrap`}>
            <button onClick={() => setView("race")} className={tabBtn(view === "race")}>Course</button>
            <button onClick={() => setView("cards")} className={tabBtn(view === "cards")}>🟨 Cartes jaunes{totalCards > 0 && <span className={`${ui.chip} ${ui.chipWarn} ml-1`}>{totalCards}</span>}</button>
            <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Classement</button>
            <button onClick={() => setView("stats")} className={tabBtn(view === "stats")}>Stats</button>
            {ctx.settings.levels && <button onClick={() => setView("levels")} className={tabBtn(view === "levels")}>⭐ Niveaux &amp; barème</button>}
            <button onClick={() => setView("teams")} className={tabBtn(view === "teams")}>
              Équipes &amp; arbitres <span className={cx(ui.chip, "ml-1", memberCount ? ui.chipOk : ui.chipWarn)}>{memberCount}</span>
              {referees.length > 0 && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>🏴‍☠️ {referees.length}</span>}
            </button>
            {obsCounts && (
              <button onClick={() => setView("arbitrage")} className={tabBtn(view === "arbitrage")}>
                👁 Arbitres <span className={`${ui.chip} ${ui.chipAccent} ml-1`}>{obsCounts.observations}</span>
              </button>
            )}
            {board && (
              <button onClick={() => setView("arbitrage")} className={tabBtn(view === "arbitrage")}>
                Arbitrage <span className={`${ui.chip} ${ui.chipAccent} ml-1`}>{board.evaluationsCount}</span>
              </button>
            )}
          </div>
          {/* Legende des tours : une couleur par tour (station), le run en plus fonce. */}
          {view === "race" && lastCard && (
            <button onClick={() => setView("cards")} className="text-[11px] font-bold text-yellow-950 bg-yellow-200 rounded-md px-2 py-0.5" title="Voir toutes les cartes">
              🟨 {ctx.teams.find((t) => t.id === lastCard.teamId)?.name ?? "?"} · {fmt(lastCard.at)}{lastCard.by ? ` · ${lastCard.by}` : ""}{lastCard.reason ? ` · ${lastCard.reason}` : ""}
            </button>
          )}
          {view === "race" && laps > 1 && (
            <span className="flex items-center gap-2 text-[11px] font-bold text-ink-2">
              {Array.from({ length: laps }, (_, i) => (
                <span key={i} className="flex items-center gap-1"><span className={cx("w-3 h-3 rounded", lapStyle(i + 1).station)} /><span className={cx("w-3 h-3 rounded", lapStyle(i + 1).run)} /> tour {i + 1}</span>
              ))}
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-success" /> fini</span>
            </span>
          )}
        </div>
      </header>

      <main className={cx("flex-1 min-h-0 w-full max-w-[1900px] mx-auto", view === "race" ? "p-2" : "p-4 overflow-auto")}>
        {view === "race" && (
          teams.length === 0 ? (
            <p className={`${ui.muted} py-6 text-center`}>Aucune équipe : règle le nombre d&apos;équipes dans ⚙️ Réglages.</p>
          ) : (
            <div className="flex h-full gap-1.5">
              {/* Pave : 5 colonnes, autant de lignes que necessaire, et TOUT l'ecran : toutes les fiches sont visibles d'un coup. */}
              <div className="grid flex-1 min-w-0 h-full gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
                {teams.map((team) => (
                  <TeamTile
                    key={team.id}
                    st={states.get(team.id)!}
                    phase={phase}
                    laps={laps}
                    liveMs={liveMs}
                    compact={compact}
                    flashing={flash === team.id}
                    disabled={isPaused}
                    onClick={() => (phase === "run" && states.get(team.id)!.finishedMs === null ? validate(team.id) : setOpenTeamId(team.id))}
                    onMore={() => setOpenTeamId(team.id)}
                  />
                ))}
              </div>
              {ctx.settings.levels ? <ParcoursColumn ctx={ctx} phase={phase} records={records} /> : <TopsColumn stations={stats.stations} tops={stats.tops} />}
            </div>
          )
        )}
        {view === "cards" && <CardsView states={states} teams={teams} cards={ctx.cards} sessionId={sessionId} phase={phase} penSec={ctx.settings.penSec} onRun={run} pending={pending} />}
        {view === "results" && <ResultsView ctx={liveCtx} hasData={phase !== "pre" || ctx.events.length > 0} />}
        {view === "stats" && <StatsView ctx={liveCtx} />}
        {view === "levels" && <LevelsView states={states} teams={teams} settings={ctx.settings} sessionId={sessionId} onRun={run} pending={pending} />}
        {view === "teams" && (
          <TeamsManager
            sessionId={sessionId}
            teams={teamsWithMembers}
            classes={classes}
            allClasses={allClasses}
            referees={referees}
            phase={phase}
            startByTeam={startByTeam}
            picker={picker}
            winterArc={winter}
            // Parcours de chaque equipe a la creation des equipes (Sartay 05/10 : « les eleves doivent pouvoir demander de
            // monter ou de descendre d'etoiles ») : fige a sa premiere validation.
            starsOf={ctx.settings.levels ? (id) => (states.get(id)?.stars ?? EVAL_DEFAULT_STARS) as Stars : undefined}
            onSetStars={ctx.settings.levels ? (id, s) => run(() => hxSetLevelAction(sessionId, id, s)) : undefined}
            starsLockedOf={(id) => (states.get(id)?.done ?? 0) > 0}
            starsHint={(s) => `${hxLevelReps(s)} rép.`}
            starsStepper
          />
        )}
        {view === "arbitrage" && board && <ArbitrageTab board={board} />}
        {view === "arbitrage" && obsCounts && (
          <div className={`${ui.cardPad} max-w-xl space-y-3`}>
            <h3 className={ui.h3}>👁 Arbitres de l&apos;Eval</h3>
            <p className={ui.muted}><b>{obsCounts.observations}</b> observation{obsCounts.observations > 1 ? "s" : ""} · <b>{obsCounts.entries}</b> série{obsCounts.entries > 1 ? "s" : ""} de reps horodatée{obsCounts.entries > 1 ? "s" : ""}.</p>
            <p className={ui.hint}>Élèves arbitres : un élève tiré au sort, suivi 5 minutes, 4 critères. Profs : qui ils veulent, 6 critères + l&apos;implication de l&apos;équipe, objectif 3 exercices par élève. Le compte rendu compare l&apos;heure de chaque série aux clics de cet écran.</p>
            <div className="flex flex-wrap gap-2">
              <a href={`/admin/observations?session=${sessionId}`} target="_blank" rel="noopener" className={btn.primary}>📋 Compte rendu des arbitres ↗</a>
              {showConsole && <a href={`/admin/eval/notes?session=${sessionId}`} target="_blank" rel="noopener" className={btn.ghost}>🎯 Notes /20 ↗</a>}
              <a href={`/touche-coule?session=${sessionId}`} target="_blank" rel="noopener" className={btn.sea}>👁 Arbitrer (prof) ↗</a>
            </div>
            {/* Dias a projeter en debut de seance (ou Imprimer -> PDF) : le parcours et les criteres de CETTE seance. */}
            <div className="flex flex-wrap gap-2">
              <a href={`/admin/eval/dias?doc=regles&session=${sessionId}`} target="_blank" rel="noopener" className={btn.ghost}>📄 Règles du WOD (participants) ↗</a>
              <a href={`/admin/eval/dias?doc=arbitres&session=${sessionId}`} target="_blank" rel="noopener" className={btn.ghost}>📄 Guide des arbitres ↗</a>
            </div>
          </div>
        )}
      </main>

      {settingsOpen && (
        <SettingsSheet sessionId={sessionId} settings={ctx.settings} locked={locked} numTeams={ctx.teams.length} canResize={phase === "pre"} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); refresh(); }} />
      )}

      {/* 🟨 en un geste depuis la course (Sartay 06/10 : « rendre l'acces aux cartes jaunes plus facile ») */}
      {cardSheet && (
        <div className={ui.backdrop} onClick={() => setCardSheet(false)}>
          <div className={cx(ui.sheet, "sm:max-w-5xl")} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className={ui.h3}>🟨 Carte jaune</h2>
              <button onClick={() => setCardSheet(false)} className={ui.close} aria-label="Fermer">✕</button>
            </div>
            <CardsView states={states} teams={teams} cards={ctx.cards} sessionId={sessionId} phase={phase} penSec={ctx.settings.penSec} onRun={run} pending={pending} onGiven={() => setCardSheet(false)} />
          </div>
        </div>
      )}

      {openSt && (
        <TeamPanel key={openSt.team.id} ctx={liveCtx} st={openSt} sessionId={sessionId} phase={phase} isPaused={isPaused} liveMs={liveMs} onValidate={() => validate(openSt.team.id)} onClose={() => { setOpenTeamId(null); refresh(); }} />
      )}
    </div>
  );
}

// Une fiche du pave : « ÉQUIPE 3 » (police panneau), les prenoms, l'exercice en cours (police display), sa consigne,
// le chrono depuis le dernier clic, la progression. Couleur = tour en cours. Clic = validation ; « ⋯ » = detail.
function TeamTile({ st, phase, laps, liveMs, compact, flashing, disabled, onClick, onMore }: { st: HXTeamState; phase: Phase; laps: number; liveMs: number; compact: boolean; flashing: boolean; disabled: boolean; onClick: () => void; onMore: () => void }) {
  const { team, current, finishedMs, cards, done, segments } = st;
  const finished = finishedMs !== null;
  const style = lapStyle(st.lap);
  const bg = finished ? "bg-success text-white" : phase === "pre" ? "bg-card text-ink border border-line-2" : current?.kind === "run" ? style.run : style.station;
  const main = finished ? `🏁 ${fmt(finishedMs)}` : current ? current.label : "";
  const detail = phase === "pre" ? `Départ : ${segments[0].detail}` : finished ? (st.inTime ? "Parcours terminé" : "Terminé en prolongation") : current?.detail ?? "";
  const pct = segments.length ? Math.round((done / segments.length) * 100) : 0;
  // Temps ecoule depuis la derniere validation de CETTE equipe (depuis le depart tant qu'elle n'a rien valide).
  const since = phase === "run" ? Math.max(0, liveMs - (st.lastMs ?? 0)) : null;
  return (
    <div className={cx("relative rounded-2xl min-h-0 overflow-hidden shadow-card transition-transform", bg, flashing && "levelup")}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={phase === "run" && !finished ? `Valider : ${main}` : "Ouvrir l'équipe"}
        className={cx("w-full h-full text-left flex flex-col disabled:opacity-60 active:scale-[.985] transition-transform", compact ? "px-2 py-1" : "px-2.5 py-1.5")}
      >
        <span className="flex items-center gap-1.5 pr-7 min-w-0">
          <span className={cx("font-team leading-[0.9] uppercase tracking-wide whitespace-nowrap", compact ? "text-[25px]" : "text-[33px]")}>Équipe {team.order}</span>
          {cards > 0 && <span className="text-[10px] font-extrabold bg-yellow-300 text-yellow-900 rounded-md px-1 py-0.5 leading-none whitespace-nowrap">🟨 ×{cards}</span>}
          {st.stars !== null && <span className={cx("ml-auto shrink-0 leading-none whitespace-nowrap tracking-[-0.08em]", compact ? "text-[14px]" : "text-[19px]", phase === "pre" ? "text-amber-500" : "text-yellow-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]")} title={`Parcours ${st.stars} étoile${st.stars > 1 ? "s" : ""} : ${st.levelReps} répétitions par station`}>{starsText(st.stars)}</span>}
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="flex-1 min-w-0 text-[11px] opacity-80 truncate leading-tight">{team.members.map((m) => m.name).join(" · ") || "—"}</span>
          {laps > 1 && phase !== "pre" && !finished && <span className="text-[10px] font-extrabold uppercase bg-white/25 rounded-md px-1 py-0.5 leading-none whitespace-nowrap">Tour {st.lap}/{laps}</span>}
        </span>
        <span className={cx("font-display font-extrabold leading-tight mt-0.5", compact ? "text-[15px] line-clamp-1" : "text-[19px] line-clamp-2")}>{main}</span>
        <span className="text-[11px] opacity-85 truncate">{detail}</span>
        <span className="mt-auto pt-1 flex items-center gap-1.5 text-[10.5px] font-bold tabular-nums">
          {since !== null && <span className="font-mono text-[12px] bg-black/20 rounded px-1 leading-tight" title="Temps écoulé depuis la dernière validation de cette équipe">⏱ {fmt(since)}</span>}
          <span className="flex-1 h-1.5 rounded-full bg-black/15 overflow-hidden"><span className="block h-full bg-white/90" style={{ width: `${pct}%` }} /></span>
          <span>{done}/{segments.length}</span>
        </span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onMore(); }}
        title="Détail de l'équipe : progression, annuler, cartes jaunes"
        aria-label={`Détail ${team.name}`}
        className="absolute top-1 right-1 w-6 h-6 rounded-md bg-black/15 hover:bg-black/30 text-current font-extrabold leading-none flex items-center justify-center"
      >
        ⋯
      </button>
    </div>
  );
}

// Colonne de droite : le top 3 des equipes sur chaque station (meilleur passage de chaque equipe) et leur temps.
function TopsColumn({ stations, tops }: { stations: HXStat[]; tops: Record<string, HXTop[]> }) {
  return (
    <aside className="hidden lg:flex w-[236px] shrink-0 flex-col rounded-2xl border border-line bg-card overflow-hidden">
      <p className="px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-2 border-b border-line">🏆 Top 3 par station</p>
      <ul className="flex-1 min-h-0 overflow-auto divide-y divide-line">
        {stations.map((s) => {
          const top = tops[s.key] ?? [];
          return (
            <li key={s.key} className="px-2.5 py-1">
              <p className="font-display font-extrabold text-[12.5px] leading-tight truncate">{s.label}</p>
              {top.length === 0 ? (
                <p className="text-[11px] text-ink-3 leading-snug">—</p>
              ) : (
                <p className="flex gap-2 text-[11.5px] tabular-nums leading-snug whitespace-nowrap">
                  {top.map((x, i) => (
                    <span key={x.teamId} title={`${x.name} : ${fmt(x.ms)}`}>{MEDALS[i]}<b className="font-team text-[15px] tracking-wide"> É{x.order}</b> {fmt(x.ms)}</span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// Colonne de droite avec les parcours (Sartay 05/10 : « a droite on ne garde que le top 1 de chaque parcours ; avant de
// commencer le cours, on affiche les tops deja joues ; s'il n'y en a pas encore, des temps calcules sur base de ce que
// les eleves devraient faire ; une fois le start lance, les temps de la classe : on les remet a zero, ils sont a
// gagner »). Pour chaque station, une case par parcours en jeu (ceux des equipes de la seance).
function ParcoursColumn({ ctx, phase, records }: { ctx: HXContext; phase: Phase; records: Record<string, Record<number, HXRecord>> | null }) {
  const { stars, tops } = useMemo(() => parcoursTops(ctx), [ctx]);
  const pre = phase === "pre";
  return (
    <aside className="hidden lg:flex w-[250px] shrink-0 flex-col rounded-2xl border border-line bg-card overflow-hidden">
      <p className="px-2.5 pt-1.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-2">🏆 Top 1 par parcours</p>
      <p className="px-2.5 pb-1.5 text-[10.5px] leading-snug text-ink-3 border-b border-line">{pre ? "Avant le départ : 🏆 record des classes précédentes, sinon ≈ temps attendu." : "Les temps de la classe : à gagner !"}</p>
      <ul className="flex-1 min-h-0 overflow-auto divide-y divide-line">
        {ctx.settings.stations.map((s) => (
          <li key={s.id} className="px-2.5 py-1">
            <p className="font-display font-extrabold text-[12.5px] leading-tight truncate">{s.label}</p>
            <p className="flex flex-wrap gap-x-2.5 text-[11.5px] tabular-nums leading-snug">
              {stars.map((n) => {
                const tag = <b className="text-accent-ink">{n}★</b>;
                if (pre) {
                  const rec = records?.[hxStationKey(s)]?.[n];
                  if (rec) return <span key={n} title={`Record : ${rec.teamName} · ${rec.classes}`}>{tag} 🏆 {fmt(rec.ms)}</span>;
                  const exp = evalExpectedMs(s.label, s.unit, hxStationReps(s, n));
                  return <span key={n} className="text-ink-2" title="Temps attendu : moyenne des équipes de 3 des séances du lundi 5 octobre">{tag} ≈ {exp !== null ? fmt(exp) : "—"}</span>;
                }
                const top = tops[`st:${s.id}`]?.[n];
                return top ? (
                  <span key={n} title={`${top.name} : ${fmt(top.ms)}`}>{tag} 🥇<b className="font-team text-[15px] tracking-wide"> É{top.order}</b> {fmt(top.ms)}</span>
                ) : (
                  <span key={n} className="text-ink-3">{tag} à gagner</span>
                );
              })}
            </p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// Detail d'une equipe : progression, gros bouton Valider (segment en cours), retour arriere,
// cartes jaunes, station de depart avant la course.
function TeamPanel({ ctx, st, sessionId, phase, isPaused, liveMs, onValidate, onClose }: { ctx: HXContext; st: HXTeamState; sessionId: string; phase: Phase; isPaused: boolean; liveMs: number; onValidate: () => void; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const { team, segments, times, clocks, splits, done, current, finishedMs, cards } = st;
  const finished = finishedMs !== null;
  const canValidate = phase === "run" && !isPaused;
  const laps = ctx.settings.laps;
  const style = lapStyle(st.lap);

  function act(fn: () => Promise<ActionResult>) {
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
  const intensity = hxIntensity(st);
  const group = isEvalGroup(team.group) ? team.group : EVAL_BASE_GROUP;
  // « Pas de changement de niveau » : le parcours se choisit avant la premiere validation de l'equipe, ensuite il est fige.
  function setLevel(stars: number) {
    if (stars === st.stars || done > 0) return;
    act(() => hxSetLevelAction(sessionId, team.id, stars));
  }
  function undo() {
    const last = done ? segments[done - 1].label : null;
    if (!last) return;
    if (!confirm(`Annuler la dernière validation de ${team.name} : ${last} ?`)) return;
    act(() => hxUndoTeamAction(sessionId, team.id));
  }

  return (
    <div className="fixed inset-0 z-30 bg-paper flex flex-col">
      <div className="flex justify-between items-center gap-3 px-4 py-3 bg-card border-b border-line">
        <h3 className="leading-tight">
          <span className="font-team text-[34px] uppercase tracking-wide leading-none">{team.name}</span>
          {team.members.length > 0 && <span className="block text-sm text-ink-2">{team.members.map((m) => m.name).join(" · ")}</span>}
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
            <div className="grid grid-cols-3 gap-1.5">
              {ctx.settings.stations.map((s, i) => (
                <button key={s.id} type="button" disabled={pending} onClick={() => act(() => hxSetStartAction(sessionId, team.id, s.id))} className={cx("rounded-xl px-2 py-2 text-sm font-bold border transition text-left truncate", st.startIndex === i ? "bg-brand text-white border-brand" : "bg-card border-line hover:border-brand")}>
                  <span className="font-display text-lg font-extrabold mr-1">{i + 1}</span>{s.label}
                </button>
              ))}
            </div>
            <p className={`${ui.hint} mt-2`}>Sans choix : station {((Math.max(1, team.order) - 1) % ctx.settings.stations.length) + 1} (numéro d&apos;équipe). Annoncé dans Équipes &amp; arbitres.</p>
          </div>
        )}

        {st.stars !== null && (
          <div className={`${ui.cardPad} mb-3`}>
            <p className="text-sm font-bold mb-1">⭐ Parcours de l&apos;équipe{intensity && <span className="font-normal text-ink-2"> · {intensity.group}</span>}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {HX_LEVELS.map((l) => (
                <button key={l.stars} type="button" disabled={pending || done > 0} onClick={() => setLevel(l.stars)} className={cx("rounded-xl px-1 py-2 text-xs font-bold border transition text-center", st.stars === l.stars ? "bg-accent text-ink border-accent" : "bg-card border-line hover:border-accent disabled:opacity-40")}>
                  <span className="block font-display text-lg font-extrabold leading-none mb-0.5">{l.stars}★</span>
                  {l.reps} rép. · {evalNote(group, l.stars)}/20
                </button>
              ))}
            </div>
            <p className={`${ui.hint} mt-2`}>
              {done > 0 ? "🔒 Parcours figé : l'équipe a commencé. " : `Sans choix : ${team.defaultStars ?? EVAL_DEFAULT_STARS}★${(team.defaultStars ?? EVAL_DEFAULT_STARS) !== EVAL_DEFAULT_STARS ? " (équipe de filles de 3e-4e : 20/20 dès ce parcours)" : ""}. Il se choisit avant le départ : à la première validation, il ne change plus. `}
              Le parcours fixe les répétitions de chaque station (les allers-retours ne changent pas) ; les points de la perf, si le WOD est bouclé avant {ctx.settings.capMin}:00, dépendent aussi des années et du sexe.
            </p>
          </div>
        )}

        <div className={cx("rounded-2xl p-4 mb-3 shadow-card", finished ? "bg-success text-white" : current?.kind === "run" ? style.run : style.station)}>
          <p className="text-xs font-extrabold uppercase tracking-wide opacity-80">{finished ? "Parcours terminé" : `En cours · ${laps > 1 ? `tour ${st.lap}/${laps} · ` : ""}segment ${done + 1}/${segments.length}`}</p>
          <p className="font-display text-[28px] font-extrabold leading-tight">{finished ? `🏁 ${fmt(finishedMs)}` : current?.label ?? ""}</p>
          <p className={cx("text-sm opacity-90", !finished && "mb-3")}>{finished ? `Les ${segments.length} segments sont validés${st.inTime ? "" : " (parcours bouclé en prolongation, après la fin officielle)"}.` : current?.detail}</p>
          {!finished && <button
            onClick={() => { onValidate(); onClose(); }}
            disabled={pending || !canValidate}
            className="w-full rounded-2xl bg-white text-ink font-display font-extrabold text-xl py-4 shadow-sm disabled:opacity-50 active:scale-[.98] transition"
          >
            ✅ Valider : {current?.label ?? ""}
          </button>}
          {!finished && !canValidate && <p className="text-xs opacity-90 mt-2">{phase === "pre" ? "Lance d'abord la course." : phase === "post" ? "Course terminée." : "Course en pause."}</p>}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={undo} disabled={pending || done === 0} className={btn.ghost}>↶ Annuler la dernière validation</button>
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
            <thead><tr><th className={ui.th}>#</th>{laps > 1 && <th className={ui.th}>Tour</th>}<th className={ui.th}>Segment</th><th className={ui.th}>Consigne</th><th className={`${ui.th} text-right`} title="Heure du clic de validation">Heure</th><th className={`${ui.th} text-right`} title="Temps de course écoulé à la validation">Chrono</th><th className={`${ui.th} text-right`}>Durée</th></tr></thead>
            <tbody>
              {segments.map((seg, i) => {
                const state = i < done ? "done" : i === done && !finished ? "current" : "todo";
                return (
                  <tr key={seg.key} className={cx(ui.tr, state === "current" && "bg-brand-soft", state === "todo" && "text-ink-3")}>
                    <td className="p-2 font-display font-extrabold">{seg.n}</td>
                    {laps > 1 && <td className="p-2"><span className={cx("inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle", lapStyle(seg.lap).station)} />{seg.lap}</td>}
                    <td className="p-2 font-bold">{seg.kind === "run" ? "🏃 " : ""}{seg.label}</td>
                    <td className="p-2 text-ink-2">{seg.detail}</td>
                    <td className="p-2 text-right tabular-nums text-ink-2">{i < done ? clockText(clocks[i]) || "…" : ""}</td>
                    <td className="p-2 text-right tabular-nums">{i < done ? fmt(times[i]) : ""}</td>
                    <td className="p-2 text-right tabular-nums font-bold">{i < done ? fmt(splits[i]) : ""}</td>
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

// Onglet cartes jaunes (et fenetre 🟨 de la course) : choisir l'equipe, confirmer. Une carte ajoute penSec secondes au
// temps et retire 1 point sur 20 a chaque eleve de l'equipe. Motif facultatif ; chaque carte dit qui l'a donnee
// (greffier, prof ou arbitre depuis son telephone) et pourquoi.
function CardsView({ states, teams, cards, sessionId, phase, penSec, onRun, pending, onGiven }: { states: Map<string, HXTeamState>; teams: HXContext["teams"]; cards: HXCard[]; sessionId: string; phase: Phase; penSec: number; onRun: (a: () => Promise<ActionResult>) => void; pending: boolean; onGiven?: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  return (
    <div>
      <p className={`${ui.hint} mb-2`}>Touche une équipe pour lui donner une carte jaune ({penSec} s ajoutées à son temps, 1 point de moins sur 20 pour chacun de ses élèves). « retirer » enlève la dernière.</p>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-xs font-bold text-ink-2">Motif (facultatif) :</span>
        {CARD_REASONS.map((r) => (
          <button key={r} onClick={() => setReason(reason === r ? null : r)} className={`${ui.pill} ${reason === r ? ui.pillOn : ui.pillOff}`}>{r}</button>
        ))}
      </div>
      {phase === "pre" && <p className={`${ui.alertWarn} mb-3`}>Les cartes jaunes se donnent une fois la course lancée.</p>}
      <div className="grid grid-cols-5 gap-2">
        {teams.map((team) => {
          const st = states.get(team.id)!;
          const mine = cards.filter((c) => c.teamId === team.id).sort((a, b) => a.at - b.at);
          return (
            <div key={team.id} className={cx("rounded-2xl border p-2.5 min-h-[96px] flex flex-col", st.cards ? "bg-yellow-50 border-yellow-400" : "bg-card border-line")}>
              <button onClick={() => { if (confirm(`Carte jaune pour ${team.name}${reason ? ` (${reason})` : ""} ?`)) { onRun(() => hxCardAction(sessionId, team.id, 1, reason)); onGiven?.(); } }} disabled={pending || phase === "pre"} className="text-left flex-1 disabled:opacity-50">
                <span className="font-team text-[28px] leading-none uppercase tracking-wide">Équipe {team.order}</span>
                <span className="block text-[11px] text-ink-2 truncate">{team.members.map((m) => m.name).join(" · ") || "—"}</span>
                <span className="block font-bold mt-1">🟨 ×{st.cards}{st.cards ? <span className="text-xs text-ink-3 font-normal"> (+{fmt(st.penMs)})</span> : null}</span>
              </button>
              {mine.map((c) => (
                <span key={c.id} className="block text-[11px] text-ink-2 leading-tight mt-0.5">{fmt(c.at)}{c.by ? ` · ${c.by}` : ""}{c.reason ? ` · ${c.reason}` : ""}</span>
              ))}
              {st.cards > 0 && <button onClick={() => onRun(() => hxCardAction(sessionId, team.id, -1))} disabled={pending} className={`${btn.smGhost} mt-1 self-start`}>retirer</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Onglet « Niveaux & bareme » (Sartay 05/10 : « les eleves peuvent choisir leur niveau », « ajouter un onglet dans
// l'app pour expliquer les baremes », puis « seulement des parcours a 40-45-50-55-60, le niveau de base a 3 etoiles pour
// tout le monde, max 5 etoiles, mais les etoiles ne valent pas les memes points en fonction des annees et des sexes ») :
// le parcours de chaque equipe en un clic avant son depart (fige a sa premiere validation), et le bareme a montrer.
function LevelsView({ states, teams, settings, sessionId, onRun, pending }: { states: Map<string, HXTeamState>; teams: HXContext["teams"]; settings: HXSettings; sessionId: string; onRun: (a: () => Promise<ActionResult>) => void; pending: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)] items-start">
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>⭐ Le parcours de chaque équipe</h3>
        <p className={`${ui.hint} mb-2`}>Un clic = le parcours de l&apos;équipe, avant son départ : ses répétitions à chaque station (les allers-retours ne changent pas). Sans choix : {EVAL_DEFAULT_STARS}★, {evalGroupDefaultStars("34F")}★ pour une équipe de filles de 3e-4e. Figé dès sa première validation. Ses points dépendent aussi de son groupe.</p>
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead><tr><th className={ui.th}>Équipe</th><th className={ui.th}>Élèves · groupe</th><th className={ui.th}>Parcours · répétitions</th><th className={`${ui.th} text-right`} title="Points de la perf si le WOD est bouclé avant la fin officielle">Si bouclé</th></tr></thead>
            <tbody>
              {teams.map((team) => {
                const st = states.get(team.id)!;
                const it = hxIntensity(st);
                const group = isEvalGroup(team.group) ? team.group : EVAL_BASE_GROUP;
                const locked = st.done > 0;
                return (
                  <tr key={team.id} className={ui.tr}>
                    <td className="p-2 font-team text-[22px] leading-none uppercase tracking-wide">Équipe {team.order}</td>
                    <td className="p-2 max-w-[190px]">
                      <span className="block truncate text-ink-2">{team.members.map((m) => m.name).join(" · ") || "—"}</span>
                      <span className="block truncate text-[11px] text-ink-3">{it?.group ?? ""}</span>
                    </td>
                    <td className="p-2">
                      <span className="flex gap-1 items-center">
                        {HX_LEVELS.map((l) => (
                          <button key={l.stars} type="button" disabled={pending || locked} onClick={() => { if (st.stars !== l.stars) onRun(() => hxSetLevelAction(sessionId, team.id, l.stars)); }} title={`${starsText(l.stars)} : ${l.reps} répétitions, ${evalNote(group, l.stars)}/20 si le WOD est bouclé`} className={cx("rounded-lg px-2 py-1 text-xs font-bold border transition tabular-nums", st.stars === l.stars ? "bg-accent text-ink border-accent" : "bg-card border-line text-ink-2 hover:border-accent disabled:opacity-40")}>
                            <b className="font-display text-sm font-extrabold">{l.stars}★</b> {l.reps}
                          </button>
                        ))}
                        {locked && <span className="ml-1 text-[11px] text-ink-3" title="L'équipe a validé un segment : son parcours ne change plus">🔒 figé</span>}
                      </span>
                    </td>
                    <td className="p-2 text-right font-display font-extrabold tabular-nums">{it ? `${noteText(it.max)}/20` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>🎯 Les points de la perf</h3>
        <p className={`${ui.hint} mb-2`}>Note de l&apos;équipe qui boucle le WOD ({settings.laps} tour{settings.laps > 1 ? "s" : ""}) avant la fin officielle ({settings.capMin}:00) : le même parcours pour tous, mais pas les mêmes points selon les années et le sexe.</p>
        <EvalBaremeTable big />
        <ul className="mt-3 space-y-1.5 text-sm text-ink-2 list-disc pl-5">
          <li>Tout le monde part à {EVAL_DEFAULT_STARS}★ (une équipe de filles de 3e-4e à {evalGroupDefaultStars("34F")}★) ; une équipe peut demander de monter ou de descendre à la création des équipes. Ensuite, le parcours ne change plus.</li>
          <li>Une équipe mixte lit la colonne « garçons ou mixte » ; « filles » = une équipe de filles uniquement.</li>
          <li>WOD pas bouclé à {settings.capMin}:00 : la note part de ce maximum et baisse selon ce qu&apos;il restait à faire.</li>
          {settings.extraMin > 0 && <li>De {settings.capMin}:00 à {settings.capMin + settings.extraMin}:00, le chrono continue pour finir son parcours : c&apos;est affiché, mais hors classement.</li>}
          <li>La perf compte pour la moitié de l&apos;éval du jour ; la technique (arbitres et profs) et l&apos;implication de l&apos;équipe font le reste.</li>
        </ul>
      </div>
    </div>
  );
}

// Classement au temps du WOD (+ penalites) ; la colonne QCM montre les points bonus, bareme a fixer par Sartay.
function ResultsView({ ctx, hasData }: { ctx: HXContext; hasData: boolean }) {
  const thR = `${ui.th} text-right`;
  if (!hasData) return <p className={`${ui.muted} py-4`}>Rien à afficher. Encode tes équipes, puis lance la course.</p>;
  let rank = 0;
  const members = (t: HXContext["teams"][number]) => t.members.map((m) => m.name).join(" · ");
  const stationTotal = ctx.settings.stations.length * ctx.settings.laps;
  const { levels, extraMin, capMin } = ctx.settings;
  return (
    <div>
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>⏱ Classement au temps</h3>
        <p className={`${ui.hint} mb-2`}>Temps au dernier segment ({ctx.settings.laps} tour{ctx.settings.laps > 1 ? "s" : ""}), + {ctx.settings.penSec} s par carte jaune. Les équipes non arrivées suivent, classées par segments faits{extraMin > 0 ? ` à la fin officielle (${capMin}:00) : ce qui est validé en prolongation est affiché, mais ne compte ni pour le classement ni pour la note` : ""}.</p>
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[13px] border-collapse whitespace-nowrap">
            <thead><tr><th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={ui.th}>Élèves</th>{levels && <th className={thR} title="Parcours de l'équipe : étoiles et répétitions par station">Parcours</th>}<th className={thR}>Départ</th><th className={thR}>Stations</th><th className={thR}>Runs</th><th className={thR}>Temps</th><th className={thR}>🟨</th><th className={thR}>Score</th>{levels && <th className={thR} title="Points de la perf : ceux du parcours, pour le groupe de l'équipe, si le WOD est bouclé avant la fin officielle ; sinon la part du WOD faite à cet instant et les points maximum du parcours">🎯 Perf</th>}<th className={thR} title="QCM bonus : points des élèves ayant répondu (barème à fixer)">📝 QCM</th></tr></thead>
            <tbody>
              {timeRows(ctx).map((st) => {
                if (st.inTime) rank++;
                const it = hxIntensity(st);
                return (
                  <tr key={st.team.id} className={`${ui.tr} text-right tabular-nums`}>
                    <td className="p-2 text-left font-display font-extrabold">{st.inTime ? rank : "—"}</td>
                    <td className="p-2 text-left font-bold">{st.team.name}</td>
                    <td className="p-2 text-left text-ink-2">{members(st.team) || "—"}</td>
                    {levels && <td className="p-2" title={it?.group}>{st.stars !== null ? <><b className="text-accent-ink">{st.stars}★</b> {st.levelReps}</> : ""}</td>}
                    <td className="p-2">{st.startIndex + 1}</td>
                    <td className="p-2">{st.stationsDone}/{stationTotal}</td>
                    <td className="p-2">{st.runsDone}</td>
                    <td className="p-2">{st.finishedMs !== null ? `${fmt(st.finishedMs)}${st.inTime ? "" : " · prolongation"}` : st.lastMs !== null ? `(${fmt(st.lastMs)})` : "—"}</td>
                    <td className="p-2">{st.cards ? `×${st.cards} (+${fmt(st.penMs)})` : ""}</td>
                    <td className="p-2 font-extrabold">{st.inTime ? fmt(st.scoreMs) : "—"}</td>
                    {levels && <td className="p-2">{!it ? "" : it.note !== null ? <><b>{noteText(it.note)}</b>/20</> : <span className="text-ink-2">{Math.round(it.share * 100)} % du WOD · max {noteText(it.max)}</span>}</td>}
                    <td className="p-2">{st.quiz.done ? `${st.quiz.score} pt${st.quiz.score > 1 ? "s" : ""}${st.quiz.done < st.team.members.length ? ` (${st.quiz.done}/${st.team.members.length})` : ""}` : ""}</td>
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

// Tableau de statistiques d'un type de segment : passages, meilleur, moyen (+ top 3 pour les stations).
function StatTable({ title, rows, tops }: { title: string; rows: HXStat[]; tops?: Record<string, HXTop[]> }) {
  const thR = `${ui.th} text-right`;
  return (
    <div>
      <h3 className={`${ui.h3} mb-1.5`}>{title}</h3>
      <div className={`${ui.card} overflow-auto`}>
        <table className="w-full text-[13px] border-collapse whitespace-nowrap">
          <thead><tr><th className={ui.th}>Segment</th><th className={thR}>Passages</th><th className={thR}>Meilleur</th><th className={thR}>Moyen</th>{tops && <th className={ui.th}>Top 3</th>}</tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key} className={`${ui.tr} text-right tabular-nums`}>
                <td className="p-2 text-left font-bold">{s.label}</td><td className="p-2">{s.n}</td><td className="p-2 font-extrabold text-success-ink">{s.best !== null ? fmt(s.best) : "—"}</td><td className="p-2">{s.avg !== null ? fmt(s.avg) : "—"}</td>
                {tops && <td className="p-2 text-left text-ink-2">{(tops[s.key] ?? []).map((x, i) => `${MEDALS[i]} ${x.name} ${fmt(x.ms)}`).join("  ") || "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Statistiques : par station (tous tours confondus) et par run complet, puis le detail des durees par equipe.
function StatsView({ ctx }: { ctx: HXContext }) {
  const stats = useMemo(() => segmentStats(ctx), [ctx]);
  const thR = `${ui.th} text-right`;
  const laps = ctx.settings.laps;
  const lapKey = (id: string, lap: number) => `st:${id}${lap > 1 ? `:${lap}` : ""}`;
  return (
    <div className="space-y-4">
      <StatTable title={`Stations${laps > 1 ? ` (les ${laps} tours confondus)` : ""}`} rows={stats.stations} tops={stats.tops} />
      <div>
        <h3 className={`${ui.h3} mb-1.5`}>Durées par équipe</h3>
        <p className={`${ui.hint} mb-2`}>S1…S{ctx.settings.stations.length} = durée passée à chaque station (dans l&apos;ordre des stations){laps > 1 ? " : tour 1 · tour 2" : ""}.</p>
        <div className={`${ui.card} overflow-auto`}>
          <table className="w-full text-[12px] border-collapse whitespace-nowrap">
            <thead>
              <tr>
                <th className={ui.th}>Équipe</th>
                {ctx.settings.stations.map((s, i) => <th key={s.id} className={thR} title={s.label}>S{i + 1}</th>)}
                <th className={thR}>Temps</th>
              </tr>
            </thead>
            <tbody>
              {[...ctx.teams].sort((a, b) => a.order - b.order).map((t) => {
                const st = teamState(ctx, t);
                const d = stats.byTeam[t.id] ?? {};
                return (
                  <tr key={t.id} className={`${ui.tr} text-right tabular-nums`}>
                    <td className="p-2 text-left font-bold">{t.name}</td>
                    {ctx.settings.stations.map((s) => (
                      <td key={s.id} className="p-2">{Array.from({ length: laps }, (_, l) => d[lapKey(s.id, l + 1)]).filter((v): v is number => v !== undefined).map((v) => fmt(v)).join(" · ")}</td>
                    ))}
                    <td className="p-2 font-extrabold">{st.finishedMs !== null ? fmt(st.finishedMs) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <StatTable title={`Runs (${ctx.settings.runParts.length > 1 ? `${ctx.settings.runParts.length} parties additionnées` : ctx.settings.runParts[0]})`} rows={stats.runs} />
    </div>
  );
}

// Reglages de la seance : les stations (libelle, quantite, unite ; on en ajoute ou retire), le run et ses parties, le
// nombre de tours, le temps limite, la carte jaune, le nombre d'equipes. Le parcours se fige a la premiere validation.
function SettingsSheet({ sessionId, settings, locked, numTeams, canResize, onClose, onSaved }: { sessionId: string; settings: HXSettings; locked: boolean; numTeams: number; canResize: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<HXSettingsInput>({
    stations: settings.stations.map((s) => ({ label: s.label, reps: s.reps, unit: s.unit })),
    runLabel: settings.runLabel,
    runParts: settings.runParts,
    runAfterLast: settings.runAfterLast,
    laps: settings.laps,
    capMin: settings.capMin,
    extraMin: settings.extraMin,
    levels: settings.levels,
    penSec: settings.penSec,
  });
  const [partsText, setPartsText] = useState(settings.runParts.join(", "));
  const [teams, setTeams] = useState(numTeams);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const setStation = (i: number, patch: Partial<HXSettingsInput["stations"][number]>) => setForm((f) => ({ ...f, stations: f.stations.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const parts = partsText.split(",").map((p) => p.trim()).filter(Boolean).slice(0, HX_MAX_RUN_PARTS);
  const nSeg = form.laps * form.stations.length * (1 + Math.max(1, parts.length)) - (form.runAfterLast ? 0 : Math.max(1, parts.length));

  function save() {
    setError("");
    if (!parts.length) { setError("Indique ce qu'est un run (ex. « 2 allers-retours »)."); return; }
    if (form.stations.some((s) => !s.label.trim())) { setError("Chaque station a besoin d'un nom."); return; }
    startTransition(async () => {
      const res = await hxSettingsAction(sessionId, { ...form, runParts: parts });
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
          <h3 className={ui.h2}>⚙️ Réglages de l&apos;Eval</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {locked && <p className={`${ui.alertWarn} mb-3`}>Des validations existent déjà : stations, runs, tours et niveaux sont figés. Fin officielle, prolongation et carte jaune restent modifiables.</p>}
        {error && <p className={`${ui.alertErr} mb-3`}>{error}</p>}

        <p className="text-sm font-bold mb-1">Les {form.stations.length} stations</p>
        <div className="space-y-1.5 mb-2">
          {form.stations.map((s, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_80px_90px] gap-1.5 items-center">
              <span className="font-display font-extrabold text-lg text-ink-3">{i + 1}</span>
              <input value={s.label} disabled={locked} onChange={(e) => setStation(i, { label: e.target.value })} className={ui.input} placeholder="Exercice" />
              <input type="number" min={0} value={s.reps} disabled={locked} onChange={(e) => setStation(i, { reps: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${ui.input} text-right`} />
              <select value={s.unit} disabled={locked} onChange={(e) => setStation(i, { unit: e.target.value })} className={ui.input}>
                {HX_UNITS.map((u) => <option key={u} value={u}>{u === "A/R" ? "allers-retours" : u}</option>)}
                {!(HX_UNITS as readonly string[]).includes(s.unit) && <option value={s.unit}>{s.unit}</option>}
              </select>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <button type="button" disabled={locked || form.stations.length >= HX_MAX_STATIONS} onClick={() => setForm((f) => ({ ...f, stations: [...f.stations, { label: `Station ${f.stations.length + 1}`, reps: 60, unit: "rép." }] }))} className={btn.smGhost}>＋ Ajouter une station</button>
          <button type="button" disabled={locked || form.stations.length <= HX_MIN_STATIONS} onClick={() => setForm((f) => ({ ...f, stations: f.stations.slice(0, -1) }))} className={btn.smGhost}>− Retirer la dernière</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_110px] gap-2 mb-1">
          <label className="text-xs"><span className={ui.label}>Nom du run</span><input value={form.runLabel} disabled={locked} onChange={(e) => setForm({ ...form, runLabel: e.target.value })} className={ui.input} /></label>
          <label className="text-xs"><span className={ui.label}>Un run = (plusieurs validations : sépare par des virgules)</span><input value={partsText} disabled={locked} onChange={(e) => setPartsText(e.target.value)} className={ui.input} placeholder="2 allers-retours" /></label>
          <label className="text-xs"><span className={ui.label}>Tours du circuit</span>
            <select value={form.laps} disabled={locked} onChange={(e) => setForm({ ...form, laps: Number(e.target.value) })} className={ui.input}>
              {Array.from({ length: HX_MAX_LAPS }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} tour{i ? "s" : ""}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm mb-1"><input type="checkbox" checked={form.runAfterLast} disabled={locked} onChange={(e) => setForm({ ...form, runAfterLast: e.target.checked })} className={ui.check} /> Un run aussi après la toute dernière station</label>
        <p className={`${ui.hint} mb-4`}>
          Sur les fiches : « {form.stations[0]?.label} » ({amountText(form.stations[0]?.reps ?? 0, form.stations[0]?.unit ?? "")}), puis {parts.length > 1 ? parts.map((p, i) => `${form.runLabel.toUpperCase()} 1 ${["A", "B", "C", "D"][i]} (${p})`).join(", ") : `${form.runLabel.toUpperCase()} 1 (${parts[0] ?? "…"})`}… · {nSeg} validations par équipe.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <label className="text-xs"><span className={ui.label}>Fin officielle (min)</span><input type="number" min={5} max={180} value={form.capMin} onChange={(e) => setForm({ ...form, capMin: parseInt(e.target.value, 10) || 55 })} className={ui.input} /></label>
          <label className="text-xs"><span className={ui.label}>Prolongation (min)</span><input type="number" min={0} max={60} value={form.extraMin} onChange={(e) => setForm({ ...form, extraMin: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={ui.input} /></label>
          <label className="text-xs"><span className={ui.label}>Carte jaune (s)</span><input type="number" min={0} max={600} value={form.penSec} onChange={(e) => setForm({ ...form, penSec: parseInt(e.target.value, 10) || 0 })} className={ui.input} /></label>
        </div>
        <p className={`${ui.hint} mb-3`}>Le classement et les notes s&apos;arrêtent à la fin officielle ; pendant la prolongation, les équipes peuvent encore valider pour finir leur parcours. À la fin de la prolongation, la course s&apos;arrête toute seule (0 = pas de prolongation).</p>
        <label className="flex items-start gap-2 text-sm mb-4"><input type="checkbox" checked={form.levels} disabled={locked} onChange={(e) => setForm({ ...form, levels: e.target.checked })} className={`${ui.check} mt-0.5`} /><span>Parcours étoilés : chaque équipe choisit son parcours avant le départ, de 1★ = 40 à 5★ = 60 répétitions par station ({EVAL_DEFAULT_STARS}★ par défaut, {evalGroupDefaultStars("34F")}★ pour une équipe de filles de 3e-4e) ; ses points dépendent aussi des années et du sexe (onglet Niveaux &amp; barème). Les quantités ci-dessus sont celles du 5★ ; les allers-retours ne changent pas.</span></label>
        <label className="text-xs block mb-4"><span className={ui.label}>Nombre d&apos;équipes {canResize ? "" : "(figé : course lancée)"}</span><input type="number" min={1} max={50} value={teams} disabled={!canResize} onChange={(e) => setTeams(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))} className={`${ui.input} w-28`} /></label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btn.ghost}>Annuler</button>
          <button onClick={save} disabled={pending} className={btn.primary}>{pending ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}
