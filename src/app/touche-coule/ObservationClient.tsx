"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CriteriaChecklist } from "../_components/CriteriaChecklist";
import { CARD_REASONS, OBS_MINUTES, OBS_PREVIEW_MS, OBS_STAFF_TARGET, type ObsMode, type ObsParticipant, type ObsStation, type ObsView } from "@/lib/observation-types";
import { obsAddRepsAction, obsAppreciateAction, obsCardAction, obsDrawAction, obsVoidLastAction } from "./obs-actions";
import { evalTechQuality } from "@/lib/level-criteria";
import { qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { btn, cx, ui } from "@/lib/ui";

type Done = Record<string, { by: string; atMs: number }>;
export type StaffRosterRow = ObsParticipant & { done: Done; watch?: boolean }; // watch : a observer en priorite (profs seulement)
export type ObsHistoryRow = { id: string; targetName: string; teamName: string; clock: string; summary: string };
type AppJob = { observationId: string; exerciseId: string; met: number[] };

const TZ = "Europe/Brussels";
const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Arbitrage du WOD Eval (Sartay 04/10), sur le telephone de l'arbitre.
// ELEVE : cycle automatique. L'appli annonce un eleve (prenom, nom, classe) : 1 minute pour le reperer. Puis l'ecran
// d'observation s'ouvre tout seul pour 5 minutes : chaque serie de reps (horodatee), 4 criteres par exercice observe,
// chaque coche enregistree tout de suite. A la fin du chrono l'ecran se ferme, le prochain eleve est annonce, et ainsi
// de suite jusqu'a la fin du WOD.
// PROF : il choisit l'eleve et l'exercice quand il veut ; 6 criteres ; la liste lui dit qui a deja ete evalue sur quoi
// (objectif : 3 exercices differents par eleve).
export function ObservationClient({
  sessionId, sessionLabel, mode, backHref, stations, obs, serverNowMs, race, paused = false, cycleStarted = false, history = [], roster = [], selected = null,
}: {
  sessionId: string;
  sessionLabel: string;
  mode: ObsMode;
  backHref: string;
  stations: ObsStation[];
  obs: ObsView | null; // eleve : l'observation du moment (eleve annonce ou fenetre en cours) ; prof : celle de l'eleve ouvert
  serverNowMs: number;
  race: "pre" | "run" | "post";
  paused?: boolean; // WOD en pause : aucun nouvel eleve n'est annonce
  cycleStarted?: boolean; // eleve : il a deja commence a arbitrer cette seance (le suivant s'enchaine tout seul)
  history?: ObsHistoryRow[]; // eleve : ses fenetres fermees
  roster?: StaffRosterRow[]; // prof : tous les eleves avec ce qui est deja evalue
  selected?: StaffRosterRow | null; // prof : eleve ouvert
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  // Horloge recalee sur le serveur : les decomptes ne dependent pas de l'heure du telephone.
  const [offset] = useState(() => serverNowMs - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const staff = mode === "STAFF";
  const serverClock = now + offset;
  // Cycle de l'arbitre eleve : eleve annonce (1 min) -> fenetre ouverte (5 min) -> fenetre fermee (le suivant arrive).
  const phase: "staff" | "idle" | "preview" | "eval" | "over" = staff ? "staff" : !obs || obs.endsAtMs == null ? "idle" : serverClock < obs.startedAtMs ? "preview" : serverClock < obs.endsAtMs ? "eval" : "over";
  const remaining = phase === "eval" && obs?.endsAtMs != null ? obs.endsAtMs - serverClock : null;
  const target = staff ? (selected ? { id: selected.userId, name: selected.name, teamName: selected.teamName, className: selected.className } : null) : phase === "eval" && obs ? { id: obs.targetId, name: obs.targetName, teamName: obs.teamName, className: obs.className } : null;

  // Nouvel eleve annonce : l'exercice choisi pour le precedent ne vaut plus (ajuste pendant le rendu, pas dans un effet).
  const [seenObs, setSeenObs] = useState<string | null>(obs?.id ?? null);
  if (!staff && (obs?.id ?? null) !== seenObs) {
    setSeenObs(obs?.id ?? null);
    setExerciseId(null);
  }

  function run(action: () => Promise<{ error: string } | { ok: true }>, after?: () => void) {
    setError("");
    startTransition(async () => {
      const res = await action();
      if ("error" in res) { setError(res.error); return; }
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(30);
      after?.();
      router.refresh();
    });
  }
  const ref = { observationId: obs?.id ?? null, targetUserId: target?.id ?? null };

  // Carte jaune a l'equipe de l'eleve suivi (Sartay 06/10) : motif obligatoire, confirmation, message de retour.
  const [cardOpen, setCardOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [cardFor, setCardFor] = useState<string | null>(target?.id ?? null);
  if ((target?.id ?? null) !== cardFor) {
    setCardFor(target?.id ?? null);
    setCardOpen(false);
    setNotice("");
  }
  function giveCard(reason: string) {
    setError("");
    startTransition(async () => {
      const res = await obsCardAction(sessionId, { ...ref, reason });
      if ("error" in res) { setError(res.error); return; }
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([40, 60, 40]);
      setCardOpen(false);
      setNotice(`🟨 Carte donnée à ${res.teamName} (${reason.toLowerCase()}).`);
      router.refresh();
    });
  }

  // Fin d'une fenetre (ou retour sur la page apres une fenetre fermee) : l'ecran demande tout seul le prochain eleve.
  // Tant que le serveur ne peut pas en annoncer un (pause, WOD fini, personne a suivre), on redemande toutes les 10 s.
  const wantNext = !staff && race === "run" && !paused && (phase === "over" || (phase === "idle" && cycleStarted));
  const cycleKey = obs?.id ?? "start";
  const [retry, setRetry] = useState(0);
  const [waitMsg, setWaitMsg] = useState(""); // attente normale dite par le serveur (plus personne a observer…)
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!wantNext) {
      asked.current = null;
      return;
    }
    const key = `${cycleKey}:${retry}`;
    if (asked.current === key) return;
    asked.current = key;
    let timer: ReturnType<typeof setTimeout> | null = null;
    obsDrawAction(sessionId).then((res) => {
      if ("error" in res) {
        setError(res.soft ? "" : res.error);
        setWaitMsg(res.soft ? res.error : "");
        timer = setTimeout(() => setRetry((n) => n + 1), 10_000);
      } else {
        setError("");
        setWaitMsg("");
      }
      router.refresh(); // nouvel eleve annonce, ou etat du WOD a jour (pause, fin)
    });
    return () => { if (timer) clearTimeout(timer); };
  }, [wantNext, cycleKey, retry, sessionId, router]);

  // WOD pas encore lance, ou en pause : on relit l'etat toutes les 10 s (le depart et la reprise se voient tout seuls).
  const waiting = !staff && (race === "pre" || (race === "run" && paused));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [waiting, router]);

  // Arbitre eleve : chaque coche part tout de suite. Les envois se suivent un par un (jamais deux enregistrements en
  // meme temps pour le meme exercice) ; si l'arbitre coche plus vite que le reseau, seul le dernier etat part.
  const saver = useRef<{ busy: boolean; todo: Map<string, AppJob> }>({ busy: false, todo: new Map() });
  function queueApp(job: AppJob) {
    const s = saver.current;
    s.todo.set(`${job.observationId}:${job.exerciseId}`, job);
    if (s.busy) return;
    s.busy = true;
    void (async () => {
      try {
        while (s.todo.size) {
          const [key, next] = s.todo.entries().next().value as [string, AppJob];
          s.todo.delete(key);
          const res = await obsAppreciateAction(sessionId, next);
          if ("error" in res) setError(res.error);
        }
      } finally {
        s.busy = false;
      }
    })();
  }

  const between = phase === "over" || (phase === "idle" && cycleStarted);

  return (
    <div className={ui.page}>
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b border-line px-4 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className={ui.eyebrow}>{staff ? "Arbitre prof · Eval" : "Arbitre · Eval"}</span>
          <p className="text-sm font-bold truncate">{sessionLabel}</p>
        </div>
        <a href={backHref} className={btn.smGhost}>← Retour</a>
      </header>

      <main className={cx("mx-auto p-3 space-y-3", staff ? "max-w-5xl" : "max-w-xl")}>
        {error && <p className={ui.alertErr}>{error}</p>}
        {race === "pre" && <p className={ui.alertInfo}>Le WOD n&apos;est pas encore lancé : l&apos;arbitrage commence au coup d&apos;envoi.</p>}

        {/* ===== ELEVE : depart du cycle ===== */}
        {phase === "idle" && !cycleStarted && (
          <section className={`${ui.cardPad} text-center`}>
            <div className="text-5xl mb-2">👁</div>
            <h1 className={`${ui.h2} mb-1`}>Ton rôle d&apos;arbitre</h1>
            <p className={`${ui.muted} mb-4`}>
              L&apos;appli t&apos;annonce un élève : tu as <b>1 minute</b> pour le repérer. Puis l&apos;écran s&apos;ouvre pour <b>{OBS_MINUTES} minutes</b> : note <b>chaque série</b> de répétitions qu&apos;il fait
              (ex. pompages : 5 puis 10 puis 3) et coche les critères que tu as vus. À la fin du chrono l&apos;écran se ferme tout seul et le prochain élève s&apos;affiche, et ainsi de suite jusqu&apos;à la fin du WOD.
            </p>
            <button onClick={() => run(() => obsDrawAction(sessionId))} disabled={pending || race !== "run" || paused} className={`${btn.lgPrimary} w-full`}>{pending ? "Tirage…" : "▶ Commencer : mon premier élève"}</button>
            {race === "post" && <p className={`${ui.hint} mt-2`}>Le WOD est terminé.</p>}
            {race === "run" && paused && <p className={`${ui.hint} mt-2`}>Le WOD est en pause : tu pourras commencer à la reprise.</p>}
          </section>
        )}

        {/* ===== ELEVE : entre deux fenetres ===== */}
        {between && (
          <section className={`${ui.cardPad} text-center`}>
            {race === "post" ? (
              <>
                <div className="text-5xl mb-2">🏁</div>
                <h1 className={`${ui.h2} mb-1`}>Le WOD est terminé</h1>
                <p className={ui.muted}>Merci pour ton arbitrage : tout ce que tu as noté est enregistré.</p>
              </>
            ) : paused ? (
              <>
                <div className="text-5xl mb-2">⏸</div>
                <h1 className={`${ui.h2} mb-1`}>WOD en pause</h1>
                <p className={ui.muted}>Ton prochain élève s&apos;affichera à la reprise.</p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-2">🎲</div>
                <h1 className={`${ui.h2} mb-1`}>Prochain élève…</h1>
                <p className={ui.muted}>{waitMsg || "La fenêtre est fermée : l'appli choisit ton prochain élève."}</p>
                {error && <button onClick={() => run(() => obsDrawAction(sessionId))} disabled={pending} className={`${btn.primary} mt-3`}>Réessayer</button>}
              </>
            )}
          </section>
        )}

        {/* ===== ELEVE : le prochain eleve est annonce, 1 minute pour le reperer ===== */}
        {phase === "preview" && obs && (
          <section className="rounded-2xl p-5 text-white shadow-card bg-sea text-center">
            <p className="text-[11px] font-extrabold uppercase tracking-wide opacity-80">Ton prochain élève</p>
            <p className="font-display text-[34px] font-extrabold leading-tight mt-1">{obs.targetName}</p>
            <p className="text-lg font-bold opacity-95">{[obs.className, obs.teamName].filter(Boolean).join(" · ")}</p>
            <p className="font-display text-[64px] font-extrabold leading-none tabular-nums mt-4">{mmss(obs.startedAtMs - serverClock)}</p>
            <div className="mt-3 h-2 rounded-full bg-black/20 overflow-hidden"><div className="h-full bg-white/90 transition-all" style={{ width: `${Math.min(100, Math.max(0, 100 - ((obs.startedAtMs - serverClock) / OBS_PREVIEW_MS) * 100))}%` }} /></div>
            <p className="text-sm opacity-90 mt-3">Repère-le dans la salle. À 0:00, l&apos;observation s&apos;ouvre toute seule pour {OBS_MINUTES} minutes.</p>
          </section>
        )}

        {/* ===== PROF : liste des eleves, avec ce qui est deja evalue ===== */}
        {staff && <StaffRoster roster={roster} stations={stations} selectedId={selected?.userId ?? null} onPick={(id) => { setExerciseId(null); router.push(`/touche-coule?session=${sessionId}&eleve=${id}`); }} />}

        {/* ===== Eleve suivi (eleve : fenetre ouverte) ===== */}
        {target && (
          <section className="rounded-2xl p-4 text-white shadow-card bg-brand">
            <p className="text-[11px] font-extrabold uppercase tracking-wide opacity-80">{staff ? "Tu évalues" : "Tu suis"}</p>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[26px] font-extrabold leading-tight truncate">{target.name}</p>
                <p className="text-sm opacity-90">{target.teamName}{target.className ? ` · ${target.className}` : ""}</p>
              </div>
              {remaining !== null && <p className="font-display text-[40px] font-extrabold leading-none tabular-nums">{mmss(remaining)}</p>}
            </div>
            {remaining !== null && (
              <div className="mt-2 h-2 rounded-full bg-black/20 overflow-hidden"><div className="h-full bg-white/90 transition-all" style={{ width: `${Math.min(100, Math.max(0, 100 - (remaining / (OBS_MINUTES * 60_000)) * 100))}%` }} /></div>
            )}
            {remaining !== null && <p className="text-xs opacity-90 mt-2">À 0:00 l&apos;écran se ferme tout seul : note les séries et coche les critères au fur et à mesure.</p>}
            {race === "run" && (
              <div className="mt-3">
                {!cardOpen ? (
                  <button onClick={() => { setCardOpen(true); setNotice(""); }} disabled={pending} className="w-full rounded-xl bg-yellow-300 text-yellow-950 font-extrabold py-2.5 text-sm shadow-sm active:scale-[0.99]">🟨 Carte jaune à {target.teamName}</button>
                ) : (
                  <div className="rounded-xl bg-white text-ink p-3 space-y-2">
                    <p className="text-sm font-bold">🟨 Carte jaune à {target.teamName} : pourquoi ?</p>
                    <p className="text-xs text-ink-3">Elle ajoute du temps à l&apos;équipe et coûte 1 point sur 20 à chacun de ses élèves. Le greffier voit ton nom et le motif.</p>
                    <div className="grid gap-1.5">
                      {CARD_REASONS.map((r) => (
                        <button key={r} disabled={pending} onClick={() => { if (confirm(`Carte jaune à ${target.teamName} : « ${r} » ?`)) giveCard(r); }} className="text-left rounded-lg border border-line-2 px-3 py-2 text-sm font-semibold hover:border-yellow-500 hover:bg-yellow-50 disabled:opacity-50">{r}</button>
                      ))}
                    </div>
                    <button onClick={() => setCardOpen(false)} className={`${btn.smGhost} w-full`}>Annuler</button>
                  </div>
                )}
                {notice && <p className="mt-2 rounded-lg bg-yellow-200 text-yellow-950 text-sm font-bold px-3 py-2">{notice}</p>}
              </div>
            )}
          </section>
        )}

        {target && (
          <StationPanel
            key={staff ? target.id : obs?.id ?? target.id}
            stations={stations}
            obs={obs}
            exerciseId={exerciseId}
            onExercise={setExerciseId}
            pending={pending}
            autoSave={!staff}
            staffDone={staff ? selected?.done ?? {} : null}
            onAdd={(ex, reps) => run(() => obsAddRepsAction(sessionId, { ...ref, exerciseId: ex, reps }))}
            onVoid={(ex) => run(() => obsVoidLastAction(sessionId, { ...ref, exerciseId: ex }))}
            onApp={(ex, met) => (staff ? run(() => obsAppreciateAction(sessionId, { ...ref, exerciseId: ex, met })) : obs && queueApp({ observationId: obs.id, exerciseId: ex, met }))}
          />
        )}

        {!staff && history.length > 0 && (
          <section className={ui.cardPad}>
            <h2 className={`${ui.h3} mb-2`}>Mes observations terminées ({history.length})</h2>
            <ul className="space-y-1.5 text-sm">
              {history.map((h) => (
                <li key={h.id} className={`${ui.inset} px-3 py-2`}>
                  <span className="font-bold">{h.targetName}</span> <span className="text-ink-3">· {h.teamName} · {h.clock}</span>
                  <span className="block text-xs text-ink-2">{h.summary || "aucune série notée"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

// Choix de l'exercice observe, series deja notees (avec leur heure), saisie d'une serie, criteres a cocher.
function StationPanel({
  stations, obs, exerciseId, onExercise, pending, autoSave, staffDone, onAdd, onVoid, onApp,
}: {
  stations: ObsStation[];
  obs: ObsView | null;
  exerciseId: string | null;
  onExercise: (id: string) => void;
  pending: boolean;
  autoSave: boolean; // arbitre eleve : chaque coche est enregistree tout de suite (la fenetre se ferme toute seule)
  staffDone: Done | null; // prof : exercices deja evalues par un prof pour cet eleve
  onAdd: (exerciseId: string, reps: number) => void;
  onVoid: (exerciseId: string) => void;
  onApp: (exerciseId: string, met: number[]) => void;
}) {
  const [reps, setReps] = useState("");
  const station = stations.find((s) => s.id === exerciseId) ?? null;
  const entries = useMemo(() => (obs?.entries ?? []).filter((e) => e.exerciseId === exerciseId), [obs, exerciseId]);
  const live = entries.filter((e) => !e.voided);
  const app = (obs?.apps ?? []).find((a) => a.exerciseId === exerciseId) ?? null;
  // Criteres deja enregistres pour cet exercice, retrouves par leur PHRASE, pas par leur rang (l'ordre de la grille peut changer).
  const saved = station ? station.criteria.map((label) => { const k = app ? app.labels.indexOf(label) : -1; return k >= 0 && !!app?.met[k]; }) : [];
  // Prof : brouillon jusqu'au bouton. Eleve : les coches de cette fenetre, deja parties vers le serveur.
  const [draft, setDraft] = useState<{ ex: string | null; met: boolean[] }>({ ex: null, met: [] });
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});
  const met = autoSave ? (exerciseId ? ticks[exerciseId] : undefined) ?? saved : draft.ex === exerciseId ? draft.met : saved;
  const dirty = draft.ex === exerciseId;
  const touched = !!app || (exerciseId !== null && ticks[exerciseId] !== undefined);
  const nMet = met.filter(Boolean).length;
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of obs?.entries ?? []) if (!e.voided) m.set(e.exerciseId, (m.get(e.exerciseId) ?? 0) + e.reps);
    return m;
  }, [obs]);
  const n = parseInt(reps, 10);

  function add() {
    if (!station || !Number.isInteger(n) || n < 1) return;
    onAdd(station.id, n);
    setReps("");
  }
  function toggle(i: number) {
    if (!station) return;
    const next = met.map((v, k) => (k === i ? !v : v));
    if (!autoSave) {
      setDraft({ ex: station.id, met: next });
      return;
    }
    setTicks((t) => ({ ...t, [station.id]: next }));
    onApp(station.id, next.flatMap((v, k) => (v ? [k] : [])));
  }
  // « Aucun critere n'est respecte » (Sartay 04/10) : une appreciation existe et rien n'y est coche. Sans elle, un
  // exercice dont on a compte les series mais ou l'on n'a rien coche resterait « sans appreciation » au compte rendu.
  const none = (autoSave ? touched : dirty || !!app) && nMet === 0;
  function setNone() {
    if (!station) return;
    const next = station.criteria.map(() => false);
    if (!autoSave) {
      setDraft({ ex: station.id, met: next });
      return;
    }
    setTicks((t) => ({ ...t, [station.id]: next }));
    onApp(station.id, []);
  }

  return (
    <section className={ui.cardPad}>
      <p className="text-sm font-bold mb-1.5">Quel exercice fait-il ?</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {stations.map((s) => {
          const total = totals.get(s.id) ?? 0;
          const hasApp = (obs?.apps ?? []).some((a) => a.exerciseId === s.id) || ticks[s.id] !== undefined;
          const already = staffDone?.[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onExercise(s.id)}
              title={already ? `Déjà évalué par ${already.by} à ${clock(already.atMs)}` : undefined}
              className={cx("rounded-xl border px-2 py-2 text-left text-sm font-bold transition", s.id === exerciseId ? "bg-brand text-white border-brand" : already ? "bg-success-soft border-success/50" : "bg-card border-line-2 hover:border-brand")}
            >
              <span className="block truncate">{s.label}</span>
              <span className={cx("block text-[11px] font-semibold", s.id === exerciseId ? "text-white/85" : "text-ink-3")}>
                {total ? `${total} reps` : already ? `déjà vu · ${already.by}` : "—"}{hasApp ? " · ✓ apprécié" : autoSave && total ? " · ⚠ à apprécier" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {station && (
        <div className="mt-4 space-y-3">
          {staffDone?.[station.id] && <p className={ui.alertInfo}>Cet élève a déjà été évalué sur <b>{station.label}</b> par {staffDone[station.id].by} à {clock(staffDone[station.id].atMs)}. Tu peux compléter ou corriger.</p>}
          <div>
            <p className="text-sm font-bold mb-1">{station.label} · séries comptées</p>
            {entries.length === 0 ? (
              <p className={ui.hint}>Aucune série pour l&apos;instant. Tape le nombre de répétitions dès qu&apos;il s&apos;arrête.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {entries.map((e) => (
                  <li key={e.id} className={cx("rounded-lg border px-2 py-1 text-sm tabular-nums", e.voided ? "border-line text-ink-3 line-through" : "border-brand/40 bg-brand-soft")}>
                    <b>{e.reps}</b> <span className="text-[11px] text-ink-3">{clock(e.atMs)}</span>
                  </li>
                ))}
                <li className="self-center text-sm font-extrabold">= {live.reduce((a, e) => a + e.reps, 0)}</li>
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Reps de la série"
              className={`${ui.input} text-lg font-bold text-center flex-1`}
            />
            <button type="button" onClick={add} disabled={pending || !Number.isInteger(n) || n < 1} className={btn.primary}>＋ Ajouter la série</button>
          </div>
          {live.length > 0 && <button type="button" onClick={() => onVoid(station.id)} disabled={pending} className={btn.smGhost}>↶ Annuler la dernière série ({live[live.length - 1].reps})</button>}

          <div>
            <p className="text-sm font-bold mb-1">Appréciation · coche ce que tu as VU ({station.criteria.length} critères)</p>
            <CriteriaChecklist labels={station.criteria} met={met} onToggle={toggle} none={none} onNone={setNone} />
            {autoSave ? (
              <p className={cx("text-xs mt-2", !touched && live.length > 0 ? "text-warn-ink font-bold" : "text-ink-3")}>
                {touched
                  ? `✓ Enregistré : ${nMet === 0 ? "aucun critère respecté" : `${nMet}/${met.length} critères`} · ${qualityCodeFromValue(evalTechQuality(station.criteria, met)) ?? "?"}`
                  : live.length > 0
                    ? "⚠ Pas encore d'appréciation : coche ce que tu as vu, ou « Aucun critère n'est respecté »."
                    : "Chaque coche est enregistrée tout de suite."}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => { onApp(station.id, met.flatMap((v, i) => (v ? [i] : []))); setDraft({ ex: null, met: [] }); }}
                disabled={pending || (!dirty && !!app)}
                className={`${btn.success} w-full mt-2`}
              >
                {app && !dirty ? `✓ Appréciation enregistrée (${app.met.filter(Boolean).length}/${app.met.length}${app.code ? ` · ${app.code}` : ""})` : "Enregistrer l'appréciation"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// Prof : tous les eleves par equipe ; pour chacun, le nombre d'exercices differents deja evalues par un prof (objectif 3).
function StaffRoster({ roster, stations, selectedId, onPick }: { roster: StaffRosterRow[]; stations: ObsStation[]; selectedId: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [todoOnly, setTodoOnly] = useState(false);
  const count = (r: StaffRosterRow) => Object.keys(r.done).length;
  const done = roster.filter((r) => count(r) >= OBS_STAFF_TARGET).length;
  const short = new Map(stations.map((s) => [s.id, s.label]));
  const shown = roster.filter((r) => (!todoOnly || count(r) < OBS_STAFF_TARGET) && (!q.trim() || `${r.name} ${r.teamName} ${r.className ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <section className={ui.cardPad}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h1 className={ui.h3}>Élèves <span className="text-ink-3 font-sans font-normal text-sm">· {done}/{roster.length} évalués sur {OBS_STAFF_TARGET} exercices</span></h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} className={ui.check} /> à faire seulement</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, équipe, classe…" className={`${ui.input} w-44 py-1.5 text-sm`} />
        </div>
      </div>
      {roster.length === 0 && <p className={ui.muted}>Aucun élève encodé dans les équipes de cette séance.</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[46vh] overflow-auto">
        {shown.map((r) => {
          const c = count(r);
          return (
            <li key={r.userId}>
              <button type="button" onClick={() => onPick(r.userId)} className={cx("w-full text-left rounded-xl border px-2.5 py-1.5 transition", r.userId === selectedId ? "border-brand ring-2 ring-brand/25 bg-brand-soft" : "border-line bg-card hover:border-brand")}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm truncate">{r.name}</span>
                  <span className={cx(ui.chip, c >= OBS_STAFF_TARGET ? ui.chipOk : c > 0 ? ui.chipWarn : ui.chipMuted)}>{c}/{OBS_STAFF_TARGET}</span>
                </span>
                {r.watch && <span className="mr-1 text-[11px] font-bold text-accent-ink" title="À observer en priorité (réglage prof)">★</span>}<span className="block text-[11px] text-ink-3 truncate">{r.teamName}{r.className ? ` · ${r.className}` : ""}{c > 0 ? ` · ${Object.keys(r.done).map((id) => short.get(id) ?? id).join(", ")}` : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
