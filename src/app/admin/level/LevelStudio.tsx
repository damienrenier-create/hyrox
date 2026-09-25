"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ExerciseRow, LevelRow } from "@/lib/level";
import {
  BOSS_EVERY, DEFAULT_TEAM, MAX_CARDS, estimateSeconds, fmtIntensity, fmtTheoretical, isBoss, statsOf, type LevelCard,
} from "@/lib/wod-engines/templates/level-engine";
import { PROPOSALS } from "@/lib/level-proposals";
import {
  createExerciseAction, createLevelAction, deleteExerciseAction, deleteLevelAction, moveLevelAction,
  saveLevelAction, seedExercisesAction, updateExerciseAction,
} from "./actions";
import { loadProposalAction } from "./proposal-actions";
import { btn, cx, ui } from "@/lib/ui";

type Res = { ok: true } | { error: string };
const fmtW = (w: number) => String(w).replace(".", ",");

// Atelier du WOD Level. Deux volets : le catalogue (un exercice = un libelle + une ponderation, le temps
// theorique d'une rep en secondes) et l'echelle des niveaux (1 a 10 fiches exercice x reps ; BOSS tous
// les 5 niveaux, un seul exercice). Chaque niveau se modifie en local puis s'enregistre d'un coup.
export function LevelStudio({ exercises, levels, isMaster }: { exercises: ExerciseRow[]; levels: LevelRow[]; isMaster: boolean }) {
  const [tab, setTab] = useState<"levels" | "catalog">(levels.length || exercises.length ? "levels" : "catalog");
  const [proposal, setProposal] = useState("E");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const weightOf = useMemo(() => new Map(exercises.map((e) => [e.id, e.weight])), [exercises]);
  const labelOf = useMemo(() => new Map(exercises.map((e) => [e.id, e.label])), [exercises]);

  const run = (label: string, fn: () => Promise<Res>) =>
    startTransition(async () => {
      const r = await fn();
      setMsg("error" in r ? { kind: "err", text: r.error } : { kind: "ok", text: label });
    });

  const totals = useMemo(() => {
    const all = levels.flatMap((l) => l.cards.map((c) => ({ reps: c.reps, weight: weightOf.get(c.exerciseId) ?? 0 })));
    const seconds = levels.reduce((s, l) => s + estimateSeconds(l.cards.map((c) => ({ reps: c.reps, weight: weightOf.get(c.exerciseId) ?? 0 })), isBoss(l.number)), 0);
    return { ...statsOf(all), seconds };
  }, [levels, weightOf]);

  return (
    <div className="space-y-4">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-3`}>
        <div className={ui.segmented}>
          <button type="button" onClick={() => setTab("levels")} className={cx("px-3 py-1.5 rounded-lg text-sm font-bold", tab === "levels" ? ui.segOn : ui.segOff)}>
            Niveaux ({levels.length})
          </button>
          <button type="button" onClick={() => setTab("catalog")} className={cx("px-3 py-1.5 rounded-lg text-sm font-bold", tab === "catalog" ? ui.segOn : ui.segOff)}>
            Catalogue ({exercises.length})
          </button>
        </div>
        <span className={ui.hint}>
          Échelle complète : {totals.reps} reps · travail {fmtTheoretical(totals.weighted)} · intensité moyenne {fmtIntensity(totals.intensity)} · <b className="text-ink">≈ {fmtTheoretical(totals.seconds)}</b> pour une équipe de {DEFAULT_TEAM} qui boucle tout · BOSS tous les {BOSS_EVERY} niveaux
        </span>
        {pending && <span className={ui.hint}>Enregistrement…</span>}
        <a href="/admin/level/fiches" target="_blank" className={btn.smGhost} title="Fiches à imprimer et découper (3 × 4 par page A4)">🖨️ Fiches</a>
      </div>

      {msg && <p className={msg.kind === "ok" ? ui.alertOk : ui.alertErr}>{msg.text}</p>}

      {tab === "catalog" ? (
        <Catalog exercises={exercises} levels={levels} isMaster={isMaster} run={run} />
      ) : (
        <div className="space-y-3">
          {exercises.filter((e) => e.active).length === 0 && (
            <p className={ui.alertInfo}>Le catalogue est vide : ajoute des exercices (ou importe le listing) avant de composer des niveaux.</p>
          )}
          {levels.length === 0 && (
            <div className={`${ui.cardPad} flex flex-wrap items-center gap-3`}>
              <div className="flex-1 min-w-[240px]">
                <b className="text-ink">Partir d'une proposition de 25 niveaux</b>
                <p className={ui.hint}>Équipes de 5, difficulté croissante, BOSS aux niveaux 5, 10, 15, 20 et 25. Tout reste modifiable ensuite.</p>
              </div>
              <select value={proposal} onChange={(e) => setProposal(e.target.value)} className={`${ui.input} max-w-[260px]`}>
                {PROPOSALS.map((p) => <option key={p.key} value={p.key}>{p.key} · {p.title}</option>)}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(`Proposition ${proposal} chargée : 25 niveaux.`, async () => {
                  const r = await loadProposalAction(proposal);
                  return "error" in r ? r : { ok: true };
                })}
                className={btn.accent}
              >
                Charger
              </button>
            </div>
          )}
          {levels.map((l, i) => (
            <LevelEditor
              key={l.id}
              level={l}
              exercises={exercises}
              labelOf={labelOf}
              weightOf={weightOf}
              isFirst={i === 0}
              isLast={i === levels.length - 1}
              isMaster={isMaster}
              run={run}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(`Niveau ${levels.length + 1} ajouté.`, () => createLevelAction())}
              className={btn.primary}
            >
              + Ajouter le niveau {levels.length + 1}{isBoss(levels.length + 1) ? " (BOSS)" : ""}
            </button>
            {isMaster && levels.length > 0 && (
              <>
                <select value={proposal} onChange={(e) => setProposal(e.target.value)} className={`${ui.input} max-w-[240px]`}>
                  {PROPOSALS.map((p) => <option key={p.key} value={p.key}>{p.key} · {p.title}</option>)}
                </select>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    confirm(`Remplacer TOUTE l'échelle par la proposition ${proposal} ? Les niveaux actuels sont perdus (les séances déjà lancées gardent leur copie).`) &&
                    run(`Échelle remplacée par la proposition ${proposal}.`, async () => {
                      const r = await loadProposalAction(proposal, true);
                      return "error" in r ? r : { ok: true };
                    })
                  }
                  className={btn.smDanger}
                  title="Repart d'une proposition de 25 niveaux"
                >
                  Remplacer par la proposition
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Catalogue =====
function Catalog({ exercises, levels, isMaster, run }: { exercises: ExerciseRow[]; levels: LevelRow[]; isMaster: boolean; run: (label: string, fn: () => Promise<Res>) => void }) {
  const [label, setLabel] = useState("");
  const [weight, setWeight] = useState("");
  const usage = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const l of levels) for (const c of l.cards) m.set(c.exerciseId, [...(m.get(c.exerciseId) ?? []), l.number]);
    return m;
  }, [levels]);

  return (
    <div className="space-y-3">
      <form
        className={`${ui.cardPad} flex flex-wrap items-end gap-2`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim() || !weight.trim()) return;
          run(`« ${label.trim().toUpperCase()} » ajouté.`, () => createExerciseAction(label, weight));
          setLabel("");
          setWeight("");
        }}
      >
        <div className="flex-1 min-w-[180px]">
          <label className={ui.label}>Nouvel exercice</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. GOBLET SQUAT" className={ui.input} maxLength={40} />
        </div>
        <div className="w-40">
          <label className={ui.label}>Pondération (s / rep)</label>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="ex. 3" inputMode="decimal" className={ui.input} />
        </div>
        <button type="submit" className={btn.primary}>Ajouter</button>
        <button type="button" onClick={() => run("Listing importé.", async () => {
          const r = await seedExercisesAction();
          return "error" in r ? r : { ok: true };
        })} className={btn.ghost} title="Ajoute les exercices du listing qui manquent, sans toucher aux existants">
          Importer le listing (21 exercices)
        </button>
      </form>

      <div className={`${ui.card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={ui.th}>Exercice</th>
              <th className={ui.th}>Pondération</th>
              <th className={ui.th}>Utilisé aux niveaux</th>
              <th className={ui.th}>Actif</th>
              <th className={ui.th}></th>
            </tr>
          </thead>
          <tbody>
            {exercises.length === 0 && (
              <tr><td colSpan={5} className={`p-4 ${ui.muted}`}>Aucun exercice. Importe le listing ou ajoute-en un ci-dessus.</td></tr>
            )}
            {exercises.map((e) => (
              <ExerciseLine key={e.id} e={e} used={usage.get(e.id) ?? []} isMaster={isMaster} run={run} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={ui.hint}>
        Pondération = temps théorique d&apos;une rep, en secondes (corde 1, pompes 3, burpees 7…). L&apos;intensité d&apos;un niveau est sa pondération moyenne par rep.
        Un exercice désactivé disparaît des listes du constructeur mais reste dans les niveaux qui l&apos;utilisent.
      </p>
    </div>
  );
}

function ExerciseLine({ e, used, isMaster, run }: { e: ExerciseRow; used: number[]; isMaster: boolean; run: (label: string, fn: () => Promise<Res>) => void }) {
  const [label, setLabel] = useState(e.label);
  const [weight, setWeight] = useState(fmtW(e.weight));
  useEffect(() => { setLabel(e.label); setWeight(fmtW(e.weight)); }, [e.label, e.weight]);
  const commitLabel = () => { if (label.trim().toUpperCase() !== e.label) run("Exercice renommé.", () => updateExerciseAction(e.id, { label })); };
  const commitWeight = () => { if (weight.replace(",", ".") !== String(e.weight)) run("Pondération modifiée.", () => updateExerciseAction(e.id, { weight })); };
  return (
    <tr className={cx(ui.tr, !e.active && "opacity-50")}>
      <td className="p-2">
        <input value={label} onChange={(x) => setLabel(x.target.value)} onBlur={commitLabel} onKeyDown={(k) => k.key === "Enter" && (k.target as HTMLInputElement).blur()} className={`${ui.input} font-bold uppercase`} maxLength={40} />
      </td>
      <td className="p-2 w-32">
        <input value={weight} onChange={(x) => setWeight(x.target.value)} onBlur={commitWeight} onKeyDown={(k) => k.key === "Enter" && (k.target as HTMLInputElement).blur()} inputMode="decimal" className={`${ui.input} tabular-nums`} />
      </td>
      <td className={`p-2 ${ui.hint}`}>{used.length ? used.join(", ") : "—"}</td>
      <td className="p-2">
        <input type="checkbox" checked={e.active} onChange={(x) => run(x.target.checked ? "Exercice réactivé." : "Exercice désactivé.", () => updateExerciseAction(e.id, { active: x.target.checked }))} className={ui.check} />
      </td>
      <td className="p-2 text-right">
        {isMaster && (
          <button
            type="button"
            onClick={() => confirm(`Supprimer « ${e.label} » du catalogue ?`) && run("Exercice supprimé.", () => deleteExerciseAction(e.id))}
            className={btn.smDanger}
            disabled={used.length > 0}
            title={used.length ? "Utilisé dans un niveau : désactive-le plutôt" : "Supprimer"}
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

// ===== Un niveau =====
function LevelEditor({ level, exercises, labelOf, weightOf, isFirst, isLast, isMaster, run }: {
  level: LevelRow;
  exercises: ExerciseRow[];
  labelOf: Map<string, string>;
  weightOf: Map<string, number>;
  isFirst: boolean;
  isLast: boolean;
  isMaster: boolean;
  run: (label: string, fn: () => Promise<Res>) => void;
}) {
  const boss = isBoss(level.number);
  const [name, setName] = useState(level.name ?? "");
  const [cards, setCards] = useState<LevelCard[]>(level.cards);
  const [dirty, setDirty] = useState(false);
  // Le serveur a la main tant que rien n'est modifie en local : une sauvegarde d'un autre prof arrive ici.
  useEffect(() => {
    if (!dirty) { setName(level.name ?? ""); setCards(level.cards); }
  }, [level, dirty]);

  const stats = statsOf(cards.map((c) => ({ reps: c.reps, weight: weightOf.get(c.exerciseId) ?? 0 })));
  const estimate = estimateSeconds(cards.map((c) => ({ reps: c.reps, weight: weightOf.get(c.exerciseId) ?? 0 })), boss);
  const options = exercises.filter((e) => e.active || cards.some((c) => c.exerciseId === e.id));
  const maxCards = boss ? 1 : MAX_CARDS;
  const edit = (i: number, patch: Partial<LevelCard>) => { setDirty(true); setCards((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c))); };
  const add = () => {
    const first = exercises.find((e) => e.active);
    if (!first) return;
    setDirty(true);
    setCards((cs) => [...cs, { exerciseId: first.id, reps: 10 }]);
  };
  const remove = (i: number) => { setDirty(true); setCards((cs) => cs.filter((_, k) => k !== i)); };
  const save = () =>
    run(`Niveau ${level.number} enregistré.`, async () => {
      const r = await saveLevelAction(level.id, { name: name || null, cards });
      if ("ok" in r) setDirty(false);
      return r;
    });

  return (
    <section className={cx(ui.card, "p-3 sm:p-4", boss ? "border-danger/50 bg-danger-soft/40" : "")}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={cx("font-display font-extrabold text-lg", boss ? "text-danger-ink" : "text-ink")}>Niveau {level.number}</span>
        {boss && <span className={cx(ui.chip, ui.chipErr)}>BOSS</span>}
        <input value={name} onChange={(e) => { setDirty(true); setName(e.target.value); }} placeholder={boss ? "Nom du boss (facultatif)" : "Nom (facultatif)"} className={`${ui.input} max-w-[220px]`} maxLength={40} />
        <span className={`${ui.hint} ml-auto tabular-nums`}>
          {cards.length} fiche{cards.length > 1 ? "s" : ""} · {stats.reps} reps · travail {fmtTheoretical(stats.weighted)} · intensité <b className="text-ink">{fmtIntensity(stats.intensity)}</b> · <b className="text-ink" title={boss ? "BOSS : toute l'équipe en même temps, travail ÷ 5" : "Les membres travaillent en parallèle : le niveau dure sa fiche la plus longue (ou le travail ÷ 5 s'il y a plus de fiches que de bras)"}>≈ {fmtTheoretical(estimate)}</b>
        </span>
      </div>

      {cards.length === 0 && <p className={`${ui.hint} mb-2`}>{boss ? "Choisis l'unique exercice du boss." : "Aucune fiche : ajoute des exercices et leurs reps."}</p>}
      <div className="space-y-1.5">
        {cards.map((c, i) => {
          const w = weightOf.get(c.exerciseId) ?? 0;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
              <select value={c.exerciseId} onChange={(e) => edit(i, { exerciseId: e.target.value })} className={`${ui.input} flex-1 min-w-[160px]`}>
                {!labelOf.has(c.exerciseId) && <option value={c.exerciseId}>(exercice supprimé)</option>}
                {options.map((e) => <option key={e.id} value={e.id}>{e.label} · {fmtW(e.weight)}</option>)}
              </select>
              <input type="number" min={1} max={10000} step={1} value={c.reps} onChange={(e) => edit(i, { reps: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className={`${ui.input} w-24 tabular-nums`} />
              <span className={`${ui.hint} w-28 tabular-nums`}>= {fmtTheoretical(c.reps * w)}</span>
              <button type="button" onClick={() => remove(i)} className={ui.close} aria-label="Retirer la fiche">✕</button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" onClick={add} disabled={cards.length >= maxCards || !exercises.some((e) => e.active)} className={btn.smGhost}>
          + Fiche{boss ? "" : ` (${cards.length}/${MAX_CARDS})`}
        </button>
        <button type="button" onClick={save} disabled={!dirty} className={dirty ? btn.smPrimary : btn.smSoft}>
          {dirty ? "Enregistrer" : "Enregistré"}
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" disabled={isFirst} onClick={() => run("Niveau déplacé.", () => moveLevelAction(level.id, "up"))} className={btn.smSoft} aria-label="Monter">↑</button>
          <button type="button" disabled={isLast} onClick={() => run("Niveau déplacé.", () => moveLevelAction(level.id, "down"))} className={btn.smSoft} aria-label="Descendre">↓</button>
          {isMaster && (
            <button
              type="button"
              onClick={() => confirm(`Supprimer le niveau ${level.number} ? Les niveaux suivants remontent d'un cran.`) && run("Niveau supprimé.", () => deleteLevelAction(level.id))}
              className={btn.smDanger}
            >
              Supprimer
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
