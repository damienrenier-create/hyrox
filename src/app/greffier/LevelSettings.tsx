"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTeamCountAction } from "./settings-actions";
import { resetLevelAction, setLevelCapAction, setLevelRefereeModeAction, setTeamStarsAction, setZombiesAction } from "./level-actions";
import { STARS, starsLabel, starsName, teamStarsOf, type FrozenLevel, type Stars } from "@/lib/wod-engines/templates/level-engine";
import { btn, cx, ui } from "@/lib/ui";

// Onglet Reglages du greffier Level : nombre d'equipes (avant le depart), temps impose (avant ou pendant),
// activite des dispenses (demineur), et les raccourcis vers l'atelier et les fiches a imprimer.
export function LevelSettings({ sessionId, phase, numTeams, capMin, refereeMode, levelsCount, frozen, zombies = true, teamList = [], teamStars = {}, ladders = {}, isChild = false, onChanged }: {
  sessionId: string;
  zombies?: boolean;
  teamList?: { id: string; name: string; order: number }[];
  teamStars?: Record<string, Stars>;
  ladders?: Partial<Record<Stars, FrozenLevel[]>>;
  isChild?: boolean;
  onChanged?: () => void;
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

      {!isChild && (
        <section className={ui.cardPad}>
          <h3 className={ui.h3}>Parcours des équipes</h3>
          <p className={`${ui.hint} mb-2`}>Trois parcours joués en même temps : ★☆☆ découverte (peu de force et de technique), ★★☆ équilibré, ★★★ force et cardio. Chaque équipe a son classement dans son parcours. Modifiable tant que l&apos;équipe n&apos;a rien coché.{STARS.filter((st) => st !== 2 && !ladders[st]).length > 0 && <> ⚠️ {STARS.filter((st) => st !== 2 && !ladders[st]).map((st) => starsName(st)).join(" et ")} : pas d&apos;échelle {frozen ? "figée dans cette séance" : "dans l'atelier"}, ces équipes joueraient le 2 étoiles.</>}</p>
          {teamList.length === 0 ? <p className={ui.hint}>Pas encore d&apos;équipe.</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {teamList.map((t) => {
                const cur = teamStarsOf(teamStars, t.id);
                return (
                  <div key={t.id} className={`${ui.inset} px-2 py-1.5 flex items-center gap-2`}>
                    <span className="font-bold text-sm flex-1 truncate">{t.name}</span>
                    <div className={`${ui.segmented} inline-flex`}>
                      {STARS.map((st) => (
                        <button key={st} type="button" disabled={pending || cur === st} onClick={() => run(`${t.name} : parcours ${starsName(st)}.`, async () => { const r = await setTeamStarsAction(sessionId, t.id, st); if (!("error" in r)) onChanged?.(); return r; })} className={cx("px-2 py-1 rounded-lg text-xs font-bold", cur === st ? ui.segOn : ui.segOff)} title={starsName(st)}>
                          {starsLabel(st)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

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
        <h3 className={ui.h3}>Mode zombies</h3>
        <p className={`${ui.hint} mb-2`}>Sur chaque niveau, un zombie atteint la première fiche en 1 min puis traverse les fiches au rythme « durée du niveau + marge » (+3 min au niveau 1, −2 min au niveau 20, et elle continue de fondre jusqu'au 25). Chaque fiche cochée éloigne le cœur, une carte jaune le rapproche. Au contact, le zombie mange le cœur en trois bouchées (30 s au palier 1, 10 s à partir du palier 20) : cœur dévoré = une vie perdue et retour au niveau précédent, et le zombie descend de trois paliers. Le classement compte les niveaux, puis les vies perdues. Le zombie se fige au temps imposé.</p>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <input type="checkbox" checked={zombies} disabled={pending} onChange={(e) => run(e.target.checked ? "Mode zombies activé." : "Mode zombies désactivé.", () => setZombiesAction(sessionId, e.target.checked))} className={ui.check} />
          🧟 Zombies (vies et retour au niveau précédent)
        </label>
      </section>

      <section className={ui.cardPad}>
        <h3 className={ui.h3}>Activité dispensés</h3>
        <p className={`${ui.hint} mb-2`}>Les élèves qui ne jouent pas arbitrent au démineur (élèves × exercices, mêmes bombes pour tous). Sans cette option, pas de bouton « Arbitrer ».</p>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <input type="checkbox" checked={refereeMode} disabled={pending} onChange={(e) => run(e.target.checked ? "Démineur activé." : "Démineur désactivé.", () => setLevelRefereeModeAction(sessionId, e.target.checked))} className={ui.check} />
          💣 Démineur pour les dispensés
        </label>
      </section>

      <section className={cx(ui.cardPad, "border-danger/50")}>
        <h3 className={cx(ui.h3, "text-danger-ink")}>Remettre le WOD à zéro</h3>
        <p className={`${ui.hint} mb-2`}>Efface le chrono, les fiches cochées, les cartes jaunes, le démineur et les évaluations. Les équipes, les arbitres et les réglages restent. L&apos;échelle est reprise de l&apos;atelier au prochain coup d&apos;envoi.</p>
        <button
          type="button"
          disabled={pending || phase === "pre"}
          onClick={() => confirm("Remettre ce WOD Level à zéro ? Chrono, coches, cartes jaunes, démineur et évaluations seront effacés. Il n'y a pas de retour en arrière.") && run("WOD remis à zéro.", () => resetLevelAction(sessionId))}
          className={btn.danger}
        >
          ↺ Remettre à zéro
        </button>
        {phase === "pre" && <p className={`${ui.hint} mt-1`}>Rien à remettre à zéro : le WOD n&apos;a pas démarré.</p>}
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
