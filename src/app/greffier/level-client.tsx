"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { elapsed, fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  activeCards, estimateSeconds, fmtTheoretical, levelLabel, progressOf, rankTeams, zombieGeometry, zombieSpeedLevel, zombieTier, ZOMBIE_ZONE,
  type FrozenLevel, type TeamProgress, type Tick,
} from "@/lib/wod-engines/templates/level-engine";
import type { LevelBundle, LevelTeam } from "@/lib/level-context";
import { endLevelAction, levelLiveAction, levelPauseAction, levelPulseAction, levelYellowCardAction, setLevelCapAction, startLevelAction, tickCardAction, untickCardAction, type LevelLive, type TeamLive } from "./level-actions";
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
  useEffect(() => { setLive(liveFromBundle(bundle)); setOptimistic(new Map()); }, [bundle]);
  const { startedAtMs, endedAtMs, pauses } = live;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Coches en attente de confirmation serveur : l'ecran reagit au doigt, la reponse de la coche confirme.
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());
  function mergeTeam(t: TeamLive) {
    setLive((l) => ({
      ...l,
      ticks: [...l.ticks.filter((x) => x.teamId !== t.teamId), ...t.ticks],
      losses: [...l.losses.filter((x) => x.teamId !== t.teamId), ...t.losses],
      yellowCards: [...l.yellowCards.filter((x) => x.teamId !== t.teamId), ...t.yellowCards],
    }));
    setOptimistic((m) => { const n = new Map(m); for (const k of n.keys()) if (k.startsWith(t.teamId + "_")) n.delete(k); return n; });
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
  // Pouls : compteurs seulement. Si la structure a bouge (equipes, membres, echelle, temps impose, depart,
  // fin) -> page entiere ; sinon -> juste l'etat vivant (6 requetes). Aucun rendu si rien n'a change.
  const lastPulse = useCallback(() => levelPulseAction(sessionId), [sessionId]);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (phase === "post") return;
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (stop || busy || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      busy = true;
      try {
        const sig = await lastPulse();
        if (stop || !sig) return;
        if (lastSig.current === null) { lastSig.current = sig; return; }
        if (sig === lastSig.current) return;
        const a = lastSig.current.split("|"), b = sig.split("|");
        lastSig.current = sig;
        const structural = [2, 3, 5, 6, 7, 8].some((i) => a[i] !== b[i]);
        if (structural) router.refresh();
        else {
          const l = await levelLiveAction(sessionId);
          if (!("error" in l)) setLive(l);
        }
      } catch {
        /* reseau : prochain tick */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [phase, lastPulse, sessionId, router]);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    return elapsed(startedAtMs, pauses, phase === "post" ? endedAtMs! : now) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);
  // Temps impose : compte a rebours, rouge dans les 10 dernieres minutes, « temps ecoule » au bout.
  const capMs = bundle.capMin !== null ? bundle.capMin * 60_000 : null;
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
  const progress = useMemo(() => new Map(teams.map((t) => [t.id, progressOf(levels, t.id, ticks, live.losses)])), [teams, levels, ticks, live.losses]);
  const ranked = useMemo(() => rankTeams([...progress.values()]), [progress]);
  const rankOf = useMemo(() => new Map(ranked.map((p, i) => [p.teamId, i + 1])), [ranked]);
  const levelByNumber = useMemo(() => new Map(levels.map((l) => [l.number, l])), [levels]);
  const cardsOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of live.yellowCards) m.set(c.teamId, (m.get(c.teamId) ?? 0) + 1);
    return m;
  }, [live.yellowCards]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  // Mode zombies : quand un zombie touche un coeur, c'est le serveur qui tranche ; l'ecran se contente de
  // demander une relecture (une seule par rattrapage, pas a chaque seconde).
  const [caughtRefreshAt, setCaughtRefreshAt] = useState(0);
  useEffect(() => {
    if (!bundle.zombies || phase !== "run" || isPaused) return;
    const raceNow = liveMs;
    const due = [...progress.values()].some((p) => {
      if (p.currentLevel === null) return false;
      const l = levelByNumber.get(p.currentLevel);
      return !!l && zombieGeometry(l, p.currentDone, raceNow - p.attemptStartMs, zombieSpeedLevel(l.number, p.losses)).remainingMs <= 0;
    });
    if (due && Date.now() - caughtRefreshAt > 4000) {
      setCaughtRefreshAt(Date.now());
      void levelLiveAction(sessionId).then((l) => { if (!("error" in l)) setLive(l); });
    }
  }, [bundle.zombies, phase, isPaused, liveMs, progress, levelByNumber, caughtRefreshAt, sessionId]);

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
      mergeTeam(res.team);
      if (res.caught) setError(`Le zombie a rattrapé ${teamById.get(teamId)?.name ?? "l'équipe"} : elle retombe au niveau précédent.`);
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
    const exercises = exerciseColumns(levels);
    const head = ["Rang", "Équipe", "Membres", "Niveaux bouclés", "Niveau en cours", "Fiches du niveau", "Dernière coche", "Reps", "Travail (s)", "Cartes jaunes", "Échelle bouclée à", ...exercises];
    const lines = ranked.map((p) => {
      const t = teamById.get(p.teamId)!;
      return [
        rankOf.get(p.teamId), t.name, t.members.map((m) => m.name).join(" / "), p.completedLevels, p.currentLevel ?? "terminé",
        p.currentLevel ? `${p.currentDone}/${p.currentTotal}` : "", p.lastTickMs !== null ? fmt(p.lastTickMs) : "", p.reps, Math.round(p.weighted), cardsOf.get(p.teamId) ?? 0,
        p.finishedMs !== null ? fmt(p.finishedMs) : "", ...exercises.map((e) => p.repsByExercise[e] ?? 0),
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
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
      </header>

      <main className="max-w-[1800px] mx-auto p-3 sm:p-4">
        {view === "race" && (
          <>
            {teams.length === 0 ? (
              <p className={`${ui.cardPad} ${ui.muted}`}>Aucune équipe : compose-les dans l&apos;onglet « Équipes &amp; arbitres ».</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {teams.map((t) => (
                  <TeamRow
                    key={t.id}
                    team={t}
                    progress={progress.get(t.id)!}
                    level={progress.get(t.id)!.currentLevel ? levelByNumber.get(progress.get(t.id)!.currentLevel!) ?? null : null}
                    rank={rankOf.get(t.id) ?? 0}
                    yellow={cardsOf.get(t.id) ?? 0}
                    canTick={canTick}
                    pendingKeys={optimistic}
                    zombies={bundle.zombies}
                    raceMs={liveMs}
                    running={phase === "run" && !isPaused}
                    onToggle={(level, card, done) => toggleCard(t.id, level, card, done)}
                    onYellow={(delta) => yellow(t.id, delta)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {view === "results" && <ResultsTable ranked={ranked} teamById={teamById} levelByNumber={levelByNumber} cardsOf={cardsOf} />}
        {view === "recap" && <RecapTable ranked={ranked} teamById={teamById} levels={levels} />}
        {view === "ladder" && (bundle.frozen ? (
          <LevelLadderEditor sessionId={sessionId} levels={levels} catalog={bundle.catalog} ticks={live.ticks} onSaved={refresh} />
        ) : (
          <LadderPreview levels={levels} />
        ))}
        {view === "records" && <RecordsTab isMaster={isMaster} sessionId={sessionId} wod="level" />}
        {view === "arbitrage" && <LevelArbitrage evaluations={bundle.evaluations} onChanged={refresh} />}
        {view === "settings" && <LevelSettings sessionId={sessionId} phase={phase} numTeams={teams.length} capMin={bundle.capMin} refereeMode={bundle.refereeMode} levelsCount={levels.length} frozen={bundle.frozen} zombies={bundle.zombies} />}
        {view === "teams" && <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} picker={picker} />}
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
  return { ticks: b.ticks, losses: b.losses, yellowCards: b.yellowCards, pauses: b.pauses, startedAtMs: b.startedAtMs, endedAtMs: b.endedAtMs, raceEndedAtMs: b.raceEndedAtMs };
}

// Colonnes d'exercices du recap : ordre de premiere apparition dans l'echelle.
function exerciseColumns(levels: FrozenLevel[]): string[] {
  const out: string[] = [];
  for (const l of levels) for (const c of l.cards) if (!c.off && !out.includes(c.label)) out.push(c.label);
  return out;
}

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Sprites : public/zombies/z01.png .. z10.png et boss.png (4 frames en ligne, transparent). Absent -> emoji.
// Cadence de marche : lente pour les premiers paliers (zombies kawaii qui trainent la patte), plus vive ensuite.
type ZombieKind = number | "boss";
const spriteFile = (kind: ZombieKind) => `/zombies/${kind === "boss" ? "boss" : "z" + String(kind).padStart(2, "0")}.png`;
const walkSeconds = (kind: ZombieKind) => (kind === "boss" ? 0.9 : kind <= 3 ? 1.5 : kind <= 7 ? 1.1 : 0.75);
const spriteCache = new Map<string, boolean>();
function useSprite(kind: ZombieKind): boolean | null {
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

function Zombie({ kind, moving }: { kind: ZombieKind; moving: boolean }) {
  const ok = useSprite(kind);
  const title = kind === "boss" ? "Zombie BOSS" : `Zombie palier ${kind}`;
  if (ok) {
    return <span className={cx("block", kind === "boss" ? "w-14 h-14" : "w-12 h-12", moving && "zwalk")} style={{ backgroundImage: `url(${spriteFile(kind)})`, backgroundSize: "400% 100%", backgroundRepeat: "no-repeat", animationDuration: `${walkSeconds(kind)}s` }} title={title} />;
  }
  return <span className={cx("text-3xl leading-none", moving && "zbob")} style={{ transform: "scaleX(-1)", display: "inline-block", animationDuration: `${walkSeconds(kind) / 2}s` }} title={title}>{kind === "boss" ? "👹" : "🧟"}</span>;
}

function TeamRow({ team, progress: p, level, rank, yellow, canTick, pendingKeys, zombies, raceMs, running, onToggle, onYellow }: {
  team: LevelTeam;
  progress: TeamProgress;
  level: FrozenLevel | null;
  rank: number;
  yellow: number;
  canTick: boolean;
  pendingKeys: Map<string, boolean>;
  zombies: boolean;
  raceMs: number;
  running: boolean;
  onToggle: (level: number, card: number, done: boolean) => void;
  onYellow: (delta: 1 | -1) => void;
}) {
  const finished = p.currentLevel === null;
  const boss = !!level?.boss;
  const act = level ? activeCards(level) : [];
  const n = Math.max(1, act.length);
  const remaining = [...act].filter(({ index }) => !p.doneCards.has(`${level!.number}_${index}`)).sort((a, b) => a.card.reps - b.card.reps || a.index - b.index);
  const speedLevel = level ? zombieSpeedLevel(level.number, p.losses) : 1;
  const geo = level && zombies ? zombieGeometry(level, p.currentDone, Math.max(0, raceMs - p.attemptStartMs), speedLevel) : null;
  const danger = !!geo && geo.remainingMs <= 30_000;
  const kind: ZombieKind = boss ? "boss" : zombieTier(speedLevel);
  return (
    <section
      title={team.members.map((m) => m.name).join(", ")}
      className={cx(ui.card, "px-2 py-1 flex items-center gap-2 min-w-0 h-16", boss && "border-danger/60 bg-danger-soft/40", finished && "border-success/60 bg-success-soft/40", danger && !finished && "ring-2 ring-danger")}
    >
      <div className="flex flex-col gap-0.5 w-[190px] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="inline-flex items-center rounded-md bg-ink text-white font-display font-extrabold text-[11px] px-1.5 py-0.5 uppercase tracking-wide truncate">{team.name}</span>
          {rank > 0 && <span className={cx(ui.chip, "px-1.5", rank === 1 ? ui.chipAccent : rank <= 3 ? ui.chipBrand : ui.chipMuted)}>#{rank}</span>}
          {zombies && <span className="text-[11px] font-bold tabular-nums" title="Vies perdues">💔{p.losses}</span>}
          <span className="ml-auto flex items-center gap-0.5 flex-shrink-0">
            {yellow > 0 && <button type="button" onClick={() => onYellow(-1)} disabled={!canTick} className="w-5 h-5 rounded-full bg-paper text-ink-2 hover:bg-line text-xs font-bold leading-none disabled:opacity-30" aria-label="Retirer une carte jaune">−</button>}
            <button type="button" onClick={() => onYellow(1)} disabled={!canTick} className="h-5 rounded-full bg-paper hover:bg-line px-1.5 text-xs font-bold tabular-nums leading-none disabled:opacity-30" title="Donner une carte jaune">🟨{yellow}</button>
          </span>
        </div>
        <div className="flex items-baseline gap-1 min-w-0" title={level?.name ?? undefined}>
          {finished ? (
            <span className="font-display font-extrabold text-sm text-success-ink">🏁 Bouclée{p.finishedMs !== null && <> à {fmt(p.finishedMs)}</>}</span>
          ) : level ? (
            <>
              <span className={cx("font-display font-extrabold text-lg leading-none", boss ? "text-danger-ink" : "text-ink")}>{boss ? "BOSS" : "Niv."} {level.number}</span>
              <span className="text-[11px] font-bold tabular-nums text-ink-2">{p.currentDone}/{p.currentTotal}</span>
              <span className={`${ui.hint} tabular-nums ml-auto`}>{p.reps} reps</span>
            </>
          ) : (
            <span className={ui.hint}>Échelle vide.</span>
          )}
        </div>
      </div>

      {/* Piste : zombie a gauche, coeur devant les fiches restantes alignees a droite (moitie droite de la piste). */}
      <div className="relative flex-1 h-full min-w-0">
        {!finished && level && (
          <>
            {geo && (
              <>
                {/* Un zombie par niveau : la cle change avec le niveau, il repart simplement du coin gauche. */}
                <div key={level.number} className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc(${geo.zombie * 100}% - 24px)`, transition: "left 1s linear" }}>
                  <Zombie kind={kind} moving={running} />
                </div>
                <div className={cx("absolute top-1/2 -translate-y-1/2 -translate-x-full text-2xl leading-none transition-[left] duration-300", danger && "heartbeat")} style={{ left: `${geo.heart * 100}%` }} title={geo.remainingMs > 0 ? `Le zombie arrive dans ${fmt(geo.remainingMs)}` : "Rattrapée !"}>❤️</div>
              </>
            )}
            <div className="absolute right-0 top-1 bottom-1 flex gap-1" style={{ width: `${(remaining.length / n) * ZOMBIE_ZONE * 100}%` }}>
              {remaining.map(({ card, index }) => {
                const busy = pendingKeys.has(`${team.id}_${level.number}_${index}`);
                return (
                  <button
                    key={index}
                    type="button"
                    disabled={!canTick || busy}
                    onClick={() => onToggle(level.number, index, false)}
                    title={`${card.reps} ${cap(card.label)} — cocher quand c'est fait`}
                    className={cx("flex-1 min-w-0 rounded-lg border px-1.5 text-left flex items-center gap-1.5 leading-tight transition active:scale-[.98] bg-card border-line-2 hover:border-brand", (!canTick || busy) && "opacity-60")}
                  >
                    <span className="font-display font-extrabold text-xl tabular-nums flex-shrink-0">{card.reps}</span>
                    <span className="font-bold text-sm truncate">{cap(card.label)}</span>
                  </button>
                );
              })}
            </div>
            {p.currentDone > 0 && (
              <button type="button" disabled={!canTick} onClick={() => { const last = act.filter(({ index }) => p.doneCards.has(`${level.number}_${index}`)).pop(); if (last) onToggle(level.number, last.index, true); }} className="absolute left-0 bottom-0 text-[10px] text-ink-3 underline disabled:opacity-40" title="Annuler la dernière fiche cochée de ce niveau">annuler une coche</button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function TeamCard({ team, progress: p, level, rank, yellow, canTick, pendingKeys, onToggle, onYellow }: {
  team: LevelTeam;
  progress: TeamProgress;
  level: FrozenLevel | null;
  rank: number;
  yellow: number;
  canTick: boolean;
  pendingKeys: Map<string, boolean>;
  onToggle: (level: number, card: number, done: boolean) => void;
  onYellow: (delta: 1 | -1) => void;
}) {
  const finished = p.currentLevel === null;
  const boss = !!level?.boss;
  // Fiches par reps croissantes : plus intuitif pour le greffier (l'index reste celui de l'echelle).
  const cards = level ? [...activeCards(level)].sort((a, b) => a.card.reps - b.card.reps || a.index - b.index) : [];
  return (
    <section
      title={team.members.map((m) => m.name).join(", ")}
      className={cx(ui.card, "p-2 flex flex-col gap-1.5 min-w-0", boss && "border-danger/60 bg-danger-soft/40", finished && "border-success/60 bg-success-soft/40")}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className="inline-flex items-center rounded-md bg-ink text-white font-display font-extrabold text-[11px] px-1.5 py-0.5 uppercase tracking-wide truncate">{team.name}</span>
        {rank > 0 && <span className={cx(ui.chip, "px-1.5", rank === 1 ? ui.chipAccent : rank <= 3 ? ui.chipBrand : ui.chipMuted)}>#{rank}</span>}
        <span className="ml-auto flex items-center gap-0.5 flex-shrink-0">
          {yellow > 0 && <button type="button" onClick={() => onYellow(-1)} disabled={!canTick} className="w-5 h-5 rounded-full bg-paper text-ink-2 hover:bg-line text-xs font-bold leading-none disabled:opacity-30" aria-label="Retirer une carte jaune">−</button>}
          <button type="button" onClick={() => onYellow(1)} disabled={!canTick} className="h-5 rounded-full bg-paper hover:bg-line px-1.5 text-xs font-bold tabular-nums leading-none disabled:opacity-30" title="Donner une carte jaune">🟨{yellow}</button>
        </span>
      </div>

      {finished ? (
        <div className="py-2 text-center">
          <div className="text-2xl">🏁</div>
          <p className="font-display font-extrabold text-success-ink text-sm leading-tight">Bouclée{p.finishedMs !== null && <> à {fmt(p.finishedMs)}</>}</p>
          <p className={ui.hint}>{p.completedLevels} niv. · {p.reps} reps</p>
        </div>
      ) : level ? (
        <>
          <div className="flex items-baseline gap-1 min-w-0" title={level.name ?? undefined}>
            <span className={cx("font-display font-extrabold text-lg leading-none", boss ? "text-danger-ink" : "text-ink")}>{boss ? "BOSS" : "Niv."} {level.number}</span>
            <span className="ml-auto text-[11px] font-bold tabular-nums text-ink-2">{p.currentDone}/{p.currentTotal}</span>
          </div>
          <div className="h-1 rounded-full bg-line overflow-hidden">
            <div className={cx("h-full transition-all", boss ? "bg-danger" : "bg-brand")} style={{ width: `${p.currentTotal ? (100 * p.currentDone) / p.currentTotal : 0}%` }} />
          </div>
          <div className="space-y-1">
            {cards.map(({ card, index }) => {
              const done = p.doneCards.has(`${level.number}_${index}`);
              const busy = pendingKeys.has(`${team.id}_${level.number}_${index}`);
              return (
                <button
                  key={index}
                  type="button"
                  disabled={!canTick || busy}
                  onClick={() => onToggle(level.number, index, done)}
                  title={`${card.reps} ${cap(card.label)}`}
                  className={cx(
                    "w-full flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left border transition active:scale-[.98] min-w-0",
                    done ? "bg-success text-white border-success" : "bg-card border-line-2 hover:border-brand",
                    (!canTick || busy) && "opacity-60"
                  )}
                >
                  <span className={cx("w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] font-black flex-shrink-0", done ? "border-white bg-white text-success" : "border-line-2")}>{done ? "✓" : ""}</span>
                  <span className="font-display font-extrabold text-sm tabular-nums flex-shrink-0">{card.reps}</span>
                  <span className="font-bold text-xs truncate">{cap(card.label)}</span>
                </button>
              );
            })}
          </div>
          <p className={`${ui.hint} tabular-nums`}>{p.completedLevels} bouclé{p.completedLevels > 1 ? "s" : ""} · {p.reps} reps</p>
        </>
      ) : (
        <p className={ui.hint}>Échelle vide.</p>
      )}
    </section>
  );
}

function ResultsTable({ ranked, teamById, levelByNumber, cardsOf }: { ranked: TeamProgress[]; teamById: Map<string, LevelTeam>; levelByNumber: Map<number, FrozenLevel>; cardsOf: Map<string, number> }) {
  return (
    <div className={`${ui.card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={ui.th}>Membres</th><th className={`${ui.th} text-right`}>Bouclés</th><th className={ui.th}>En cours</th><th className={`${ui.th} text-right`}>Dernière coche</th><th className={`${ui.th} text-right`}>Reps</th><th className={`${ui.th} text-right`}>Travail</th><th className={`${ui.th} text-right`}>💔</th><th className={`${ui.th} text-right`}>🟨</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => {
            const t = teamById.get(p.teamId)!;
            const l = p.currentLevel ? levelByNumber.get(p.currentLevel) : null;
            return (
              <tr key={p.teamId} className={ui.tr}>
                <td className="p-2 font-display font-extrabold">{i + 1}</td>
                <td className="p-2 font-bold">{t.name}</td>
                <td className={`p-2 ${ui.hint}`}>{t.members.map((m) => m.name).join(", ")}</td>
                <td className="p-2 text-right tabular-nums font-bold">{p.completedLevels}</td>
                <td className="p-2">{p.currentLevel ? <span className={cx(l?.boss && "text-danger-ink font-bold")}>{levelLabel(l)} · {p.currentDone}/{p.currentTotal}</span> : <span className="text-success-ink font-bold">🏁 {p.finishedMs !== null ? fmt(p.finishedMs) : ""}</span>}</td>
                <td className="p-2 text-right tabular-nums">{p.lastTickMs !== null ? fmt(p.lastTickMs) : "—"}</td>
                <td className="p-2 text-right tabular-nums">{p.reps}</td>
                <td className="p-2 text-right tabular-nums">{fmtTheoretical(p.weighted)}</td>
                <td className="p-2 text-right tabular-nums">{p.losses}</td>
                <td className="p-2 text-right tabular-nums">{cardsOf.get(p.teamId) ?? 0}</td>
              </tr>
            );
          })}
          {ranked.length === 0 && <tr><td colSpan={10} className={`p-3 ${ui.muted}`}>Pas encore d&apos;équipe.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RecapTable({ ranked, teamById, levels }: { ranked: TeamProgress[]; teamById: Map<string, LevelTeam>; levels: FrozenLevel[] }) {
  const cols = exerciseColumns(levels);
  const totals = cols.map((c) => ranked.reduce((s, p) => s + (p.repsByExercise[c] ?? 0), 0));
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
              {cols.map((c) => <td key={c} className="p-2 text-right tabular-nums">{p.repsByExercise[c] ?? ""}</td>)}
              <td className="p-2 text-right tabular-nums font-bold">{p.reps}</td>
            </tr>
          ))}
          <tr className="bg-paper">
            <td className="p-2 font-bold">Toutes</td>
            {totals.map((n, i) => <td key={cols[i]} className="p-2 text-right tabular-nums font-bold">{n || ""}</td>)}
            <td className="p-2 text-right tabular-nums font-bold">{totals.reduce((a, b) => a + b, 0)}</td>
          </tr>
        </tbody>
      </table>
      <p className={`${ui.hint} p-2`}>Reps validées par le greffier (fiches entières). Les reps observées par les arbitres, élève par élève, sont dans le démineur.</p>
    </div>
  );
}

function LadderPreview({ levels }: { levels: FrozenLevel[] }) {
  return (
    <div className="space-y-2">
      <p className={`${ui.cardPad} ${ui.muted}`}>
        Échelle commune de l&apos;atelier, figée dans la séance au coup d&apos;envoi. Pour la modifier avant le départ : <a href="/admin/level" className="underline font-bold">atelier Level</a>. Une fois lancée, elle se retouche ici, pour cette séance seulement. <a href="/admin/level/fiches" target="_blank" className="underline font-bold">🖨️ Imprimer les fiches</a>.
      </p>
      {levels.length === 0 && <p className={ui.alertWarn}>Aucun niveau : l&apos;atelier Level est vide.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {levels.map((l) => (
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
