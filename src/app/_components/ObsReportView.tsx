"use client";

import { useMemo, useState } from "react";
import { OBS_STAFF_TARGET, obsCsv, type ObsReport, type ReportObs } from "@/lib/observation-types";
import { btn, cx, ui } from "@/lib/ui";

// Compte rendu des arbitres du WOD Eval (Sartay 04/10) : par eleve observe, chaque serie de reps avec son heure, et la
// concordance avec les clics du greffier (✓ l'equipe etait bien a cette station a cette heure ; ✗ sinon, avec l'endroit
// ou le greffier la situait). En tete : fiabilite de chaque arbitre, et l'avancement des profs (3 exercices par eleve).
export function ObsReportView({ report }: { report: ObsReport }) {
  const [who, setWho] = useState<"all" | "STUDENT" | "STAFF">("all");
  const [offOnly, setOffOnly] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(
    () =>
      report.observations.filter(
        (o) =>
          (who === "all" || o.mode === who) &&
          (!offOnly || o.groups.some((g) => g.entries.some((e) => e.match === "off"))) &&
          (!q.trim() || `${o.targetName} ${o.teamName} ${o.evaluatorName} ${o.className ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
      ),
    [report, who, offOnly, q]
  );
  const byStudent = useMemo(() => {
    const m = new Map<string, ReportObs[]>();
    for (const o of shown) m.set(o.targetId, [...(m.get(o.targetId) ?? []), o]);
    return [...m.values()];
  }, [shown]);
  const staffDone = report.students.filter((s) => s.staffExercises >= OBS_STAFF_TARGET).length;
  const totalEntries = report.referees.reduce((n, r) => n + r.entries, 0);
  const totalOff = report.referees.reduce((n, r) => n + r.off, 0);

  function exportCsv() {
    const blob = new Blob([obsCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "arbitres_eval.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const pill = (on: boolean) => cx(ui.pill, on ? ui.pillOn : ui.pillOff);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className={ui.cardPad}><p className={ui.eyebrow}>Observations</p><p className="font-display text-3xl font-extrabold">{report.observations.length}</p><p className={ui.hint}>{report.students.filter((s) => s.observations > 0).length}/{report.students.length} élèves observés</p></div>
        <div className={ui.cardPad}><p className={ui.eyebrow}>Séries horodatées</p><p className="font-display text-3xl font-extrabold">{totalEntries}</p><p className={ui.hint}>chaque série garde son heure</p></div>
        <div className={ui.cardPad}><p className={ui.eyebrow}>Hors concordance</p><p className={cx("font-display text-3xl font-extrabold", totalOff ? "text-danger" : "text-success")}>{totalOff}</p><p className={ui.hint}>série notée à une station où le greffier ne situait pas l&apos;équipe (± {report.toleranceS} s)</p></div>
        <div className={ui.cardPad}><p className={ui.eyebrow}>Profs · objectif {OBS_STAFF_TARGET} exos</p><p className="font-display text-3xl font-extrabold">{staffDone}<span className="text-lg text-ink-3"> / {report.students.length}</span></p><p className={ui.hint}>élèves évalués par un prof sur {OBS_STAFF_TARGET} exercices différents</p></div>
      </div>

      {report.referees.length > 0 && (
        <section className={ui.cardPad}>
          <h3 className={`${ui.h3} mb-2`}>Arbitres · concordance avec les clics du greffier</h3>
          <div className="overflow-auto">
            <table className="w-full text-[13px] border-collapse whitespace-nowrap">
              <thead><tr><th className={ui.th}>Arbitre</th><th className={ui.th}>Type</th><th className={`${ui.th} text-right`}>Observations</th><th className={`${ui.th} text-right`}>Séries</th><th className={`${ui.th} text-right`}>Concordent</th><th className={`${ui.th} text-right`}>Ne concordent pas</th></tr></thead>
              <tbody>
                {report.referees.map((r) => {
                  const checked = r.matched + r.off;
                  return (
                    <tr key={r.id} className={`${ui.tr} text-right tabular-nums`}>
                      <td className="p-2 text-left font-bold">{r.name}</td>
                      <td className="p-2 text-left">{r.mode === "STAFF" ? "prof" : "élève"}</td>
                      <td className="p-2">{r.observations}</td>
                      <td className="p-2">{r.entries}</td>
                      <td className="p-2 text-success-ink font-bold">{checked ? `${r.matched} (${Math.round((r.matched / checked) * 100)} %)` : "—"}</td>
                      <td className={cx("p-2 font-bold", r.off ? "text-danger-ink" : "text-ink-3")}>{r.off}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setWho("all")} className={pill(who === "all")}>Tous</button>
        <button onClick={() => setWho("STUDENT")} className={pill(who === "STUDENT")}>Arbitres élèves</button>
        <button onClick={() => setWho("STAFF")} className={pill(who === "STAFF")}>Profs</button>
        <label className="flex items-center gap-1.5 text-xs font-semibold ml-2"><input type="checkbox" checked={offOnly} onChange={(e) => setOffOnly(e.target.checked)} className={ui.check} /> seulement ce qui ne concorde pas</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Élève, équipe, arbitre…" className={`${ui.input} w-52 py-1.5 text-sm ml-auto`} />
        <button onClick={exportCsv} className={btn.smGhost}>⬇ Excel</button>
      </div>

      {byStudent.length === 0 && <p className={`${ui.cardPad} ${ui.muted}`}>Aucune observation{report.observations.length ? " avec ces filtres" : " pour l'instant : les arbitres apparaissent ici dès leur première série"}.</p>}
      <div className="space-y-2">
        {byStudent.map((list) => (
          <section key={list[0].targetId} className={ui.cardPad}>
            <h3 className="font-display font-extrabold text-lg leading-tight">{list[0].targetName} <span className="text-ink-3 font-sans text-sm font-semibold">· {list[0].teamName}{list[0].className ? ` · ${list[0].className}` : ""}</span></h3>
            <div className="mt-2 space-y-2">
              {list.map((o) => (
                <div key={o.id} className={`${ui.inset} p-2.5`}>
                  <p className="text-xs font-bold text-ink-2 mb-1">
                    <span className={cx(ui.chip, o.mode === "STAFF" ? ui.chipBrand : ui.chipSea, "mr-1.5")}>{o.mode === "STAFF" ? "prof" : "élève"}</span>
                    {o.evaluatorName} · début {o.clock}
                  </p>
                  {o.groups.length === 0 && <p className={ui.hint}>Rien de noté pendant cette observation.</p>}
                  <ul className="space-y-1.5">
                    {o.groups.map((g) => (
                      <li key={g.exerciseId} className="text-sm">
                        <span className="font-bold">{g.label}</span>
                        <span className="text-ink-2"> · {g.total} reps</span>
                        {g.app && <span className={cx(ui.chip, ui.chipMuted, "ml-1.5")} title={g.app.unmet.length ? `Non vus : ${g.app.unmet.join(" | ")}` : "Tous les critères vus"}>{g.app.code ?? "?"} · {g.app.met}/{g.app.total} critères</span>}
                        {!g.app && <span className={cx(ui.chip, ui.chipWarn, "ml-1.5")}>sans appréciation</span>}
                        <span className="flex flex-wrap gap-1.5 mt-1">
                          {g.entries.map((e) => (
                            <span
                              key={e.id}
                              title={e.voided ? "Série annulée par l'arbitre" : e.match === "ok" ? "Concorde avec les clics du greffier" : e.match === "off" ? `Ne concorde pas : le greffier situait l'équipe ${e.where ? `à « ${e.where} »` : "ailleurs"}` : "Non vérifiable (course pas lancée)"}
                              className={cx("rounded-lg border px-1.5 py-0.5 text-[12px] tabular-nums", e.voided ? "border-line text-ink-3 line-through" : e.match === "off" ? "border-danger/60 bg-danger-soft text-danger-ink" : e.match === "ok" ? "border-success/50 bg-success-soft" : "border-line bg-card")}
                            >
                              <b>{e.reps}</b> · {e.clock}{e.raceAt ? ` (${e.raceAt})` : ""} {e.voided ? "" : e.match === "ok" ? "✓" : e.match === "off" ? `✗${e.where ? ` ${e.where}` : ""}` : ""}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
