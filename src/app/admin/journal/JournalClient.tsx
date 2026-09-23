"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DAY_END, DAY_START, DEFAULT_DURATION, MAX_SLOT_CLASSES, STEP, WEEKDAYS, fmtMin, groupSlots, parseHHMM, weeklyMinutes,
  type SlotGroup, type SlotRow,
} from "@/lib/journal";
import {
  deleteSlotGroupAction, moveClassAction, placeClassAction, removeClassAction, setSlotPlanAction, setSlotTimesAction, type JournalResult,
} from "./actions";
import { btn, cx, ui } from "@/lib/ui";

// Grille hebdomadaire du journal de classe : palette de classes a gauche, lundi-vendredi a droite.
// Souris : glisser une classe sur une case (ou sur un creneau existant pour s'y ajouter) ; glisser une classe
// d'un creneau a l'autre pour la deplacer. Tablette / sans souris : toucher la classe (elle est « en main »),
// puis toucher la case. Un clic sur un creneau ouvre son editeur (heures a la minute, seance-type, suppression).
// Aucune regle metier ici : conflits et maximums sont tranches par les actions serveur, qui repondent en clair.

export type PlanOption = { id: string; label: string; isCurrent: boolean };
export type Elsewhere = { weekday: number; startMin: number; endMin: number; who: string };

type Payload = { className: string; slotId?: string };

const ROW_H = 26; // pixels par pas de 30 min
const ROWS = (DAY_END - DAY_START) / STEP;
const GRID_H = ROWS * ROW_H;
const y = (min: number) => ((Math.min(Math.max(min, DAY_START), DAY_END) - DAY_START) / STEP) * ROW_H;
const DAYS = [1, 2, 3, 4, 5];

async function settle(action: () => Promise<JournalResult>): Promise<JournalResult> {
  try {
    return await action();
  } catch (e) {
    return { error: "Action non enregistrée (réseau ou session expirée) : " + (e instanceof Error ? e.message : String(e)) };
  }
}

const fmtHours = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;

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
  const [hover, setHover] = useState<string | null>(null); // case ou creneau survole pendant un glisser
  const [editing, setEditing] = useState<string | null>(null); // cle du creneau ouvert dans l'editeur

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
  function drop(p: Payload, weekday: number, startMin: number) {
    setArmed(null);
    setHover(null);
    run(() => (p.slotId ? moveClassAction({ slotId: p.slotId, weekday, startMin }) : placeClassAction({ teacherId, weekday, startMin, className: p.className })));
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

  const hourMarks: number[] = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) hourMarks.push(m);
  const weekMin = weeklyMinutes(groups);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-4 items-start">
      {/* ===== Palette des classes ===== */}
      <aside className={`${ui.cardPad} lg:sticky lg:top-24`}>
        <h2 className={`${ui.h3} mb-1`}>Classes</h2>
        <p className={`${ui.hint} mb-3`}>
          Glisse une classe sur la grille, ou touche-la puis touche une case. <b>×n</b> = déjà posée n fois dans ce journal.
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
                    `${c}${n ? ` · ${n} créneau${n > 1 ? "x" : ""} dans ce journal` : ""}` +
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className={ui.h3}>Semaine type</h2>
            <p className={ui.hint}>
              {groups.length} créneau{groups.length > 1 ? "x" : ""} · {fmtHours(weekMin)} de cours · un créneau posé fait {DEFAULT_DURATION} min, max {MAX_SLOT_CLASSES} classes ; clique dessus pour l&apos;ajuster.
            </p>
          </div>
          {armed && (
            <div className={`${ui.alertInfo} flex items-center gap-2 py-1.5`}>
              <span>
                <b>{armed.className}</b> en main{armed.slotId ? " (déplacement)" : ""} : touche une case ou un créneau.
              </span>
              <button type="button" onClick={() => setArmed(null)} className={btn.smGhost}>Annuler</button>
            </div>
          )}
        </div>
        {error && <p className={`${ui.alertErr} mb-3`}>{error}</p>}

        <div className="grid select-none" style={{ gridTemplateColumns: "44px repeat(5, minmax(0, 1fr))" }}>
          <div />
          {DAYS.map((d) => (
            <div key={d} className="text-center text-xs font-extrabold uppercase tracking-wide text-ink-2 pb-2">{WEEKDAYS[d]}</div>
          ))}

          <div className="relative" style={{ height: GRID_H }}>
            {hourMarks.map((m) => (
              <div key={m} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-ink-3" style={{ top: y(m) }}>{fmtMin(m)}</div>
            ))}
          </div>

          {DAYS.map((d) => (
            <div key={d} className="relative border-l border-line" style={{ height: GRID_H }} onDragLeave={() => setHover(null)}>
              {Array.from({ length: ROWS }, (_, i) => {
                const m = DAY_START + i * STEP;
                const k = `${d}_${m}`;
                return (
                  <div
                    key={m}
                    onDragOver={(e) => allow(e, k)}
                    onDrop={(e) => onDrop(e, d, m)}
                    onClick={() => armed && drop(armed, d, m)}
                    title={armed ? `Poser ${armed.className} ${WEEKDAYS[d].toLowerCase()} à ${fmtMin(m)}` : undefined}
                    className={cx(
                      "absolute left-0 right-0 border-t",
                      m % 60 === 0 ? "border-line" : "border-line/40",
                      hover === k && "bg-brand-soft",
                      armed && "cursor-copy hover:bg-brand-soft/70"
                    )}
                    style={{ top: y(m), height: ROW_H }}
                  />
                );
              })}

              {(byDay.get(d) ?? []).map((g) => {
                const pl = planLabel(g.planId);
                const height = Math.max(ROW_H - 2, y(g.endMin) - y(g.startMin) - 2);
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
                            title={`${c.className} : glisse-la vers une autre case pour la déplacer, × pour la retirer`}
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

// Editeur d'un creneau : heures a la minute, seance-type imposee, classes, suppression.
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
  const [start, setStart] = useState(fmtMin(g.startMin));
  const [end, setEnd] = useState(fmtMin(g.endMin));
  const [localError, setLocalError] = useState("");
  const ref = { teacherId, weekday: g.weekday, startMin: g.startMin, endMin: g.endMin };

  function saveTimes() {
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

        <p className="text-sm font-bold mb-1">Heures exactes</p>
        <div className="flex items-end gap-2 mb-1">
          <label className="text-xs flex-1">
            <span className={ui.label}>Début</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={ui.input} />
          </label>
          <label className="text-xs flex-1">
            <span className={ui.label}>Fin</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={ui.input} />
          </label>
          <button type="button" onClick={saveTimes} disabled={pending} className={btn.primary}>Enregistrer</button>
        </div>
        {localError && <p className={`${ui.alertErr} mb-3`}>{localError}</p>}
        <p className={`${ui.hint} mb-4`}>La séance s&apos;ouvre toute seule au début et se ferme à la fin, chaque semaine.</p>

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
