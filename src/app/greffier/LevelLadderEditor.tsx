"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { updateSessionLevelsAction } from "./level-actions";
import { MAX_CARDS, activeCards, estimateSeconds, fmtTheoretical, isBoss, statsOf, type FrozenLevel } from "@/lib/wod-engines/templates/level-engine";
import type { LevelTickRow } from "@/lib/level-context";
import { btn, cx, ui } from "@/lib/ui";

type Catalog = { id: string; label: string; weight: number; active: boolean }[];

// Editeur de l'echelle FIGEE d'une seance, pendant qu'elle tourne : reps ou exercice d'une fiche, fiche
// ajoutee, fiche retiree (jamais supprimee : les coches y font reference par index), niveau ajoute en fin.
// L'echelle commune de l'atelier /admin/level n'est pas touchee.
export function LevelLadderEditor({ sessionId, levels, catalog, ticks, onSaved }: { sessionId: string; levels: FrozenLevel[]; catalog: Catalog; ticks: LevelTickRow[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<FrozenLevel[]>(() => structuredClone(levels));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(levels));
  }, [levels, dirty]);

  const tickedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of ticks) m.set(`${t.level}_${t.card}`, (m.get(`${t.level}_${t.card}`) ?? 0) + 1);
    return m;
  }, [ticks]);
  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);

  const edit = (fn: (d: FrozenLevel[]) => void) => {
    setDirty(true);
    setDraft((d) => {
      const n = structuredClone(d);
      fn(n);
      return n;
    });
  };
  const save = () =>
    startTransition(async () => {
      const r = await updateSessionLevelsAction(sessionId, draft);
      if ("error" in r) setMsg({ kind: "err", text: r.error });
      else {
        setMsg({ kind: "ok", text: "Échelle de la séance enregistrée." });
        setDirty(false);
        onSaved();
      }
    });

  return (
    <div className="space-y-3">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-3`}>
        <div className="flex-1 min-w-[240px]">
          <b className="text-ink">Échelle de cette séance</b>
          <p className={ui.hint}>Figée au coup d&apos;envoi. Tu peux corriger les reps, changer un exercice, ajouter une fiche, retirer une fiche (elle reste dans l&apos;historique) ou ajouter un niveau. L&apos;échelle commune de l&apos;atelier ne bouge pas.</p>
        </div>
        <a href={`/admin/level/fiches?session=${sessionId}`} target="_blank" className={btn.ghost}>🖨️ Fiches</a>
        <button type="button" onClick={save} disabled={!dirty || pending} className={dirty ? btn.primary : btn.soft}>
          {pending ? "Enregistrement…" : dirty ? "Enregistrer" : "Enregistré"}
        </button>
      </div>
      {msg && <p className={msg.kind === "ok" ? ui.alertOk : ui.alertErr}>{msg.text}</p>}

      {draft.map((l, li) => {
        const boss = isBoss(l.number);
        const act = activeCards(l);
        const stats = statsOf(act.map(({ card }) => ({ reps: card.reps, weight: card.weight })));
        const estimate = estimateSeconds(act.map(({ card }) => ({ reps: card.reps, weight: card.weight })), boss);
        return (
          <section key={l.number} className={cx(ui.card, "p-3", boss && "border-danger/50 bg-danger-soft/40")}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className={cx("font-display font-extrabold", boss ? "text-danger-ink" : "text-ink")}>Niveau {l.number}</span>
              {boss && <span className={cx(ui.chip, ui.chipErr)}>BOSS</span>}
              <input value={l.name ?? ""} onChange={(e) => edit((d) => { d[li].name = e.target.value || null; })} placeholder="Nom (facultatif)" className={`${ui.input} max-w-[200px]`} maxLength={40} />
              <span className={`${ui.hint} ml-auto tabular-nums`}>
                {act.length} fiche{act.length > 1 ? "s" : ""} · {stats.reps} reps · ≈ {fmtTheoretical(estimate)}
              </span>
            </div>
            <div className="space-y-1.5">
              {l.cards.map((c, ci) => {
                const n = tickedBy.get(`${l.number}_${ci}`) ?? 0;
                return (
                  <div key={ci} className={cx("flex flex-wrap items-center gap-2", c.off && "opacity-50")}>
                    <span className="w-5 text-right text-xs text-ink-3 tabular-nums">{ci + 1}</span>
                    <select
                      value={c.exerciseId}
                      disabled={!!c.off}
                      onChange={(e) => edit((d) => {
                        const ex = byId.get(e.target.value);
                        if (!ex) return;
                        d[li].cards[ci] = { ...d[li].cards[ci], exerciseId: ex.id, label: ex.label, weight: ex.weight };
                      })}
                      className={`${ui.input} flex-1 min-w-[160px]`}
                    >
                      {!byId.has(c.exerciseId) && <option value={c.exerciseId}>{c.label} (hors catalogue)</option>}
                      {catalog.filter((e) => e.active || e.id === c.exerciseId).map((e) => <option key={e.id} value={e.id}>{e.label} · {String(e.weight).replace(".", ",")}</option>)}
                    </select>
                    <input type="number" min={1} max={10000} value={c.reps} disabled={!!c.off} onChange={(e) => edit((d) => { d[li].cards[ci].reps = Math.max(1, Math.round(Number(e.target.value) || 1)); })} className={`${ui.input} w-24 tabular-nums`} />
                    <span className={`${ui.hint} w-24 tabular-nums`}>{c.off ? "retirée" : fmtTheoretical(c.reps * c.weight)}</span>
                    {n > 0 && <span className={cx(ui.chip, ui.chipOk)} title="Équipes qui ont déjà coché cette fiche">✓ {n}</span>}
                    <button type="button" onClick={() => edit((d) => { d[li].cards[ci].off = !d[li].cards[ci].off; if (!d[li].cards[ci].off) delete d[li].cards[ci].off; })} className={c.off ? btn.smSuccess : btn.smGhost}>
                      {c.off ? "Rétablir" : "Retirer"}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-2">
              <button
                type="button"
                disabled={l.cards.length >= MAX_CARDS || (boss && act.length >= 1) || !catalog.some((e) => e.active)}
                onClick={() => edit((d) => {
                  const first = catalog.find((e) => e.active);
                  if (first) d[li].cards.push({ exerciseId: first.id, label: first.label, weight: first.weight, reps: 20 });
                })}
                className={btn.smGhost}
              >
                + Fiche
              </button>
            </div>
          </section>
        );
      })}
      <button
        type="button"
        onClick={() => edit((d) => { d.push({ number: d.length + 1, name: null, boss: isBoss(d.length + 1), cards: [] }); })}
        className={btn.ghost}
      >
        + Ajouter le niveau {draft.length + 1}{isBoss(draft.length + 1) ? " (BOSS)" : ""}
      </button>
    </div>
  );
}
