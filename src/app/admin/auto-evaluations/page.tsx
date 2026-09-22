import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { TopBar } from "../../_components/TopBar";
import { btn, ui } from "@/lib/ui";

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

  const colorOf = (code: string) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";

  return (
    <div className={ui.page}>
      <TopBar title="Auto-évaluations" back={user.role === "MASTER_ADMIN" ? { href: "/admin", label: "Console" } : undefined}>
        <form className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-ink-2">Séance</label>
          <select name="session" defaultValue={session?.id ?? ""} className={`${ui.input} w-auto max-w-full`}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}{s.isActive ? " · ouverte" : ""}{s.raceEndedAt ? " · terminée" : ""}
              </option>
            ))}
          </select>
          <button type="submit" className={btn.primary}>Voir</button>
        </form>
      </TopBar>

      <main className={`${ui.container} py-6`}>
        {!session ? (
          <p className={ui.muted}>Aucune séance.</p>
        ) : (
          <>
            <p className={`${ui.muted} mb-3`}>
              <b className="text-ink">{rows.length}</b> auto-évaluation(s) reçue(s) sur <b className="text-ink">{participants}</b> participant(s) encodé(s).
            </p>
            <div className={`${ui.card} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={ui.th}>Classe</th>
                    <th className={ui.th}>Élève</th>
                    <th className={ui.th}>Équipe</th>
                    {SELF_EVAL_CRITERIA.map((c) => (
                      <th key={c.id} className={`${ui.th} text-center`}>{c.label}</th>
                    ))}
                    <th className={ui.th}>Envoyé</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={4 + SELF_EVAL_CRITERIA.length} className="p-4 text-ink-3 italic">Aucune auto-évaluation pour cette séance.</td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.studentId} className={ui.tr}>
                      <td className="p-2 text-ink-2">{r.className}</td>
                      <td className="p-2 font-bold">{r.name}</td>
                      <td className="p-2 text-ink-2">{r.teamName}</td>
                      {SELF_EVAL_CRITERIA.map((c) => (
                        <td key={c.id} className={`p-2 text-center font-black ${colorOf(r.answers[c.id])}`}>{r.answers[c.id] ?? "—"}</td>
                      ))}
                      <td className="p-2 text-xs text-ink-3">{new Date(r.submittedAt).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-ink-3">
              {QUALITY_LEVELS.map((l) => (
                <span key={l.code}><b className={l.color}>{l.code}</b> = {l.label}</span>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
