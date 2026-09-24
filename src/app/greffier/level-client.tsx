"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { elapsed, fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import {
  activeCards, estimateSeconds, fmtTheoretical, levelLabel, progressOf, rankTeams,
  type FrozenLevel, type TeamProgress, type Tick,
} from "@/lib/wod-engines/templates/level-engine";
import type { LevelBundle, LevelTeam } from "@/lib/level-context";
import { endLevelAction, levelPauseAction, levelPulseAction, levelYellowCardAction, startLevelAction, tickCardAction, untickCardAction } from "./level-actions";
import { usePulse } from "../_components/usePulse";
import { TeamsManager, type TeamWithMembers, type RefereeView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { LevelLadderEditor } from "./LevelLadderEditor";
import { RecordsTab } from "./RecordsTab";
import { LevelArbitrage } from "./LevelArbitrage";
import { LogoutButton } from "../_components/LogoutButton";
import type { PendingRequest } from "./referee-decisions";
import { SessionStep, sessionDay, type SessionOption } from "./client";
import { btn, cx, ui } from "@/lib/ui";

type View = "race" | "results" | "recap" | "ladder" | "records" | "arbitrage" | "teams";

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
  const { levels, teams, startedAtMs, endedAtMs, pauses } = bundle;
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Coches en attente de confirmation serveur : l'ecran reagit au doigt, la base confirme au pouls suivant.
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());
  useEffect(() => setOptimistic(new Map()), [bundle.ticks]);

  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);
  const isPaused = pauses.some((p) => p.to === null);
  const phase: "pre" | "run" | "post" = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  const [view, setView] = useState<View>(phase === "pre" && memberCount === 0 ? "teams" : "race");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, isPaused]);
  const pulse = useCallback(() => levelPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 8000, phase !== "post" && !pending);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    return elapsed(startedAtMs, pauses, phase === "post" ? endedAtMs! : now) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);

  // Coches effectives = base + optimistes (ajouts et retraits en attente).
  const ticks: Tick[] = useMemo(() => {
    const out: Tick[] = bundle.ticks.filter((t) => optimistic.get(`${t.teamId}_${t.level}_${t.card}`) !== false).map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: t.atMs }));
    for (const [key, on] of optimistic) {
      if (!on) continue;
      const [teamId, level, card] = key.split("_");
      if (!out.some((t) => t.teamId === teamId && t.level === Number(level) && t.card === Number(card))) out.push({ teamId, level: Number(level), card: Number(card), atMs: liveMs });
    }
    return out;
  }, [bundle.ticks, optimistic, liveMs]);
  const progress = useMemo(() => new Map(teams.map((t) => [t.id, progressOf(levels, t.id, ticks)])), [teams, levels, ticks]);
  const ranked = useMemo(() => rankTeams([...progress.values()]), [progress]);
  const rankOf = useMemo(() => new Map(ranked.map((p, i) => [p.teamId, i + 1])), [ranked]);
  const levelByNumber = useMemo(() => new Map(levels.map((l) => [l.number, l])), [levels]);
  const cardsOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of bundle.yellowCards) m.set(c.teamId, (m.get(c.teamId) ?? 0) + 1);
    return m;
  }, [bundle.yellowCards]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

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
    startTransition(async () => {
      const res = done ? await untickCardAction(sessionId, teamId, level, card) : await tickCardAction(sessionId, teamId, level, card);
      if ("error" in res) {
        setError(res.error);
        setOptimistic((m) => { const n = new Map(m); n.delete(key); return n; });
      } else refresh();
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
  const canTick = phase === "run" && !isPaused;

  return (
    <div className={`${ui.page} pb-28`}>
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4 py-2">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
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
          </div>
          <p className={cx("font-display text-[3.4rem] font-extrabold leading-none tracking-tight tabular-nums text-center", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : "text-ink")}>{fmt(liveMs) || "0:00"}</p>
          <div className="text-right">
            <p className="text-xs text-ink-2">{phase === "pre" ? "Chrono à l'arrêt" : phase === "post" ? "WOD terminé" : isPaused ? "EN PAUSE — coches bloquées" : "WOD en cours"}</p>
            <p className={ui.hint}>Échelle : {levels.length} niveau{levels.length > 1 ? "x" : ""}{bundle.frozen ? " · figée" : " · vive (figée au départ)"}</p>
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
      </header>

      <main className="max-w-[1800px] mx-auto p-3 sm:p-4">
        {view === "race" && (
          <>
            {ranked.length > 0 && phase !== "pre" && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ranked.map((p, i) => {
                  const t = teamById.get(p.teamId)!;
                  const l = p.currentLevel ? levelByNumber.get(p.currentLevel) : null;
                  return (
                    <span key={p.teamId} className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", i === 0 ? "bg-accent text-ink" : i < 3 ? "bg-ink text-white" : "bg-card border border-line text-ink")}>
                      <span className="opacity-70">#{i + 1}</span> {t.name} <span className={cx("font-black", l?.boss && "text-danger")}>{p.currentLevel ? levelLabel(l) : "🏁"}</span>
                      {p.currentLevel && <span className="opacity-70">{p.currentDone}/{p.currentTotal}</span>}
                    </span>
                  );
                })}
              </div>
            )}
            {teams.length === 0 ? (
              <p className={`${ui.cardPad} ${ui.muted}`}>Aucune équipe : compose-les dans l&apos;onglet « Équipes &amp; arbitres ».</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {teams.map((t) => (
                  <TeamCard
                    key={t.id}
                    team={t}
                    progress={progress.get(t.id)!}
                    level={progress.get(t.id)!.currentLevel ? levelByNumber.get(progress.get(t.id)!.currentLevel!) ?? null : null}
                    rank={rankOf.get(t.id) ?? 0}
                    yellow={cardsOf.get(t.id) ?? 0}
                    canTick={canTick}
                    pendingKeys={optimistic}
                    onToggle={(level, card, done) => toggleCard(t.id, level, card, done)}
                    onYellow={(delta) => run(() => levelYellowCardAction(sessionId, t.id, delta))}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {view === "results" && <ResultsTable ranked={ranked} teamById={teamById} levelByNumber={levelByNumber} cardsOf={cardsOf} />}
        {view === "recap" && <RecapTable ranked={ranked} teamById={teamById} levels={levels} />}
        {view === "ladder" && (bundle.frozen ? (
          <LevelLadderEditor sessionId={sessionId} levels={levels} catalog={bundle.catalog} ticks={bundle.ticks} onSaved={refresh} />
        ) : (
          <LadderPreview levels={levels} />
        ))}
        {view === "records" && <RecordsTab isMaster={isMaster} sessionId={sessionId} wod="level" />}
        {view === "arbitrage" && <LevelArbitrage evaluations={bundle.evaluations} onChanged={refresh} />}
        {view === "teams" && <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} picker={picker} />}
      </main>

      <footer className="fixed bottom-0 inset-x-0 z-20 bg-card/95 backdrop-blur border-t border-line px-3 py-2">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center gap-2">
          <div className={`${ui.segmented} flex-wrap`}>
            <button onClick={() => setView("race")} className={tabBtn(view === "race")}>Course</button>
            <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Classement</button>
            <button onClick={() => setView("recap")} className={tabBtn(view === "recap")}>Reps par exo</button>
            <button onClick={() => setView("ladder")} className={tabBtn(view === "ladder")}>Échelle</button>
            <button onClick={() => setView("records")} className={tabBtn(view === "records")}>🏆 Records</button>
            <button onClick={() => setView("arbitrage")} className={tabBtn(view === "arbitrage")}>
              Arbitrage <span className={`${ui.chip} ${ui.chipAccent} ml-1`}>{bundle.evaluations.length}</span>
            </button>
            <button onClick={() => setView("teams")} className={tabBtn(view === "teams")}>
              Équipes &amp; arbitres <span className={cx(ui.chip, "ml-1", memberCount ? ui.chipOk : ui.chipWarn)}>{memberCount}</span>
              {referees.length > 0 && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>💣 {referees.length}</span>}
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {phase === "pre" && <button onClick={handleStart} disabled={pending || teams.length === 0} className={btn.lgSuccess}>Lancer le WOD</button>}
            {phase === "run" && (
              <>
                <button onClick={() => run(() => levelPauseAction(sessionId))} disabled={pending} className={isPaused ? btn.lgSuccess : btn.lgAccent}>{isPaused ? "Reprendre" : "Pause"}</button>
                <button onClick={handleEnd} disabled={pending} className={btn.lgDanger}>Fin du WOD</button>
              </>
            )}
            {phase === "post" && <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 WOD terminé</span>}
            <button onClick={exportCsv} className={btn.lgDark}>Exporter</button>
            <a href={`/touche-coule?session=${sessionId}`} className={btn.lgGhost} title="Ouvrir le démineur des arbitres pour cette séance">💣 Arbitrer</a>
            <LogoutButton />
          </div>
        </div>
      </footer>
    </div>
  );
}

// Colonnes d'exercices du recap : ordre de premiere apparition dans l'echelle.
function exerciseColumns(levels: FrozenLevel[]): string[] {
  const out: string[] = [];
  for (const l of levels) for (const c of l.cards) if (!c.off && !out.includes(c.label)) out.push(c.label);
  return out;
}

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

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
  return (
    <section className={cx(ui.card, "p-3 flex flex-col gap-2", boss && "border-danger/60 bg-danger-soft/40", finished && "border-success/60 bg-success-soft/40")}>
      <div className="flex items-start gap-2">
        <span className="inline-flex items-center rounded-lg bg-ink text-white font-display font-extrabold text-sm px-2 py-0.5 uppercase tracking-wide">{team.name}</span>
        {rank > 0 && <span className={cx(ui.chip, rank === 1 ? ui.chipAccent : rank <= 3 ? ui.chipBrand : ui.chipMuted)}>#{rank}</span>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onYellow(-1)} disabled={!canTick || yellow === 0} className="w-6 h-6 rounded-full bg-paper text-ink-2 hover:bg-line text-sm font-bold leading-none disabled:opacity-30" aria-label="Retirer une carte jaune">−</button>
          <span className="text-sm font-bold tabular-nums" title="Cartes jaunes">🟨 {yellow}</span>
          <button type="button" onClick={() => onYellow(1)} disabled={!canTick} className="w-6 h-6 rounded-full bg-paper text-ink-2 hover:bg-line text-sm font-bold leading-none disabled:opacity-30" aria-label="Donner une carte jaune">+</button>
        </span>
      </div>
      {team.members.length > 0 && <p className="text-[11px] text-ink-2 leading-tight truncate" title={team.members.map((m) => m.name).join(", ")}>{team.members.map((m) => m.name).join(", ")}</p>}

      {finished ? (
        <div className="py-3 text-center">
          <div className="text-3xl">🏁</div>
          <p className="font-display font-extrabold text-success-ink">Échelle bouclée{p.finishedMs !== null && <> à {fmt(p.finishedMs)}</>}</p>
          <p className={ui.hint}>{p.completedLevels} niveaux · {p.reps} reps</p>
        </div>
      ) : level ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cx("font-display font-extrabold text-2xl leading-none", boss ? "text-danger-ink" : "text-ink")}>{boss ? "BOSS" : "Niveau"} {level.number}</span>
            {level.name && <span className="text-xs text-ink-2 truncate">{level.name.replace(/^BOSS · /, "")}</span>}
            <span className="ml-auto text-xs font-bold tabular-nums text-ink-2">{p.currentDone}/{p.currentTotal}</span>
          </div>
          <div className="h-1.5 rounded-full bg-line overflow-hidden">
            <div className={cx("h-full transition-all", boss ? "bg-danger" : "bg-brand")} style={{ width: `${p.currentTotal ? (100 * p.currentDone) / p.currentTotal : 0}%` }} />
          </div>
          <div className="space-y-1">
            {activeCards(level).map(({ card, index }) => {
              const done = p.doneCards.has(`${level.number}_${index}`);
              const busy = pendingKeys.has(`${team.id}_${level.number}_${index}`);
              return (
                <button
                  key={index}
                  type="button"
                  disabled={!canTick || busy}
                  onClick={() => onToggle(level.number, index, done)}
                  className={cx(
                    "w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-left border transition active:scale-[.98]",
                    done ? "bg-success text-white border-success" : "bg-card border-line-2 hover:border-brand",
                    (!canTick || busy) && "opacity-60"
                  )}
                >
                  <span className={cx("w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-black flex-shrink-0", done ? "border-white bg-white text-success" : "border-line-2")}>{done ? "✓" : ""}</span>
                  <span className="font-display font-extrabold text-base tabular-nums">{card.reps}</span>
                  <span className="font-bold text-sm truncate">{cap(card.label)}</span>
                  <span className={cx("ml-auto text-[11px] tabular-nums", done ? "text-white/80" : "text-ink-3")}>{boss ? `${fmtTheoretical((card.reps * card.weight) / 5)} à 5` : fmtTheoretical(card.reps * card.weight)}</span>
                </button>
              );
            })}
          </div>
          <p className={`${ui.hint} tabular-nums`}>≈ {fmtTheoretical(estimateSeconds(activeCards(level).map(({ card }) => ({ reps: card.reps, weight: card.weight })), boss))} · {p.completedLevels} bouclé{p.completedLevels > 1 ? "s" : ""} · {p.reps} reps</p>
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
            <th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={ui.th}>Membres</th><th className={`${ui.th} text-right`}>Bouclés</th><th className={ui.th}>En cours</th><th className={`${ui.th} text-right`}>Dernière coche</th><th className={`${ui.th} text-right`}>Reps</th><th className={`${ui.th} text-right`}>Travail</th><th className={`${ui.th} text-right`}>🟨</th>
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
                <td className="p-2 text-right tabular-nums">{cardsOf.get(p.teamId) ?? 0}</td>
              </tr>
            );
          })}
          {ranked.length === 0 && <tr><td colSpan={9} className={`p-3 ${ui.muted}`}>Pas encore d&apos;équipe.</td></tr>}
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
        Échelle commune de l&apos;atelier, figée dans la séance au coup d&apos;envoi. Pour la modifier avant le départ : <a href="/admin/level" className="underline font-bold">atelier Level</a>. Une fois lancée, elle se retouche ici, pour cette séance seulement.
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
