"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CriteriaChecklist } from "../_components/CriteriaChecklist";
import { OBS_MINUTES, OBS_STAFF_TARGET, type ObsMode, type ObsParticipant, type ObsStation, type ObsView } from "@/lib/observation-types";
import { obsAddRepsAction, obsAppreciateAction, obsDrawAction, obsFinishAction, obsVoidLastAction } from "./obs-actions";
import { btn, cx, ui } from "@/lib/ui";

type Done = Record<string, { by: string; atMs: number }>;
export type StaffRosterRow = ObsParticipant & { done: Done };
export type ObsHistoryRow = { id: string; targetName: string; teamName: string; clock: string; summary: string };

const TZ = "Europe/Brussels";
const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Arbitrage du WOD Eval (Sartay 04/10), sur le telephone de l'arbitre.
// ELEVE : l'appli tire un eleve au sort ; pendant 5 minutes chrono il consigne chaque serie de reps (horodatee) et coche
// 4 criteres par exercice observe ; a la fin, il termine et tire le suivant.
// PROF : il choisit l'eleve et l'exercice quand il veut ; 6 criteres ; la liste lui dit qui a deja ete evalue sur quoi
// (objectif : 3 exercices differents par eleve).
export function ObservationClient({
  sessionId, sessionLabel, mode, backHref, stations, obs, serverNowMs, race, history = [], roster = [], selected = null,
}: {
  sessionId: string;
  sessionLabel: string;
  mode: ObsMode;
  backHref: string;
  stations: ObsStation[];
  obs: ObsView | null;
  serverNowMs: number;
  race: "pre" | "run" | "post";
  history?: ObsHistoryRow[]; // eleve : ses observations terminees
  roster?: StaffRosterRow[]; // prof : tous les eleves avec ce qui est deja evalue
  selected?: StaffRosterRow | null; // prof : eleve ouvert
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  // Horloge recalee sur le serveur : le compte a rebours ne depend pas de l'heure du telephone.
  const [offset] = useState(() => serverNowMs - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const staff = mode === "STAFF";
  const remaining = obs?.endsAtMs != null ? obs.endsAtMs - (now + offset) : null;
  const timeUp = remaining !== null && remaining <= 0;
  const target = staff ? (selected ? { id: selected.userId, name: selected.name, teamName: selected.teamName, className: selected.className } : null) : obs ? { id: obs.targetId, name: obs.targetName, teamName: obs.teamName, className: obs.className } : null;

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

        {/* ===== ELEVE : tirage au sort ===== */}
        {!staff && !obs && (
          <section className={`${ui.cardPad} text-center`}>
            <div className="text-5xl mb-2">🎲</div>
            <h1 className={`${ui.h2} mb-1`}>Ton rôle d&apos;arbitre</h1>
            <p className={`${ui.muted} mb-4`}>
              L&apos;appli te tire un élève au sort. Tu le suis pendant <b>{OBS_MINUTES} minutes</b> : note <b>chaque série</b> de répétitions qu&apos;il fait (ex. pompages : 5 puis 10 puis 3),
              et coche les critères que tu as vus. Sois sûr à 100 % de qui tu regardes : demande-lui son prénom au besoin.
            </p>
            <button onClick={() => run(() => obsDrawAction(sessionId))} disabled={pending || race !== "run"} className={`${btn.lgPrimary} w-full`}>{pending ? "Tirage…" : "🎲 Tirer un élève au sort"}</button>
            {race === "post" && <p className={`${ui.hint} mt-2`}>Le WOD est terminé.</p>}
          </section>
        )}

        {/* ===== PROF : liste des eleves, avec ce qui est deja evalue ===== */}
        {staff && <StaffRoster roster={roster} stations={stations} selectedId={selected?.userId ?? null} onPick={(id) => { setExerciseId(null); router.push(`/touche-coule?session=${sessionId}&eleve=${id}`); }} />}

        {/* ===== Eleve suivi ===== */}
        {target && (
          <section className={cx("rounded-2xl p-4 text-white shadow-card", !staff && timeUp ? "bg-accent" : "bg-brand")}>
            <p className="text-[11px] font-extrabold uppercase tracking-wide opacity-80">{staff ? "Tu évalues" : "Tu suis"}</p>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[26px] font-extrabold leading-tight truncate">{target.name}</p>
                <p className="text-sm opacity-90">{target.teamName}{target.className ? ` · ${target.className}` : ""}</p>
              </div>
              {!staff && remaining !== null && (
                <p className="font-display text-[40px] font-extrabold leading-none tabular-nums">{timeUp ? "0:00" : mmss(remaining)}</p>
              )}
            </div>
            {!staff && obs?.endsAtMs != null && (
              <div className="mt-2 h-2 rounded-full bg-black/20 overflow-hidden"><div className="h-full bg-white/90 transition-all" style={{ width: `${Math.min(100, Math.max(0, 100 - ((remaining ?? 0) / (OBS_MINUTES * 60_000)) * 100))}%` }} /></div>
            )}
            {!staff && timeUp && <p className="text-sm font-bold mt-2">⏱ Temps écoulé : complète tes appréciations, puis termine.</p>}
          </section>
        )}

        {target && (
          <StationPanel
            key={target.id}
            stations={stations}
            obs={obs}
            exerciseId={exerciseId}
            onExercise={setExerciseId}
            canAdd={staff || !timeUp}
            pending={pending}
            staffDone={staff ? selected?.done ?? {} : null}
            onAdd={(ex, reps) => run(() => obsAddRepsAction(sessionId, { ...ref, exerciseId: ex, reps }))}
            onVoid={(ex) => run(() => obsVoidLastAction(sessionId, { ...ref, exerciseId: ex }))}
            onApp={(ex, met) => run(() => obsAppreciateAction(sessionId, { ...ref, exerciseId: ex, met }))}
          />
        )}

        {!staff && obs && (
          <button onClick={() => run(() => obsFinishAction(sessionId, obs.id), () => setExerciseId(null))} disabled={pending || !(timeUp || race === "post")} className={`${btn.lgSuccess} w-full`}>
            {timeUp || race === "post" ? "✓ Terminer · tirer l'élève suivant" : `Encore ${mmss(remaining ?? 0)} avec ${target?.name.split(" ")[0] ?? "ton élève"}`}
          </button>
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
  stations, obs, exerciseId, onExercise, canAdd, pending, staffDone, onAdd, onVoid, onApp,
}: {
  stations: ObsStation[];
  obs: ObsView | null;
  exerciseId: string | null;
  onExercise: (id: string) => void;
  canAdd: boolean;
  pending: boolean;
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
  // Criteres coches : ceux deja enregistres pour cet exercice, modifiables tant que l'observation est ouverte.
  const [draft, setDraft] = useState<{ ex: string | null; met: boolean[] }>({ ex: null, met: [] });
  const met = draft.ex === exerciseId ? draft.met : station ? station.criteria.map((_, i) => app?.met[i] ?? false) : [];
  const dirty = draft.ex === exerciseId;
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

  return (
    <section className={ui.cardPad}>
      <p className="text-sm font-bold mb-1.5">Quel exercice fait-il ?</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {stations.map((s) => {
          const total = totals.get(s.id) ?? 0;
          const hasApp = (obs?.apps ?? []).some((a) => a.exerciseId === s.id);
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
                {total ? `${total} reps` : already ? `déjà vu · ${already.by}` : "—"}{hasApp ? " · ✓ apprécié" : ""}
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
              disabled={!canAdd}
              className={`${ui.input} text-lg font-bold text-center flex-1`}
            />
            <button type="button" onClick={add} disabled={pending || !canAdd || !Number.isInteger(n) || n < 1} className={btn.primary}>＋ Ajouter la série</button>
          </div>
          {live.length > 0 && <button type="button" onClick={() => onVoid(station.id)} disabled={pending} className={btn.smGhost}>↶ Annuler la dernière série ({live[live.length - 1].reps})</button>}
          {!canAdd && <p className={ui.hint}>Les {OBS_MINUTES} minutes sont écoulées : plus de nouvelle série, mais tu peux encore cocher les critères.</p>}

          <div>
            <p className="text-sm font-bold mb-1">Appréciation · coche ce que tu as VU ({station.criteria.length} critères)</p>
            <CriteriaChecklist labels={station.criteria} met={met} onToggle={(i) => setDraft({ ex: station.id, met: met.map((v, k) => (k === i ? !v : v)) })} />
            <button
              type="button"
              onClick={() => { onApp(station.id, met.flatMap((v, i) => (v ? [i] : []))); setDraft({ ex: null, met: [] }); }}
              disabled={pending || (!dirty && !!app)}
              className={`${btn.success} w-full mt-2`}
            >
              {app && !dirty ? `✓ Appréciation enregistrée (${app.met.filter(Boolean).length}/${app.met.length}${app.code ? ` · ${app.code}` : ""})` : "Enregistrer l'appréciation"}
            </button>
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
                <span className="block text-[11px] text-ink-3 truncate">{r.teamName}{r.className ? ` · ${r.className}` : ""}{c > 0 ? ` · ${Object.keys(r.done).map((id) => short.get(id) ?? id).join(", ")}` : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
