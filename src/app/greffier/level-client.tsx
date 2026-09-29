"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { elapsed, fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  activeCards, fmtWaveMin, attemptEvents, cardSeconds, cardsForTeam, coinsInPlay, coinsState, suggestStars, ladderKey, formatLabel, formatName, parcoursKey, teamFormatOf, teamSizeOf, FORMATS, type Format, emomNextCard, emomProgress, emomRank, emomSchedule, emomTotalMs, emomWaveAt, emomWaveEvents, emomZombieSim, estimateSeconds, fmtTheoretical, heartCarryBites, ladderFor, levelLabel, masteredExercises, orderedLevels, progressOf, rankTeams, rightmostCard, rocketTargets, sendOptions, starsLabel, starsName, teamStarsOf, warmupCoinsInPlay, zombieSim, zombieSpeedLevel, zombieTier, DISCOUNT_STEPS, EMOM_ZOMBIE_SPEED, HEART_BITES, PENALTY_STEPS, ROCKET_PRICE, STARS, ZOMBIE_ZONE,
  type CoinEvent, type CoinsState, type EmomTeam, type EmomWave, type FrozenLevel, type Stars, type TeamPenalty, type TeamProgress, type Tick,
} from "@/lib/wod-engines/templates/level-engine";
import { absoluteFromRace, catchUpAll, cloneState, replayOps, type ReplayConfig, type ReplayOp, type ReplayState } from "@/lib/wod-engines/templates/level-replay";
import { levelPoints, rankGlobal } from "@/lib/wod-engines/templates/level-engine";
import type { LevelBundle, LevelTeam, PhaseTeamTotals } from "@/lib/level-context";
import { createTwinSessionAction } from "./settings-actions";
import { createStarTeamAction, numberTeamsAction, getEmomPlayerScoresAction, setLevelCapAction, setTeamStarsAction, startChildAction, startLevelAction, tickCardAction, untickCardAction, type LevelLive } from "./level-actions";
import { TeamsManager, type TeamWithMembers, type RefereeView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { LevelLadderEditor } from "./LevelLadderEditor";
import { PaceReport } from "./PaceReport";
import { RecordsTab } from "./RecordsTab";
import { LevelArbitrage } from "./LevelArbitrage";
import { LevelSettings } from "./LevelSettings";
import { LogoutButton } from "../_components/LogoutButton";
import type { PendingRequest } from "./referee-decisions";
import { SessionStep, sessionDay, type SessionOption } from "./client";
import { btn, cx, ui } from "@/lib/ui";

// Operation en attente d'envoi (greffier hors ligne, Sartay 28-29/09) : coche, carte jaune, allegement, fusee, cordes,
// pause, reprise, fin du WOD — datee au clic (instant absolu recale sur le serveur + temps de course).
type PendingOp = ReplayOp;
const RETRY_EVERY_MS = 30_000; // fin du WOD pas encore envoyee : nouvel essai toutes les 30 s ; mode « en ligne » : envoi toutes les 30 s
// Mode d'envoi, memorise sur CE PC pour toutes les seances : « local » (defaut) = la seance entiere se joue sur le PC
// et part a la Fin du WOD (essai aussi a la Pause) ; « live » = envoi toutes les 30 s et tout de suite pour un BOSS.
// Dans les deux cas l'ecran calcule tout lui-meme (zombies, vies, pieces, fusees, cartes, pauses).
type SyncMode = "local" | "live";
const SYNC_MODE_KEY = "reps-level-sync-mode";
const SYNC_MODE_EVENT = "reps-level-sync-mode";
function readSyncMode(): SyncMode {
  try { return localStorage.getItem(SYNC_MODE_KEY) === "live" ? "live" : "local"; } catch { return "local"; }
}
function subscribeSyncMode(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(SYNC_MODE_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(SYNC_MODE_EVENT, cb); };
}
function writeSyncMode(m: SyncMode) {
  try { localStorage.setItem(SYNC_MODE_KEY, m); } catch { /* navigation privee : reste sur le mode par defaut */ }
  window.dispatchEvent(new Event(SYNC_MODE_EVENT));
}
const newOpId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
type View = "race" | "results" | "recap" | "ladder" | "records" | "arbitrage" | "teams" | "settings";

// Greffier « Level » (PC projete, mais aussi telephone d'un prof qui valide un BOSS) : chrono centre, une
// tuile par equipe avec son niveau en cours et ses fiches a cocher, classement en direct, recap des reps
// par exercice, echelle de la seance modifiable en cours de route. Plusieurs appareils cochent en meme
// temps : chaque coche est une ligne unique en base. Depuis le 28/09 (soir), UN seul greffier pendant la course : ses
// coches restent sur le PC jusqu'a la Pause ou la Fin du WOD (voir plus bas).
export function LevelClient({
  sessionId, sessionLabel, sessionOptions, olderSession, newerSession, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, picker, isMaster = false, showConsole = false, screens = [],
}: {
  screens?: { id: string; label: string }[]; // seances jumelles du meme creneau (un greffier par ecran), celle-ci comprise
  sessionId: string;
  isMaster?: boolean;
  showConsole?: boolean; // profs et coachs : lien vers la console (nouvel onglet, le WOD reste ouvert)
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
  useEffect(() => { setLive(liveFromBundle(bundle)); }, [bundle]);
  const { startedAtMs } = live;
  // Horloge recalee sur le serveur (les coches sont datees au clic) : decalage mesure a chaque sauvegarde.
  const clockOffset = useRef(bundle.serverNowMs - Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!error) return;
    const h = setTimeout(() => setError(""), 8000);
    return () => clearTimeout(h);
  }, [error]);
  // Greffier hors ligne (Sartay 28-29/09 : « la seance doit pouvoir etre jouee 100 % hors ligne et envoyee a la fin ») :
  // une fois le WOD lance, TOUT est une operation gardee sur le PC (et dans le navigateur, pour survivre a un
  // rechargement) avec l'heure exacte du clic, appliquee ici avec le code du serveur (level-replay.ts) : coches,
  // zombies, vies, pieces, fusees, cartes jaunes, allegements, cordes, pause, reprise, fin. Rien ne part pendant la
  // course : envoi a la Fin du WOD (nouvel essai toutes les 30 s), essai a la Pause, a la fermeture de la page, ou
  // sur demande (clic sur 💾). Seuls le coup d'envoi et les reglages d'avant course passent par le serveur.
  const QUEUE_KEY = `reps-level-queue-${sessionId}`;
  const [queue, setQueueState] = useState<PendingOp[]>([]);
  const queueRef = useRef<PendingOp[]>([]);
  function setQueue(fn: (q: PendingOp[]) => PendingOp[]) {
    const next = fn(queueRef.current);
    queueRef.current = next;
    setQueueState(next);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(next)); } catch { /* navigation privee : file en memoire seulement */ }
  }
  const [sync, setSync] = useState<{ at: number | null; failed: boolean }>({ at: null, failed: false });
  const syncMode = useSyncExternalStore(subscribeSyncMode, readSyncMode, () => "local" as SyncMode);
  const pendingMap = useMemo(() => new Map<string, boolean>(), []); // plus d'appel en vol par coche
  // Etat sauvegarde renvoye par une sauvegarde : il remplace la base, la file restante est rejouee par-dessus.
  function applyLive(l: LevelLive) { setLive(l); }

  // Format (4-5+ ou 1-3) : fixe dans les reglages (numerotation, coup d'envoi), sinon d'apres l'effectif.
  const formatOf = useCallback((teamId: string): Format => teamFormatOf(bundle.teamFormats, teamId, teams.find((t) => t.id === teamId)?.members.length), [bundle.teamFormats, teams]);
  // Temps impose (minutes de chrono), null = libre.
  const capMs = bundle.capMin !== null ? bundle.capMin * 60_000 : null;
  // Rejeu local : etat sauvegarde + operations du PC, rejouees avec le code du serveur (level-replay.ts). Ce que
  // l'ecran montre est exactement ce que la sauvegarde ecrira. Pauses et fin du WOD en font partie : le chrono de
  // l'ecran se fige et se termine sans le serveur.
  const replayCfg = useMemo<ReplayConfig>(() => ({
    levels,
    ladders: bundle.ladders,
    order: bundle.levelOrder,
    formatOf,
    teamIds: teams.map((t) => t.id),
    zombies: bundle.zombies,
    fixedSpeed: bundle.zombieSpeed,
    isMain: !bundle.child,
    spending: !bundle.child && !bundle.emom,
    emom: bundle.emom,
    capMs,
    coinsCarry: bundle.coinsCarry,
    startedAtMs: startedAtMs ?? 0,
    now: () => Date.now() + clockOffset.current,
    newId: (key) => key, // cles stables d'un rendu a l'autre (le serveur tire de vrais identifiants)
    reorient: bundle.reorient && !bundle.child,
  }), [levels, bundle.ladders, bundle.levelOrder, formatOf, teams, bundle.zombies, bundle.zombieSpeed, bundle.child, bundle.emom, capMs, bundle.coinsCarry, startedAtMs, bundle.reorient]);
  const baseState = useMemo<ReplayState>(() => ({
    ticks: live.ticks.map((t) => ({ id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: t.atMs })),
    losses: live.losses.map((l) => ({ id: l.id, teamId: l.teamId, level: l.level, atMs: l.atMs, soft: l.soft })),
    penalties: live.penalties,
    coinEvents: live.coinEvents,
    teamStars: { ...bundle.teamStars },
    switches: { ...(bundle.starSwitches ?? {}) },
    voided: [],
    newSwitches: {},
    pauses: live.pauses.map((p, i) => ({ id: `base-pause-${i}`, from: p.from, to: p.to })),
    yellowCards: live.yellowCards.map((c) => ({ id: c.id, teamId: c.teamId, atMs: c.atMs, absMs: live.startedAtMs === null ? 0 : absoluteFromRace(live.startedAtMs, live.pauses.map((p) => ({ from: p.from, to: p.to ?? p.from })), c.atMs, 0) })), // pas de carte pendant une pause : une pause ouverte compte pour rien
    endedAtMs: live.endedAtMs,
    emomScores: live.emomScores,
    emomPlayerScores: {},
    giftCount: live.giftCount,
    removedPenalties: [],
    scoredTeams: [],
    bossEntry: live.bossEntry,
    streaks: live.streaks ?? {},
  }), [live, bundle.teamStars, bundle.starSwitches]);
  // Une operation ajoutee au bout de la file ne rejoue que celle-la (un WOD sans pause peut en compter 1 000).
  const replayed = useMemo(() => replayQueue(baseState, replayCfg, queue), [baseState, replayCfg, queue]);
  const pauses = replayed.pauses;
  const endedAtMs = replayed.endedAtMs;
  // Ajouter une operation : verifiee tout de suite sur l'etat local (meme reponse que le serveur), puis en file.
  function queueOp(op: Omit<ReplayOp, "id" | "absMs" | "atMs">): boolean {
    setError("");
    const absMs = Date.now() + clockOffset.current;
    const full: ReplayOp = { ...op, id: newOpId(), absMs, atMs: startedAtMs === null ? 0 : elapsed(startedAtMs, pauses, absMs) ?? 0 };
    const [res] = replayOps(replayCfg, cloneState(replayed), [full]);
    if (!res.ok) { setError(res.error ?? "Refusé."); return false; }
    setQueue((q) => [...q, full]);
    return true;
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
      if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.()?.catch?.(() => {});
      else if (!on && document.fullscreenElement) void document.exitFullscreen?.();
    } catch {
      /* navigateur sans plein ecran : tant pis */
    }
  }
  // Sartay 29/09 : tant que la course tourne (WOD, echauffement, finisher, pause comprise), l'ecran reste en plein
  // ecran. Le navigateur en sort tout seul (touche Echap, boite de confirmation, rechargement) et n'accepte d'y
  // revenir que sur un geste : le prochain clic, n'importe ou, l'y remet.
  useEffect(() => {
    if (phase !== "run") return;
    const onClick = () => { if (!document.fullscreenElement) toggleFullscreen(true); };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [phase]);

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => clearInterval(t);
  }, [phase, isPaused]);
  // Pouls : UN appel toutes les 8 s (8 requetes en parallele) qui rend l'etat vivant + une signature de
  // structure. Structure changee (equipes, membres, echelle, temps impose, depart, fin) -> page entiere ;
  // etat identique -> aucun rendu ; sinon -> remplacement local. Onglet cache : rien du tout.
  const lastLive = useRef<string | null>(null);
  const lastStructure = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pausedRef = useRef(isPaused);
  pausedRef.current = isPaused;
  const flushing = useRef<Promise<void> | null>(null);
  function flush(read = false): Promise<void> {
    if (flushing.current) return flushing.current.then(() => (queueRef.current.length || read ? flush(read) : undefined));
    if (!queueRef.current.length && !read) return Promise.resolve(); // rien a envoyer : pas d'aller-retour
    const ops = queueRef.current;
    const p = (async () => {
      const t0 = Date.now();
      try {
        const res = await fetch("/greffier/level-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, ops, catchUp: true }) });
        const t1 = Date.now();
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: { id: string; ok: boolean; error?: string }[]; live: LevelLive | { error: string }; serverNow: number };
        clockOffset.current = data.serverNow - (t0 + t1) / 2;
        const sent = new Set(ops.map((o) => o.id));
        setQueue((q) => q.filter((o) => !sent.has(o.id)));
        const bad = data.results.find((r) => !r.ok);
        if (bad?.error) setError(`Coche refusée : ${bad.error}`);
        if (!("error" in data.live)) {
          const l = data.live;
          if (lastStructure.current !== null && lastStructure.current !== l.structure) { lastStructure.current = l.structure; router.refresh(); }
          else { lastStructure.current = l.structure; applyLive(l); }
        }
        setSync({ at: Date.now(), failed: false });
      } catch {
        setSync((s) => ({ ...s, failed: true })); // hors ligne : la file reste sur le PC (nouvel essai en pause ou a la fin)
      } finally {
        flushing.current = null;
      }
    })();
    flushing.current = p;
    return p;
  }
  // Au chargement : file restee dans le navigateur (rechargement, coupure). En course elle reste sur le PC ; en pause ou
  // apres la fin, elle part tout de suite.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
      if (Array.isArray(saved) && saved.length) { queueRef.current = saved; setQueueState(saved); }
    } catch { /* rien */ }
    const h = setTimeout(() => { if (queueRef.current.length && (phaseRef.current === "post" || pausedRef.current)) void flush(true); }, 1500);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  // Mode « sur ce PC » : pendant la course, rien ne part tout seul ; une fois la fin du WOD declaree, la seance est
  // renvoyee toutes les 30 s jusqu'a ce que ca passe. Mode « en ligne » : envoi toutes les 30 s (comme avant).
  useEffect(() => {
    const t = setInterval(() => {
      if (syncMode === "live" && phaseRef.current === "run" && !pausedRef.current) {
        if (document.visibilityState === "visible" || queueRef.current.length) void flush(true);
        return;
      }
      if (queueRef.current.length && phaseRef.current === "post") void flush(true);
    }, RETRY_EVERY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, syncMode]);
  // Fermeture ou changement de page : dernier envoi sans attendre de reponse.
  useEffect(() => {
    const onHide = () => {
      const ops = queueRef.current;
      if (!ops.length) return;
      try { navigator.sendBeacon("/greffier/level-sync", new Blob([JSON.stringify({ sessionId, ops })], { type: "application/json" })); } catch { /* rien */ }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [sessionId]);
  // Sans reseau, une page rechargee ne revient pas : le navigateur demande confirmation tant que la course tourne
  // avec des operations sur ce PC (la file survit de toute facon dans le navigateur).
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => { if (queueRef.current.length && phaseRef.current === "run") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    return elapsed(startedAtMs, pauses, phase === "post" ? endedAtMs! : now) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);
  // Temps impose : compte a rebours, rouge dans les 10 dernieres minutes, « temps ecoule » au bout.
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

  // Zombies constates jusqu'a maintenant (quelques ms par seconde) ; nouvel etat seulement si une vie tombe.
  const local = useMemo(() => (phase !== "pre" && bundle.zombies ? catchUpNow(replayed, replayCfg, zombieMs) : replayed), [replayed, replayCfg, zombieMs, phase, bundle.zombies]);
  const ticks: Tick[] = local.ticks;
  const losses = local.losses;
  const penalties = local.penalties;
  // Parcours (descente de categorie a la 3e vie, decidee ici) : references stables tant que rien ne change.
  const starsKey = JSON.stringify([local.teamStars, local.switches]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const starState = useMemo(() => ({ teamStars: local.teamStars, switches: local.switches }), [starsKey]);
  // Echelle de chaque equipe : son parcours (1, 2 ou 3 etoiles), dans son ordre.
  const ladderOf = useCallback((teamId: string) => orderedLevels(ladderFor(levels, bundle.ladders, teamStarsOf(starState.teamStars, teamId), formatOf(teamId), starState.switches[teamId]), bundle.levelOrder?.[teamId]), [levels, bundle.ladders, starState, bundle.levelOrder, formatOf]);
  const starsOf = useCallback((teamId: string): Stars => teamStarsOf(starState.teamStars, teamId), [starState]);
  // Classement commun (Sartay 29/09 soir) : toutes les equipes de l'ecran dans un seul classement, points = niveau x
  // etoiles. Avant (et a l'echauffement / au finisher) : groupe = parcours + format.
  const globalRank = bundle.reorient && !bundle.child && !bundle.emom;
  const groupOf = useCallback((teamId: string) => (globalRank ? "all" : parcoursKey(starsOf(teamId), formatOf(teamId))), [globalRank, starsOf, formatOf]);
  const mixedFormats = useMemo(() => new Set(teams.map((t) => formatOf(t.id))).size > 1, [teams, formatOf]);
  const levelOf = useCallback((teamId: string, number: number | null) => (number === null ? null : ladderOf(teamId).find((l) => l.number === number) ?? null), [ladderOf]);
  const allLevels = useMemo(() => [levels, ...Object.values(bundle.ladders)].flat(), [levels, bundle.ladders]);
  const progress = useMemo(() => new Map(teams.map((t) => [t.id, progressOf(ladderOf(t.id), t.id, ticks, losses, penalties)])), [teams, ladderOf, ticks, losses, penalties]);
  // Classement : niveaux, vies, pieces gagnees (echauffement compris), fiches, rapidite.
  const coinsForRank = useMemo(() => { const m = new Map<string, number>(); if (!bundle.emom) for (const t of teams) { const st = coinsState(ladderOf(t.id), t.id, ticks, losses, penalties, local.coinEvents, bundle.coinsCarry, bundle.child?.kind === "warmup" ? warmupCoinsInPlay : coinsInPlay); m.set(t.id, st.score); } return m; }, [teams, ladderOf, ticks, losses, penalties, local.coinEvents, bundle.coinsCarry, bundle.child, bundle.emom]);
  const pointsOf = useMemo(() => new Map(teams.map((t) => [t.id, levelPoints(ladderOf(t.id), progress.get(t.id)!, starsOf(t.id), starState.switches[t.id])])), [teams, ladderOf, progress, starsOf, starState]);
  const ranked = useMemo(() => (globalRank ? rankGlobal([...progress.values()], (id) => pointsOf.get(id) ?? 0, (id) => coinsForRank.get(id) ?? 0) : rankTeams([...progress.values()], (id) => coinsForRank.get(id) ?? 0)), [globalRank, progress, pointsOf, coinsForRank]);
  // Rang DANS SON PARCOURS : un niveau 12 du 1 etoile ne se compare pas a un niveau 10 du 3 etoiles.
  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const p of ranked) { const g = groupOf(p.teamId); const n = (seen.get(g) ?? 0) + 1; seen.set(g, n); m.set(p.teamId, n); }
    return m;
  }, [ranked, groupOf]);
  // Ordre de la course (Sartay 28/09) : les places ne bougent qu'apres un BOSS. Dans une categorie : BOSS passes
  // (le plus en premier), puis l'ordre dans lequel le dernier BOSS a ete passe, puis le numero d'equipe. Avant
  // le premier BOSS, pas de rang affiche. Le classement complet (resultats, fusees) reste inchange.
  const bossOrder = useMemo(() => {
    const info = new Map<string, { bosses: number; lastAt: number; order: number }>();
    for (const t of teams) {
      const lv = ladderOf(t.id);
      let bosses = 0, lastAt = 0;
      for (const l of lv) {
        if (!l.boss) continue;
        const cards = cardsForTeam(l, t.id, penalties);
        const done = cards.map(({ index }) => ticks.find((x) => x.teamId === t.id && x.level === l.number && x.card === index)).filter((x): x is Tick => !!x);
        if (!cards.length || done.length < cards.length) continue;
        bosses++;
        lastAt = Math.max(...done.map((x) => x.atMs));
      }
      info.set(t.id, { bosses, lastAt, order: t.order });
    }
    const cmp = (a: string, b: string) => { const x = info.get(a)!, y = info.get(b)!; return y.bosses - x.bosses || (x.bosses ? x.lastAt - y.lastAt : 0) || x.order - y.order; };
    const rank = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const id of teams.map((t) => t.id).sort(cmp)) { const g = groupOf(id); const n = (seen.get(g) ?? 0) + 1; seen.set(g, n); rank.set(id, info.get(id)!.bosses > 0 ? n : 0); }
    return { cmp, rank };
  }, [teams, ladderOf, penalties, ticks, groupOf]);
  const groupSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of teams) m.set(groupOf(t.id), (m.get(groupOf(t.id)) ?? 0) + 1);
    return m;
  }, [teams, groupOf]);
  // Pieces (echauffement et WOD, pas le finisher) : gagnees d'apres les coches, banque = gagnees + report - depenses.
  const coinsOn = !bundle.emom;
  const inPlay = bundle.child?.kind === "warmup" ? warmupCoinsInPlay : coinsInPlay;
  const coinsOf = useMemo(() => new Map(teams.map((t) => [t.id, coinsState(ladderOf(t.id), t.id, ticks, losses, penalties, local.coinEvents, bundle.coinsCarry, inPlay)])), [teams, ladderOf, ticks, losses, penalties, local.coinEvents, bundle.coinsCarry, inPlay]);
  function discount(teamId: string, reps: number) { queueOp({ kind: "discount", teamId, reps }); }
  const [flight, setFlight] = useState<{ id: number; from: { x: number; y: number }; to: { x: number; y: number }; toId: string; text: string } | null>(null);
  // Impact : la ligne visee tremble et affiche ce qu'elle vient de recevoir.
  const [impact, setImpact] = useState<{ id: number; teamId: string; text: string; good?: boolean } | null>(null);
  // Montee (1re de sa categorie sur tout un BOSS) ou descente (3e vie perdue) : annoncee sur la ligne de l'equipe.
  const seenStars = useRef<Record<string, Stars> | null>(null);
  useEffect(() => {
    const now = Object.fromEntries(teams.map((t) => [t.id, teamStarsOf(starState.teamStars, t.id)])) as Record<string, Stars>;
    const prev = seenStars.current;
    seenStars.current = now;
    if (!prev || phase !== "run") return;
    const changed = teams.find((t) => prev[t.id] !== undefined && prev[t.id] !== now[t.id]);
    if (!changed) return;
    const up = now[changed.id] > prev[changed.id];
    const lost = losses.filter((l) => l.teamId === changed.id).length;
    setImpact({ id: Date.now(), teamId: changed.id, text: up ? `⬆️ Monte en ${starsLabel(now[changed.id])} : bravo !` : `⬇️ Descend en ${starsLabel(now[changed.id])} (${lost} vie${lost > 1 ? "s" : ""} perdue${lost > 1 ? "s" : ""})`, good: up });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starState]);
  // Fusee : le greffier clique, la regle choisit cible et charge ici meme (le seul tirage au sort est garde dans
  // l'operation pour que le serveur rejoue la meme fusee) ; l'ecran anime chaque nouvel envoi.
  function launchRocket(teamId: string) { queueOp({ kind: "rocket", teamId, draw: Math.random() }); }
  // Envois deja animes, reconnus a leur signature (l'identifiant change une fois la fusee enregistree par le serveur).
  const seenSends = useRef<Set<string> | null>(null);
  const sendKey = (e: CoinEvent) => `${e.teamId}>${e.toTeamId}@${e.at}`;
  useEffect(() => {
    const sends = local.coinEvents.filter((e) => e.kind === "send" && e.toTeamId);
    if (seenSends.current === null) { seenSends.current = new Set(sends.map(sendKey)); return; }
    const fresh = sends.filter((e) => !seenSends.current!.has(sendKey(e)));
    if (!fresh.length) return;
    for (const e of fresh) seenSends.current.add(sendKey(e));
    const e = fresh[fresh.length - 1];
    const toId = e.toTeamId!;
    // La fusee decolle de la ligne de l'expediteur, monte en arc et vient percuter la ligne de la cible.
    const a = document.getElementById(`team-row-${e.teamId}`)?.getBoundingClientRect();
    const b = document.getElementById(`team-row-${toId}`)?.getBoundingClientRect();
    const text = `💥 +${e.reps ?? ""} ${cap(e.label ?? "")} reçus de ${teamById.get(e.teamId)?.name ?? "l'adversaire"}`;
    if (a && b) setFlight({ id: Date.now(), from: { x: a.right - 70, y: a.top + a.height / 2 - 18 }, to: { x: b.left + 120, y: b.top + b.height / 2 - 18 }, toId, text });
    else setImpact({ id: Date.now(), teamId: toId, text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.coinEvents]);
  // Classement par parcours pour les cibles de fusee.
  // Suggestions de parcours d'apres l'echauffement (avant le coup d'envoi, WOD principal seulement).
  const suggestions = useMemo(() => {
    const m = new Map<string, { stars: Stars; finishMs: number | null; ratio: number | null; levels: number; total: number }>();
    const warm = bundle.phases.find((ph) => ph.kind === "warmup");
    if (!warm || phase !== "pre" || bundle.child) return m;
    for (const t of teams) {
      const x = warm.byOrder[t.order];
      if (!x || (x.finishMs === null && x.levels === 0)) continue;
      m.set(t.id, { stars: suggestStars(x.finishMs, x.levels, warm.levelsTotal, x.estimateMs), finishMs: x.finishMs, ratio: x.finishMs !== null && x.estimateMs > 0 ? x.finishMs / x.estimateMs : null, levels: x.levels, total: warm.levelsTotal });
    }
    return m;
  }, [bundle.phases, bundle.child, phase, teams]);
  // Equipes dont la suggestion differe de leur parcours actuel, dans l'ordre des numeros.
  const suggestionRows = useMemo(() => teams.filter((t) => { const s = suggestions.get(t.id); return !!s && s.stars !== starsOf(t.id); }).map((t) => ({ team: t, cur: starsOf(t.id), sg: suggestions.get(t.id)! })), [teams, suggestions, starsOf]);
  const suggestionsDiff = suggestionRows.length;
  const [showSuggestions, setShowSuggestions] = useState(false);
  function applySuggestions(rows: { team: LevelTeam; sg: { stars: Stars } }[]) {
    run(async () => {
      for (const { team, sg } of rows) {
        const r = await setTeamStarsAction(sessionId, team.id, sg.stars);
        if ("error" in r) return { error: `${team.name} : ${r.error}` };
      }
      return { ok: true };
    });
  }
  function createStar(st: Stars) { run(async () => { const r = await createStarTeamAction(sessionId, st); return "error" in r ? r : { ok: true }; }); }
  function numberTeams() { run(async () => { const r = await numberTeamsAction(sessionId); return "error" in r ? r : { ok: true }; }); }
  const cardsOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of local.yellowCards) m.set(c.teamId, (m.get(c.teamId) ?? 0) + 1);
    return m;
  }, [local.yellowCards]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  // Totaux des phases (echauffement + finisher) par equipe : classement, reps et export les additionnent au WOD.
  const extras = useMemo(() => new Map(teams.map((t) => [t.id, extrasFor(bundle.phases, t.order)])), [teams, bundle.phases]);
  // Temps impose ecoule : plus aucune coche possible, les coches du PC partent tout de suite.
  useEffect(() => {
    if (timeUp) void flush(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);
  // Coeur croque au niveau precedent, par equipe (meme rejeu que le serveur).
  const carryOf = useMemo(() => {
    const m = new Map<string, number>();
    if (!bundle.zombies || bundle.emom) return m;
    for (const t of teams) m.set(t.id, heartCarryBites(ladderOf(t.id), t.id, ticks, losses, penalties, (l, k) => bundle.zombieSpeed ?? zombieSpeedLevel(l.number, k), teamSizeOf(formatOf(t.id))));
    return m;
  }, [bundle.zombies, bundle.emom, bundle.zombieSpeed, teams, ladderOf, ticks, losses, penalties, formatOf]);

  function refresh() {
    router.refresh();
  }
  function run(action: () => Promise<{ error: string } | { ok: true }>) {
    setError("");
    startTransition(async () => {
      await flush(true); // les coches en attente passent avant, zombies compris (ordre des evenements)
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
  // Pause / reprise : locales (le chrono et les zombies se figent tout de suite) ; la pause est l'occasion d'un envoi
  // si le reseau est la (sinon tant pis : tout part a la fin).
  function handlePause() {
    if (!queueOp({ kind: isPaused ? "resume" : "pause" })) return;
    if (!isPaused) void flush(true);
  }
  // Fin du WOD : locale (chrono arrete, classement fige), puis envoi de toute la seance ; s'il rate, nouvel essai
  // toutes les 30 s, l'ecran reste utilisable (classement, reps) sur ce PC.
  function handleEnd() {
    if (!confirm("Fin du WOD ? Le chrono s'arrête et le classement est figé.")) return;
    if (!queueOp({ kind: "end" })) return;
    void flush(true).then(() => { if (!queueRef.current.length) refresh(); });
  }
  function toggleCard(teamId: string, level: number, card: number, done: boolean) {
    if (phase !== "run" || isPaused) return;
    if (done && !confirm("Annuler cette coche ?")) return;
    const key = `${teamId}_${level}_${card}`;
    setError("");
    const pendingTick = queueRef.current.find((o) => o.kind === "tick" && `${o.teamId}_${o.level}_${o.card}` === key);
    if (done && pendingTick) setQueue((q) => q.filter((o) => o.id !== pendingTick.id)); // pas encore envoyee : on l'oublie
    else { const absMs = Date.now() + clockOffset.current; setQueue((q) => [...q, { id: newOpId(), kind: done ? "untick" : "tick", teamId, level, card, absMs, atMs: elapsed(startedAtMs, pauses, absMs) ?? 0 }]); }
    // Mode « en ligne » : un BOSS part tout de suite (comme avant).
    if (syncMode === "live" && levelOf(teamId, level)?.boss) void flush(true);
    void untickCardAction; void tickCardAction;
  }
  function yellow(teamId: string, delta: 1 | -1) { queueOp({ kind: "yellow", teamId, delta }); }

  function exportCsv() {
    const exercises = exerciseColumnsWith(allLevels, extras);
    const hasPhases = bundle.phases.length > 0;
    const head = ["Rang (dans son parcours)", "Équipe", "Parcours", "Format", "Membres", "Niveaux bouclés", "Niveau en cours", "Fiches du niveau", "Dernière coche", "Reps", "Travail (s)", "Cartes jaunes", "Vies perdues", "Pièces gagnées", "Pièces en banque", "Pièces perdues (zombie)", "Score pièces", "Échelle bouclée à", ...(hasPhases ? ["Reps WOD seul", ...bundle.phases.map((ph) => `Reps ${ph.kind === "warmup" ? "échauffement" : "finisher"}`), "Finisher (cordes)"] : []), ...exercises];
    const lines = ranked.map((p) => {
      const t = teamById.get(p.teamId)!;
      const ex = extras.get(p.teamId) ?? extrasFor([], 0);
      return [
        rankOf.get(p.teamId), t.name, starsLabel(starsOf(p.teamId)), formatLabel(formatOf(p.teamId)), t.members.map((m) => m.name).join(" / "), p.completedLevels, p.currentLevel ?? "terminé",
        p.currentLevel ? `${p.currentDone}/${p.currentTotal}` : "", p.lastTickMs !== null ? fmt(p.lastTickMs) : "", p.reps + ex.reps, Math.round(p.weighted + ex.work), (cardsOf.get(p.teamId) ?? 0) + ex.cards, p.losses + ex.losses,
        (coinsOf.get(p.teamId)?.earned ?? 0) + (coinsOf.get(p.teamId)?.carry ?? 0), coinsOf.get(p.teamId)?.bank ?? 0, coinsOf.get(p.teamId)?.lost ?? 0, coinsOf.get(p.teamId)?.score ?? 0,
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
            {phase !== "pre" && (
              <button type="button" onClick={() => void flush(true)} className={cx("text-[11px] font-bold tabular-nums whitespace-nowrap", sync.failed ? "text-danger-ink" : queue.length ? "text-warn-ink" : "text-ink-3")} title="Pendant le WOD, tout reste sur ce PC (rien n'attend le réseau) et part sur le serveur à la Fin du WOD — essai aussi à la Pause. Clique pour envoyer maintenant.">
                {sync.failed ? (phase === "post" ? `📴 pas encore envoyé · ${queue.length}` : `📴 hors ligne · ${queue.length}`) : queue.length ? (syncMode === "live" ? `⏳ ${queue.length} à sauver` : phase === "post" ? "📤 envoi…" : `📍 ${queue.length} sur ce PC`) : "💾 tout est sauvé"}
              </button>
            )}
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
                  onClick={() => {
                    if (!confirm(`Terminer ${bundle.child?.kind === "warmup" ? "l'échauffement" : "le finisher"} (chrono arrêté, classement figé) et revenir au WOD principal ?`)) return;
                    if (!queueOp({ kind: "end" })) return;
                    void flush(true).then(() => { if (!queueRef.current.length) router.push(`/greffier?session=${bundle.child!.parentId}`); else setError("Fin enregistrée sur ce PC, mais pas encore envoyée (hors ligne) : clique sur 💾 dès que le réseau revient, puis reviens au WOD principal."); });
                  }}
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
        {/* Erreur en bulle flottante (Sartay 29/09) : un bandeau dans la page poussait la course et la 8e equipe
            sortait de l'ecran. Elle s'efface seule apres 8 s, ou au clic. */}
        {error && (
          <button type="button" onClick={() => setError("")} className={`${ui.alertErr} fixed left-1/2 -translate-x-1/2 top-3 z-50 max-w-[90vw] shadow-pop text-left`} title="Fermer">
            {error} <span className="ml-2 font-bold">✕</span>
          </button>
        )}
      </header>

      <main className="max-w-[1800px] mx-auto p-3 sm:p-4">
        {view === "race" && (
          <>
            {suggestionsDiff > 0 && (
              <div className={`${ui.alertInfo} mb-2`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span>🔥 D&apos;après l&apos;échauffement, <b>{suggestionsDiff} équipe{suggestionsDiff > 1 ? "s" : ""}</b> pourrai{suggestionsDiff > 1 ? "en" : ""}t changer de parcours. Rien ne change sans ton clic.</span>
                  <button type="button" onClick={() => setShowSuggestions((v) => !v)} className={`${btn.smPrimary} ml-auto`}>{showSuggestions ? "Masquer" : "Voir les suggestions"}</button>
                </div>
                {showSuggestions && (
                  <div className="mt-2 bg-card text-ink rounded-xl border border-line overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className={ui.th}>Équipe</th>
                          <th className={ui.th}>Échauffement</th>
                          <th className={ui.th}>Parcours actuel</th>
                          <th className={ui.th}>Suggestion</th>
                          <th className={ui.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestionRows.map(({ team, cur, sg }) => (
                          <tr key={team.id} className={ui.tr}>
                            <td className="p-2">
                              <b>{team.name}</b>
                              <span className="block text-[11px] text-ink-3">{team.members.map((m) => m.name).join(", ")}</span>
                            </td>
                            <td className="p-2 tabular-nums">
                              {sg.finishMs !== null ? (
                                <>bouclé en <b>{fmt(sg.finishMs)}</b> <span className="text-ink-3">({Math.round((sg.ratio ?? 0) * 100)} % du temps prévu)</span></>
                              ) : (
                                <>pas bouclé : <b>{sg.levels}/{sg.total}</b> séries</>
                              )}
                            </td>
                            <td className="p-2 font-bold text-accent-ink">{starsLabel(cur)}</td>
                            <td className="p-2 font-bold">{sg.stars > cur ? "▲" : "▼"} <span className="text-accent-ink">{starsLabel(sg.stars)}</span> <span className="text-ink-3 font-normal text-xs">{starsName(sg.stars)}</span></td>
                            <td className="p-2 text-right">
                              <button type="button" disabled={pending} onClick={() => applySuggestions([{ team, sg }])} className={btn.smSea}>
                                {sg.stars > cur ? "▲ Monter" : "▼ Descendre"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="p-2 flex flex-wrap items-center gap-2 border-t border-line">
                      <span className={`${ui.hint} flex-1 min-w-[240px]`}>
                        Règle : échauffement bouclé en 80 % du temps prévu ou moins → ★★★ ; jusqu&apos;à 120 % → ★★☆ ; au-delà → ★☆☆. Pas bouclé : ★★☆ s&apos;il a fait au moins les trois quarts des séries, sinon ★☆☆. Tu peux aussi tout régler à la main dans ⚙️ Réglages › Parcours des équipes.
                      </span>
                      <button type="button" disabled={pending} onClick={() => applySuggestions(suggestionRows)} className={btn.smPrimary}>
                        Tout appliquer ({suggestionsDiff})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {teams.length === 0 ? (
              <p className={`${ui.cardPad} ${ui.muted}`}>Aucune équipe : compose-les dans l&apos;onglet « Équipes &amp; arbitres ».</p>
            ) : bundle.emom ? (
              <FitToScreen active={phase !== "pre"}>
              <EmomBoard
                waveMinutes={bundle.emom.waveMinutes}
                levels={levels}
                teams={teams}
                ticks={ticks}
                scores={local.emomScores}
                losses={losses}
                raceMs={liveMs}
                canTick={canTick}
                ended={phase === "post"}
                pendingKeys={pendingMap}
                zombies={bundle.zombies}
                zombieSpeed={bundle.zombieSpeed ?? EMOM_ZOMBIE_SPEED}
                running={phase === "run" && !isPaused}
                onToggle={toggleCard}
                sessionId={sessionId}
                onScore={(teamId, scores) => { queueOp({ kind: "scores", teamId, scores }); }}
              />
              </FitToScreen>
            ) : (
              <>
              <FitToScreen active={phase !== "pre"}>
              <div className="flex flex-col gap-1">
                {(globalRank
                  // Sartay 29/09 soir : « les equipes ne se deplacent plus sur le leaderboard, on change seulement le
                  // petit chiffre qui donne le classement » — lignes fixes dans l'ordre des numeros, couleur du parcours.
                  ? [{ fm: null as Format | null, st: null as Stars | null, key: "all", rows: [...teams].sort((a, b) => a.order - b.order).map((t) => progress.get(t.id)!) }]
                  : FORMATS.flatMap((fm) => ([...STARS].reverse()).map((st) => ({ fm: fm as Format | null, st: st as Stars | null, key: parcoursKey(st, fm) }))).filter(({ key }) => teams.some((t) => groupOf(t.id) === key)).map((g) => ({ ...g, rows: ranked.filter((p) => groupOf(p.teamId) === g.key).sort((a, b) => bossOrder.cmp(a.teamId, b.teamId)) }))
                ).map(({ fm, st, key, rows: group }) => {
                  return (
                    <section key={key} className={cx("rounded-xl flex flex-col gap-1", st !== null && "p-1")} style={st !== null ? { background: STAR_BG[st] } : undefined}>
                      {group.map((p) => {
                        const t = teamById.get(p.teamId)!;
                        return (
                          <motion.div key={t.id} layout={!globalRank} transition={{ type: "spring", stiffness: 260, damping: 28 }} id={`team-row-${t.id}`}>
                            <TeamRow
                              team={t}
                              carryBites={carryOf.get(t.id) ?? 0}
                              progress={p}
                              level={levelOf(t.id, p.currentLevel)}
                              stars={st ?? starsOf(t.id)}
                              format={fm ?? formatOf(t.id)}
                              rank={globalRank ? (phase === "pre" ? 0 : rankOf.get(t.id) ?? 0) : bossOrder.rank.get(t.id) ?? 0}
                              points={globalRank ? pointsOf.get(t.id) ?? 0 : null}
                              teamsCount={group.length}
                              yellow={cardsOf.get(t.id) ?? 0}
                              canTick={canTick}
                              pendingKeys={pendingMap}
                              zombies={bundle.zombies}
                              fixedSpeed={bundle.zombieSpeed}
                              penalties={penalties.filter((x) => x.teamId === t.id)}
                              ticks={ticks}
                              raceMs={zombieMs}
                              running={phase === "run" && !isPaused && !timeUp}
                              coins={coinsOn ? coinsOf.get(t.id) ?? null : null}
                              impact={impact?.teamId === t.id ? impact : null}
                              onDiscount={(reps) => discount(t.id, reps)}
                              onRocket={() => launchRocket(t.id)}
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
              </FitToScreen>
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
              </>
            )}
          </>
        )}

        {view === "results" && <ResultsTable ranked={ranked} teamById={teamById} levelOf={levelOf} rankOf={rankOf} starsOf={starsOf} formatOf={formatOf} cardsOf={cardsOf} extras={extras} phases={bundle.phases} coinsOf={coinsOn ? coinsOf : null} pointsOf={globalRank ? pointsOf : null} />}
        {view === "results" && phase === "post" && !bundle.child && !bundle.emom && queue.length === 0 && <PaceReport sessionId={sessionId} />}
        {view === "recap" && <RecapTable ranked={ranked} teamById={teamById} levels={allLevels} extras={extras} phases={bundle.phases} />}
        {view === "ladder" && (bundle.frozen ? (
          <LevelLadderEditor sessionId={sessionId} levels={levels} ladders={bundle.ladders} teamStars={bundle.teamStars} teamFormats={bundle.teamFormats} catalog={bundle.catalog} ticks={live.ticks} onSaved={refresh} />
        ) : (
          <LadderPreview levels={levels} ladders={bundle.ladders} />
        ))}
        {view === "records" && <RecordsTab isMaster={isMaster} sessionId={sessionId} wod="level" />}
        {view === "arbitrage" && <LevelArbitrage evaluations={bundle.evaluations} onChanged={refresh} />}
        {view === "settings" && (
          <div className={`${ui.cardPad} mb-3`}>
            <p className="font-bold">💾 Sauvegarde des coches <span className={`${ui.hint} font-normal`}>· réglage de ce PC, pour toutes les séances</span></p>
            <div className={`${ui.segmented} inline-flex flex-wrap mt-2`}>
              <button type="button" onClick={() => writeSyncMode("local")} className={cx("px-3 py-1.5 rounded-lg text-sm font-bold", syncMode === "local" ? ui.segOn : ui.segOff)}>📍 Sur ce PC · envoi à la fin du WOD</button>
              <button type="button" onClick={() => { writeSyncMode("live"); if (phase === "run") void flush(true); }} className={cx("px-3 py-1.5 rounded-lg text-sm font-bold", syncMode === "live" ? ui.segOn : ui.segOff)}>🌐 En ligne · envoi toutes les 30 s</button>
            </div>
            <p className={`${ui.hint} mt-2`}>
              {syncMode === "local"
                ? "Pendant le WOD, rien ne part sur le serveur : l'écran calcule tout lui-même (coches, zombies, vies, cartes jaunes, allègements, fusées, pause, fin du WOD). Envoi à la Fin du WOD — nouvel essai toutes les 30 s tant que ça n'est pas passé —, essai aussi à la Pause, ou en cliquant sur 💾 en haut. Tout survit à un rechargement de la page sur ce PC, mais ne recharge pas la page sans réseau : elle ne reviendrait pas."
                : "Envoi toutes les 30 s et tout de suite pour un BOSS. L'écran calcule quand même tout lui-même (pas d'attente du serveur)."}
            </p>
          </div>
        )}
        {view === "settings" && !bundle.child && <TwinScreens sessionId={sessionId} screens={screens} canCreate={showConsole} />}
        {view === "settings" && <LevelSettings sessionId={sessionId} phase={phase} numTeams={teams.length} capMin={bundle.capMin} refereeMode={bundle.refereeMode} levelsCount={levels.length} frozen={bundle.frozen} zombies={bundle.zombies} teamList={teams} teamStars={bundle.teamStars} teamFormats={bundle.teamFormats} formatOf={formatOf} ladders={bundle.ladders} isChild={!!bundle.child} onChanged={refresh} suggestions={suggestions} />}
        {view === "teams" && <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} picker={picker} starsOf={bundle.child ? undefined : starsOf} onCreateStar={bundle.child || phase !== "pre" ? undefined : createStar} onNumber={bundle.child || phase !== "pre" ? undefined : numberTeams} onSetStars={bundle.child ? undefined : (teamId, st) => run(() => setTeamStarsAction(sessionId, teamId, st))} />}
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
                <button onClick={handlePause} disabled={pending} className={isPaused ? btn.lgSuccess : btn.lgAccent}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleEnd} disabled={pending} className={btn.lgDanger}>Fin du WOD</button>
              </>
            )}
            {phase === "post" && <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 WOD terminé</span>}
            {showConsole && <a href="/admin" target="_blank" rel="noopener" className={btn.lgGhost} title="Ouvrir la console dans un nouvel onglet : le WOD reste ouvert ici">🏠 Console ↗</a>}
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

// Caches du rejeu local, hors composant (cles = objets d'etat : liberes avec eux).
// Une coche ajoutee au bout de la file ne rejoue que la nouvelle coche (un WOD sans pause peut en compter 1 000).
const replayCache = new WeakMap<ReplayState, { cfg: ReplayConfig; ops: PendingOp[]; st: ReplayState }>();
function replayQueue(base: ReplayState, cfg: ReplayConfig, queue: PendingOp[]): ReplayState {
  const c = replayCache.get(base);
  let st: ReplayState;
  if (c && c.cfg === cfg && queue.length >= c.ops.length && c.ops.every((o, i) => queue[i] === o)) {
    if (queue.length === c.ops.length) return c.st;
    st = cloneState(c.st);
    replayOps(cfg, st, queue.slice(c.ops.length));
  } else {
    st = cloneState(base);
    replayOps(cfg, st, queue);
  }
  replayCache.set(base, { cfg, ops: queue, st });
  return st;
}
// Constat des zombies jusqu'a maintenant, en repartant du dernier constat pour ce meme etat rejoue.
const caughtCache = new WeakMap<ReplayState, ReplayState>();
function catchUpNow(replayed: ReplayState, cfg: ReplayConfig, untilMs: number): ReplayState {
  const prev = caughtCache.get(replayed) ?? replayed;
  const next = cloneState(prev);
  const out = catchUpAll(cfg, next, untilMs) > 0 ? next : prev;
  caughtCache.set(replayed, out);
  return out;
}

// Sartay 29/09 : les 8 equipes toujours visibles sur l'ecran projete. Si la course depasse la hauteur disponible
// (categorie de plus, bandeau d'echauffement, petit ecran), elle est reduite a l'echelle pour tenir, jamais agrandie.
function FitToScreen({ children, active }: { children: ReactNode; active: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ s: 1, h: 0 });
  useEffect(() => {
    const compute = () => {
      const o = outer.current, i = inner.current;
      if (!o || !i) return;
      const natural = i.offsetHeight; // hauteur de mise en page, avant l'echelle
      const footer = document.querySelector("footer")?.getBoundingClientRect().height ?? 0;
      const avail = window.innerHeight - o.getBoundingClientRect().top - footer - 8;
      const s = active && natural > 0 && avail > 0 ? Math.max(0.5, Math.min(1, avail / natural)) : 1;
      setFit((f) => (Math.abs(f.s - s) < 0.005 && Math.abs(f.h - natural) < 1 ? f : { s, h: natural }));
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (inner.current) ro.observe(inner.current);
    ro.observe(document.body);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [active]);
  const scaled = active && fit.s < 1;
  return (
    <div ref={outer} style={scaled ? { height: fit.h * fit.s } : undefined}>
      <div ref={inner} style={scaled ? { transform: `scale(${fit.s})`, transformOrigin: "top left", width: `${100 / fit.s}%` } : undefined}>{children}</div>
    </div>
  );
}

// Seances jumelles (Sartay 30/09) : deux greffiers, deux ecrans, meme creneau. Chaque ecran est une seance a part
// (equipes, classement, fusees, echauffement, finisher) ; les numeros d'equipe se suivent, un eleve n'est que d'un cote.
function TwinScreens({ sessionId, screens, canCreate }: { sessionId: string; screens: { id: string; label: string }[]; canCreate: boolean }) {
  const [teams, setTeams] = useState("6");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; label: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const others = screens.filter((s) => s.id !== sessionId);
  function create() {
    setError("");
    startTransition(async () => {
      const res = await createTwinSessionAction(sessionId, parseInt(teams, 10));
      if ("error" in res) { setError(res.error); return; }
      setCreated({ id: res.id, label: res.label });
      router.refresh();
    });
  }
  return (
    <div className={`${ui.cardPad} mb-3`}>
      <p className="font-bold">📺 Écrans de ce créneau <span className={`${ui.hint} font-normal`}>· un greffier par écran, deux séances à part</span></p>
      {others.length > 0 && (
        <ul className="mt-2 space-y-1">
          {screens.map((s) => (
            <li key={s.id} className="text-sm flex items-center gap-2">
              {s.id === sessionId ? <b>{s.label} (cet écran)</b> : <><span>{s.label}</span><a href={`/greffier?session=${s.id}`} target="_blank" rel="noopener" className={btn.smGhost}>Ouvrir ↗</a></>}
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <label className={`${ui.hint} flex items-center gap-1`}>Équipes <input type="number" min={1} max={20} value={teams} onChange={(e) => setTeams(e.target.value)} className={`${ui.input} w-16 py-1`} /></label>
          <button type="button" onClick={create} disabled={pending} className={btn.smPrimary}>➕ Ouvrir un {others.length + 2}e écran</button>
        </div>
      )}
      {created && <p className={`${ui.alertInfo} mt-2`}>« {created.label} » est ouvert. Sur l&apos;autre PC : greffier → choisir « {created.label} » dans la liste, ou <a href={`/greffier?session=${created.id}`} target="_blank" rel="noopener" className="underline font-bold">l&apos;ouvrir ici ↗</a>.</p>}
      {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
      <p className={`${ui.hint} mt-2`}>
        Même créneau, mêmes classes, mêmes horaires, mais chaque écran a ses équipes, son classement, ses fusées, son échauffement et son finisher.
        Les numéros d&apos;équipe se suivent d&apos;un écran à l&apos;autre (1-6, puis 7-12) et un élève placé d&apos;un côté n&apos;est pas proposé de l&apos;autre.
        Règle d&apos;abord le nombre d&apos;équipes de cet écran, puis ouvre le suivant.
      </p>
    </div>
  );
}

function liveFromBundle(b: LevelBundle): LevelLive {
  return { ticks: b.ticks, losses: b.losses, yellowCards: b.yellowCards, penalties: b.penalties, emomScores: b.emomScores, coinEvents: b.coinEvents, pauses: b.pauses, startedAtMs: b.startedAtMs, endedAtMs: b.endedAtMs, raceEndedAtMs: b.raceEndedAtMs, structure: "", at: 0, giftCount: b.giftCount, bossEntry: b.bossEntry, streaks: b.streaks };
}

// ===== Finisher EMOM : vague en cours pour tout le monde, fiches decouvertes une a une, score max =====
function EmomBoard({ sessionId, waveMinutes, levels, teams, ticks, losses, scores, raceMs, canTick, ended = false, pendingKeys, zombies, zombieSpeed, running, onToggle, onScore }: {
  sessionId: string;
  ended?: boolean; // finisher termine : les cordes se saisissent encore
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
  onScore: (teamId: string, scores: Record<string, number>) => void;
}) {
  const wave = emomWaveAt(waveMinutes, raceMs);
  const schedule = emomSchedule(waveMinutes);
  const over = ended || raceMs >= emomTotalMs(waveMinutes);
  const progress = teams.map((t) => emomProgress(levels, t.id, ticks, scores, losses));
  const ranked = emomRank(progress);
  const rankOf = new Map(ranked.map((p, i) => [p.teamId, i + 1]));
  const current = wave ? levels.find((l) => l.number === wave.wave) ?? null : null;
  // Derniere vague = maximum de cordes (apres ses fiches s'il y en a, depuis le 28/09).
  const isMax = !!wave && wave.wave === waveMinutes.length;
  return (
    <div className="space-y-2">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-3`}>
        <div className="flex gap-1">
          {schedule.map((w) => (
            <span key={w.wave} className={cx(ui.chip, wave?.wave === w.wave ? ui.chipBrand : raceMs >= w.endMs ? ui.chipOk : ui.chipMuted)}>V{w.wave} · {fmtWaveMin(waveMinutes[w.wave - 1])}</span>
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
            sessionId={sessionId}
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
      <p className={ui.hint}>Les vagues s&apos;enchaînent au chrono, qu&apos;une équipe ait fini ou non. Dans une vague, la fiche suivante n&apos;apparaît qu&apos;une fois la précédente cochée. La dernière vague reprend les fiches de la vague 4, puis c&apos;est le maximum de cordes, tout le monde en même temps : saisis les cordes de chaque joueur (🪢), le total est le score final.{zombies && <> Un zombie du palier {zombieTier(zombieSpeed)} part à chaque vague : il dévore le cœur si la vague n&apos;est pas bouclée à sa fin (💔 une vie).</>}</p>
    </div>
  );
}

// Une equipe du finisher : rang, vagues, zombie de la vague en cours (palier 10), fiches a decouvrir.
function EmomRow({ sessionId, team: t, progress: p, rank, wave, current, isMax, over, ticks, raceMs, canTick, pendingKeys, zombies, zombieSpeed, running, onToggle, onScore }: {
  sessionId: string;
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
  onScore: (teamId: string, scores: Record<string, number>) => void;
}) {
  const next = current ? emomNextCard(current, t.id, ticks) : null;
  const maxOpen = (isMax && !next) || over; // fiches de la derniere vague bouclees, ou EMOM fini/termine : cordes
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
        {current && !(isMax && !next) && (
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
        {maxOpen && <PlayerScores sessionId={sessionId} team={t} total={p.score} disabled={!canTick && !over} onSubmit={(s) => onScore(t.id, s)} />}
        {!current && !over && <span className={ui.hint}>En attente du départ.</span>}
      </div>
    </section>
  );
}

// Cordes de la derniere vague, joueur par joueur (tout le monde saute en meme temps) : total = score de l'equipe.
function PlayerScores({ sessionId, team, total, disabled, onSubmit }: { sessionId: string; team: LevelTeam; total: number | null; disabled: boolean; onSubmit: (scores: Record<string, number>) => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  function openIt() {
    setOpen(true);
    void getEmomPlayerScoresAction(sessionId, team.id).then((r) => {
      if ("error" in r) return;
      setVals(Object.fromEntries(team.members.map((m) => [m.id, r.scores[m.id] !== undefined ? String(r.scores[m.id]) : ""])));
    });
  }
  const parsed = team.members.map((m) => ({ m, n: vals[m.id]?.trim() ? parseInt(vals[m.id], 10) : null }));
  const bad = parsed.some(({ n }) => n !== null && (!Number.isInteger(n) || n < 0 || n > 5000));
  const sum = parsed.reduce((s, { n }) => s + (n && n > 0 ? n : 0), 0);
  return (
    <>
      <button type="button" onClick={openIt} disabled={disabled} className={cx(btn.smPrimary, "flex-shrink-0")}>🪢 Cordes par joueur{total !== null ? ` · ${total}` : ""}</button>
      {open && (
        <div className={ui.backdrop} onClick={() => setOpen(false)}>
          <div className={`${ui.sheet} max-w-md`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-display font-extrabold text-lg">🪢 {team.name} · MAX de cordes</p>
              <button type="button" onClick={() => setOpen(false)} className={ui.close}>✕</button>
            </div>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (bad) return;
                onSubmit(Object.fromEntries(parsed.filter(({ n }) => n !== null).map(({ m, n }) => [m.id, n as number])));
                setOpen(false);
              }}
            >
              {team.members.map((m) => (
                <label key={m.id} className="flex items-center gap-3">
                  <span className="flex-1 font-bold">{m.name}</span>
                  <input type="number" inputMode="numeric" min={0} max={5000} value={vals[m.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [m.id]: e.target.value }))} className={`${ui.input} w-28 text-lg font-display font-extrabold tabular-nums`} placeholder="0" />
                </label>
              ))}
              {team.members.length === 0 && <p className={ui.hint}>Aucun joueur dans cette équipe.</p>}
              <div className="flex items-center justify-between pt-2 border-t border-line">
                <span className="font-display font-extrabold text-xl tabular-nums">Total : {sum}</span>
                <button type="submit" disabled={bad} className={btn.primary}>Valider</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
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

// Cinq parcours (29/09 soir) : 1 vert, 2 violet, 3 bleu (l'ancien 2 etoiles), 4 orange, 5 rouge (l'ancien 3 etoiles).
const STAR_BG: Record<Stars, string> = { 5: "#e59aa3", 4: "#f0b27a", 3: "#94b9e3", 2: "#c3a6e0", 1: "#95d0a8" };
// Fond de chaque ligne d'equipe (28/09 : couleurs encore plus marquees) ; BOSS et echelle bouclee gardent leur teinte.
const STAR_ROW: Record<Stars, string> = { 5: "#fbdadd", 4: "#fde5cf", 3: "#d7e6f7", 2: "#ece1f7", 1: "#d6f0de" };
// Bord gauche de chaque ligne : la couleur franche du parcours (28/09, « augmenter le contraste »).
const STAR_STRONG: Record<Stars, string> = { 5: "#c0392b", 4: "#d35400", 3: "#2471a3", 2: "#7d3c98", 1: "#1e8449" };
// Filigrane « ÉQUIPE n » colore selon le parcours (Sartay 28/09 : la couleur remplace les etoiles a l'ecran).
const STAR_INK: Record<Stars, string> = { 5: "rgba(150, 30, 20, 0.7)", 4: "rgba(150, 70, 10, 0.7)", 3: "rgba(20, 75, 125, 0.7)", 2: "rgba(90, 40, 120, 0.7)", 1: "rgba(15, 95, 45, 0.7)" };

function TeamRow({ team, carryBites = 0, progress: p, level, stars, format = "big", rank, points = null, teamsCount, yellow, canTick, pendingKeys, zombies, fixedSpeed = null, penalties, ticks, raceMs, running, coins = null, impact = null, onDiscount, onRocket, onToggle, onYellow }: {
  onRocket?: () => void;
  team: LevelTeam;
  progress: TeamProgress;
  level: FrozenLevel | null;
  stars: Stars;
  format?: Format; // 1-3 : zombie regle sur une equipe de 3
  carryBites?: number; // morceaux de coeur deja manges au niveau precedent
  rank: number;
  points?: number | null; // classement commun (29/09 soir) : points = niveau x etoiles
  coins?: CoinsState | null;
  impact?: { id: number; text: string; good?: boolean } | null;
  onDiscount?: (reps: number) => void;
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
  const geo = level && zombies && ev ? zombieSim(level, ev.initialTotalSec, ev.events, Math.max(0, raceMs - p.attemptStartMs), speedLevel, all.length, teamSizeOf(format), carryBites) : null;
  const danger = !!geo && (geo.contact || geo.remainingMs <= 20_000);
  // Skin du zombie (Sartay 29/09) : lie au NIVEAU seulement ; une vie perdue le ralentit (speedLevel) mais ne change pas son apparence.
  const kind: ZombieKind = boss ? "boss" : zombieTier(fixedSpeed ?? level?.number ?? 1);
  // Pieces : fiche allegeable (la plus longue restante de l'echelle) et menu d'allegement.
  const [coinOpen, setCoinOpen] = useState(false);
  const target = level && !finished ? rightmostCard(level, team.id, penalties, p.doneCards) : null;
  const horde = boss && level ? Array.from({ length: 4 }, (_, i) => zombieTier(fixedSpeed ?? Math.max(1, level.number - 4 + i))).sort((a, b) => a - b) : [];
  // Fiches restantes toujours visibles et cliquables (Sartay 29/09 : une fiche recue de 50 cordes restait cachee sous
  // le coeur une fois les 100 burpees du BOSS coches) : largeur minimale de la zone des fiches, coeur et zombie
  // toujours a sa gauche.
  const cardsMinRem = remaining.length * 5.75;

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
    if (!impact.good) setShaking(true);
    setToast({ id: impact.id, text: impact.text, bad: !impact.good });
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
      style={{ borderLeft: `10px solid ${STAR_STRONG[stars]}`, ...(boss || finished ? {} : { background: STAR_ROW[stars] }) }}
      className={cx(ui.card, "relative px-2 py-0.5 flex items-center gap-2 min-w-0 h-16 transition-colors", boss && "border-danger/60 bg-danger-soft/40", finished && "border-success/60 bg-success-soft/40", danger && !finished && "ring-2 ring-danger", toast?.bad && "bg-danger-soft animate-pulse", levelFlash && "levelup", shaking && "shake")}
    >
      {/* Tout a gauche (Sartay 29/09) : la fusee, construite toute seule a 100 pieces ; chaque envoi coute la charge. */}
      {coins && (
        <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center">
          {coins.stock > 0 && !finished ? (
            <button type="button" onClick={onRocket} disabled={!canTick} className="rocketpop w-12 h-12 rounded-xl flex items-center justify-center text-3xl disabled:opacity-40" style={{ background: "#efe4ff", border: "2px solid #a06cd5" }} title="Fusée prête : clique pour la lancer. L'envoi coûte la charge (reps × pondération, 1 pièce par seconde de travail) ; banque trop courte : charge réduite. Cible : le concurrent direct (dans le top 4 l'équipe juste devant, le premier vise le deuxième), sinon le top 4 en partant du premier, sinon au hasard. Charge : un exercice maîtrisé, d'autant plus gros que l'équipe a de pièces."><span className="inline-block animate-bounce">🚀</span></button>
          ) : (
            <span className="w-12 h-12 rounded-xl border-2 border-dashed border-line flex flex-col items-center justify-center text-ink-3 leading-none opacity-60" title={`Fusée : se construit toute seule à ${ROCKET_PRICE} pièces en banque`}>
              <span className="text-base grayscale">🚀</span>
              <span className="text-[9px] font-bold tabular-nums">{Math.min(ROCKET_PRICE, coins.bank)}/{ROCKET_PRICE}</span>
            </span>
          )}
        </div>
      )}
      {/* Colonne gauche : rang, equipe, niveau, compteurs. */}
      <div className="flex items-center gap-2 w-[230px] flex-shrink-0 min-w-0">
        <span className={cx("relative w-12 h-12 rounded-xl flex flex-col items-center justify-center font-display font-black leading-none flex-shrink-0 shadow-sm", rankStyle(rank))} title={points !== null ? `Classement commun : ${points} points (niveau × étoiles des niveaux bouclés)` : "Classement"}>
          {rank > 0 ? (
            <>
              <span className="text-[9px] font-bold tracking-widest opacity-70">{rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "RANG"}</span>
              <span className="text-xl">#<Odometer value={rank} /></span>
              {points !== null && <span className="text-[9px] font-bold opacity-70 tabular-nums">{points} pts</span>}
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
            <span className="inline-flex items-center rounded-md bg-ink text-white font-display font-extrabold text-[11px] px-1.5 py-0.5 uppercase tracking-wide truncate" title={`Parcours ${starsName(stars)}`}>{team.name}</span>
            {format !== "big" && <span className="text-[10px] font-bold text-ink-2 bg-line rounded px-1 flex-shrink-0" title={formatName(format)}>{formatLabel(format)}</span>}
            {zombies && <span className={cx("font-display font-black text-xl leading-none tabular-nums flex-shrink-0", p.losses > 0 ? "text-danger-ink" : "text-ink-3")} title="Vies perdues">💔<Odometer value={p.losses} /></span>}
          {coins && (
            <span className="relative">
              <button type="button" onClick={() => setCoinOpen((v) => !v)} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0 font-display font-black text-lg leading-tight border-2 flex-shrink-0", coins.bank > 0 ? "bg-accent-soft border-accent text-accent-ink" : "bg-paper border-line text-ink-3", coinBurst && "coinpulse")} title={`Pièces : ${coins.earned} gagnées${coins.carry ? ` + ${coins.carry} de l'échauffement` : ""} · ${coins.spent} dépensées · ${coins.bank} en banque · fusée ${coins.stock ? "prête" : `à ${ROCKET_PRICE}`}`}>
                🪙<Odometer value={coins.bank} />
              </button>
              {coinOpen && (
                <span className="absolute left-0 top-full mt-1 z-30 w-56 rounded-xl bg-card border border-line shadow-pop p-2 text-left" onMouseLeave={() => setCoinOpen(false)}>
                  <span className="block text-[10px] text-ink-3 mb-1">{coins.earned + coins.carry} gagnées · {coins.spent} dépensées{coins.lost ? ` · ${coins.lost} mangées par le zombie` : ""} · fusée : {coins.stock ? "prête 🚀 (clique dessus)" : `${Math.min(ROCKET_PRICE, coins.bank)}/${ROCKET_PRICE}`}</span>
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
          <div className="flex items-baseline gap-1.5 min-w-0" title={level?.name ?? undefined}>
            {finished ? (
              <span className="font-display font-extrabold text-sm text-success-ink">🏁 Bouclée{p.finishedMs !== null && <> à {fmt(p.finishedMs)}</>}</span>
            ) : level ? (
              <>
                <span className={cx("font-display font-black text-3xl leading-none", boss ? "text-danger-ink" : "text-ink")}>{boss ? "BOSS" : "Niv."} {level.number}</span>
                <span className="text-xs font-bold tabular-nums text-ink-2">{p.currentDone}/{p.currentTotal}</span>
              </>
            ) : (
              <span className={ui.hint}>Échelle vide.</span>
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
        <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 z-[15] flex items-baseline gap-1 select-none pointer-events-none">
          <span className="font-display font-black text-[0.9rem] tracking-[0.2em] uppercase" style={{ color: STAR_INK[stars] }}>Équipe</span>
          <span className="font-display font-black text-[3rem] leading-none" style={{ color: STAR_INK[stars] }}>{team.order}</span>
          <span className="font-display font-black text-2xl leading-none ml-1" style={{ color: STAR_INK[stars] }}>{"★".repeat(stars)}</span>
        </span>
        {!finished && level && (
          <>
            {geo && (
              <>
                <div key={level.number} className="absolute top-1/2 -translate-y-1/2 z-10" style={{ left: `min(calc(${zx * 100}% - ${zombieShift}px), calc(100% - ${cardsMinRem}rem - 80px))`, transition: "left 1s linear" }}>
                  {boss ? <Horde tiers={horde} moving={running && !geo.contact && !lostFlash} /> : <Zombie kind={kind} moving={running && !geo.contact && !lostFlash} />}
                </div>
                <div className={cx("absolute top-1/2 -translate-y-1/2 -translate-x-full z-10 transition-[left] duration-300", biteShake && "bite")} style={{ left: `min(${geo.heart * 100}%, calc(100% - ${cardsMinRem}rem))` }} title={lostFlash ? "Niveau perdu" : geo.contact ? `Cœur dévoré dans ${fmt(Math.max(0, geo.eatMs - geo.eatenMs))}` : `Chute dans ${fmt(Math.max(0, geo.remainingMs))} si personne ne coche`}>
                  <Heart state={lostFlash ? HEART_STATES - 1 : geo.bites} beating={geo.contact || lostFlash} />
                </div>
              </>
            )}
            <div className="absolute right-0 top-1 bottom-1 z-20 flex gap-1" style={{ width: `${Math.min(1, remainingSec / totalSec) * ZOMBIE_ZONE * 100}%`, minWidth: `${cardsMinRem}rem` }}>
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
  const agg: PhaseTeamTotals = { reps: 0, work: 0, repsByExercise: {}, losses: 0, cards: 0, score: null, levels: 0, coins: 0, finishMs: null, estimateMs: 0 };
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

function ResultsTable({ ranked, teamById, levelOf, rankOf, starsOf, formatOf, cardsOf, extras, phases, coinsOf, pointsOf = null }: { ranked: TeamProgress[]; teamById: Map<string, LevelTeam>; levelOf: (teamId: string, number: number | null) => FrozenLevel | null; rankOf: Map<string, number>; starsOf: (teamId: string) => Stars; formatOf: (teamId: string) => Format; cardsOf: Map<string, number>; extras: Map<string, PhaseTeamTotals>; phases: LevelBundle["phases"]; coinsOf: Map<string, CoinsState> | null; pointsOf?: Map<string, number> | null }) {
  const hasFinisher = phases.some((ph) => ph.kind === "finisher");
  const hasPhases = phases.length > 0;
  // Classement commun (29/09 soir) : un seul tableau, points = niveau x etoiles. Avant : un classement par parcours.
  const groups = pointsOf
    ? [{ fm: null as Format | null, st: null as Stars | null, rows: ranked }]
    : FORMATS.flatMap((fm) => STARS.map((st) => ({ fm: fm as Format | null, st: st as Stars | null, rows: ranked.filter((p) => starsOf(p.teamId) === st && formatOf(p.teamId) === fm) }))).filter((g) => g.rows.length > 0);
  const mixed = new Set(groups.map((g) => g.fm)).size > 1;
  return (
    <div className={`${ui.card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={ui.th}>Membres</th>{pointsOf && <th className={`${ui.th} text-right`} title="Somme, sur les niveaux bouclés, de (numéro du niveau × étoiles du parcours où il a été bouclé)">Points</th>}<th className={`${ui.th} text-right`}>Bouclés</th><th className={ui.th}>En cours</th><th className={`${ui.th} text-right`}>Dernière coche</th><th className={`${ui.th} text-right`}>Reps</th><th className={`${ui.th} text-right`}>💔</th><th className={`${ui.th} text-right`}>🟨</th>{coinsOf && <th className={`${ui.th} text-right`} title="Pièces gagnées (échauffement compris) · en banque">🪙</th>}{hasFinisher && <th className={`${ui.th} text-right`}>🪢 Finisher</th>}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(({ fm, st, rows }) => [
            ...(groups.length > 1 && st !== null && fm !== null ? [<tr key={`h${fm}${st}`}><td colSpan={11} className="p-2 bg-paper font-display font-extrabold text-sm">{starsLabel(st)} Parcours {starsName(st)}{mixed ? ` · ${formatName(fm)}` : ""} · {rows.length} équipe{rows.length > 1 ? "s" : ""}</td></tr>] : []),
            ...rows.map((p) => {
            const t = teamById.get(p.teamId)!;
            const l = levelOf(p.teamId, p.currentLevel);
            const ex = extras.get(p.teamId) ?? extrasFor([], 0);
            return (
              <tr key={p.teamId} className={ui.tr}>
                <td className="p-2 font-display font-extrabold">{rankOf.get(p.teamId) ?? "—"}</td>
                <td className="p-2 font-bold">{t.name} <span className="text-[10px] text-accent-ink font-sans">{starsLabel(st ?? starsOf(p.teamId))}{(fm ?? formatOf(p.teamId)) !== "big" ? ` · ${formatLabel(fm ?? formatOf(p.teamId))}` : ""}</span></td>
                <td className={`p-2 ${ui.hint}`}>{t.members.map((m) => m.name).join(", ")}</td>
                {pointsOf && <td className="p-2 text-right tabular-nums font-black">{pointsOf.get(p.teamId) ?? 0}</td>}
                <td className="p-2 text-right tabular-nums font-bold">{p.completedLevels}</td>
                <td className="p-2">{p.currentLevel ? <span className={cx(l?.boss && "text-danger-ink font-bold")}>{levelLabel(l)} · {p.currentDone}/{p.currentTotal}</span> : <span className="text-success-ink font-bold">🏁 {p.finishedMs !== null ? fmt(p.finishedMs) : ""}</span>}</td>
                <td className="p-2 text-right tabular-nums">{p.lastTickMs !== null ? fmt(p.lastTickMs) : "—"}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, p.reps, (x) => x.reps) : undefined}>{p.reps + ex.reps}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, p.losses, (x) => x.losses) : undefined}>{p.losses + ex.losses}</td>
                <td className="p-2 text-right tabular-nums" title={hasPhases ? phaseBreakdown(phases, t.order, cardsOf.get(p.teamId) ?? 0, (x) => x.cards) : undefined}>{(cardsOf.get(p.teamId) ?? 0) + ex.cards}</td>
                {coinsOf && <td className="p-2 text-right tabular-nums" title={`${coinsOf.get(p.teamId)?.earned ?? 0} gagnées au WOD + ${coinsOf.get(p.teamId)?.carry ?? 0} de l'échauffement − ${coinsOf.get(p.teamId)?.lost ?? 0} mangées par le zombie · ${coinsOf.get(p.teamId)?.spent ?? 0} dépensées`}><b>{coinsOf.get(p.teamId)?.score ?? 0}</b> <span className="text-ink-3">· {coinsOf.get(p.teamId)?.bank ?? 0}</span></td>}
                {hasFinisher && <td className="p-2 text-right tabular-nums font-bold">{ex.score !== null ? `${ex.score} cordes` : "—"}</td>}
              </tr>
            );
          }),
          ])}
          {ranked.length === 0 && <tr><td colSpan={11} className={`p-3 ${ui.muted}`}>Pas encore d&apos;équipe.</td></tr>}
        </tbody>
      </table>
      {hasPhases && <p className={`${ui.hint} p-2`}>Reps, travail, 💔 et 🟨 additionnent le WOD et {phases.map((ph) => `l'${PHASE_NAMES[ph.kind]}`).join(" et ").replace("l'finisher", "le finisher")} (survole une valeur pour le détail). Le classement, lui, reste celui du WOD : {pointsOf ? "points (niveau × étoiles), puis reps, puis vies perdues, pièces et rapidité" : "niveaux bouclés, puis vies perdues, puis fiches, puis rapidité"}.</p>}
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
  const [format, setFormat] = useState<Format>("big");
  const shown = ladderFor(levels, ladders, stars, format);
  const available = STARS.filter((st) => st === 2 || (ladders[st]?.length ?? 0) > 0);
  const smallMissing = format !== "big" && !ladders[ladderKey(stars, format)]?.length;
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
      <div className={`${ui.segmented} inline-flex ml-2`} title="Format d'équipe : 4-5+ = échelle de référence ; 1-3 = reps ÷ 1,7, 5 fiches max">
        {FORMATS.map((fm) => (
          <button key={fm} type="button" onClick={() => setFormat(fm)} className={cx("px-3 py-1.5 rounded-lg text-sm font-bold", format === fm ? ui.segOn : ui.segOff)} title={formatName(fm)}>
            {formatLabel(fm)}
          </button>
        ))}
      </div>
      {smallMissing && <p className={ui.alertInfo}>Pas d&apos;échelle {formatLabel(format)} figée pour ce parcours : ses {formatName(format)} jouent l&apos;échelle affichée (5+).</p>}
      {shown.length === 0 && <p className={ui.alertWarn}>Aucun niveau : l&apos;atelier Level est vide.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {shown.map((l) => (
          <div key={l.number} className={cx(ui.card, "p-2.5", l.boss && "border-danger/50 bg-danger-soft/40")}>
            <p className={cx("font-display font-extrabold", l.boss ? "text-danger-ink" : "text-ink")}>{l.boss ? "BOSS" : "Niveau"} {l.number}{l.name ? <span className="text-xs text-ink-2 font-sans font-normal"> · {l.name.replace(/^BOSS · /, "")}</span> : null}</p>
            <p className="text-xs text-ink-2">{activeCards(l).map(({ card }) => `${card.reps} ${cap(card.label)}`).join(" · ")}</p>
            <p className={`${ui.hint} tabular-nums`}>≈ {fmtTheoretical(estimateSeconds(activeCards(l).map(({ card }) => ({ reps: card.reps, weight: card.weight })), l.boss, teamSizeOf(format)))}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
