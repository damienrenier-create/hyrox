"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { elapsed, fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  activeCards, attemptEvents, cardSeconds, cardsForTeam, coinsInPlay, coinsState, emomNextCard, emomProgress, emomRank, emomSchedule, emomTotalMs, emomWaveAt, emomWaveEvents, emomZombieSim, estimateSeconds, fmtTheoretical, ladderFor, levelLabel, masteredExercises, orderedLevels, progressOf, rankTeams, rightmostCard, rocketTargets, sendOptions, starsLabel, starsName, teamStarsOf, warmupCoinsInPlay, zombieSim, zombieSpeedLevel, zombieTier, DISCOUNT_STEPS, EMOM_ZOMBIE_SPEED, HEART_BITES, PENALTY_STEPS, ROCKET_PRICE, STARS, ZOMBIE_ZONE,
  type CoinsState, type EmomTeam, type EmomWave, type FrozenLevel, type Stars, type TeamPenalty, type TeamProgress, type Tick,
} from "@/lib/wod-engines/templates/level-engine";
import type { LevelBundle, LevelTeam, PhaseTeamTotals } from "@/lib/level-context";
import { createStarTeamAction, discountAction, endLevelAction, levelLiveAction, levelPauseAction, levelYellowCardAction, numberTeamsAction, sendRocketAction, setEmomScoreAction, setLevelCapAction, startChildAction, startLevelAction, tickCardAction, untickCardAction, type LevelLive, type TeamLive } from "./level-actions";
import { TeamsManager, type TeamWithMembers, type RefereeView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { LevelLadderEditor } from "./LevelLadderEditor";
import { RecordsTab } from "./RecordsTab";
import { LevelArbitrage } from "./LevelArbitrage";
import { LevelSettings } from "./LevelSettings";
import { LogoutButton } from "../_components/LogoutButton";
import type { PendingRequest } from "./referee-decisions";
import { SessionStep, sessionDay, type SessionOption } from "./client";
import { btn, cx, ui } from "@/lib/ui";

type View = "race" | "results" | "recap" | "ladder" | "records" | "arbitrage" | "teams" | "settings";

// Greffier « Level » (PC projete, mais aussi telephone d'un prof qui valide un BOSS) : chrono centre, une
// tuile par equipe avec son niveau en cours et ses fiches a cocher, classement en direct, recap des reps
// par exercice, echelle de la seance modifiable en cours de route. Plusieurs appareils cochent en meme
// temps : chaque coche est une ligne unique en base, et le pouls resynchronise les ecrans.
export function LevelClient({
  sessionId, sessionLabel, sessionOptions, olderSession, newerSession, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, picker, isMaster = false,
}: {
  sessionId: string;
  isMaster?: boolean;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  olderSession: SessionOption | null;
  newerSession: SessionOption | null;
  bundle: LevelBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  pendingRequests: PendingRequest[];
  picker: PickerData;
}) {
  const router = useRouter();
  const { levels, teams } = bundle;
  // Etat vivant (coches, vies, cartes, chrono) tenu localement : une coche remplace la ligne de son equipe,
  // le pouls recharge cet etat leger, et la page entiere n'est rechargee que si la structure change.
  const [live, setLive] = useState<LevelLive>(() => liveFromBundle(bundle));
  useEffect(() => { setLive(liveFromBundle(bundle)); setOptimistic(new Map()); lastApplied.current = new Map(); }, [bundle]);
  const { startedAtMs, endedAtMs, pauses } = live;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Coches en attente de confirmation serveur : l'ecran reagit au doigt, la reponse de la coche confirme.
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());
  // Heure serveur du dernier etat applique par equipe : une reponse plus ancienne (taps qui se croisent) est
  // ignoree, et seule la coche terminee est liberee — les autres restent affichees telles que tapees.
  const lastApplied = useRef<Map<string, number>>(new Map());
  function mergeTeam(t: TeamLive, finishedKey?: string) {
    if (finishedKey) setOptimistic((m) => { const n = new Map(m); n.delete(finishedKey); return n; });
    if (t.at <= (lastApplied.current.get(t.teamId) ?? 0)) return;
    lastApplied.current.set(t.teamId, t.at);
    setLive((l) => ({
      ...l,
      ticks: [...l.ticks.filter((x) => x.teamId !== t.teamId), ...t.ticks],
      losses: [...l.losses.filter((x) => x.teamId !== t.teamId), ...t.losses],
      yellowCards: [...l.yellowCards.filter((x) => x.teamId !== t.teamId), ...t.yellowCards],
      penalties: [...l.penalties.filter((x) => x.teamId !== t.teamId), ...t.penalties],
      coinEvents: [...l.coinEvents.filter((x) => x.teamId !== t.teamId), ...t.coinEvents],
      emomScores: t.score === null ? l.emomScores : { ...l.emomScores, [t.teamId]: t.score },
    }));
  }
  // Etat complet du pouls : les equipes dont on a un etat plus recent gardent leurs donnees locales.
  function applyLive(l: LevelLive) {
    setLive((prev) => {
      const newer = new Set([...lastApplied.current.entries()].filter(([, at]) => at > l.at).map(([id]) => id));
      if (!newer.size) return l;
      return {
        ...l,
        ticks: [...l.ticks.filter((x) => !newer.has(x.teamId)), ...prev.ticks.filter((x) => newer.has(x.teamId))],
        losses: [...l.losses.filter((x) => !newer.has(x.teamId)), ...prev.losses.filter((x) => newer.has(x.teamId))],
        yellowCards: [...l.yellowCards.filter((x) => !newer.has(x.teamId)), ...prev.yellowCards.filter((x) => newer.has(x.teamId))],
        penalties: [...l.penalties.filter((x) => !newer.has(x.teamId)), ...prev.penalties.filter((x) => newer.has(x.teamId))],
        coinEvents: [...l.coinEvents.filter((x) => !newer.has(x.teamId)), ...prev.coinEvents.filter((x) => newer.has(x.teamId))],
      };
    });
  }

  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);
  const isPaused = pauses.some((p) => p.to === null);
  const phase: "pre" | "run" | "post" = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  const [view, setView] = useState<View>(phase === "pre" && memberCount === 0 ? "teams" : "race");
  const [moreOpen, setMoreOpen] = useState(false);
  // Mode « course » : une fois le WOD lance, l'ecran ne garde que l'essentiel (chrono, tuiles, boutons vitaux).
  const focus = phase === "run";
  function toggleFullscreen(force?: boolean) {
    if (typeof document === "undefined") return;
    const on = force ?? !document.fullscreenElement;
    try {
      if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.();
      else if (!on && document.fullscreenElement) void document.exitFullscreen?.();
    } catch {
      /* navigateur sans plein ecran : tant pis */
    }
  }

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, isPaused]);
  // Pouls : UN appel toutes les 8 s (8 requetes en parallele) qui rend l'etat vivant + une signature de
  // structure. Structure changee (equipes, membres, echelle, temps impose, depart, fin) -> page entiere ;
  // etat identique -> aucun rendu ; sinon -> remplacement local. Onglet cache : rien du tout.
  const lastLive = useRef<string | null>(null);
  const lastStructure = useRef<string | null>(null);
  useEffect(() => {
    if (phase === "post") return;
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (stop || busy || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      busy = true;
      try {
        const l = await levelLiveAction(sessionId);
        if (stop || "error" in l) return;
        if (lastStructure.current !== null && lastStructure.current !== l.structure) { lastStructure.current = l.structure; router.refresh(); return; }
        lastStructure.current = l.structure;
        const key = JSON.stringify([l.ticks.map((t) => t.id), l.losses.map((x) => x.id), l.yellowCards.map((c) => c.id), l.penalties.length, l.penalties.map((x) => x.id ?? "").join(","), l.coinEvents.length, l.emomScores, l.pauses, l.startedAtMs, l.endedAtMs, l.raceEndedAtMs]);
        if (key !== lastLive.current) { lastLive.current = key; applyLive(l); }
      } catch {
        /* reseau : prochain tick */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [phase, sessionId, router]);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    return elapsed(startedAtMs, pauses, phase === "post" ? endedAtMs! : now) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);
  // Temps impose : compte a rebours, rouge dans les 10 dernieres minutes, « temps ecoule » au bout.
  const capMs = bundle.capMin !== null ? bundle.capMin * 60_000 : null;
  // Horloge des zombies : figee au temps impose (le serveur ne constate plus de rattrapage au-dela).
  const zombieMs = capMs !== null ? Math.min(liveMs, capMs) : liveMs;
  const restMs = capMs !== null ? capMs - liveMs : null;
  const timeUp = phase === "run" && restMs !== null && restMs <= 0;
  const redZone = phase === "run" && restMs !== null && restMs > 0 && restMs <= 10 * 60_000;
  function handleCap() {
    const v = prompt("Temps imposé en minutes de chrono (vide = temps libre) :", bundle.capMin !== null ? String(bundle.capMin) : "");
    if (v === null) return;
    const n = v.trim() === "" ? null : Number(v.replace(",", "."));
    if (n !== null && !Number.isFinite(n)) { setError("Nombre de minutes invalide."); return; }
    run(() => setLevelCapAction(sessionId, n));
  }

  // Coches effectives = base + optimistes (ajouts et retraits en attente).
  const ticks: Tick[] = useMemo(() => {
    const out: Tick[] = live.ticks.filter((t) => optimistic.get(`${t.teamId}_${t.level}_${t.card}`) !== false).map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: t.atMs }));
    for (const [key, on] of optimistic) {
      if (!on) continue;
      const [teamId, level, card] = key.split("_");
      if (!out.some((t) => t.teamId === teamId && t.level === Number(level) && t.card === Number(card))) out.push({ teamId, level: Number(level), card: Number(card), atMs: liveMs });
    }
    return out;
  }, [live.ticks, optimistic, liveMs]);
  // Echelle de chaque equipe : son parcours (1, 2 ou 3 etoiles), dans son ordre.
  const ladderOf = useCallback((teamId: string) => orderedLevels(ladderFor(levels, bundle.ladders, teamStarsOf(bundle.teamStars, teamId)), bundle.levelOrder?.[teamId]), [levels, bundle.ladders, bundle.teamStars, bundle.levelOrder]);
  const starsOf = useCallback((teamId: string): Stars => teamStarsOf(bundle.teamStars, teamId), [bundle.teamStars]);
  const levelOf = useCallback((teamId: string, number: number | null) => (number === null ? null : ladderOf(teamId).find((l) => l.number === number) ?? null), [ladderOf]);
  const allLevels = useMemo(() => [levels, ...Object.values(bundle.ladders)].flat(), [levels, bundle.ladders]);
  const progress = useMemo(() => new Map(teams.map((t) => [t.id, progressOf(ladderOf(t.id), t.id, ticks, live.losses, live.penalties)])), [teams, ladderOf, ticks, live.losses, live.penalties]);
  // Classement : niveaux, vies, pieces gagnees (echauffement compris), fiches, rapidite.
  const coinsForRank = useMemo(() => { const m = new Map<string, number>(); if (!bundle.emom) for (const t of teams) { const st = coinsState(ladderOf(t.id), t.id, ticks, live.losses, live.penalties, live.coinEvents, bundle.coinsCarry, bundle.child?.kind === "warmup" ? warmupCoinsInPlay : coinsInPlay); m.set(t.id, st.earned + st.carry); } return m; }, [teams, ladderOf, ticks, live.losses, live.penalties, live.coinEvents, bundle.coinsCarry, bundle.child, bundle.emom]);
  const ranked = useMemo(() => rankTeams([...progress.values()], (id) => coinsForRank.get(id) ?? 0), [progress, coinsForRank]);
  // Rang DANS SON PARCOURS : un niveau 12 du 1 etoile ne se compare pas a un niveau 10 du 3 etoiles.
  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const st of STARS) ranked.filter((p) => starsOf(p.teamId) === st).forEach((p, i) => m.set(p.teamId, i + 1));
    return m;
  }, [ranked, starsOf]);
  const groupSize = useMemo(() => {
    const m = new Map<Stars, number>();
    for (const t of teams) m.set(starsOf(t.id), (m.get(starsOf(t.id)) ?? 0) + 1);
    return m;
  }, [teams, starsOf]);
  // Pieces (echauffement et WOD, pas le finisher) : gagnees d'apres les coches, banque = gagnees + report - depenses.
  const coinsOn = !bundle.emom;
  const inPlay = bundle.child?.kind === "warmup" ? warmupCoinsInPlay : coinsInPlay;
  const coinsOf = useMemo(() => new Map(teams.map((t) => [t.id, coinsState(ladderOf(t.id), t.id, ticks, live.losses, live.penalties, live.coinEvents, bundle.coinsCarry, inPlay)])), [teams, ladderOf, ticks, live.losses, live.penalties, live.coinEvents, bundle.coinsCarry, inPlay]);
  function discount(teamId: string, reps: number) {
    setError("");
    void discountAction(sessionId, teamId, reps).then((res) => { if ("error" in res) setError(res.error); else mergeTeam(res.team); });
  }
  const [rocketFor, setRocketFor] = useState<string | null>(null);
  const [flight, setFlight] = useState<{ id: number; from: { x: number; y: number }; to: { x: number; y: number }; toId: string; text: string } | null>(null);
  // Impact : la ligne visee tremble et affiche ce qu'elle vient de recevoir.
  const [impact, setImpact] = useState<{ id: number; teamId: string; text: string } | null>(null);
  function launchRocket(fromId: string, exerciseId: string, reps: number, toId: string, label: string) {
    setError("");
    void sendRocketAction(sessionId, fromId, exerciseId, reps, toId).then((res) => {
      if ("error" in res) { setError(res.error); return; }
      setRocketFor(null);
      mergeTeam(res.team);
      // La fusee decolle de la ligne de l'expediteur, monte en arc et vient percuter la ligne de la cible.
      const a = document.getElementById(`team-row-${fromId}`)?.getBoundingClientRect();
      const b = document.getElementById(`team-row-${toId}`)?.getBoundingClientRect();
      const text = `💥 +${reps} ${cap(label)} reçus de ${teamById.get(fromId)?.name ?? "l'adversaire"}`;
      if (a && b) setFlight({ id: Date.now(), from: { x: a.right - 70, y: a.top + a.height / 2 - 18 }, to: { x: b.left + 120, y: b.top + b.height / 2 - 18 }, toId, text });
      else setImpact({ id: Date.now(), teamId: toId, text });
      // La cible a une nouvelle fiche : relecture complete de l'etat vivant.
      void levelLiveAction(sessionId).then((l) => { if (!("error" in l)) applyLive(l); });
    });
  }
  // Classement par parcours pour les cibles de fusee.
  const rocketRows = useMemo(() => teams.map((t) => { const st = starsOf(t.id); return { teamId: t.id, stars: st, rankInStars: rankOf.get(t.id) ?? 0, groupSize: groupSize.get(st) ?? 1, finished: progress.get(t.id)?.currentLevel === null }; }), [teams, starsOf, rankOf, groupSize, progress]);
  function createStar(st: Stars) { run(async () => { const r = await createStarTeamAction(sessionId, st); return "error" in r ? r : { ok: true }; }); }
  function numberTeams() { run(async () => { const r = await numberTeamsAction(sessionId); return "error" in r ? r : { ok: true }; }); }
  const cardsOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of live.yellowCards) m.set(c.teamId, (m.get(c.teamId) ?? 0) + 1);
    return m;
  }, [live.yellowCards]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  // Totaux des phases (echauffement + finisher) par equipe : classement, reps et export les additionnent au WOD.
  const extras = useMemo(() => new Map(teams.map((t) => [t.id, extrasFor(bundle.phases, t.order)])), [teams, bundle.phases]);
  // Finisher : a chaque changement de vague, relecture apres 1,5 s (le serveur constate les vagues perdues a leur fin).
  const emomWaveNo = bundle.emom ? (emomWaveAt(bundle.emom.waveMinutes, liveMs)?.wave ?? (liveMs >= emomTotalMs(bundle.emom.waveMinutes) ? 99 : 0)) : -1;
  useEffect(() => {
    if (emomWaveNo <= 1 || phase !== "run") return;
    const h = setTimeout(() => { void levelLiveAction(sessionId).then((l) => { if (!("error" in l)) applyLive(l); }); }, 1500);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emomWaveNo, phase, sessionId]);
  // Mode zombies : quand un zombie touche un coeur, c'est le serveur qui tranche ; l'ecran se contente de
  // demander une relecture (une seule par rattrapage, pas a chaque seconde).
  const [caughtRefreshAt, setCaughtRefreshAt] = useState(0);
  useEffect(() => {
    if (!bundle.zombies || phase !== "run" || isPaused) return;
    const raceNow = zombieMs;
    const due = [...progress.values()].some((p) => {
      if (p.currentLevel === null) return false;
      const l = levelOf(p.teamId, p.currentLevel);
      if (!l) return false;
      const ev = attemptEvents(l, p.teamId, ticks, p.attemptStartMs, live.penalties);
      return zombieSim(l, ev.initialTotalSec, ev.events, raceNow - p.attemptStartMs, bundle.zombieSpeed ?? zombieSpeedLevel(l.number, p.losses), cardsForTeam(l, p.teamId, live.penalties).length).catchAtMs !== null;
    });
    if (due && Date.now() - caughtRefreshAt > 4000) {
      setCaughtRefreshAt(Date.now());
      void levelLiveAction(sessionId).then((l) => { if (!("error" in l)) applyLive(l); });
    }
  }, [bundle.zombies, phase, isPaused, zombieMs, progress, levelOf, caughtRefreshAt, sessionId, live.penalties, ticks]);

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
    if (!levels.some((l) => activeCards(l).length > 0)) {
      setError("L'échelle est vide : compose les niveaux dans l'atelier Level avant de lancer.");
      return;
    }
    if (!bundle.frozen && !confirm(`Figer l'échelle (${levels.length} niveaux) dans cette séance et lancer le chrono ?`)) return;
    toggleFullscreen(true); // geste utilisateur : le navigateur accepte le plein ecran ici
    run(() => startLevelAction(sessionId));
  }
  function handleEnd() {
    if (!confirm("Fin du WOD ? Le chrono s'arrête et le classement est figé.")) return;
    run(() => endLevelAction(sessionId));
  }
  function toggleCard(teamId: string, level: number, card: number, done: boolean) {
    if (phase !== "run" || isPaused) return;
    if (done && !confirm("Annuler cette coche ?")) return;
    const key = `${teamId}_${level}_${card}`;
    setError("");
    setOptimistic((m) => new Map(m).set(key, !done));
    // Pas de useTransition ici : les taps rapides partent en parallele, chacun remplace la ligne de son equipe.
    void (done ? untickCardAction(sessionId, teamId, level, card) : tickCardAction(sessionId, teamId, level, card)).then((res) => {
      if ("error" in res) {
        setError(res.error);
        setOptimistic((m) => { const n = new Map(m); n.delete(key); return n; });
        return;
      }
      mergeTeam(res.team, key);
      if (res.caught) setError(bundle.emom ? `Le zombie a dévoré le cœur de ${teamById.get(teamId)?.name ?? "l'équipe"} : vague perdue.` : `Le zombie a rattrapé ${teamById.get(teamId)?.name ?? "l'équipe"} : elle retombe au niveau précédent.`);
    });
  }
  function yellow(teamId: string, delta: 1 | -1) {
    setError("");
    void levelYellowCardAction(sessionId, teamId, delta).then((res) => {
      if ("error" in res) setError(res.error);
      else mergeTeam(res.team);
    });
  }

  function exportCsv() {
    const exercises = exerciseColumnsWith(allLevels, extras);
    const hasPhases = bundle.phases.length > 0;
    const head = ["Rang (dans son parcours)", "Équipe", "Parcours", "Membres", "Niveaux bouclés", "Niveau en cours", "Fiches du niveau", "Dernière coche", "Reps", "Travail (s)", "Cartes jaunes", "Vies perdues", "Pièces gagnées", "Pièces en banque", "Échelle bouclée à", ...(hasPhases ? ["Reps WOD seul", ...bundle.phases.map((ph) => `Reps ${ph.kind === "warmup" ? "échauffement" : "finisher"}`), "Finisher (cordes)"] : []), ...exercises];
    const lines = ranked.map((p) => {
      const t = teamById.get(p.teamId)!;
      const ex = extras.get(p.teamId) ?? extrasFor([], 0);
      return [
        rankOf.get(p.teamId), t.name, starsLabel(starsOf(p.teamId)), t.members.map((m) => m.name).join(" / "), p.completedLevels, p.currentLevel ?? "terminé",
        p.currentLevel ? `${p.currentDone}/${p.currentTotal}` : "", p.lastTickMs !== null ? fmt(p.lastTickMs) : "", p.reps + ex.reps, Math.round(p.weighted + ex.work), (cardsOf.get(p.teamId) ?? 0) + ex.cards, p.losses + ex.losses,
        (coinsOf.get(p.teamId)?.earned ?? 0) + (coinsOf.get(p.teamId)?.carry ?? 0), coinsOf.get(p.teamId)?.bank ?? 0,
        p.finishedMs !== null ? fmt(p.finishedMs) : "", ...(hasPhases ? [p.reps, ...bundle.phases.map((ph) => ph.byOrder[t.order]?.reps ?? 0), ex.score ?? ""] : []), ...exercises.map((e) => (p.repsByExercise[e] ?? 0) + (ex.repsByExercise[e] ?? 0)),
      ];
    });
    const csv = [head, ...lines].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (n: number) => (n < 10 ? "0" : "") + n;
    a.href = url;
    a.download = `level_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const tabBtn = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg transition", on ? ui.segOn : ui.segOff);
  const canTick = phase === "run" && !isPaused && !timeUp;

  return (
    <div className={`${ui.page} pb-28`}>
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      <header className={cx("sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4", focus ? "py-1" : "py-2")}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            {focus ? (
              <p className="text-sm font-bold leading-tight truncate">{sessionLabel}{classes.length > 0 && <span className="text-ink-2 font-semibold"> · {classes.join(", ")}</span>}</p>
            ) : (
              <>
                <span className={ui.eyebrow}>Greffier · Level</span>
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
              </>
            )}
          </div>
          <div className="text-center">
            <p className={cx("font-display font-extrabold leading-none tracking-tight tabular-nums", focus ? "text-[3rem]" : "text-[3.4rem]", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : timeUp || redZone ? "text-danger" : "text-ink")}>{fmt(liveMs) || "0:00"}</p>
            {restMs !== null && phase !== "pre" && (
              <p className={cx("text-sm font-bold tabular-nums", timeUp ? "text-danger" : redZone ? "text-danger" : "text-ink-2")}>{timeUp ? "⏱ TEMPS ÉCOULÉ" : `reste ${fmt(Math.max(0, restMs))}`}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-2">{phase === "pre" ? "Chrono à l'arrêt" : phase === "post" ? "WOD terminé" : isPaused ? "EN PAUSE — coches bloquées" : timeUp ? "Temps écoulé — déclare la fin du WOD" : "WOD en cours"}</p>
            {!focus && (
              <>
                <button type="button" onClick={handleCap} disabled={pending || phase === "post"} className={ui.hint + " underline"} title="Temps imposé (minutes de chrono), vide = libre">⏱ {bundle.capMin !== null ? `temps imposé : ${bundle.capMin} min` : "temps libre"}</button>
                <p className={ui.hint}>Échelle : {levels.length} niveau{levels.length > 1 ? "x" : ""}{bundle.frozen ? " · figée" : " · vive (figée au départ)"}</p>
              </>
            )}
          </div>
        </div>
        {bundle.child && (
          <p className={`${ui.alertInfo} mt-2 flex flex-wrap items-center gap-2`}>
            <b>{bundle.child.kind === "warmup" ? "🔥 Échauffement" : "🏁 Finisher"}</b> de « {bundle.child.parentLabel} »{bundle.child.kind === "warmup" && <> · départs en différé (une série par équipe), zombies du palier 1, BOSS = horde</>}.
            {phase === "run" ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirm(`Terminer ${bundle.child?.kind === "warmup" ? "l'échauffement" : "le finisher"} (chrono arrêté, classement figé) et revenir au WOD principal ?`) && run(async () => {
                    const r = await endLevelAction(sessionId);
                    if ("ok" in r) router.push(`/greffier?session=${bundle.child!.parentId}`);
                    return r;
                  })}
                  className={`${btn.smPrimary} ml-auto`}
                >
                  🏁 Terminer et revenir au WOD principal
                </button>
                <a href={`/greffier?session=${bundle.child.parentId}`} className={btn.smGhost} title="Le chrono de cette séance continue">revenir sans terminer</a>
              </>
            ) : (
              <a href={`/greffier?session=${bundle.child.parentId}`} className={`${btn.smPrimary} ml-auto`}>← Retour au WOD principal</a>
            )}
          </p>
        )}
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
      </header>

      <main className="max-w-[1800px] mx-auto p-3 sm:p-4">
        {view === "race" && (
          <>
            {teams.length === 0 ? (
              <p className={`${ui.cardPad} ${ui.muted}`}>Aucune équipe : compose-les dans l&apos;onglet « Équipes &amp; arbitres ».</p>
            ) : bundle.emom ? (
              <EmomBoard
                waveMinutes={bundle.emom.waveMinutes}
                levels={levels}
                teams={teams}
                ticks={ticks}
                scores={live.emomScores}
                losses={live.losses}
                raceMs={liveMs}
                canTick={canTick}
                pendingKeys={optimistic}
                zombies={bundle.zombies}
                zombieSpeed={bundle.zombieSpeed ?? EMOM_ZOMBIE_SPEED}
                running={phase === "run" && !isPaused}
                onToggle={toggleCard}
                onScore={(teamId, reps) => { setError(""); void setEmomScoreAction(sessionId, teamId, reps).then((res) => { if ("error" in res) setError(res.error); else mergeTeam(res.team); }); }}
              />
            ) : (
              <>
              <div className="flex flex-col gap-2">
                {[3, 2, 1].filter((st): st is Stars => teams.some((t) => starsOf(t.id) === st)).map((st) => {
                  const group = ranked.filter((p) => starsOf(p.teamId) === st);
                  return (
                    <section key={st} className="rounded-2xl p-1.5 flex flex-col gap-1.5" style={{ background: STAR_BG[st] }}>
                      <p className="px-2 pt-0.5 text-[11px] font-display font-extrabold tracking-widest text-ink/60 uppercase">{starsLabel(st)} Parcours {starsName(st)} · {group.length} équipe{group.length > 1 ? "s" : ""}</p>
                      {group.map((p) => {
                        const t = teamById.get(p.teamId)!;
                        return (
                          <motion.div key={t.id} layout transition={{ type: "spring", stiffness: 260, damping: 28 }} id={`team-row-${t.id}`}>
                            <TeamRow
                              team={t}
                              progress={p}
                              level={levelOf(t.id, p.currentLevel)}
                              stars={st}
                              rank={rankOf.get(t.id) ?? 0}
                              teamsCount={group.length}
                              yellow={cardsOf.get(t.id) ?? 0}
                              canTick={canTick}
                              pendingKeys={optimistic}
                              zombies={bundle.zombies}
                              fixedSpeed={bundle.zombieSpeed}
                              penalties={live.penalties.filter((x) => x.teamId === t.id)}
                              ticks={ticks}
                              raceMs={zombieMs}
                              running={phase === "run" && !isPaused && !timeUp}
                              coins={coinsOn ? coinsOf.get(t.id) ?? null : null}
                              impact={impact?.teamId === t.id ? impact : null}
                              onDiscount={(reps) => discount(t.id, reps)}
                              onRocket={() => setRocketFor(t.id)}
                              onToggle={(level, card, done) => toggleCard(t.id, level, card, done)}
                              onYellow={(delta) => yellow(t.id, delta)}
                            />
                          </motion.div>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
              <AnimatePresence>
                {flight && (
                  <motion.span
                    key={flight.id}
                    initial={{ x: flight.from.x, y: flight.from.y, rotate: -10, scale: 0.8, opacity: 1 }}
                    animate={{ x: [flight.from.x, (flight.from.x + flight.to.x) / 2, flight.to.x], y: [flight.from.y, Math.min(flight.from.y, flight.to.y) - 160, flight.to.y], rotate: [-10, -40, 30], scale: [0.8, 1.7, 1] }}
                    exit={{ opacity: 0, scale: 2.5 }}
                    transition={{ duration: 1.4, ease: "easeInOut", times: [0, 0.5, 1] }}
                    onAnimationComplete={() => { setImpact({ id: Date.now(), teamId: flight.toId, text: flight.text }); setTimeout(() => setFlight(null), 120); }}
                    className="fixed left-0 top-0 z-50 text-4xl pointer-events-none drop-shadow-lg"
                  >🚀</motion.span>
                )}
              </AnimatePresence>
              {rocketFor && (
                <RocketMenu
                  team={teamById.get(rocketFor)!}
                  stars={starsOf(rocketFor)}
                  coins={coinsOf.get(rocketFor) ?? null}
                  mastered={masteredExercises(ladderOf(rocketFor), rocketFor, ticks, live.penalties)}
                  targets={rocketTargets(rocketFor, rocketRows).map((r) => ({ id: r.teamId, name: teamById.get(r.teamId)?.name ?? "?", stars: r.stars, rank: r.rankInStars }))}
                  sameGroupOnly={rocketRows.filter((r) => r.stars === starsOf(rocketFor) && r.teamId !== rocketFor).length >= 2}
                  onSend={(exerciseId, reps, toId, label) => launchRocket(rocketFor, exerciseId, reps, toId, label)}
                  onClose={() => setRocketFor(null)}
                />
              )}
              </>
            )}
          </>
        )}

        {view === "results" && <ResultsTable ranked={ranked} teamById={teamById} levelOf={levelOf} rankOf={rankOf} starsOf={starsOf} cardsOf={cardsOf} extras={extras} phases={bundle.phases} coinsOf={coinsOn ? coinsOf : null} />}
        {view === "recap" && <RecapTable ranked={ranked} teamById={teamById} levels={allLevels} extras={extras} phases={bundle.phases} />}
        {view === "ladder" && (bundle.frozen ? (
          <LevelLadderEditor sessionId={sessionId} levels={levels} ladders={bundle.ladders} teamStars={bundle.teamStars} catalog={bundle.catalog} ticks={live.ticks} onSaved={refresh} />
        ) : (
          <LadderPreview levels={levels} ladders={bundle.ladders} />
        ))}
        {view === "records" && <RecordsTab isMaster={isMaster} sessionId={sessionId} wod="level" />}
        {view === "arbitrage" && <LevelArbitrage evaluations={bundle.evaluations} onChanged={refresh} />}
        {view === "settings" && <LevelSettings sessionId={sessionId} phase={phase} numTeams={teams.length} capMin={bundle.capMin} refereeMode={bundle.refereeMode} levelsCount={levels.length} frozen={bundle.frozen} zombies={bundle.zombies} teamList={teams} teamStars={bundle.teamStars} ladders={bundle.ladders} isChild={!!bundle.child} onChanged={refresh} />}
        {view === "teams" && <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} picker={picker} starsOf={bundle.child ? undefined : starsOf} onCreateStar={bundle.child || phase !== "pre" ? undefined : createStar} onNumber={bundle.child || phase !== "pre" ? undefined : numberTeams} />}
      </main>

      <footer className="fixed bottom-0 inset-x-0 z-20 bg-card/95 backdrop-blur border-t border-line px-2 py-1.5">
        <div className="max-w-[1800px] mx-auto flex flex-nowrap items-center gap-2 overflow-x-auto">
          <div className={`${ui.segmented} flex-nowrap flex-shrink-0`}>
            <button onClick={() => setView("race")} className={tabBtn(view === "race")}>Course</button>
            <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Classement</button>
            <button onClick={() => setView("recap")} className={tabBtn(view === "recap")}>Reps</button>
            <button onClick={() => setView("ladder")} className={tabBtn(view === "ladder")}>Échelle</button>
            <button onClick={() => setView("records")} className={tabBtn(view === "records")}>🏆</button>
            <button onClick={() => setView("arbitrage")} className={tabBtn(view === "arbitrage")}>
              Arbitrage <span className={`${ui.chip} ${ui.chipAccent} ml-1`}>{bundle.evaluations.length}</span>
            </button>
            <button onClick={() => setView("settings")} className={tabBtn(view === "settings")}>⚙️</button>
            <button onClick={() => setView("teams")} className={tabBtn(view === "teams")}>
              Équipes <span className={cx(ui.chip, "ml-1", memberCount ? ui.chipOk : ui.chipWarn)}>{memberCount}</span>
              {referees.length > 0 && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>💣 {referees.length}</span>}
            </button>
          </div>
          <div className="ml-auto flex flex-nowrap items-center gap-2 flex-shrink-0 relative">
            {!bundle.child && phase !== "run" && (
              <button
                onClick={() => confirm(`Lancer l'${phase === "pre" ? "échauffement" : "échauffement (le WOD principal est terminé)"} ? Une séance à part s'ouvre avec les mêmes équipes : 5 séries en différé + BOSS.`) && run(async () => {
                  const r = await startChildAction(sessionId, "warmup");
                  if ("ok" in r) router.push(`/greffier?session=${r.id}`);
                  return r;
                })}
                disabled={pending || teams.length === 0}
                className={btn.lgGhost}
                title="Échauffement : 5 séries (A-E) en différé + BOSS, zombies du palier 1, sur une séance à part"
              >
                🔥 Échauffement
              </button>
            )}
            {!bundle.child && phase === "post" && (
              <button
                onClick={() => confirm("Lancer le finisher ? Une séance à part s'ouvre avec les mêmes équipes.") && run(async () => {
                  const r = await startChildAction(sessionId, "finisher");
                  if ("ok" in r) router.push(`/greffier?session=${r.id}`);
                  return r;
                })}
                disabled={pending || teams.length === 0}
                className={btn.lgGhost}
                title="Finisher : une séance à part avec les mêmes équipes"
              >
                🏁 Finisher
              </button>
            )}
            {phase === "pre" && <button onClick={handleStart} disabled={pending || teams.length === 0} className={btn.lgSuccess}>Lancer le WOD</button>}
            {phase === "run" && (
              <>
                <button onClick={() => run(() => levelPauseAction(sessionId))} disabled={pending} className={isPaused ? btn.lgSuccess : btn.lgAccent}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleEnd} disabled={pending} className={btn.lgDanger}>Fin du WOD</button>
              </>
            )}
            {phase === "post" && <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 WOD terminé</span>}
            <button type="button" onClick={() => setMoreOpen((v) => !v)} className={btn.lgGhost} aria-label="Plus d'actions" title="Exporter, arbitrer, plein écran, déconnexion">⋯</button>
            {moreOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-56 rounded-2xl bg-card border border-line shadow-pop p-2 flex flex-col gap-1" onMouseLeave={() => setMoreOpen(false)}>
                <button type="button" onClick={() => { setMoreOpen(false); exportCsv(); }} className={btn.ghost}>📤 Exporter (CSV)</button>
                <a href={`/touche-coule?session=${sessionId}`} className={btn.ghost} title="Ouvrir le démineur des arbitres pour cette séance">💣 Arbitrer</a>
                <button type="button" onClick={() => { setMoreOpen(false); toggleFullscreen(); }} className={btn.ghost}>⛶ Plein écran</button>
                <LogoutButton />
              </div>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

function liveFromBundle(b: LevelBundle): LevelLive {
  return { ticks: b.ticks, losses: b.losses, yellowCards: b.yellowCards, penalties: b.penalties, emomScores: b.emomScores, coinEvents: b.coinEvents, pauses: b.pauses, startedAtMs: b.startedAtMs, endedAtMs: b.endedAtMs, raceEndedAtMs: b.raceEndedAtMs, structure: "", at: 0 };
}

// ===== Finisher EMOM : vague en cours pour tout le monde, fiches decouvertes une a une, score max =====
function EmomBoard({ waveMinutes, levels, teams, ticks, losses, scores, raceMs, canTick, pendingKeys, zombies, zombieSpeed, running, onToggle, onScore }: {
  waveMinutes: number[];
  levels: FrozenLevel[];
  teams: LevelTeam[];
  ticks: Tick[];
  losses: { teamId: string; level: number; atMs: number }[];
  scores: Record<string, number>;
  raceMs: number;
  canTick: boolean;
  pendingKeys: Map<string, boolean>;
  zombies: boolean;
  zombieSpeed: number;
  running: boolean;
  onToggle: (teamId: string, level: number, card: number, done: boolean) => void;
  onScore: (teamId: string, reps: number) => void;
}) {
  const wave = emomWaveAt(waveMinutes, raceMs);
  const schedule = emomSchedule(waveMinutes);
  const over = raceMs >= emomTotalMs(waveMinutes);
  const progress = teams.map((t) => emomProgress(levels, t.id, ticks, scores, losses));
  const ranked = emomRank(progress);
  const rankOf = new Map(ranked.map((p, i) => [p.teamId, i + 1]));
  const current = wave ? levels.find((l) => l.number === wave.wave) ?? null : null;
  const isMax = !!current && activeCards(current).length === 0;
  return (
    <div className="space-y-2">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-3`}>
        <div className="flex gap-1">
          {schedule.map((w) => (
            <span key={w.wave} className={cx(ui.chip, wave?.wave === w.wave ? ui.chipBrand : raceMs >= w.endMs ? ui.chipOk : ui.chipMuted)}>V{w.wave} · {waveMinutes[w.wave - 1]}&apos;</span>
          ))}
        </div>
        {wave ? (
          <p className="font-display font-extrabold text-2xl tabular-nums">
            Vague {wave.wave} <span className="text-ink-2 text-base">· {current?.name?.replace(/^Vague \d+ · /, "") ?? ""}</span> · reste <span className={cx((wave.endMs - raceMs) <= 10_000 && "text-danger")}>{fmt(Math.max(0, wave.endMs - raceMs))}</span>
          </p>
        ) : (
          <p className="font-display font-extrabold text-xl text-success-ink">{over ? "🏁 EMOM terminé — saisis les maximums de cordes s'il en manque" : "Prêt"}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {teams.map((t) => (
          <EmomRow
            key={t.id}
            team={t}
            progress={progress.find((x) => x.teamId === t.id)!}
            rank={rankOf.get(t.id) ?? 0}
            wave={wave}
            current={current}
            isMax={isMax}
            over={over}
            ticks={ticks}
            raceMs={raceMs}
            canTick={canTick}
            pendingKeys={pendingKeys}
            zombies={zombies}
            zombieSpeed={zombieSpeed}
            running={running}
            onToggle={onToggle}
            onScore={onScore}
          />
        ))}
      </div>
      <p className={ui.hint}>Les vagues s&apos;enchaînent au chrono, qu&apos;une équipe ait fini ou non. Dans une vague, la fiche suivante n&apos;apparaît qu&apos;une fois la précédente cochée. La dernière vague est un maximum de cordes : saisis le total, c&apos;est le score final.{zombies && <> Un zombie du palier {zombieTier(zombieSpeed)} part à chaque vague : il dévore le cœur si la vague n&apos;est pas bouclée à sa fin (💔 une vie).</>}</p>
    </div>
  );
}

// Une equipe du finisher : rang, vagues, zombie de la vague en cours (palier 10), fiches a decouvrir.
function EmomRow({ team: t, progress: p, rank, wave, current, isMax, over, ticks, raceMs, canTick, pendingKeys, zombies, zombieSpeed, running, onToggle, onScore }: {
  team: LevelTeam;
  progress: EmomTeam;
  rank: number;
  wave: EmomWave | null;
  current: FrozenLevel | null;
  isMax: boolean;
  over: boolean;
  ticks: Tick[];
  raceMs: number;
  canTick: boolean;
  pendingKeys: Map<string, boolean>;
  zombies: boolean;
  zombieSpeed: number;
  running: boolean;
  onToggle: (teamId: string, level: number, card: number, done: boolean) => void;
  onScore: (teamId: string, reps: number) => void;
}) {
  const next = current && !isMax ? emomNextCard(current, t.id, ticks) : null;
  const cards = current ? activeCards(current) : [];
  const doneCards = current ? cards.filter(({ index }) => ticks.some((k) => k.teamId === t.id && k.level === current.number && k.card === index)) : [];
  const sim = zombies && wave && current ? emomZombieSim(wave.endMs - wave.startMs, cards.length, cards.reduce((s, x) => s + cardSeconds(x.card), 0), emomWaveEvents(current, t.id, ticks, wave), raceMs - wave.startMs, zombieSpeed) : null;
  // Vague perdue : coeur zombifie et ligne rouge pendant 3 s quand une vie tombe.
  const [lostFlash, setLostFlash] = useState(false);
  const prevLosses = useRef(p.losses);
  useEffect(() => {
    if (p.losses > prevLosses.current) {
      prevLosses.current = p.losses;
      setLostFlash(true);
      const h = setTimeout(() => setLostFlash(false), 3000);
      return () => clearTimeout(h);
    }
    prevLosses.current = p.losses;
  }, [p.losses]);
  const danger = !!sim && (sim.contact || (!sim.done && cards.length > 0 && sim.remainingMs <= 20_000));
  return (
    <section title={t.members.map((m) => m.name).join(", ")} className={cx(ui.card, "px-2 py-1.5 flex items-center gap-3 min-w-0 h-20 transition-colors", danger && "ring-2 ring-danger", lostFlash && "bg-danger-soft animate-pulse")}>
      <span className={cx("w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-display font-black leading-none flex-shrink-0 shadow-sm", rankStyle(rank))} title="Classement du finisher">
        {p.score !== null || p.wavesDone > 0 ? (
          <>
            <span className="text-[9px] font-bold tracking-widest opacity-70">{rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "RANG"}</span>
            <span className="text-2xl">#<Odometer value={rank} /></span>
          </>
        ) : "—"}
      </span>
      <div className="w-[190px] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="inline-flex items-center rounded-md bg-ink text-white font-display font-extrabold text-[11px] px-1.5 py-0.5 uppercase tracking-wide truncate">{t.name}</span>
          {zombies && <span className="text-xs font-bold tabular-nums" title="Vagues perdues">💔<Odometer value={p.losses} /></span>}
        </div>
        <p className="text-[11px] text-ink-2 tabular-nums mt-0.5">{p.wavesDone} vague{p.wavesDone > 1 ? "s" : ""} bouclée{p.wavesDone > 1 ? "s" : ""}{p.score !== null && <> · <b className="text-ink">{p.score} cordes</b></>}</p>
        <p className="text-[10px] text-ink-3 tabular-nums">{p.doneByWave.map((n, i) => `V${i + 1} ${n}`).join(" · ")}</p>
      </div>
      {sim && (
        <div className="relative w-[220px] h-full flex-shrink-0" title={sim.done ? "Vague bouclée : le zombie s'arrête" : sim.contact ? `Le zombie dévore le cœur : boucle la vague avant ${fmt(Math.max(0, sim.remainingMs))}` : cards.length ? `Le zombie mord dans ${fmt(Math.max(0, sim.remainingMs - sim.eatMs))}` : "Vague MAX : le zombie arrive à la fin, sans mordre"}>
          <div className="absolute top-1/2 -translate-y-1/2 z-10" style={{ left: `calc(${(lostFlash ? sim.heart : sim.zombie) * 100}% - ${Math.round(24 + 56 * Math.min(1, (lostFlash ? sim.heart : sim.zombie) / Math.max(0.01, sim.heart)))}px)`, transition: "left 1s linear" }}>
            <Zombie kind={zombieTier(zombieSpeed)} moving={running && !sim.contact && !sim.done && !lostFlash} />
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-full z-10 transition-[left] duration-300" style={{ left: `${sim.heart * 100}%` }}>
            <Heart state={lostFlash ? HEART_STATES - 1 : sim.bites} beating={sim.contact || lostFlash} />
          </div>
        </div>
      )}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {current && !isMax && (
          <>
            {doneCards.map(({ card, index }) => <span key={index} className={cx(ui.chip, ui.chipOk)}>✓ {card.reps} {cap(card.label)}</span>)}
            {next ? (
              <button type="button" disabled={!canTick || pendingKeys.has(`${t.id}_${current.number}_${next.index}`)} onClick={() => onToggle(t.id, current.number, next.index, false)} className="flex-1 min-w-0 max-w-[360px] h-14 rounded-xl border-2 border-brand bg-card hover:bg-brand-soft flex items-center gap-2 px-3 text-left active:scale-[.98] disabled:opacity-50">
                <span className="font-display font-extrabold text-2xl tabular-nums">{next.card.reps}</span>
                <span className="font-bold text-sm">{cap(next.card.label)}</span>
                <span className={`${ui.hint} ml-auto`}>fiche {doneCards.length + 1}/{cards.length}</span>
              </button>
            ) : (
              <span className={cx(ui.chip, ui.chipOk, "text-sm px-3 py-1")}>🏁 Vague {current.number} bouclée</span>
            )}
            {doneCards.length > 0 && <button type="button" disabled={!canTick} onClick={() => onToggle(t.id, current.number, doneCards[doneCards.length - 1].index, true)} className="text-[10px] text-ink-3 underline">annuler</button>}
          </>
        )}
        {(isMax || over) && <ScoreInput value={p.score} disabled={!canTick && !over} onSubmit={(n) => onScore(t.id, n)} />}
        {!current && !over && <span className={ui.hint}>En attente du départ.</span>}
      </div>
    </section>
  );
}

// Menu de la fusee : exercice maitrise, quantite (prix = reps x ponderation), cible (meme parcours sauf s'il
// manque d'adversaires, jamais la derniere, jamais une equipe arrivee au bout).
function RocketMenu({ team, stars, coins, mastered, targets, sameGroupOnly, onSend, onClose }: {
  team: LevelTeam; stars: Stars; coins: CoinsState | null; mastered: ReturnType<typeof masteredExercises>; targets: { id: string; name: string; stars: Stars; rank: number }[]; sameGroupOnly: boolean;
  onSend: (exerciseId: string, reps: number, toId: string, label: string) => void; onClose: () => void;
}) {
  const [pick, setPick] = useState<{ exerciseId: string; reps: number; price: number; label: string } | null>(null);
  const bank = coins?.bank ?? 0;
  return (
    <div className="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={cx(ui.card, "w-full max-w-2xl p-4 space-y-3")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-3xl">🚀</span>
          <div className="flex-1">
            <p className="font-display font-extrabold text-lg">Fusée de {team.name} <span className="text-accent-ink text-sm">{starsLabel(stars)}</span></p>
            <p className={ui.hint}>Banque : <b className="text-ink">{bank} 🪙</b> · 1 pièce = 1 seconde de travail (reps × pondération). L'équipe visée reçoit la fiche à son prochain niveau.</p>
          </div>
          <button type="button" onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {mastered.length === 0 ? (
          <p className={ui.alertInfo}>Aucun exercice maîtrisé pour l&apos;instant : il faut avoir coché 3 fiches d&apos;un même exercice pour pouvoir l&apos;envoyer.</p>
        ) : (
          <div className="space-y-1.5">
            <p className={ui.eyebrow}>1 · Exercice maîtrisé et quantité</p>
            {mastered.map((m) => (
              <div key={m.exerciseId} className={`${ui.inset} px-2 py-1.5 flex flex-wrap items-center gap-1.5`}>
                <span className="font-bold text-sm w-36 truncate" title={`${m.count} fiches cochées · ${m.weight} 🪙/rep`}>{cap(m.label)} <span className="text-[10px] text-ink-3">×{m.count}</span></span>
                {sendOptions(m.weight).map((o) => (
                  <button key={o.reps} type="button" disabled={o.price > bank} onClick={() => setPick({ exerciseId: m.exerciseId, reps: o.reps, price: o.price, label: m.label })} className={cx("rounded-lg border px-2 py-1 text-xs font-bold disabled:opacity-40", pick?.exerciseId === m.exerciseId && pick.reps === o.reps ? "bg-ink text-white border-ink" : "bg-card border-line-2 hover:border-brand")}>
                    {o.reps} reps · {o.price}🪙
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <p className={ui.eyebrow}>2 · Cible {sameGroupOnly ? `(même parcours ${starsLabel(stars)}, jamais la dernière)` : "(moins de deux adversaires dans le parcours : tout le monde, jamais la dernière d'un parcours)"}</p>
          {targets.length === 0 ? <p className={ui.hint}>Aucune cible possible.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {targets.map((t) => (
                <button key={t.id} type="button" disabled={!pick} onClick={() => pick && onSend(pick.exerciseId, pick.reps, t.id, pick.label)} className={cx(btn.primary, "disabled:opacity-40")} title={pick ? `Envoyer ${pick.reps} ${cap(pick.label)} à ${t.name} pour ${pick.price} pièces` : "Choisis d'abord un exercice et une quantité"}>
                  {t.name} <span className="text-[10px] opacity-80">{starsLabel(t.stars)} #{t.rank}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {pick && <p className={ui.hint}>Sélection : <b className="text-ink">{pick.reps} {cap(pick.label)}</b> pour <b className="text-ink">{pick.price} 🪙</b>. Touche l&apos;équipe visée pour lancer.</p>}
      </div>
    </div>
  );
}

function ScoreInput({ value, disabled, onSubmit }: { value: number | null; disabled: boolean; onSubmit: (n: number) => void }) {
  const [v, setV] = useState(value !== null ? String(value) : "");
  useEffect(() => { setV(value !== null ? String(value) : ""); }, [value]);
  const n = parseInt(v, 10);
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (Number.isInteger(n) && n >= 0) onSubmit(n); }}>
      <span className="text-xs font-bold text-ink-2">MAX cordes</span>
      <input type="number" inputMode="numeric" min={0} max={5000} value={v} onChange={(e) => setV(e.target.value)} className={`${ui.input} w-24 text-lg font-display font-extrabold tabular-nums`} placeholder="0" disabled={disabled} />
      <button type="submit" disabled={disabled || !Number.isInteger(n) || n === value} className={btn.smPrimary}>Valider</button>
    </form>
  );
}

// Colonnes d'exercices du recap : ordre de premiere apparition dans l'echelle.
function exerciseColumns(levels: FrozenLevel[]): string[] {
  const out: string[] = [];
  for (const l of levels) for (const c of l.cards) if (!c.off && !out.includes(c.label)) out.push(c.label);
  return out;
}
function exerciseColumnsWith(levels: FrozenLevel[], extras: Map<string, PhaseTeamTotals>): string[] {
  const out = exerciseColumns(levels);
  for (const ex of extras.values()) for (const label of Object.keys(ex.repsByExercise)) if (!out.includes(label)) out.push(label);
  return out;
}

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Sprites : public/zombies/z01.png .. z13.png (4 frames en ligne) et heart.png (4 etats, mange depuis la gauche).
// Absent -> emoji. Meme cadence de marche pour tous les paliers.
type ZombieKind = number | "boss";
type SpriteKey = ZombieKind | "heart";
const spriteFile = (kind: SpriteKey) => `/zombies/${kind === "boss" ? "boss" : kind === "heart" ? "heart" : "z" + String(kind).padStart(2, "0")}.png`;
const walkSeconds = (_kind: ZombieKind) => 1.2;
const spriteCache = new Map<string, boolean>();
function useSprite(kind: SpriteKey): boolean | null {
  const key = String(kind);
  const [ok, setOk] = useState<boolean | null>(spriteCache.get(key) ?? null);
  useEffect(() => {
    if (spriteCache.has(key)) { setOk(spriteCache.get(key)!); return; }
    const img = new Image();
    img.onload = () => { spriteCache.set(key, true); setOk(true); };
    img.onerror = () => { spriteCache.set(key, false); setOk(false); };
    img.src = spriteFile(kind);
  }, [kind, key]);
  return ok;
}

// BOSS : pas de sprite special, une HORDE des zombies vaincus depuis le dernier BOSS (les paliers des quatre
// niveaux du bloc), decalee en profondeur.
function Horde({ tiers, moving }: { tiers: number[]; moving: boolean }) {
  return (
    <span className="relative block h-12" style={{ width: 48 + (tiers.length - 1) * 14 }}>
      {tiers.map((t, i) => (
        <span key={`${t}_${i}`} className="absolute bottom-0" style={{ left: (tiers.length - 1 - i) * 14, zIndex: i, transform: `scale(${0.82 + 0.06 * i})`, transformOrigin: "bottom center" }}>
          <Zombie kind={t} moving={moving} />
        </span>
      ))}
    </span>
  );
}

function Zombie({ kind, moving }: { kind: ZombieKind; moving: boolean }) {
  const ok = useSprite(kind);
  const title = kind === "boss" ? "Zombie BOSS" : `Zombie palier ${kind}`;
  if (ok) {
    return <span className={cx("block", kind === "boss" ? "w-14 h-14" : "w-12 h-12", moving && "zwalk")} style={{ backgroundImage: `url(${spriteFile(kind)})`, backgroundSize: "400% 100%", backgroundRepeat: "no-repeat", animationDuration: `${walkSeconds(kind)}s` }} title={title} />;
  }
  return <span className={cx("text-3xl leading-none", moving && "zbob")} style={{ transform: "scaleX(-1)", display: "inline-block", animationDuration: `${walkSeconds(kind) / 2}s` }} title={title}>{kind === "boss" ? "👹" : "🧟"}</span>;
}

// Le coeur, mange DEPUIS LA GAUCHE (le zombie arrive de la gauche) : entier, une bouchee, deux bouchees, puis
// zombifie (vert, un ver en sort) = niveau perdu. Il ternit a chaque bouchee et bat quand le zombie le mange.
// Sprite optionnel public/zombies/heart.png = 4 etats cote a cote ; sinon emoji + filtres.
const HEART_STATES = 4;
function Heart({ state, beating }: { state: number; beating: boolean }) {
  const ok = useSprite("heart");
  const s = Math.min(HEART_STATES - 1, Math.max(0, state));
  const lost = s === HEART_STATES - 1;
  const tarnish = s === 1 ? "saturate(0.7) brightness(0.95)" : s === 2 ? "saturate(0.4) brightness(0.85)" : undefined;
  if (ok) {
    return (
      <span className="relative block w-10 h-10">
        <span className={cx("block w-10 h-10", beating && "heartbeat")} style={{ backgroundImage: "url(/zombies/heart.png)", backgroundSize: `${HEART_STATES * 100}% 100%`, backgroundRepeat: "no-repeat", backgroundPositionX: `${(s * 100) / (HEART_STATES - 1)}%` }} title={lost ? "Cœur zombifié : niveau perdu" : beating ? "Le zombie dévore le cœur !" : "Cœur de l'équipe"} />
      </span>
    );
  }
  return (
    <span className="relative inline-block">
      <span className={cx("text-2xl leading-none inline-block", beating && "heartbeat")} style={{ transform: `scale(${1 - Math.min(2, s) * 0.2})`, filter: lost ? "hue-rotate(95deg) saturate(1.4)" : tarnish }}>{s >= 2 ? "💔" : s === 1 ? "❤️‍🩹" : "❤️"}</span>
      {lost && <span className="absolute -right-2 -top-1 text-sm animate-bounce" aria-hidden>🐛</span>}
    </span>
  );
}

// Compteur qui defile (reps, rang, vies) : attire l'oeil quand la valeur change.
function Odometer({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(false);
  const from = useRef(value);
  useEffect(() => {
    if (from.current === value) return;
    const start = performance.now();
    const a = from.current;
    const dur = 650;
    setBump(true);
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else { from.current = value; setBump(false); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={cx("tabular-nums inline-block transition-transform duration-300", bump && "scale-125", className)}>{shown}</span>;
}

const REP_MILESTONES = [100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];
const rankStyle = (rank: number) =>
  rank === 1 ? "bg-accent text-ink ring-2 ring-accent/60" : rank === 2 ? "bg-line-2 text-ink" : rank === 3 ? "bg-warn-soft text-warn-ink" : "bg-paper text-ink-2 border border-line";

const STAR_BG: Record<Stars, string> = { 3: "#fbe9ea", 2: "#e7f0fb", 1: "#e8f6ec" };

function TeamRow({ team, progress: p, level, stars, rank, teamsCount, yellow, canTick, pendingKeys, zombies, fixedSpeed = null, penalties, ticks, raceMs, running, coins = null, impact = null, onDiscount, onRocket, onToggle, onYellow }: {
  team: LevelTeam;
  progress: TeamProgress;
  level: FrozenLevel | null;
  stars: Stars;
  rank: number;
  coins?: CoinsState | null;
  impact?: { id: number; text: string } | null;
  onDiscount?: (reps: number) => void;
  onRocket?: () => void;
  teamsCount: number;
  yellow: number;
  canTick: boolean;
  pendingKeys: Map<string, boolean>;
  zombies: boolean;
  fixedSpeed?: number | null;
  penalties: TeamPenalty[];
  ticks: Tick[];
  raceMs: number;
  running: boolean;
  onToggle: (level: number, card: number, done: boolean) => void;
  onYellow: (delta: 1 | -1) => void;
}) {
  const finished = p.currentLevel === null;
  const boss = !!level?.boss;
  const all = level ? cardsForTeam(level, team.id, penalties) : [];
  // Fiches restantes : les penalites EN PREMIER (elles s'intercalent entre le coeur et la premiere fiche, et
  // font reculer le coeur vers le zombie), puis par reps croissantes.
  const remaining = all
    .filter(({ index }) => !p.doneCards.has(`${level!.number}_${index}`))
    .sort((a, b) => Number(b.penalty) - Number(a.penalty) || a.card.reps - b.card.reps || a.index - b.index);
  const remainingSec = remaining.reduce((s, x) => s + cardSeconds(x.card), 0);
  const totalSec = Math.max(1, p.currentTotalSec);
  const speedLevel = level ? (fixedSpeed ?? zombieSpeedLevel(level.number, p.losses)) : 1;
  const ev = level ? attemptEvents(level, team.id, ticks, p.attemptStartMs, penalties) : null;
  const geo = level && zombies && ev ? zombieSim(level, ev.initialTotalSec, ev.events, Math.max(0, raceMs - p.attemptStartMs), speedLevel, all.length) : null;
  const danger = !!geo && (geo.contact || geo.remainingMs <= 20_000);
  const kind: ZombieKind = boss ? "boss" : zombieTier(speedLevel);
  // Pieces : fiche allegeable (la plus longue restante de l'echelle) et menu d'allegement.
  const [coinOpen, setCoinOpen] = useState(false);
  const target = level && !finished ? rightmostCard(level, team.id, penalties, p.doneCards) : null;
  const horde = boss && level ? Array.from({ length: 4 }, (_, i) => zombieTier(fixedSpeed ?? zombieSpeedLevel(level.number - 4 + i, p.losses))).sort((a, b) => a - b) : [];

  // Jalons : premiere place, podium, plus derniere, centaine de reps, niveau gagne, coeur devore.
  const prev = useRef<{ rank: number; reps: number; losses: number; level: number | null } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; bad: boolean } | null>(null);
  const [lostFlash, setLostFlash] = useState(false);
  // Le zombie s'arrete au BORD GAUCHE du coeur (40 px de coeur + 48 px de zombie - 8 px de morsure) : decalage
  // qui va de 24 px au depart a 80 px au contact, en fonction de sa progression vers le coeur.
  const zx = geo ? (lostFlash ? geo.heart : geo.zombie) : 0;
  const zombieShift = geo ? Math.round(24 + 56 * Math.min(1, zx / Math.max(0.01, geo.heart))) : 24;
  useEffect(() => {
    if (!lostFlash) return;
    const h = setTimeout(() => setLostFlash(false), 3000);
    return () => clearTimeout(h);
  }, [lostFlash]);
  // Jalons espaces : au plus UN par niveau et par equipe (la chute s'affiche toujours), paliers de reps de
  // plus en plus eloignes (100, 250, 500, 1 000, 1 500, 2 000, 3 000, 4 000, 5 000…).
  const lastToastLevel = useRef<number | null>(null);
  useEffect(() => {
    const cur = { rank, reps: p.reps, losses: p.losses, level: p.currentLevel };
    const old = prev.current;
    prev.current = cur;
    if (!old) return;
    if (cur.losses > old.losses) {
      setToast({ id: Date.now(), text: `💔 Cœur zombifié ! Retour au ${cur.level !== null ? `niveau ${cur.level}` : "début"}`, bad: true });
      setLostFlash(true);
      lastToastLevel.current = cur.level;
      return;
    }
    if (cur.level !== null && lastToastLevel.current === cur.level) return; // deja un jalon sur ce niveau
    let t: string | null = null;
    if (cur.rank === 1 && old.rank !== 1 && teamsCount > 1) t = "🥇 Première place !";
    else if (cur.rank <= 3 && old.rank > 3 && teamsCount > 3) t = "🏆 Podium !";
    else if (teamsCount > 1 && old.rank === teamsCount && cur.rank < teamsCount) t = "🚀 Plus dernière !";
    else {
      const crossed = REP_MILESTONES.filter((m) => old.reps < m && cur.reps >= m).pop();
      if (crossed) t = `💯 ${crossed.toLocaleString("fr-BE")} reps !`;
    }
    if (t) { setToast({ id: Date.now(), text: t, bad: false }); lastToastLevel.current = cur.level; }
  }, [rank, p.reps, p.losses, p.currentLevel, teamsCount]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(h);
  }, [toast]);

  // ----- Pack d'animations : pieces gagnees, niveau gagne, morsure, rang, fusee construite, impact, arrivee -----
  const [coinBurst, setCoinBurst] = useState<{ id: number; delta: number; pct: number; dots: { x: number; y: number; d: number }[] } | null>(null);
  const prevEarned = useRef<number | null>(null);
  useEffect(() => {
    const earned = coins ? coins.earned + coins.carry : null;
    if (earned === null) return;
    if (prevEarned.current !== null && earned > prevEarned.current) {
      const delta = earned - prevEarned.current;
      const pct = coins?.perLevel.at(-1)?.pct ?? 0;
      const n = Math.min(14, 4 + Math.ceil(delta / 8));
      setCoinBurst({ id: Date.now(), delta, pct, dots: Array.from({ length: n }, (_, i) => ({ x: 45 + ((i * 37) % 50), y: -18 + ((i * 23) % 36), d: (i % 5) * 0.06 })) });
    }
    prevEarned.current = earned;
  }, [coins]);
  useEffect(() => {
    if (!coinBurst) return;
    const h = setTimeout(() => setCoinBurst(null), 1900);
    return () => clearTimeout(h);
  }, [coinBurst]);
  const [levelFlash, setLevelFlash] = useState(false);
  const prevLevelUp = useRef<{ level: number | null; losses: number } | null>(null);
  useEffect(() => {
    const old = prevLevelUp.current;
    prevLevelUp.current = { level: p.currentLevel, losses: p.losses };
    if (!old || old.losses !== p.losses) return;
    const up = (p.currentLevel === null && old.level !== null) || (p.currentLevel !== null && old.level !== null && p.currentLevel > old.level);
    if (up) { setLevelFlash(true); setTimeout(() => setLevelFlash(false), 1200); }
  }, [p.currentLevel, p.losses]);
  const [biteShake, setBiteShake] = useState(false);
  const prevBites = useRef(0);
  useEffect(() => {
    const b = geo?.bites ?? 0;
    if (b > prevBites.current) { setBiteShake(true); setTimeout(() => setBiteShake(false), 500); }
    prevBites.current = b;
  }, [geo?.bites]);
  const [rankDelta, setRankDelta] = useState<"up" | "down" | null>(null);
  const prevRank = useRef(rank);
  useEffect(() => {
    if (prevRank.current > 0 && rank > 0 && rank !== prevRank.current) { setRankDelta(rank < prevRank.current ? "up" : "down"); setTimeout(() => setRankDelta(null), 1600); }
    prevRank.current = rank;
  }, [rank]);
  const prevStock = useRef(coins?.stock ?? 0);
  useEffect(() => {
    const s = coins?.stock ?? 0;
    if (s > prevStock.current) setToast({ id: Date.now(), text: "🚀 Fusée construite : prête à décoller !", bad: false });
    prevStock.current = s;
  }, [coins?.stock]);
  const [shaking, setShaking] = useState(false);
  const lastImpact = useRef<number | null>(null);
  useEffect(() => {
    if (!impact || impact.id === lastImpact.current) return;
    lastImpact.current = impact.id;
    setShaking(true);
    setToast({ id: impact.id, text: impact.text, bad: true });
    const h = setTimeout(() => setShaking(false), 700);
    return () => clearTimeout(h);
  }, [impact]);
  const [confetti, setConfetti] = useState(false);
  const prevFinished = useRef(finished);
  useEffect(() => {
    if (finished && !prevFinished.current) { setConfetti(true); setToast({ id: Date.now(), text: "🏁 Échelle bouclée !", bad: false }); setTimeout(() => setConfetti(false), 3200); }
    prevFinished.current = finished;
  }, [finished]);

  return (
    <section
      title={team.members.map((m) => m.name).join(", ")}
      className={cx(ui.card, "relative px-2 py-1 flex items-center gap-2 min-w-0 h-20 transition-colors", boss && "border-danger/60 bg-danger-soft/40", finished && "border-success/60 bg-success-soft/40", danger && !finished && "ring-2 ring-danger", toast?.bad && "bg-danger-soft animate-pulse", levelFlash && "levelup", shaking && "shake")}
    >
      {/* Colonne gauche : rang, equipe, niveau, compteurs. */}
      <div className="flex items-center gap-2 w-[230px] flex-shrink-0 min-w-0">
        <span className={cx("relative w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-display font-black leading-none flex-shrink-0 shadow-sm", rankStyle(rank))} title="Classement">
          {rank > 0 ? (
            <>
              <span className="text-[9px] font-bold tracking-widest opacity-70">{rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "RANG"}</span>
              <span className="text-2xl">#<Odometer value={rank} /></span>
            </>
          ) : "—"}
          <AnimatePresence>
            {rankDelta && (
              <motion.span key={rankDelta} initial={{ opacity: 0, y: rankDelta === "up" ? 10 : -10, scale: 0.6 }} animate={{ opacity: 1, y: rankDelta === "up" ? -22 : 22, scale: 1.2 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }} className={cx("absolute -right-2 top-1/2 text-xl font-black pointer-events-none", rankDelta === "up" ? "text-success-ink" : "text-danger-ink")}>{rankDelta === "up" ? "▲" : "▼"}</motion.span>
            )}
          </AnimatePresence>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className="inline-flex items-center rounded-md bg-ink text-white font-display font-extrabold text-[11px] px-1.5 py-0.5 uppercase tracking-wide truncate">{team.name}</span>
            <span className="text-[11px] font-bold text-accent-ink tracking-tight flex-shrink-0" title={`Parcours ${starsName(stars)}`}>{starsLabel(stars)}</span>
            {zombies && <span className="text-xs font-bold tabular-nums" title="Vies perdues">💔<Odometer value={p.losses} /></span>}
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0" title={level?.name ?? undefined}>
            {finished ? (
              <span className="font-display font-extrabold text-sm text-success-ink">🏁 Bouclée{p.finishedMs !== null && <> à {fmt(p.finishedMs)}</>}</span>
            ) : level ? (
              <>
                <span className={cx("font-display font-extrabold text-xl leading-none", boss ? "text-danger-ink" : "text-ink")}>{boss ? "BOSS" : "Niv."} {level.number}</span>
                <span className="text-[11px] font-bold tabular-nums text-ink-2">{p.currentDone}/{p.currentTotal}</span>
              </>
            ) : (
              <span className={ui.hint}>Échelle vide.</span>
            )}
          </div>
          <div className="text-[11px] text-ink-2 tabular-nums flex items-center gap-2">
            <span><Odometer value={p.reps} className="font-bold text-ink text-sm" /> reps</span>
            {coins && (
              <span className="relative">
                <button type="button" onClick={() => setCoinOpen((v) => !v)} className={cx("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold text-[11px] border", coins.bank > 0 ? "bg-accent-soft border-accent text-accent-ink" : "bg-paper border-line text-ink-3", coinBurst && "coinpulse")} title={`Pièces : ${coins.earned} gagnées${coins.carry ? ` + ${coins.carry} de l'échauffement` : ""} · ${coins.spent} dépensées · ${coins.bank} en banque · fusée ${coins.stock ? "prête" : `à ${ROCKET_PRICE}`}`}>
                  🪙<Odometer value={coins.bank} />
                </button>
                {coinOpen && (
                  <span className="absolute left-0 top-full mt-1 z-30 w-56 rounded-xl bg-card border border-line shadow-pop p-2 text-left" onMouseLeave={() => setCoinOpen(false)}>
                    <span className="block text-[10px] text-ink-3 mb-1">{coins.earned + coins.carry} gagnées · {coins.spent} dépensées · fusée : {coins.stock ? "prête 🚀" : `${Math.min(ROCKET_PRICE, coins.bank)}/${ROCKET_PRICE}`}</span>
                    {target ? (
                      <>
                        <span className="block text-[11px] font-bold text-ink mb-1">Alléger « {target.card.reps} {cap(target.card.label)} » ({target.card.weight} 🪙/rep)</span>
                        <span className="flex flex-wrap gap-1">
                          {DISCOUNT_STEPS.map((n) => { const k = Math.min(n, target.card.reps - 1); const cost = k * target.card.weight; return (
                            <button key={n} type="button" disabled={!canTick || k <= 0 || cost > coins.bank} onClick={() => { setCoinOpen(false); onDiscount?.(n); }} className={cx(btn.smSoft, "disabled:opacity-40")} title={`${cost} pièces`}>−{k} · {cost}🪙</button>
                          ); })}
                        </span>
                      </>
                    ) : <span className="block text-[11px] text-ink-3">Rien à alléger sur ce niveau.</span>}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Piste : numero en filigrane, zombie a gauche, coeur devant les fiches restantes (largeur = duree). */}
      <div className="relative flex-1 h-full min-w-0">
        {/* Pluie de pieces vers la banque (niveau boucle) et confettis (echelle bouclee). */}
        <AnimatePresence>
          {coinBurst && coinBurst.dots.map((d, i) => (
            <motion.span key={`${coinBurst.id}_${i}`} initial={{ left: `${d.x}%`, top: `calc(50% + ${d.y}px)`, opacity: 0, scale: 0.4 }} animate={{ left: "-12px", top: "50%", opacity: [0, 1, 1, 0], scale: [0.4, 1.2, 1, 0.5] }} exit={{ opacity: 0 }} transition={{ duration: 1.1, delay: d.d, ease: "easeIn" }} className="absolute z-20 text-lg pointer-events-none">🪙</motion.span>
          ))}
          {coinBurst && (
            <motion.span key={`lbl${coinBurst.id}`} initial={{ opacity: 0, y: 6, scale: 0.7 }} animate={{ opacity: [0, 1, 1, 0], y: -34, scale: 1.1 }} transition={{ duration: 1.8 }} className="absolute left-2 top-1/2 z-30 rounded-full bg-accent text-ink font-display font-black text-sm px-2 py-0.5 shadow-pop pointer-events-none whitespace-nowrap">+{coinBurst.delta} 🪙 · {coinBurst.pct} % du temps restant</motion.span>
          )}
          {confetti && Array.from({ length: 14 }, (_, i) => (
            <motion.span key={`cf${i}`} initial={{ left: `${4 + ((i * 29) % 92)}%`, top: -16, opacity: 1, rotate: 0 }} animate={{ top: 90, opacity: [1, 1, 0], rotate: (i % 2 ? 1 : -1) * 260 }} exit={{ opacity: 0 }} transition={{ duration: 2.4 + (i % 4) * 0.3, delay: (i % 6) * 0.1, ease: "easeIn" }} className="absolute z-20 text-xl pointer-events-none">{["🎉", "✨", "🏁", "⭐"][i % 4]}</motion.span>
          ))}
        </AnimatePresence>
        <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 z-0 flex items-baseline gap-1 select-none pointer-events-none">
          <span className="font-display font-black text-[0.9rem] tracking-[0.2em] text-ink/35 uppercase">Équipe</span>
          <span className="font-display font-black text-[3rem] leading-none text-ink/35">{team.order}</span>
        </span>
        {!finished && level && (
          <>
            {geo && (
              <>
                <div key={level.number} className="absolute top-1/2 -translate-y-1/2 z-10" style={{ left: `calc(${zx * 100}% - ${zombieShift}px)`, transition: "left 1s linear" }}>
                  {boss ? <Horde tiers={horde} moving={running && !geo.contact && !lostFlash} /> : <Zombie kind={kind} moving={running && !geo.contact && !lostFlash} />}
                </div>
                <div className={cx("absolute top-1/2 -translate-y-1/2 -translate-x-full z-10 transition-[left] duration-300", biteShake && "bite")} style={{ left: `${geo.heart * 100}%` }} title={lostFlash ? "Niveau perdu" : geo.contact ? `Cœur dévoré dans ${fmt(Math.max(0, geo.eatMs - geo.eatenMs))}` : `Chute dans ${fmt(Math.max(0, geo.remainingMs))} si personne ne coche`}>
                  <Heart state={lostFlash ? HEART_STATES - 1 : geo.bites} beating={geo.contact || lostFlash} />
                </div>
              </>
            )}
            <div className="absolute right-0 top-1 bottom-1 flex gap-1" style={{ width: `${Math.min(1, remainingSec / totalSec) * ZOMBIE_ZONE * 100}%` }}>
              {remaining.map(({ card, index, penalty, kind: cardKind }) => {
                const busy = pendingKeys.has(`${team.id}_${level.number}_${index}`);
                const gift = cardKind === "gift";
                return (
                  <button
                    key={index}
                    type="button"
                    disabled={!canTick || busy}
                    onClick={() => onToggle(level.number, index, false)}
                    title={`${card.reps} ${cap(card.label)}${gift ? " (fiche reçue d'une fusée adverse)" : penalty ? " (pénalité carte jaune)" : ""} — cocher quand c'est fait`}
                    style={{ flex: `${Math.max(20, cardSeconds(card))} 1 0`, ...(gift ? { background: "#efe4ff", borderColor: "#a06cd5", color: "#4a1d7a" } : {}) }}
                    className={cx(
                      "min-w-[5.5rem] rounded-lg border px-1.5 py-0.5 text-left flex items-center gap-1.5 leading-tight transition active:scale-[.98] overflow-hidden",
                      gift ? "" : penalty ? "bg-accent-soft border-accent text-accent-ink" : "bg-card border-line-2 hover:border-brand",
                      (!canTick || busy) && "opacity-60"
                    )}
                  >
                    <span className="font-display font-extrabold text-xl tabular-nums flex-shrink-0">{card.reps}</span>
                    <span className="font-bold text-xs leading-tight break-words">{gift ? "🚀 " : penalty ? "🟨 " : ""}{cap(card.label)}</span>
                  </button>
                );
              })}
            </div>
            {p.currentDone > 0 && (
              <button type="button" disabled={!canTick} onClick={() => { const last = all.filter(({ index }) => p.doneCards.has(`${level.number}_${index}`)).pop(); if (last) onToggle(level.number, last.index, true); }} className="absolute left-0 bottom-0 text-[10px] text-ink-3 underline disabled:opacity-40" title="Annuler la dernière fiche cochée de ce niveau">annuler une coche</button>
            )}
          </>
        )}
        <AnimatePresence>
          {toast && (
            <motion.span key={toast.id} initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} className={cx("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 rounded-full px-3 py-1 text-sm font-display font-extrabold shadow-pop pointer-events-none whitespace-nowrap", toast.bad ? "bg-danger text-white" : "bg-ink text-white")}>
              {toast.text}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* La fusee, construite des que la banque atteint son prix : un clic ouvre le menu d'envoi. */}
      {coins && coins.stock > 0 && !finished && (
        <button type="button" onClick={onRocket} disabled={!canTick} className="rocketpop w-12 h-12 rounded-xl flex items-center justify-center text-3xl flex-shrink-0 disabled:opacity-40" style={{ background: "#efe4ff", border: "2px solid #a06cd5" }} title="Fusée prête : envoyer des reps à une équipe"><span className="inline-block animate-bounce">🚀</span></button>
      )}
      {/* Tout a droite : la carte jaune, qui ajoute une fiche de penalite (10, 20, 30… 1000 cordes). */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-12">
        <button type="button" onClick={() => onYellow(1)} disabled={!canTick} className="w-10 h-10 rounded-lg bg-accent hover:bg-accent-hover text-ink font-display font-black text-base flex items-center justify-center disabled:opacity-30 shadow-sm" title={`Carte jaune : +${PENALTY_STEPS[Math.min(yellow, PENALTY_STEPS.length - 1)]} cordes de pénalité`}>
          🟨{yellow > 0 && <span className="text-[11px] ml-0.5">{yellow}</span>}
        </button>
        {yellow > 0 && <button type="button" onClick={() => onYellow(-1)} disabled={!canTick} className="text-[10px] text-ink-3 underline disabled:opacity-30" title="Retirer la dernière carte jaune">retirer</button>}
      </div>
    </section>
  );
}

// Totaux d'une equipe sur les phases (echauffement + finisher), par numero d'equipe. Copie client de
// phaseExtras (level-context est un module serveur).
function extrasFor(phases: LevelBundle["phases"], order: number): PhaseTeamTotals {
  const agg: PhaseTeamTotals = { reps: 0, work: 0, repsByExercise: {}, losses: 0, cards: 0, score: null, levels: 0, coins: 0 };
  for (const ph of phases) {
    const x = ph.byOrder[order];
    if (!x) continue;
    agg.reps += x.reps; agg.work += x.work; agg.losses += x.losses; agg.cards += x.cards; agg.levels += x.levels; agg.coins += x.coins;
    for (const [k, v] of Object.entries(x.repsByExercise)) agg.repsByExercise[k] = (agg.repsByExercise[k] ?? 0) + v;
    if (ph.kind === "finisher") agg.score = x.score;
  }
  return agg;
}
const PHASE_NAMES: Record<"warmup" | "finisher", string> = { warmup: "échauffement", finisher: "finisher" };
// Detail « WOD + echauffement + finisher » pour l'infobulle d'un total.
function phaseBreakdown(phases: LevelBundle["phases"], order: number, main: number, pick: (x: PhaseTeamTotals) => number): string {
  return [`WOD ${main}`, ...phases.map((ph) => `${PHASE_NAMES[ph.kind]} ${ph.byOrder[order] ? pick(ph.byOrder[order]) : 0}`)].join(" + ");
}

function ResultsTable({ ranked, teamById, levelOf, rankOf, starsOf, cardsOf, extras, phases, coinsOf }: { ranked: TeamProgress[]; teamById: Map<string, LevelTeam>; levelOf: (teamId: string, number: number | null) => FrozenLevel | null; rankOf: Map<string, number>; starsOf: (teamId: string) => Stars; cardsOf: Map<string, number>; extras: Map<string, PhaseTeamTotals>; phases: LevelBundle["phases"]; coinsOf: Map<string, CoinsState> | null }) {
  const hasFinisher = phases.some((ph) => ph.kind === "finisher");
  const hasPhases = phases.length > 0;
  // Un classement par parcours : les etoiles ne se comparent pas entre elles.
  const groups = STARS.map((st) => ({ st, rows: ranked.filter((p) => starsOf(p.teamId) === st) })).filter((g) => g.rows.length > 0);
  return (
    <div className={`${ui.card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={ui.th}>Membres</th><th className={`${ui.th} text-right`}>Bouclés</th><th className={ui.th}>En cours</th><th className={`${ui.th} text-right`}>Dernière coche</th><th className={`${ui.th} text-right`}>Reps</th><th className={`${ui.th} text-right`}>Travail</th><th className={`${ui.th} text-right`}>💔</th><th className={`${ui.th} text-right`}>🟨</th>{coinsOf && <th className={`${ui.th} text-right`} title="Pièces gagnées (échauffement compris) · en banque">🪙</th>}{hasFinisher && <th className={`${ui.th} text-right`}>🪢 Finisher</th>}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(({ st, rows }) => [
            ...(groups.length > 1 ? [<tr key={`h${st}`}><td colSpan={12} className="p-2 bg-paper font-display font-extrabold text-sm">{starsLabel(st)} Parcours {starsName(st)} · {rows.length} équipe{rows.length > 1 ? "s" : ""}</td></tr>] : []),
            ...rows.map((p) => {
            const t = teamById.get(p.teamId)!;
            const l = levelOf(p.teamId, p.currentLevel);
            const ex = extras.get(p.teamId) ?? extrasFor([], 0);
            return (
              <tr key={p.teamId} className={ui.tr}>
                <td className="p-2 font-display font-extrabold">{rankOf.get(p.teamId) ?? "—"}</td>
                <td className="p-2 font-bold">{t.name} <span className="text-[10px] text-accent-ink font-sans">{starsLabel(st)}</span></td>
                <td className={`p-2 ${ui.hint}`}>{t.members.map((m) => m.name).join(", ")}</td>
                <td className="p-2 text-right tabular-nums font-bold">{p.completedLevels}</td>
                <td className="p-2">{p.currentLevel ? <span className={cx(l?.boss && "text-danger-ink font-bold")}>{levelLabel(l)} · {p.currentDone}/{p.currentTotal}</span> : <span className="text-success-ink font-bold">🏁 {p.finishedMs !== null ? fmt(p.finishedMs) : ""}</span>}</td>
                <td className="p-2 text-right tabular-nums">{p.lastTickMs !== null ? fmt(p.lastTickMs) : "—"}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, p.reps, (x) => x.reps) : undefined}>{p.reps + ex.reps}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, Math.round(p.weighted), (x) => Math.round(x.work)) : undefined}>{fmtTheoretical(p.weighted + ex.work)}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, p.losses, (x) => x.losses) : undefined}>{p.losses + ex.losses}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, cardsOf.get(p.teamId) ?? 0, (x) => x.cards) : undefined}>{(cardsOf.get(p.teamId) ?? 0) + ex.cards}</td>
                {coinsOf && <td className="p-2 text-right tabular-nums" title={`${coinsOf.get(p.teamId)?.earned ?? 0} gagnées au WOD + ${coinsOf.get(p.teamId)?.carry ?? 0} de l'échauffement · ${coinsOf.get(p.teamId)?.spent ?? 0} dépensées`}><b>{(coinsOf.get(p.teamId)?.earned ?? 0) + (coinsOf.get(p.teamId)?.carry ?? 0)}</b> <span className="text-ink-3">· {coinsOf.get(p.teamId)?.bank ?? 0}</span></td>}
                {hasFinisher && <td className="p-2 text-right tabular-nums font-bold">{ex.score !== null ? `${ex.score} cordes` : "—"}</td>}
              </tr>
            );
          }),
          ])}
          {ranked.length === 0 && <tr><td colSpan={11} className={`p-3 ${ui.muted}`}>Pas encore d&apos;équipe.</td></tr>}
        </tbody>
      </table>
      {hasPhases && <p className={`${ui.hint} p-2`}>Reps, travail, 💔 et 🟨 additionnent le WOD et {phases.map((ph) => `l'${PHASE_NAMES[ph.kind]}`).join(" et ").replace("l'finisher", "le finisher")} (survole une valeur pour le détail). Le classement, lui, reste celui du WOD : niveaux bouclés, puis vies perdues, puis fiches, puis rapidité.</p>}
    </div>
  );
}

function RecapTable({ ranked, teamById, levels, extras, phases }: { ranked: TeamProgress[]; teamById: Map<string, LevelTeam>; levels: FrozenLevel[]; extras: Map<string, PhaseTeamTotals>; phases: LevelBundle["phases"] }) {
  const cols = exerciseColumnsWith(levels, extras);
  const repsOf = (p: TeamProgress, c: string) => (p.repsByExercise[c] ?? 0) + (extras.get(p.teamId)?.repsByExercise[c] ?? 0);
  const totals = cols.map((c) => ranked.reduce((s, p) => s + repsOf(p, c), 0));
  return (
    <div className={`${ui.card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={ui.th}>Équipe</th>
            {cols.map((c) => <th key={c} className={`${ui.th} text-right`}>{cap(c)}</th>)}
            <th className={`${ui.th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p) => (
            <tr key={p.teamId} className={ui.tr}>
              <td className="p-2 font-bold whitespace-nowrap">{teamById.get(p.teamId)?.name}</td>
              {cols.map((c) => <td key={c} className="p-2 text-right tabular-nums">{repsOf(p, c) || ""}</td>)}
              <td className="p-2 text-right tabular-nums font-bold">{p.reps + (extras.get(p.teamId)?.reps ?? 0)}</td>
            </tr>
          ))}
          <tr className="bg-paper">
            <td className="p-2 font-bold">Toutes</td>
            {totals.map((n, i) => <td key={cols[i]} className="p-2 text-right tabular-nums font-bold">{n || ""}</td>)}
            <td className="p-2 text-right tabular-nums font-bold">{totals.reduce((a, b) => a + b, 0)}</td>
          </tr>
        </tbody>
      </table>
      <p className={`${ui.hint} p-2`}>Reps validées par le greffier (fiches entières){phases.length > 0 && <>, WOD + {phases.map((ph) => PHASE_NAMES[ph.kind]).join(" + ")} additionnés</>}. Les reps observées par les arbitres, élève par élève, sont dans le démineur.</p>
    </div>
  );
}

function LadderPreview({ levels, ladders }: { levels: FrozenLevel[]; ladders: LevelBundle["ladders"] }) {
  const [stars, setStars] = useState<Stars>(2);
  const shown = ladderFor(levels, ladders, stars);
  const available = STARS.filter((st) => st === 2 || (ladders[st]?.length ?? 0) > 0);
  return (
    <div className="space-y-2">
      <p className={`${ui.cardPad} ${ui.muted}`}>
        Échelles communes de l&apos;atelier (un parcours par étoile), figées dans la séance au coup d&apos;envoi. Pour les modifier avant le départ : <a href="/admin/level" className="underline font-bold">atelier Level</a>. Une fois lancée, elles se retouchent ici, pour cette séance seulement. <a href="/admin/level/fiches" target="_blank" className="underline font-bold">🖨️ Imprimer les fiches</a>.
      </p>
      <div className={`${ui.segmented} inline-flex`}>
        {STARS.map((st) => (
          <button key={st} type="button" onClick={() => setStars(st)} className={cx("px-3 py-1.5 rounded-lg text-sm font-bold", stars === st ? ui.segOn : ui.segOff)} title={available.includes(st) ? starsName(st) : `${starsName(st)} : pas d'échelle, ses équipes jouent le 2 étoiles`}>
            {starsLabel(st)} {starsName(st)}{!available.includes(st) && " (= 2★)"}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className={ui.alertWarn}>Aucun niveau : l&apos;atelier Level est vide.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {shown.map((l) => (
          <div key={l.number} className={cx(ui.card, "p-2.5", l.boss && "border-danger/50 bg-danger-soft/40")}>
            <p className={cx("font-display font-extrabold", l.boss ? "text-danger-ink" : "text-ink")}>{l.boss ? "BOSS" : "Niveau"} {l.number}{l.name ? <span className="text-xs text-ink-2 font-sans font-normal"> · {l.name.replace(/^BOSS · /, "")}</span> : null}</p>
            <p className="text-xs text-ink-2">{activeCards(l).map(({ card }) => `${card.reps} ${cap(card.label)}`).join(" · ")}</p>
            <p className={`${ui.hint} tabular-nums`}>≈ {fmtTheoretical(estimateSeconds(activeCards(l).map(({ card }) => ({ reps: card.reps, weight: card.weight })), l.boss))}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
