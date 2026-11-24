"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COURTS, SCOUT_LAYERS, type ScoutConfig } from "@/lib/badminton-scout";
import { setScoutConfigAction, setScoutLevelAction } from "@/app/eleve/badminton-actions";
import { cx, ui } from "@/lib/ui";

// Scouting de la seance, cote prof (Sartay 24/11) : les arbitres en direct notent l'impact du volant ou pas, sur quel
// terrain, avec quelles couches ; et des couches en plus (ou en moins) pour certains eleves (« plus dispo, competents,
// forts »). Le reglage d'un eleve le suit dans ses seances suivantes.
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
  return (
    <details className={cx(ui.cardPad, config.on && "border-accent")}>
      <summary className="cursor-pointer font-bold">🔭 Scouting : {config.on ? `impacts notés · ${COURTS.find((c) => c.id === config.court)?.name.toLowerCase()} · couche ${config.level}${custom ? ` (${custom} élève${custom > 1 ? "s" : ""} à part)` : ""}` : "pas d'impacts notés"}</summary>
      <div className="mt-3 space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className={ui.check} checked={config.on} disabled={pending} onChange={(e) => run(() => setScoutConfigAction(sessionId, { on: e.target.checked }))} /> Les arbitres en direct notent l&apos;impact du volant à chaque fin d&apos;échange</label>
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
          <summary className="cursor-pointer font-bold">Couches par élève{custom ? ` · ${custom} réglage${custom > 1 ? "s" : ""} particulier${custom > 1 ? "s" : ""}` : ""}</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {students.map((s) => (
              <label key={s.id} className={cx("flex items-center justify-between gap-2 rounded-lg px-2 py-1", s.own !== null ? "bg-accent-soft/50" : "bg-paper")}>
                <span className="truncate">{s.name} <span className="text-ink-3 text-xs">{s.className}</span></span>
                <select value={s.own ?? 0} disabled={pending} onChange={(e) => run(() => setScoutLevelAction(sessionId, s.id, Number(e.target.value)))} className="text-xs rounded border border-line px-1 py-0.5" aria-label={`Couches de ${s.name}`}>
                  <option value={0}>comme la classe ({config.level})</option>
                  {SCOUT_LAYERS.map((l) => <option key={l.level} value={l.level}>couche {l.level}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className={`${ui.hint} mt-1`}>Le réglage d&apos;un élève le suit dans ses séances suivantes, jusqu&apos;à ce que vous le changiez.</p>
        </details>
        {error && <p className={ui.alertErr}>{error}</p>}
        <p className={ui.hint}>Les profs qui arbitrent en direct ont toutes les couches. Les impacts et les fiches techniques des scouts s&apos;affichent sur la fiche de chaque élève (« Où il gagne et perd ses points ») et dans son onglet Classement.</p>
      </div>
    </details>
  );
}
