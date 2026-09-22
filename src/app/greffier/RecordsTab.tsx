"use client";

import { useEffect, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { pyramideRecordsAction } from "./records-actions";
// Types uniquement : importer une valeur de `pyramide-records` embarquerait la base dans le paquet client.
import type { RecordsResult, TeamSex } from "@/lib/pyramide-records";
import { btn, cx, ui } from "@/lib/ui";

const SEXES: (TeamSex | "")[] = ["", "F", "M", "OPEN"];
const LABELS: Record<TeamSex | "", string> = {
  "": "Toutes les équipes",
  F: "Équipes de filles",
  M: "Équipes de gars",
  OPEN: "Équipes mixtes",
};

// Onglet « Records » : palmares du WOD Pyramide, toutes classes et toutes seances confondues.
// Le calcul part d'un appel explicite (et repart a chaque changement de filtre) : rien n'est charge
// tant que l'onglet n'est pas ouvert.
export function RecordsTab() {
  const [sex, setSex] = useState<TeamSex | "">("");
  const [grade, setGrade] = useState<number | null>(null);
  const [data, setData] = useState<RecordsResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => setData(await pyramideRecordsAction({ sex, grade })));
  }, [sex, grade]);

  const grades = data?.grades ?? [];

  return (
    <div className="space-y-4">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={ui.eyebrow}>Équipes</span>
          {SEXES.map((s) => (
            <button key={s || "all"} type="button" onClick={() => setSex(s)} className={cx(ui.pill, sex === s ? ui.pillOn : ui.pillOff)}>
              {LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={ui.eyebrow}>Année scolaire</span>
          <button type="button" onClick={() => setGrade(null)} className={cx(ui.pill, grade === null ? ui.pillOn : ui.pillOff)}>
            Toutes
          </button>
          {grades.map((g) => (
            <button key={g} type="button" onClick={() => setGrade(g)} className={cx(ui.pill, grade === g ? ui.pillOn : ui.pillOff)}>
              {g === 1 ? "1res" : `${g}es`}
            </button>
          ))}
        </div>
        <span className={ui.hint}>
          {pending
            ? "Calcul en cours…"
            : data
              ? `${data.teamsScanned} équipe(s) sur ${data.sessionsScanned} séance(s) Pyramide`
              : ""}
        </span>
      </div>

      {data && data.teamsScanned === 0 && !pending && (
        <p className={ui.alertInfo}>Aucune équipe ne correspond à ces filtres. Il faut une séance lancée, des équipes composées et au moins un tour validé.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {(data?.boards ?? []).map((b) => (
          <section key={b.id} className={`${ui.card} p-3`}>
            <h3 className="font-display font-extrabold text-sm text-ink leading-tight">{b.title}</h3>
            <p className={`${ui.hint} mb-2`}>{b.hint}</p>
            {b.rows.length === 0 ? (
              <p className={ui.hint}>Pas encore de record.</p>
            ) : (
              <ol className="space-y-1">
                {b.rows.map((r, i) => (
                  <motion.li
                    key={r.key}
                    layout
                    className={cx(
                      "flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-xs",
                      i === 0 ? "bg-accent-soft border border-accent/50" : "bg-paper border border-line"
                    )}
                  >
                    <span className={cx("font-display font-extrabold w-4 text-center", i === 0 ? "text-accent-ink" : "text-ink-3")}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-ink truncate">
                        {r.members.join(", ") || r.teamName}
                      </span>
                      <span className="block text-ink-3 text-[10px] truncate">
                        {r.classes || "sans classe"} · {r.sessionLabel} · {new Date(r.dateMs).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </span>
                    </span>
                    <span className="font-display font-extrabold text-ink tabular-nums whitespace-nowrap">{r.display}</span>
                  </motion.li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      {!data && pending && <p className={ui.muted}>Lecture de toutes les séances Pyramide…</p>}
      <button type="button" onClick={() => startTransition(async () => setData(await pyramideRecordsAction({ sex, grade })))} disabled={pending} className={btn.smGhost}>
        ↻ Recalculer
      </button>
    </div>
  );
}
