import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildConsultation, consultationCsv } from "@/lib/consultation";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { ExportCsvButton } from "./ExportCsvButton";

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
  const colorOf = (code: string | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-slate-500";
  const input = "bg-slate-950 border border-cyan-800 rounded p-2 text-sm text-white";

  return (
    <div className="min-h-screen bg-slate-950 text-cyan-50 font-mono p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-black text-cyan-400 uppercase tracking-widest">Résultats</h1>
        <div className="flex gap-3 items-center">
          <ExportCsvButton csv={csv} filename={`hyrox-resultats-${new Date().toISOString().slice(0, 10)}.csv`} />
          {user.role === "MASTER_ADMIN" && <Link href="/admin" className="text-sm text-cyan-300 underline">← Console</Link>}
        </div>
      </div>

      <form className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4 items-end">
        <label className="text-xs text-cyan-300">Cycle
          <select name="cycle" defaultValue={p.cycle ?? ""} className={`${input} w-full`}>
            <option value="">tous</option>
            {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-cyan-300 col-span-2">Séance
          <select name="session" defaultValue={p.session ?? ""} className={`${input} w-full`}>
            <option value="">toutes (15 dernières)</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}</option>)}
          </select>
        </label>
        <label className="text-xs text-cyan-300">Classe
          <select name="classe" defaultValue={p.classe ?? ""} className={`${input} w-full`}>
            <option value="">toutes</option>
            {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-cyan-300">Élève
          <input name="eleve" defaultValue={p.eleve ?? ""} placeholder="nom ou prénom" className={`${input} w-full`} />
        </label>
        <label className="text-xs text-cyan-300">Du
          <input type="date" name="from" defaultValue={p.from ?? ""} className={`${input} w-full`} />
        </label>
        <label className="text-xs text-cyan-300">Au
          <input type="date" name="to" defaultValue={p.to ?? ""} className={`${input} w-full`} />
        </label>
        <button type="submit" className="bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-bold px-4 py-2.5 rounded lg:col-span-7">Filtrer</button>
      </form>

      <p className="text-xs text-slate-400 mb-2">{rows.length} ligne(s) · {sessionsScanned} séance(s) parcourue(s). Une ligne = un élève × une séance (participant et/ou arbitre).</p>

      <div className="overflow-x-auto bg-slate-900 border border-cyan-900 rounded-xl">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="text-left border-b border-cyan-900 text-cyan-300">
              <th className="p-2">Date</th><th className="p-2">Séance</th><th className="p-2">Classe</th><th className="p-2">Élève</th><th className="p-2">Rôle</th>
              <th className="p-2">Équipe</th><th className="p-2">Rang</th><th className="p-2">Tours</th><th className="p-2">Temps</th><th className="p-2">Reps</th><th className="p-2">🟨</th>
              <th className="p-2">Arbitrages</th><th className="p-2">💥</th>
              {SELF_EVAL_CRITERIA.map((c) => <th key={c.id} className="p-2 text-center" title={c.label}>AE{SELF_EVAL_CRITERIA.indexOf(c) + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={13 + SELF_EVAL_CRITERIA.length} className="p-4 text-slate-500 italic">Aucune donnée pour ces filtres.</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.sessionId}_${r.studentId}`} className="border-b border-slate-800 hover:bg-slate-800/60">
                <td className="p-2 text-slate-400">{new Date(r.sessionDate).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" })}</td>
                <td className="p-2">{r.sessionLabel}{r.cycleName ? <span className="text-slate-500"> · {r.cycleName}</span> : null}</td>
                <td className="p-2 text-slate-400">{r.className}</td>
                <td className="p-2 font-bold">{r.lastName} {r.firstName}</td>
                <td className="p-2">
                  {r.role === "participant" ? "💪" : r.role === "arbitre" ? "🏴‍☠️" : "💪🏴‍☠️"}
                  {r.refereeNote && <span className="text-slate-400"> {r.refereeNote}</span>}
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
                      <span className="text-slate-300">{r.evalCount}× · {r.evalMedianReps} reps · </span>
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
      <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-slate-500">
        {SELF_EVAL_CRITERIA.map((c, i) => <span key={c.id}><b>AE{i + 1}</b> = {c.label}</span>)}
        <span>·</span>
        {QUALITY_LEVELS.map((l) => <span key={l.code}><b className={l.color}>{l.code}</b> {l.label}</span>)}
      </div>
    </div>
  );
}
