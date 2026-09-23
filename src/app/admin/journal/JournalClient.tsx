"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BREAKS, DAY_END, DAY_START, DEFAULT_PERIODS, MAX_SLOT_CLASSES, PERIODS, PERIOD_MIN, WEEKDAYS, fmtMin, groupSlots, parseHHMM,
  periodIndexAt, periodsCovered, slotEndFor, weeklyMinutes, type SlotGroup, type SlotRow,
} from "@/lib/journal";
import {
  deleteSlotGroupAction, moveClassAction, placeClassAction, removeClassAction, setSlotPlanAction, setSlotTimesAction, type JournalResult,
} from "./actions";
import { btn, cx, ui } from "@/lib/ui";

// Grille hebdomadaire du journal de classe : palette de classes a gauche, lundi-vendredi a droite, une ligne par
// periode de cours de l'ecole (P1-P8), recres et midi dessines entre elles.
// Souris : glisser une classe sur une periode (ou sur un creneau existant pour s'y ajouter) ; glisser une classe
// d'un creneau a l'autre pour la deplacer. Tablette / sans souris : toucher la classe (elle est « en main »),
// puis toucher la periode. Un clic sur un creneau ouvre son editeur (periodes, heures libres, seance-type, suppression).
// Aucune regle metier ici : conflits et maximums sont tranches par les actions serveur, qui repondent en clair.

export type PlanOption = { id: string; label: string; isCurrent: boolean };
export type Elsewhere = { weekday: number; startMin: number; endMin: number; who: string };

type Payload = { className: string; slotId?: string };

const PX_PER_MIN = 1.15; // une periode de 50 min = ~58 px
const GRID_H = (DAY_END - DAY_START) * PX_PER_MIN;
const y = (min: number) => (Math.min(Math.max(min, DAY_START), DAY_END) - DAY_START) * PX_PER_MIN;
const DAYS = [1, 2, 3, 4, 5];

async function settle(action: () => Promise<JournalResult>): Promise<JournalResult> {
  try {
    return await action();
  } catch (e) {
    return { error: "Action non enregistrée (réseau ou session expirée) : " + (e instanceof Error ? e.message : String(e)) };
  }
}

const fmtHours = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
const plural = (n: number, s: string, p = s + "s") => (n > 1 ? p : s);

export function JournalClient({
  teacherId, slots, classes, plans, elsewhere,
}: {
  teacherId: string;
  slots: SlotRow[];
  classes: string[];
  plans: PlanOption[];
  elsewhere: Record<string, Elsewhere[]>; // classe -> creneaux des AUTRES profs (info-bulle)
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [armed, setArmed] = useState<Payload | null>(null); // classe « en main » : palette (pose) ou creneau (deplacement)
  const [hover, setHover] = useState<string | null>(null); // periode ou creneau survole pendant un glisser
  const [editing, setEditing] = useState<string | null>(null); // cle du creneau ouvert dans l'editeur
  const [nPeriods, setNPeriods] = useState<number>(DEFAULT_PERIODS); // duree d'un creneau pose : 1 ou 2 periodes

  const groups = useMemo(() => groupSlots(slots), [slots]);
  const byDay = useMemo(() => {
    const m = new Map<number, SlotGroup[]>();
    for (const g of groups) (m.get(g.weekday) ?? m.set(g.weekday, []).get(g.weekday)!).push(g);
    return m;
  }, [groups]);
  const placedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots) m.set(s.className, (m.get(s.className) ?? 0) + 1);
    return m;
  }, [slots]);
  // Palette : classes rangees par premier caractere (1P2, 2Ca…, 3GTa…, S1a…).
  const families = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of classes) (m.get(c[0] ?? "?") ?? m.set(c[0] ?? "?", []).get(c[0] ?? "?")!).push(c);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "fr", { numeric: true }));
  }, [classes]);
  const planLabel = (id: string | null) => (id ? plans.find((p) => p.id === id)?.label ?? "séance-type supprimée" : null);
  const editingGroup = editing ? groups.find((g) => g.key === editing) ?? null : null;

  // Echap : on lache ce qu'on a en main, on ferme l'editeur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setArmed(null);
        setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run(action: () => Promise<JournalResult>) {
    setError("");
    startTransition(async () => {
      const res = await settle(action);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  // Pose ou deplacement sur une periode : le serveur ajoute au creneau existant s'il y en a un a cette heure.
  function drop(p: Payload, weekday: number, startMin: number) {
    setArmed(null);
    setHover(null);
    run(() =>
      p.slotId
        ? moveClassAction({ slotId: p.slotId, weekday, startMin })
        : placeClassAction({ teacherId, weekday, startMin, className: p.className, endMin: slotEndFor(startMin, nPeriods) })
    );
  }
  function onDragStart(e: React.DragEvent, p: Payload) {
    e.dataTransfer.setData("text/plain", JSON.stringify(p));
    e.dataTransfer.effectAllowed = "move";
  }
  function onDrop(e: React.DragEvent, weekday: number, startMin: number) {
    e.preventDefault();
    e.stopPropagation();
    let p: Payload | null = null;
    try {
      p = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      p = null;
    }
    if (p && typeof p.className === "string") drop(p, weekday, startMin);
  }
  function allow(e: React.DragEvent, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hover !== key) setHover(key);
  }

  const weekMin = weeklyMinutes(groups);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-4 items-start">
      {/* ===== Palette des classes ===== */}
      <aside className={`${ui.cardPad} lg:sticky lg:top-24`}>
        <h2 className={`${ui.h3} mb-1`}>Classes</h2>
        <p className={`${ui.hint} mb-3`}>
          Glisse une classe sur une période, ou touche-la puis touche la période. <b>×n</b> = déjà posée n fois dans ce journal.
        </p>
        <div className="space-y-3">
          {families.map(([fam, list]) => (
            <div key={fam}>
              <div className={`${ui.eyebrow} mb-1`}>{/^\d$/.test(fam) ? `${fam}e` : fam}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((c) => {
                  const n = placedCount.get(c) ?? 0;
                  const other = elsewhere[c] ?? [];
                  const isArmed = armed?.className === c && !armed.slotId;
                  const title =
                    `${c}${n ? ` · ${n} ${plural(n, "créneau", "créneaux")} dans ce journal` : ""}` +
                    (other.length ? `\nAilleurs : ${other.map((o) => `${WEEKDAYS[o.weekday].slice(0, 3)} ${fmtMin(o.startMin)}–${fmtMin(o.endMin)} (${o.who})`).join(", ")}` : "");
                  return (
                    <button
                      key={c}
                      type="button"
                      draggable
                      onDragStart={(e) => onDragStart(e, { className: c })}
                      onClick={() => setArmed(isArmed ? null : { className: c })}
                      title={title}
                      className={cx(
                        "px-2 py-1 rounded-lg border text-xs font-bold select-none cursor-grab active:cursor-grabbing transition",
                        isArmed ? "bg-brand text-white border-brand" : other.length ? "bg-paper border-line-2 text-ink-2 hover:border-brand" : "bg-card border-line hover:border-brand"
                      )}
                    >
                      {c}
                      {n > 0 && <span className="ml-1 text-[10px] opacity-70">×{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ===== Grille de la semaine ===== */}
      <section className={cx(ui.cardPad, pending && "opacity-70 pointer-events-none")} aria-busy={pending}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className={ui.h3}>Semaine type</h2>
            <p className={ui.hint}>
              {groups.length} {plural(groups.length, "créneau", "créneaux")} · {fmtHours(weekMin)} de cours · max {MAX_SLOT_CLASSES} classes par créneau ; clique sur un créneau pour l&apos;ajuster.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={ui.hint}>Un créneau posé fait</span>
            <div className={ui.segmented}>
              {[1, 2].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNPeriods(n)}
                  className={cx("px-3 py-1 rounded-lg text-xs font-bold transition", nPeriods === n ? ui.segOn : ui.segOff)}
                >
                  {n} {plural(n, "période")} · {n * PERIOD_MIN} min
                </button>
              ))}
            </div>
          </div>
        </div>
        {armed && (
          <div className={`${ui.alertInfo} flex items-center justify-between gap-2 py-1.5 mb-3`}>
            <span>
              <b>{armed.className}</b> en main{armed.slotId ? " (déplacement)" : ""} : touche une période ou un créneau.
            </span>
            <button type="button" onClick={() => setArmed(null)} className={btn.smGhost}>Annuler</button>
          </div>
        )}
        {error && <p className={`${ui.alertErr} mb-3`}>{error}</p>}

        <div className="grid select-none" style={{ gridTemplateColumns: "64px repeat(5, minmax(0, 1fr))" }}>
          <div />
          {DAYS.map((d) => (
            <div key={d} className="text-center text-xs font-extrabold uppercase tracking-wide text-ink-2 pb-2">{WEEKDAYS[d]}</div>
          ))}

          {/* Gouttiere : numero et heure de chaque periode, libelle des pauses. */}
          <div className="relative" style={{ height: GRID_H }}>
            {PERIODS.map((p) => (
              <div key={p.id} className="absolute right-2 left-0 text-right leading-tight" style={{ top: y(p.start) + 4 }}>
                <div className="text-[11px] font-extrabold text-ink-2">{p.id}</div>
                <div className="text-[10px] tabular-nums text-ink-3">{fmtMin(p.start)}</div>
              </div>
            ))}
            {BREAKS.map((b) => (
              <div key={b.start} className="absolute right-2 left-0 text-right text-[9px] uppercase tracking-wide text-ink-3 -translate-y-1/2" style={{ top: y(b.start) + ((b.end - b.start) * PX_PER_MIN) / 2 }}>
                {b.label}
              </div>
            ))}
          </div>

          {DAYS.map((d) => (
            <div key={d} className="relative border-l border-line" style={{ height: GRID_H }} onDragLeave={() => setHover(null)}>
              {BREAKS.map((b) => (
                <div
                  key={b.start}
                  className="absolute left-0 right-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(29,27,24,0.05)_6px_8px)] border-y border-line/60"
                  style={{ top: y(b.start), height: (b.end - b.start) * PX_PER_MIN }}
                />
              ))}
              {PERIODS.map((p) => {
                const k = `${d}_${p.start}`;
                return (
                  <div
                    key={p.id}
                    onDragOver={(e) => allow(e, k)}
                    onDrop={(e) => onDrop(e, d, p.start)}
                    onClick={() => armed && drop(armed, d, p.start)}
                    title={armed ? `Poser ${armed.className} ${WEEKDAYS[d].toLowerCase()} en ${p.id} (${fmtMin(p.start)})` : `${p.id} · ${fmtMin(p.start)}–${fmtMin(p.end)}`}
                    className={cx(
                      "absolute left-0 right-0 border-t border-line/60",
                      hover === k && "bg-brand-soft",
                      armed && "cursor-copy hover:bg-brand-soft/70"
                    )}
                    style={{ top: y(p.start), height: (p.end - p.start) * PX_PER_MIN }}
                  />
                );
              })}

              {(byDay.get(d) ?? []).map((g) => {
                const pl = planLabel(g.planId);
                const height = Math.max(PERIOD_MIN * PX_PER_MIN - 2, y(g.endMin) - y(g.startMin) - 2);
                return (
                  <div
                    key={g.key}
                    onDragOver={(e) => allow(e, g.key)}
                    onDrop={(e) => onDrop(e, g.weekday, g.startMin)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (armed) drop(armed, g.weekday, g.startMin);
                      else setEditing(g.key);
                    }}
                    title={`${fmtMin(g.startMin)}–${fmtMin(g.endMin)} · ${g.classes.map((c) => c.className).join(", ")}${pl ? ` · ${pl}` : ""}\nClique pour ajuster les heures ou la séance-type.`}
                    className={cx(
                      "absolute left-1 right-1 z-10 rounded-xl border shadow-sm overflow-hidden cursor-pointer text-left",
                      g.planId ? "bg-sea-soft border-sea/40" : "bg-brand-soft border-brand/40",
                      hover === g.key && "ring-2 ring-brand"
                    )}
                    style={{ top: y(g.startMin) + 1, height }}
                  >
                    <div className="flex items-center justify-between gap-1 px-1.5 pt-1 text-[10px] font-extrabold text-ink-2 tabular-nums leading-tight">
                      <span>{fmtMin(g.startMin)}–{fmtMin(g.endMin)}</span>
                      {pl && <span className="truncate text-sea-ink">{pl}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 px-1.5 pb-1 pt-0.5">
                      {g.classes.map((c) => {
                        const isArmed = armed?.slotId === c.id;
                        return (
                          <span
                            key={c.id}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              onDragStart(e, { className: c.className, slotId: c.id });
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setArmed(isArmed ? null : { className: c.className, slotId: c.id });
                            }}
                            title={`${c.className} : glisse-la vers une autre période pour la déplacer, × pour la retirer`}
                            className={cx(
                              "inline-flex items-center gap-0.5 rounded-md bg-card border px-1.5 py-0.5 text-[11px] font-bold cursor-grab active:cursor-grabbing",
                              isArmed ? "border-brand ring-2 ring-brand/40" : "border-line"
                            )}
                          >
                            {c.className}
                            <button
                              type="button"
                              aria-label={`Retirer ${c.className} de ce créneau`}
                              onClick={(e) => {
                                e.stopPropagation();
                                run(() => removeClassAction({ slotId: c.id }));
                              }}
                              className="text-ink-3 hover:text-danger font-bold px-0.5 leading-none"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {g.classes.length < MAX_SLOT_CLASSES && <span className="text-[10px] text-ink-3 self-center">+ classe</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className={`${ui.hint} mt-3`}>
          Grille de l&apos;école : {PERIODS.length} périodes de {PERIOD_MIN} min ({fmtMin(DAY_START)}–{fmtMin(DAY_END)}),
          {" "}{BREAKS.map((b) => `${b.label} ${fmtMin(b.start)}–${fmtMin(b.end)}`).join(", ")}. Un créneau de 2 périodes enjambe la récré (ex. 09:05–11:00), jamais le temps de midi.
        </p>
      </section>

      {editingGroup && (
        <SlotEditor
          g={editingGroup}
          teacherId={teacherId}
          plans={plans}
          pending={pending}
          onRun={run}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// Editeur d'un creneau : periodes (ou heures libres a la minute), seance-type imposee, classes, suppression.
function SlotEditor({
  g, teacherId, plans, pending, onRun, onClose,
}: {
  g: SlotGroup;
  teacherId: string;
  plans: PlanOption[];
  pending: boolean;
  onRun: (action: () => Promise<JournalResult>) => void;
  onClose: () => void;
}) {
  const startIdx = periodIndexAt(g.startMin);
  const onGrid = startIdx !== -1 && PERIODS[startIdx].start === g.startMin;
  const [periodId, setPeriodId] = useState(onGrid ? PERIODS[startIdx].id : "");
  const [count, setCount] = useState(Math.max(1, periodsCovered(g.startMin, g.endMin) || DEFAULT_PERIODS));
  const [start, setStart] = useState(fmtMin(g.startMin));
  const [end, setEnd] = useState(fmtMin(g.endMin));
  const [localError, setLocalError] = useState("");
  const ref = { teacherId, weekday: g.weekday, startMin: g.startMin, endMin: g.endMin };

  function applyPeriods() {
    const p = PERIODS.find((x) => x.id === periodId);
    if (!p) return setLocalError("Choisis une période de début.");
    setLocalError("");
    onRun(() => setSlotTimesAction({ ...ref, newStart: p.start, newEnd: slotEndFor(p.start, count) }));
  }
  function applyFreeTimes() {
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s === null || e === null) return setLocalError("Heures au format HH:MM.");
    if (e <= s) return setLocalError("La fin doit être après le début.");
    setLocalError("");
    onRun(() => setSlotTimesAction({ ...ref, newStart: s, newEnd: e }));
  }
  function remove() {
    if (!confirm(`Supprimer le créneau du ${WEEKDAYS[g.weekday].toLowerCase()} ${fmtMin(g.startMin)}–${fmtMin(g.endMin)} (${g.classes.map((c) => c.className).join(", ")}) ?\n\nLes séances déjà ouvertes ou jouées ne sont pas touchées.`)) return;
    onRun(() => deleteSlotGroupAction(ref));
    onClose();
  }
  const preview = (() => {
    const p = PERIODS.find((x) => x.id === periodId);
    return p ? `${fmtMin(p.start)}–${fmtMin(slotEndFor(p.start, count))}` : null;
  })();

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className={ui.h2}>{WEEKDAYS[g.weekday]} {fmtMin(g.startMin)}–{fmtMin(g.endMin)}</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>

        <p className="text-sm font-bold mb-1">Classes du créneau <span className="text-ink-3 font-normal">({g.classes.length}/{MAX_SLOT_CLASSES})</span></p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {g.classes.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-lg bg-paper border border-line px-2 py-1 text-xs font-bold">
              {c.className}
              <button type="button" disabled={pending} onClick={() => onRun(() => removeClassAction({ slotId: c.id }))} className="text-ink-3 hover:text-danger font-bold" aria-label={`Retirer ${c.className}`}>×</button>
            </span>
          ))}
        </div>
        <p className={`${ui.hint} mb-4`}>Pour ajouter une classe, glisse-la (ou touche-la puis touche ce créneau) depuis la grille.</p>

        <p className="text-sm font-bold mb-1">Périodes</p>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 mb-1">
          <label className="text-xs">
            <span className={ui.label}>Début</span>
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className={ui.input}>
              {!onGrid && <option value="">hors grille ({fmtMin(g.startMin)})</option>}
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.id} · {fmtMin(p.start)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className={ui.label}>Durée</span>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={ui.input}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>{n} {plural(n, "période")} · {n * PERIOD_MIN} min</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={applyPeriods} disabled={pending} className={btn.primary}>Appliquer</button>
        </div>
        <p className={`${ui.hint} mb-3`}>{preview ? `Soit ${preview}` : "Choisis une période de début."} · une petite récré entre deux périodes est enjambée, le temps de midi jamais.</p>

        <details className="mb-4">
          <summary className="text-xs font-bold text-ink-2 cursor-pointer select-none">Heures libres, à la minute</summary>
          <div className="flex items-end gap-2 mt-2">
            <label className="text-xs flex-1">
              <span className={ui.label}>Début</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={ui.input} />
            </label>
            <label className="text-xs flex-1">
              <span className={ui.label}>Fin</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={ui.input} />
            </label>
            <button type="button" onClick={applyFreeTimes} disabled={pending} className={btn.ghost}>Enregistrer</button>
          </div>
        </details>
        {localError && <p className={`${ui.alertErr} mb-3`}>{localError}</p>}

        <p className="text-sm font-bold mb-1">Séance-type de ce créneau</p>
        <select
          value={g.planId ?? ""}
          disabled={pending}
          onChange={(e) => onRun(() => setSlotPlanAction({ ...ref, planId: e.target.value || null }))}
          className={`${ui.input} mb-1`}
        >
          <option value="">Séance de la semaine (celle du cycle en cours)</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.label}{p.isCurrent ? " · séance de la semaine" : ""}</option>
          ))}
        </select>
        {g.planId && !plans.some((p) => p.id === g.planId) && <p className={`${ui.alertWarn} mb-1`}>La séance-type imposée n&apos;existe plus dans le cycle en cours : ce créneau ouvrira quand même la séance de la semaine.</p>}
        <p className={`${ui.hint} mb-5`}>Par défaut, chaque créneau ouvre la « séance de la semaine ». Imposer une séance-type sert quand un groupe est en décalage (rattrapage, évaluation…).</p>

        <div className="flex justify-between">
          <button type="button" onClick={remove} disabled={pending} className={btn.danger}>Supprimer le créneau</button>
          <button type="button" onClick={onClose} className={btn.ghost}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
