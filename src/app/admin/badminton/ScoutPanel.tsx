"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COURTS, SCOUT_LAYERS, type ScoutConfig } from "@/lib/badminton-scout";
import { setScoutConfigAction, setScoutLevelAction, setScoutUnlockAction } from "@/app/eleve/badminton-actions";
import { cx, ui } from "@/lib/ui";

// Scouting de la seance, cote prof (Sartay 24/11 ; VERROU 26/11 : « des options que le prof deverrouille ou pas au cours,
// pour tout le monde ou pour certains eleves en cliquant sur leur profil ») : verrouille par defaut, deverrouille pour toute
// la classe ou eleve par eleve (pour ce cours) ; sur quel terrain, avec quelles couches ; et des couches en plus (ou en
// moins) pour certains eleves (« plus dispo, competents, forts »), qui les suivent dans leurs seances suivantes.
export type ScoutStudentRow = { id: string; name: string; className: string | null; own: number | null };
export function ScoutPanel({ sessionId, config, students }: { sessionId: string; config: ScoutConfig; students: ScoutStudentRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<{ error: string } | { ok: true } | object>) => {
    setError("");
    start(async () => {
      const r = await fn();
      if ("error" in r) setError((r as { error: string }).error);
      else router.refresh();
    });
  };
  const seg = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg whitespace-nowrap", on ? ui.segOn : ui.segOff);
  const custom = students.filter((s) => s.own !== null).length;
  const unlocked = students.filter((s) => config.unlocked.includes(s.id));
  const anyOpen = config.on || unlocked.length > 0;
  const lock = config.on ? "déverrouillé pour toute la classe" : unlocked.length ? `déverrouillé pour ${unlocked.length} élève${unlocked.length > 1 ? "s" : ""}` : "verrouillé";
  return (
    <details className={cx(ui.cardPad, anyOpen && "border-accent")}>
      <summary className="cursor-pointer font-bold">🔭 Scouting : {lock}{anyOpen ? ` · ${COURTS.find((c) => c.id === config.court)?.name.toLowerCase()} · couche ${config.level}${custom ? ` (${custom} élève${custom > 1 ? "s" : ""} à part)` : ""}` : ""}</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className={ui.hint}>Verrouillé par défaut. Un élève déverrouillé note l&apos;impact du volant quand il arbitre en direct, et peut « 🔭 Scouter un joueur » (fiche technique des 6 coups). Pour ce cours seulement.</p>
        <label className="flex items-center gap-2 font-bold"><input type="checkbox" className={ui.check} checked={config.on} disabled={pending} onChange={(e) => run(() => setScoutConfigAction(sessionId, { on: e.target.checked }))} /> 🔓 Déverrouiller pour toute la classe</label>
        {!config.on && (
          <div>
            <span className={ui.label}>Déverrouillé pour certains élèves</span>
            {unlocked.length === 0 ? <p className={ui.hint}>Personne pour l&apos;instant.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {unlocked.map((s) => <button key={s.id} type="button" disabled={pending} onClick={() => run(() => setScoutUnlockAction(sessionId, s.id, false))} className={cx(ui.chip, ui.chipBrand, "py-1")} title="Reverrouiller">🔓 {s.name} ✕</button>)}
              </div>
            )}
            <p className={`${ui.hint} mt-1`}>Touchez le nom d&apos;un élève n&apos;importe où sur cette page (matchs, élèves, tournoi…) puis « 🔓 Déverrouiller le scouting », ou cochez-le dans la liste « Élève par élève » ci-dessous.</p>
          </div>
        )}
        <div>
          <span className={ui.label}>Terrain dessiné</span>
          <div className={cx(ui.segmented, "flex-wrap")}>{COURTS.map((c) => <button key={c.id} type="button" disabled={pending} onClick={() => run(() => setScoutConfigAction(sessionId, { court: c.id }))} className={seg(config.court === c.id)}>{c.name}</button>)}</div>
        </div>
        <div>
          <span className={ui.label}>Couches de la classe (les élèves en ajoutent petit à petit)</span>
          <div className={cx(ui.segmented, "flex-wrap")}>{SCOUT_LAYERS.map((l) => <button key={l.level} type="button" disabled={pending} onClick={() => run(() => setScoutConfigAction(sessionId, { level: l.level }))} className={seg(config.level === l.level)}>{l.level}. {l.name}</button>)}</div>
          <ul className="mt-1 space-y-0.5">{SCOUT_LAYERS.map((l) => <li key={l.level} className={ui.hint}>{l.level}. {l.name} : {l.hint}</li>)}</ul>
        </div>
        <details>
          <summary className="cursor-pointer font-bold">Élève par élève : déverrouiller, couches{custom ? ` · ${custom} réglage${custom > 1 ? "s" : ""} particulier${custom > 1 ? "s" : ""}` : ""}</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {students.map((s) => {
              const open = config.on || config.unlocked.includes(s.id);
              return (
                <div key={s.id} className={cx("flex items-center justify-between gap-2 rounded-lg px-2 py-1", open ? "bg-accent-soft/50" : "bg-paper")}>
                  <label className="flex items-center gap-1.5 min-w-0">
                    <input type="checkbox" className={ui.check} checked={open} disabled={pending || config.on} onChange={(e) => run(() => setScoutUnlockAction(sessionId, s.id, e.target.checked))} aria-label={`Déverrouiller le scouting de ${s.name}`} />
                    <span className="truncate">{s.name} <span className="text-ink-3 text-xs">{s.className}</span></span>
                  </label>
                  <select value={s.own ?? 0} disabled={pending} onChange={(e) => run(() => setScoutLevelAction(sessionId, s.id, Number(e.target.value)))} className="text-xs rounded border border-line px-1 py-0.5" aria-label={`Couches de ${s.name}`}>
                    <option value={0}>comme la classe ({config.level})</option>
                    {SCOUT_LAYERS.map((l) => <option key={l.level} value={l.level}>couche {l.level}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p className={`${ui.hint} mt-1`}>Le déverrouillage vaut pour ce cours. Les couches d&apos;un élève le suivent dans ses séances suivantes, jusqu&apos;à ce que vous les changiez.</p>
        </details>
        {error && <p className={ui.alertErr}>{error}</p>}
        <p className={ui.hint}>Les profs qui arbitrent en direct ont toutes les couches dès que le scouting est déverrouillé pour quelqu&apos;un. Les impacts et les fiches techniques s&apos;affichent sur la fiche de chaque élève et dans l&apos;onglet 🔭 Scouting ; l&apos;élève reçoit son analyse après son auto-évaluation.</p>
      </div>
    </details>
  );
}
