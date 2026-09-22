import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { wodLabel, fmtDate } from "@/lib/student-sessions";

type Row = {
  studentId: string;
  name: string;
  className: string;
  teamName: string;
  answers: Record<string, string>;
  submittedAt: string;
};

// Consultation des auto-evaluations par les admins (DAMZER + coachs), une seance a la fois.
export default async function AutoEvaluationsPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");

  const { session: requested } = await searchParams;
  const sessions = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all();
  const session = (requested ? sessions.find((s) => s.id === requested) : null) ?? sessions[0] ?? null;

  let rows: Row[] = [];
  let participants = 0;
  if (session) {
    const teams = await db.orm.public.Team.where({ sessionId: session.id }).all();
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const teamOfStudent = new Map<string, string>();
    for (const t of teams) {
      const members = await db.orm.public.TeamMember.where({ teamId: t.id }).all();
      for (const m of members) teamOfStudent.set(m.userId, t.id);
    }
    participants = teamOfStudent.size;
    const evals = await db.orm.public.SelfEvaluation.where({ sessionId: session.id }).all();
    for (const e of evals) {
      const u = await db.orm.public.User.where({ id: e.studentId }).first();
      rows.push({
        studentId: e.studentId,
        name: u ? `${u.lastName ?? ""} ${u.firstName ?? ""}`.trim() : e.studentId,
        className: u?.className ?? "",
        teamName: teamName.get(teamOfStudent.get(e.studentId) ?? "") ?? "—",
        answers: (e.answers as Record<string, string>) ?? {},
        submittedAt: String(e.submittedAt),
      });
    }
    rows = rows.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
  }

  const colorOf = (code: string) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-slate-500";

  return (
    <div className="min-h-screen bg-slate-950 text-cyan-50 font-mono p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-black text-cyan-400 uppercase tracking-widest">Auto-évaluations</h1>
        {user.role === "MASTER_ADMIN" && <Link href="/admin" className="text-sm text-cyan-300 underline">← Console</Link>}
      </div>

      <form className="mb-6 flex flex-wrap items-center gap-2">
        <label className="text-sm text-cyan-300">Séance</label>
        <select name="session" defaultValue={session?.id ?? ""} className="bg-slate-900 border border-cyan-800 rounded p-2 text-sm">
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {wodLabel(s.wodType)} · {fmtDate(s.createdAt)}{s.isActive ? " · active" : ""}{s.raceEndedAt ? " · terminée" : ""}
            </option>
          ))}
        </select>
        <button type="submit" className="bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-bold px-4 py-2 rounded">Voir</button>
      </form>

      {!session ? (
        <p className="text-slate-400">Aucune séance.</p>
      ) : (
        <>
          <p className="text-sm text-slate-400 mb-3">
            {rows.length} auto-évaluation(s) reçue(s) sur {participants} participant(s) encodé(s).
          </p>
          <div className="overflow-x-auto bg-slate-900 border border-cyan-900 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-cyan-900 text-cyan-300">
                  <th className="p-2">Classe</th>
                  <th className="p-2">Élève</th>
                  <th className="p-2">Équipe</th>
                  {SELF_EVAL_CRITERIA.map((c) => (
                    <th key={c.id} className="p-2 text-center" title={c.hint}>{c.label}</th>
                  ))}
                  <th className="p-2">Envoyé</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4 + SELF_EVAL_CRITERIA.length} className="p-4 text-slate-500 italic">Aucune auto-évaluation pour cette séance.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.studentId} className="border-b border-slate-800">
                    <td className="p-2 text-slate-400">{r.className}</td>
                    <td className="p-2 font-bold">{r.name}</td>
                    <td className="p-2 text-slate-300">{r.teamName}</td>
                    {SELF_EVAL_CRITERIA.map((c) => (
                      <td key={c.id} className={`p-2 text-center font-black ${colorOf(r.answers[c.id])}`}>{r.answers[c.id] ?? "—"}</td>
                    ))}
                    <td className="p-2 text-xs text-slate-500">{new Date(r.submittedAt).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-slate-500">
            {QUALITY_LEVELS.map((l) => (
              <span key={l.code}><b className={l.color}>{l.code}</b> = {l.label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
