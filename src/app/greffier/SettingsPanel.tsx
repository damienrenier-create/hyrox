"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { total, pyramid, type RaceSettings } from "@/lib/wod-engines/templates/pyramide-engine";
import { setTeamCountAction, updateExercisesAction, updateRaceSettingsAction } from "./settings-actions";
import { btn, cx, ui } from "@/lib/ui";

type ExerciseRow = { id: string; label: string; number: number };

type Props = {
  sessionId: string;
  settings: RaceSettings;
  noStartExerciseIds: string[];
  exercises: ExerciseRow[]; // deja tries par number
  numTeams: number;
  onClose: () => void;
  hidePyramid?: boolean; // seances sans pyramide (Fete Foraine) : equipes + exercices seulement
};

// Reglages de la seance par le greffier, AVANT le depart (verrouilles ensuite cote serveur) :
// nombre d'equipes (crop de la carte), pyramide, temps, departs autorises, ordre/libelles des exercices.
export function SettingsPanel({ sessionId, settings, noStartExerciseIds, exercises: initialExercises, numTeams: initialTeams, onClose, hidePyramid = false }: Props) {
  const router = useRouter();
  const [teams, setTeams] = useState(initialTeams);
  const [s, setS] = useState<RaceSettings>(settings);
  const [noStart, setNoStart] = useState<Set<string>>(new Set(noStartExerciseIds));
  const [exercises, setExercises] = useState<ExerciseRow[]>(initialExercises.map((e) => ({ ...e })));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const num = (k: keyof RaceSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS((p) => ({ ...p, [k]: parseInt(e.target.value || "0", 10) }));
  const T = Number.isFinite(total(s)) ? total(s) : 0;
  const preview = (() => {
    try {
      return pyramid(s);
    } catch {
      return [] as number[];
    }
  })();

  function move(idx: number, dir: -1 | 1) {
    setExercises((list) => {
      const j = idx + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((e, i) => ({ ...e, number: i + 1 }));
    });
  }

  function save() {
    setError("");
    startTransition(async () => {
      if (teams !== initialTeams) {
        if (teams < initialTeams && !confirm(`Passer de ${initialTeams} à ${teams} équipes supprime les équipes ${teams + 1}→${initialTeams} et les flottes d'arbitres qui débordent. Continuer ?`)) return;
        const r = await setTeamCountAction(sessionId, teams);
        if ("error" in r) return setError(r.error);
      }
      if (!hidePyramid) {
        const r1 = await updateRaceSettingsAction(sessionId, { ...s, noStartExerciseIds: [...noStart] });
        if ("error" in r1) return setError(r1.error);
      }
      const r2 = await updateExercisesAction(sessionId, exercises.map((e, i) => ({ id: e.id, label: e.label, number: i + 1 })));
      if ("error" in r2) return setError(r2.error);
      router.refresh();
      onClose();
    });
  }

  const field = `${ui.input} text-base`;
  const small = ui.label;

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-2xl max-h-[90vh]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1">
          <h3 className={ui.h2}>⚙️ Réglages de la séance</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        <p className={`${ui.hint} mb-4`}>Modifiables jusqu&apos;au « Début de course », puis verrouillés.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <section>
            <h4 className={`${ui.h3} mb-2`}>Équipes</h4>
            <label className={small}>Nombre d&apos;équipes (1–50)</label>
            <input type="number" min={1} max={50} value={teams} onChange={(e) => setTeams(parseInt(e.target.value || "0", 10))} className={field} />
            {teams < initialTeams && <p className={`${ui.alertWarn} mt-2 text-[11px]`}>⚠️ La carte sera croppée : équipes {teams + 1}→{initialTeams} et flottes qui débordent supprimées.</p>}
          </section>

          {!hidePyramid && (<>
          <section>
            <h4 className={`${ui.h3} mb-2`}>Pyramide</h4>
            <div className="grid grid-cols-3 gap-2">
              <label className={small}>Départ<input type="number" min={1} value={s.rep0} onChange={num("rep0")} className={`${field} mt-1`} /></label>
              <label className={small}>Sommet<input type="number" min={1} value={s.peak} onChange={num("peak")} className={`${field} mt-1`} /></label>
              <label className={small}>Pas<input type="number" min={1} value={s.step} onChange={num("step")} className={`${field} mt-1`} /></label>
            </div>
            <p className={`${ui.hint} mt-1`}>
              {T} tours · {preview.slice(0, 20).join(" → ")}{preview.length > 20 ? " …" : ""}
            </p>
          </section>

          <section>
            <h4 className={`${ui.h3} mb-2`}>Temps (minutes)</h4>
            <div className="grid grid-cols-3 gap-2">
              <label className={small}>Durée max<input type="number" min={1} value={s.capMin} onChange={num("capMin")} className={`${field} mt-1`} /></label>
              <label className={small}>Après 1re arrivée<input type="number" min={0} value={s.afterMin} onChange={num("afterMin")} className={`${field} mt-1`} /></label>
              <label className={small}>Retrait / arrivée<input type="number" min={0} value={s.penMin} onChange={num("penMin")} className={`${field} mt-1`} /></label>
            </div>
          </section>

          <section>
            <h4 className={`${ui.h3} mb-2`}>Départs autorisés</h4>
            <div className="flex flex-wrap gap-1">
              {exercises.map((e) => {
                const on = !noStart.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setNoStart((prev) => { const n = new Set(prev); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}
                    className={cx(ui.pill, "text-[11px] px-2 py-1", on ? ui.pillOn : `${ui.pillOff} line-through text-ink-3`)}
                  >
                    {e.number}. {e.label}
                  </button>
                );
              })}
            </div>
          </section>
          </>)}

          <section className="sm:col-span-2">
            <h4 className={`${ui.h3} mb-2`}>Exercices (nom et ordre)</h4>
            <ul className="space-y-1">
              {exercises.map((e, i) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs font-black text-ink-3">{i + 1}.</span>
                  <input
                    value={e.label}
                    maxLength={40}
                    onChange={(ev) => setExercises((list) => list.map((x) => (x.id === e.id ? { ...x, label: ev.target.value } : x)))}
                    className={`${ui.input} flex-1 py-1.5`}
                  />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-8 h-8 rounded-lg bg-paper hover:bg-line font-black disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === exercises.length - 1} className="w-8 h-8 rounded-lg bg-paper hover:bg-line font-black disabled:opacity-30">↓</button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {error && <p className={`${ui.alertErr} mt-4`}>{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`${btn.lgGhost} flex-1`}>Annuler</button>
          <button onClick={save} disabled={pending} className={`${btn.lgPrimary} flex-[2]`}>{pending ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}
