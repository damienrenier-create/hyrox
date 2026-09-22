import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { buildConsultation, consultationCsv } from "@/lib/consultation";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { ExportCsvButton } from "./ExportCsvButton";
import { TopBar } from "../../_components/TopBar";
import { btn, ui } from "@/lib/ui";

type Params = { cycle?: string; session?: string; classe?: string; eleve?: string; from?: string; to?: string };

// Consultation des resultats (DAMZER + coachs) : filtres cycle / seance / classe / eleve / periode, export CSV.
export default async function ResultatsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const p = await searchParams;

  const cycles = await db.orm.public.Cycle.where({}).orderBy((c) => c.order.asc()).all();
  const sessions = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all();
  const allClasses = [...new Set((await db.orm.public.User.where({ role: "STUDENT" }).all()).map((u) => u.className).filter((c): c is string => !!c))].sort();

  const { rows, sessionsScanned } = await buildConsultation({
    cycleId: p.cycle || undefined,
    sessionId: p.session || undefined,
    className: p.classe || undefined,
    query: p.eleve || undefined,
    from: p.from || undefined,
    to: p.to || undefined,
  });
  const csv = consultationCsv(rows);
  const colorOf = (code: string | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";
  const input = ui.input;
  const label = "text-xs font-semibold text-ink-2";

  return (
    <div className={ui.page}>
      <TopBar
        title="Résultats"
        wide
        back={user.role === "MASTER_ADMIN" ? { href: "/admin", label: "Console" } : undefined}
        right={<ExportCsvButton csv={csv} filename={`hyrox-resultats-${new Date().toISOString().slice(0, 10)}.csv`} />}
      >
        <form className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 items-end">
          <label className={label}>Cycle
            <select name="cycle" defaultValue={p.cycle ?? ""} className={`${input} mt-1`}>
              <option value="">tous</option>
              {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className={`${label} col-span-2`}>Séance
            <select name="session" defaultValue={p.session ?? ""} className={`${input} mt-1`}>
              <option value="">toutes (15 dernières)</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}</option>)}
            </select>
          </label>
          <label className={label}>Classe
            <select name="classe" defaultValue={p.classe ?? ""} className={`${input} mt-1`}>
              <option value="">toutes</option>
              {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Élève
            <input name="eleve" defaultValue={p.eleve ?? ""} placeholder="nom ou prénom" className={`${input} mt-1`} />
          </label>
          <label className={label}>Du
            <input type="date" name="from" defaultValue={p.from ?? ""} className={`${input} mt-1`} />
          </label>
          <label className={label}>Au
            <input type="date" name="to" defaultValue={p.to ?? ""} className={`${input} mt-1`} />
          </label>
          <button type="submit" className={`${btn.primary} lg:col-span-7`}>Filtrer</button>
        </form>
      </TopBar>

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6">
        <p className={`${ui.hint} mb-2`}><b className="text-ink">{rows.length}</b> ligne(s) · {sessionsScanned} séance(s) parcourue(s). Une ligne = un élève × une séance (participant et/ou arbitre).</p>

        <div className={`${ui.card} overflow-x-auto`}>
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr>
                <th className={ui.th}>Date</th><th className={ui.th}>Séance</th><th className={ui.th}>Classe</th><th className={ui.th}>Élève</th><th className={ui.th}>Rôle</th>
                <th className={ui.th}>Équipe</th><th className={ui.th}>Rang</th><th className={ui.th}>Tours</th><th className={ui.th}>Temps</th><th className={ui.th}>Reps</th><th className={ui.th}>🟨</th>
                <th className={ui.th}>Arbitrages</th><th className={ui.th}>💥</th>
                {SELF_EVAL_CRITERIA.map((c) => <th key={c.id} className={`${ui.th} text-center`} title={c.label}>AE{SELF_EVAL_CRITERIA.indexOf(c) + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={13 + SELF_EVAL_CRITERIA.length} className="p-4 text-ink-3 italic">Aucune donnée pour ces filtres.</td></tr>}
              {rows.map((r) => (
                <tr key={`${r.sessionId}_${r.studentId}`} className={`${ui.tr} hover:bg-brand-soft/60`}>
                  <td className="p-2 text-ink-2">{new Date(r.sessionDate).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" })}</td>
                  <td className="p-2">{r.sessionLabel}{r.cycleName ? <span className="text-ink-3"> · {r.cycleName}</span> : null}</td>
                  <td className="p-2 text-ink-2">{r.className}</td>
                  <td className="p-2 font-bold">{r.lastName} {r.firstName}</td>
                  <td className="p-2">
                    {r.role === "participant" ? "💪" : r.role === "arbitre" ? "🏴‍☠️" : "💪🏴‍☠️"}
                    {r.refereeNote && <span className="text-ink-2"> {r.refereeNote}</span>}
                  </td>
                  <td className="p-2">{r.teamName ?? "—"}</td>
                  <td className="p-2 font-black">{r.rank ?? ""}</td>
                  <td className="p-2">{r.laps !== null ? `${r.laps}/${r.lapsTotal}` : ""}</td>
                  <td className="p-2">{r.time ?? ""}</td>
                  <td className="p-2">{r.reps ?? ""}</td>
                  <td className="p-2">{r.cards || ""}</td>
                  <td className="p-2">
                    {r.evalCount ? (
                      <>
                        <span className="text-ink-2">{r.evalCount}× · {r.evalMedianReps} reps · </span>
                        {r.evalQualities.split(",").filter(Boolean).map((c, i) => <span key={i} className={`font-black ${colorOf(c)}`}>{c} </span>)}
                      </>
                    ) : ""}
                  </td>
                  <td className="p-2">{r.pirateScore ?? ""}</td>
                  {SELF_EVAL_CRITERIA.map((c) => (
                    <td key={c.id} className={`p-2 text-center font-black ${colorOf(r.selfEval?.[c.id])}`}>{r.selfEval?.[c.id] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-ink-3">
          {SELF_EVAL_CRITERIA.map((c, i) => <span key={c.id}><b>AE{i + 1}</b> = {c.label}</span>)}
          <span>·</span>
          {QUALITY_LEVELS.map((l) => <span key={l.code}><b className={l.color}>{l.code}</b> {l.label}</span>)}
        </div>
      </main>
    </div>
  );
}
