"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { excludeFromRecordsAction, levelRecordsAction, pyramideRecordsAction, restoreToRecordsAction } from "./records-actions";
// Types uniquement : importer une valeur de `pyramide-records` embarquerait la base dans le paquet client.
import type { RecordEntry, RecordPeriod, RecordPhase, RecordsResult, TeamSex } from "@/lib/pyramide-records";
import { btn, cx, ui } from "@/lib/ui";

const SEXES: (TeamSex | "")[] = ["", "F", "M", "OPEN"];
const LABELS: Record<TeamSex | "", string> = {
  "": "Toutes les équipes",
  F: "Équipes de filles",
  M: "Équipes de gars",
  OPEN: "Équipes mixtes",
};
const PERIODS: RecordPeriod[] = ["session", "day", "week", "all"];
const PERIOD_LABELS: Record<RecordPeriod, string> = { session: "Cette séance", day: "Aujourd'hui", week: "Cette semaine", all: "Depuis toujours" };
const PHASES: RecordPhase[] = ["warmup", "wod", "finisher"];
const PHASE_LABELS: Record<RecordPhase, string> = { warmup: "🔥 Échauffement", wod: "🧗 WOD", finisher: "🪢 Finisher" };
const day = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "2-digit" });

// Onglet « Records » : palmares du WOD Pyramide, toutes classes et toutes seances confondues.
// Le calcul part d'un appel explicite (et repart a chaque changement de filtre) : rien n'est charge
// tant que l'onglet n'est pas ouvert. DAMZER peut ecarter une equipe du palmares (greffier qui a
// tape trop vite ou trop tard) sans rien effacer de ce que les eleves ont fait, et la retablir.
export function RecordsTab({ isMaster = false, sessionId = null, wod = "pyramide" }: { isMaster?: boolean; sessionId?: string | null; wod?: "pyramide" | "level" }) {
  const fetchRecords = wod === "level" ? levelRecordsAction : pyramideRecordsAction;
  const wodName = wod === "level" ? "Level" : "Pyramide";
  const [sex, setSex] = useState<TeamSex | "">("");
  const [grade, setGrade] = useState<number | null>(null);
  const [period, setPeriod] = useState<RecordPeriod>("all");
  const [phase, setPhase] = useState<RecordPhase>("wod");
  const filters = useMemo(() => ({ sex, grade, period, sessionId, ...(wod === "level" ? { phase } : {}) }), [sex, grade, period, sessionId, phase, wod]);
  const [data, setData] = useState<RecordsResult | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const reload = useCallback(() => {
    startTransition(async () => setData(await fetchRecords(filters)));
  }, [filters, fetchRecords]);
  useEffect(() => reload(), [reload]);

  function invalidate(e: RecordEntry) {
    if (!confirm(`Écarter « ${e.teamName} » (${e.members.join(", ")}) des records ?\nSes tours et ses résultats restent intacts, seul le palmarès l'ignore. Tu pourras la rétablir.`)) return;
    setError("");
    startTransition(async () => {
      const res = await excludeFromRecordsAction(e.sessionId, e.teamId);
      if ("error" in res) setError(res.error);
      else setData(await fetchRecords(filters));
    });
  }
  function restore(e: RecordEntry) {
    setError("");
    startTransition(async () => {
      const res = await restoreToRecordsAction(e.sessionId, e.teamId);
      if ("error" in res) setError(res.error);
      else setData(await fetchRecords(filters));
    });
  }

  const grades = data?.grades ?? [];

  return (
    <div className="space-y-4">
      <div className={`${ui.cardPad} flex flex-wrap items-center gap-4`}>
        {wod === "level" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={ui.eyebrow}>Phase</span>
            {PHASES.map((p) => (
              <button key={p} type="button" onClick={() => setPhase(p)} className={cx(ui.pill, phase === p ? ui.pillOn : ui.pillOff)}>
                {PHASE_LABELS[p]}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className={ui.eyebrow}>Période</span>
          {PERIODS.filter((p) => p !== "session" || sessionId).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} className={cx(ui.pill, period === p ? ui.pillOn : ui.pillOff)}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
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
          {pending ? "Calcul en cours…" : data ? `${data.teamsScanned} équipe(s) sur ${data.sessionsScanned} séance(s) ${wodName}` : ""}
        </span>
      </div>

      {error && <p className={ui.alertErr}>{error}</p>}
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
                      <span className="block font-bold text-ink truncate">{r.members.join(", ") || r.teamName}</span>
                      <span className="block text-ink-3 text-[10px] truncate">
                        {r.classes || "sans classe"} · {r.sessionLabel} · {day(r.dateMs)}
                      </span>
                    </span>
                    {r.bk && <span className="inline-flex items-center rounded px-1 text-[9px] font-black leading-4 bg-ink text-white" title="BK · une pause du chrono est tombée entre 20 et 80 % du WOD de cette équipe">BK</span>}
                    <span className="font-display font-extrabold text-ink tabular-nums whitespace-nowrap">{r.display}</span>
                    {isMaster && (
                      <button
                        type="button"
                        onClick={() => invalidate(r)}
                        disabled={pending}
                        title="Écarter ce record (chrono faussé par le greffier), sans rien effacer"
                        aria-label="Écarter ce record"
                        className="w-5 h-5 rounded-full text-ink-3 hover:bg-danger-soft hover:text-danger-ink font-bold leading-none flex items-center justify-center flex-shrink-0"
                      >
                        ✕
                      </button>
                    )}
                  </motion.li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      {/* Equipes ecartees : visibles pour pouvoir revenir dessus, jamais perdues. */}
      {data && data.excluded.length > 0 && (
        <section className={`${ui.cardPad} border-warn/50`}>
          <h3 className={`${ui.h3} mb-1`}>Écartées des records ({data.excluded.length})</h3>
          <p className={`${ui.hint} mb-2`}>
            Leurs tours, leurs temps et leurs résultats sont intacts partout ailleurs : seul le palmarès les ignore.
          </p>
          <ul className="space-y-1">
            {data.excluded.map((e) => (
              <li key={e.key} className={`${ui.inset} px-3 py-1.5 flex flex-wrap items-center gap-2 text-xs`}>
                <span className="min-w-0 flex-1">
                  <b className="text-ink">{e.members.join(", ") || e.teamName}</b>
                  <span className="text-ink-3"> · {e.teamName} · {e.classes || "sans classe"} · {e.sessionLabel} · {day(e.dateMs)} · {e.display}{e.bk ? " · BK" : ""}</span>
                </span>
                {isMaster && (
                  <button type="button" onClick={() => restore(e)} disabled={pending} className={btn.smGhost}>
                    Rétablir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!data && pending && <p className={ui.muted}>Lecture de toutes les séances {wodName}…</p>}
      <button type="button" onClick={reload} disabled={pending} className={btn.smGhost}>
        ↻ Recalculer
      </button>
    </div>
  );
}
