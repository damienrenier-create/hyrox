"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTeamCountAction } from "./settings-actions";
import { setLevelCapAction, setLevelRefereeModeAction } from "./level-actions";
import { btn, cx, ui } from "@/lib/ui";

// Onglet Reglages du greffier Level : nombre d'equipes (avant le depart), temps impose (avant ou pendant),
// activite des dispenses (demineur), et les raccourcis vers l'atelier et les fiches a imprimer.
export function LevelSettings({ sessionId, phase, numTeams, capMin, refereeMode, levelsCount, frozen }: {
  sessionId: string;
  phase: "pre" | "run" | "post";
  numTeams: number;
  capMin: number | null;
  refereeMode: boolean;
  levelsCount: number;
  frozen: boolean;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState(String(numTeams));
  const [cap, setCap] = useState(capMin !== null ? String(capMin) : "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (label: string, fn: () => Promise<{ error: string } | { ok: true }>) =>
    startTransition(async () => {
      const r = await fn();
      setMsg("error" in r ? { kind: "err", text: r.error } : { kind: "ok", text: label });
      if (!("error" in r)) router.refresh();
    });

  return (
    <div className="space-y-3 max-w-2xl">
      {msg && <p className={msg.kind === "ok" ? ui.alertOk : ui.alertErr}>{msg.text}</p>}

      <section className={ui.cardPad}>
        <h3 className={ui.h3}>Équipes</h3>
        <p className={`${ui.hint} mb-2`}>De 1 à 6 élèves par équipe, 5 conseillés. Le nombre d&apos;équipes se règle avant le départ ; ensuite, l&apos;onglet « Équipes &amp; arbitres » permet encore de supprimer une équipe vide.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={ui.label}>Nombre d&apos;équipes</span>
            <input type="number" min={1} max={50} value={teams} onChange={(e) => setTeams(e.target.value)} disabled={phase !== "pre"} className={`${ui.input} w-28 tabular-nums`} />
          </label>
          <button type="button" disabled={pending || phase !== "pre" || Number(teams) === numTeams} onClick={() => run("Nombre d'équipes mis à jour.", () => setTeamCountAction(sessionId, Math.max(1, Math.min(50, Math.round(Number(teams) || 1)))))} className={btn.primary}>
            Appliquer
          </button>
          {phase !== "pre" && <span className={ui.hint}>verrouillé : la course est lancée</span>}
        </div>
      </section>

      <section className={ui.cardPad}>
        <h3 className={ui.h3}>Temps imposé</h3>
        <p className={`${ui.hint} mb-2`}>En minutes de chrono (les pauses ne comptent pas). Vide = temps libre. Au bout, les coches sont refusées et tu déclares la fin du WOD. Modifiable avant ou pendant.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={ui.label}>Minutes</span>
            <input type="number" min={1} max={180} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="libre" disabled={phase === "post"} className={`${ui.input} w-28 tabular-nums`} />
          </label>
          <button type="button" disabled={pending || phase === "post"} onClick={() => run(cap.trim() ? `Temps imposé : ${cap} min.` : "Temps libre.", () => setLevelCapAction(sessionId, cap.trim() ? Number(cap.replace(",", ".")) : null))} className={btn.primary}>
            Appliquer
          </button>
          {capMin !== null && <button type="button" disabled={pending || phase === "post"} onClick={() => { setCap(""); run("Temps libre.", () => setLevelCapAction(sessionId, null)); }} className={btn.ghost}>Temps libre</button>}
        </div>
      </section>

      <section className={ui.cardPad}>
        <h3 className={ui.h3}>Activité dispensés</h3>
        <p className={`${ui.hint} mb-2`}>Les élèves qui ne jouent pas arbitrent au démineur (élèves × exercices, mêmes bombes pour tous). Sans cette option, pas de bouton « Arbitrer ».</p>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <input type="checkbox" checked={refereeMode} disabled={pending} onChange={(e) => run(e.target.checked ? "Démineur activé." : "Démineur désactivé.", () => setLevelRefereeModeAction(sessionId, e.target.checked))} className={ui.check} />
          💣 Démineur pour les dispensés
        </label>
      </section>

      <section className={ui.cardPad}>
        <h3 className={ui.h3}>Échelle</h3>
        <p className={`${ui.hint} mb-2`}>{levelsCount} niveau{levelsCount > 1 ? "x" : ""} · {frozen ? "figée dans cette séance (retouches dans l'onglet Échelle)" : "échelle commune, figée au coup d'envoi"}.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/admin/level" className={cx(btn.ghost)}>🧗 Atelier Level</a>
          <a href={frozen ? `/admin/level/fiches?session=${sessionId}` : "/admin/level/fiches"} target="_blank" className={btn.ghost}>🖨️ Fiches à imprimer</a>
        </div>
      </section>
    </div>
  );
}
