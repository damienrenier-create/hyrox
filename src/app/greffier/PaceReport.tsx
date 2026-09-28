"use client";

import { useEffect, useState } from "react";
import { paceReportAction } from "./level-actions";
import type { PaceFlag, PaceTeam } from "@/lib/level-pace";
import { formatLabel, starsLabel } from "@/lib/wod-engines/templates/level-engine";
import { fmt } from "@/lib/wod-engines/templates/pyramide-engine";
import { cx, ui } from "@/lib/ui";

// Rapport de rythme (fin de seance, Sartay 28/09) : chaque niveau boucle compare a la mediane des autres equipes
// (toutes seances) sur le meme niveau, parcours et format. Trop vite = moins de la moitie ; trop lent = plus du double.
export function PaceReport({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<{ flags: PaceFlag[]; teams: PaceTeam[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let off = false;
    void paceReportAction(sessionId).then((r) => { if (off) return; if ("error" in r) setError(r.error); else setData(r); });
    return () => { off = true; };
  }, [sessionId]);
  const pct = (ratio: number) => (ratio < 1 ? `${Math.round((1 - ratio) * 100)} % plus rapide` : `${Math.round((ratio - 1) * 100)} % plus lent`);
  return (
    <section className={`${ui.cardPad} mt-3`}>
      <h3 className={ui.h3}>⏱ Rythme des équipes</h3>
      <p className={`${ui.hint} mb-2`}>
        Chaque niveau bouclé est comparé au temps médian des autres équipes (toutes séances) sur le même niveau, le même parcours et le même format d&apos;équipe.
        Quand il y a moins de 3 autres passages, on prend le temps théorique multiplié par ce que les équipes mettent en pratique. <b>Trop vite</b> : moins de la
        moitié de la référence (reps sautées ?). <b>Trop lent</b> : plus du double (équipe en difficulté ?).
      </p>
      {error && <p className={ui.alertErr}>{error}</p>}
      {!data && !error && <p className={ui.muted}>Calcul…</p>}
      {data && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className={`${ui.card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead><tr><th className={ui.th}>Équipe</th><th className={`${ui.th} text-right`}>Niveaux</th><th className={ui.th}>Rythme moyen</th><th className={`${ui.th} text-right`}>🐇</th><th className={`${ui.th} text-right`}>🐢</th></tr></thead>
              <tbody>
                {data.teams.map((t) => (
                  <tr key={t.teamId} className={ui.tr}>
                    <td className="p-2 font-bold">{t.teamName} <span className="text-[10px] text-accent-ink">{starsLabel(t.stars)}{t.format !== "big" ? ` · ${formatLabel(t.format)}` : ""}</span></td>
                    <td className="p-2 text-right tabular-nums">{t.levels}</td>
                    <td className={cx("p-2", t.ratio < 0.7 ? "text-danger-ink font-bold" : t.ratio > 1.5 ? "text-warn-ink font-bold" : "text-ink-2")}>{pct(t.ratio)}</td>
                    <td className="p-2 text-right tabular-nums">{t.fast || ""}</td>
                    <td className="p-2 text-right tabular-nums">{t.slow || ""}</td>
                  </tr>
                ))}
                {data.teams.length === 0 && <tr><td colSpan={5} className={`p-3 ${ui.muted}`}>Aucun niveau bouclé.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className={`${ui.card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead><tr><th className={ui.th}></th><th className={ui.th}>Équipe</th><th className={ui.th}>Niveau</th><th className={`${ui.th} text-right`}>Temps</th><th className={`${ui.th} text-right`}>Référence</th></tr></thead>
              <tbody>
                {data.flags.map((f, i) => (
                  <tr key={`${f.teamId}_${f.level}_${i}`} className={ui.tr}>
                    <td className="p-2">{f.kind === "fast" ? "🐇" : "🐢"}</td>
                    <td className="p-2 font-bold">{f.teamName}</td>
                    <td className="p-2">{f.boss ? "BOSS" : "Niv."} {f.level}</td>
                    <td className={cx("p-2 text-right tabular-nums font-bold", f.kind === "fast" ? "text-danger-ink" : "text-warn-ink")}>{fmt(f.durationMs)}</td>
                    <td className="p-2 text-right tabular-nums text-ink-2" title={f.basis === "moyenne" ? `Médiane de ${f.n} autres passages` : "Temps théorique × facteur observé"}>{fmt(f.referenceMs)}{f.basis === "théorie" ? " *" : ""}</td>
                  </tr>
                ))}
                {data.flags.length === 0 && <tr><td colSpan={5} className={`p-3 ${ui.muted}`}>Aucun niveau anormalement rapide ou lent.</td></tr>}
              </tbody>
            </table>
            {data.flags.some((f) => f.basis === "théorie") && <p className={`${ui.hint} p-2`}>* pas encore assez de passages sur ce niveau : référence théorique.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
