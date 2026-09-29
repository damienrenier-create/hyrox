import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { notDeleted } from "@/lib/session-roles";
import { sessionsForStudent, fmtDate } from "@/lib/student-sessions";
import { toMs } from "@/lib/scheduling";
import { QUALITY_LEVELS, type QualityCode } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA, SELF_EVAL_WINDOW_MS } from "@/lib/wod-engines/core/self-eval";
import { TopBar } from "../../_components/TopBar";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Libelles courts pour le tableau d'evolution (la grille complete reste sur la page du WOD).
const SHORT: Record<string, string> = {
  engagement: "Engagement",
  technique: "Exécution",
  quotas: "Quotas",
  effort: "Effort",
  tenue_cooperation: "Tenue & coop.",
  forme: "Forme du jour",
};
const levelOf = (code: unknown) => QUALITY_LEVELS.find((l) => l.code === code) ?? null;
const shortDate = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });
const Code = ({ code, small = false }: { code: unknown; small?: boolean }) => {
  const l = levelOf(code);
  return l ? <b className={cx(l.color, small && "text-xs")} title={l.label}>{l.code}</b> : <span className="text-ink-3">—</span>;
};

// WOD termines depuis moins de 24 h (fenetre d'auto-evaluation) parmi ceux passes en argument.
async function pendingSelfEvals(rows: Awaited<ReturnType<typeof sessionsForStudent>>) {
  if (!rows.length) return [];
  const sessions = await db.orm.public.Session.where((s) => s.id.in(rows.map((r) => r.sessionId))).all();
  const now = Date.now();
  return rows.filter((r) => {
    const s = sessions.find((x) => x.id === r.sessionId);
    return !!s?.raceEndedAt && now - toMs(s.raceEndedAt) <= SELF_EVAL_WINDOW_MS;
  });
}

// Historique des auto-evaluations d'un eleve (Sartay 29/09 nuit) : son evolution critere par critere, puis chaque
// auto-evaluation avec l'avis du prof quand il l'a rendu visible. Seulement ses WOD a lui.
export default async function MesAutoEvaluationsPage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");

  const [selfRows, reviewRows, mine] = await Promise.all([
    db.orm.public.SelfEvaluation.where({ studentId: user.id }).all(),
    db.orm.public.SelfEvalReview.where({ studentId: user.id }).all(),
    sessionsForStudent(user.id),
  ]);
  const sessionIds = [...new Set(selfRows.map((r) => r.sessionId))];
  const sessions = sessionIds.length ? (await db.orm.public.Session.where((s) => s.id.in(sessionIds)).all()).filter(notDeleted) : [];
  const rowOf = new Map(mine.map((r) => [r.sessionId, r]));
  const evals = selfRows
    // Seulement les WOD vraiment enregistres pour l'eleve (une seance lancee sans aucun resultat reste invisible).
    .filter((r) => sessions.some((s) => s.id === r.sessionId) && rowOf.get(r.sessionId)?.recorded)
    .map((r) => {
      const wod = rowOf.get(r.sessionId);
      const rev = reviewRows.find((x) => x.sessionId === r.sessionId);
      return {
        sessionId: r.sessionId,
        answers: (r.answers as Record<string, string> | null) ?? {},
        dateMs: wod?.dateMs ?? toMs(r.submittedAt),
        wodName: wod?.wodName ?? "WOD",
        teamName: wod?.teamName ?? null,
        // L'eleve ne voit de l'avis du prof que ce que le prof a rendu visible (grille et commentaire separement).
        review: rev && (rev.visible || (rev.commentVisible && rev.comment)) ? { answers: rev.visible ? ((rev.answers as Record<string, string>) ?? {}) : null, comment: rev.commentVisible ? rev.comment ?? null : null, by: rev.reviewerName } : null,
      };
    })
    .sort((a, b) => a.dateMs - b.dateMs);
  // WOD termines depuis moins de 24 h sans auto-evaluation : a remplir (la page du WOD donne l'etat exact).
  const done = new Set(evals.map((e) => e.sessionId));
  const todo = await pendingSelfEvals(mine.filter((r) => r.recorded && r.ended && !done.has(r.sessionId)));

  return (
    <div className={ui.page}>
      <TopBar brand={false} back={{ href: "/eleve", label: "Retour" }} title="📝 Mes auto-évaluations" subtitle={`${evals.length} auto-évaluation${evals.length > 1 ? "s" : ""}`} />
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {todo.map((r) => (
          <Link key={r.sessionId} href={`/eleve/${r.sessionId}`} className={`block ${ui.card} border-accent bg-accent-soft/40 p-3`}>
            <span className="font-display font-extrabold text-ink">✍️ À remplir : {r.wodName} du {shortDate(r.dateMs)}</span>
            <span className="block text-xs text-ink-2">Tu as 24 h après la fin du WOD pour t&apos;auto-évaluer.</span>
          </Link>
        ))}

        {evals.length === 0 ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Tes auto-évaluations apparaîtront ici après ton premier WOD.</p>
        ) : (
          <>
            {evals.length > 1 && (
              <section className={`${ui.card} p-3`}>
                <h2 className={`${ui.eyebrow} mb-2`}>Mon évolution</h2>
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr>
                        <th className={ui.th} />
                        {evals.map((e) => (
                          <th key={e.sessionId} className={`${ui.th} text-center whitespace-nowrap`}>
                            <Link href={`/eleve/${e.sessionId}`} className="hover:underline">{shortDate(e.dateMs)}</Link>
                            <span className="block text-[10px] font-normal text-ink-3">{e.wodName.replace(/^WOD /, "")}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SELF_EVAL_CRITERIA.map((c) => (
                        <tr key={c.id} className={ui.tr}>
                          <td className="p-1.5 pr-3 font-bold text-ink whitespace-nowrap">{SHORT[c.id] ?? c.label}</td>
                          {evals.map((e) => (
                            <td key={e.sessionId} className="p-1.5 text-center">
                              <Code code={e.answers[c.id]} />
                              {e.review?.answers?.[c.id] && e.review.answers[c.id] !== e.answers[c.id] && (
                                <span className="block text-[10px] text-ink-3">prof <Code code={e.review.answers[c.id]} small /></span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={`${ui.hint} mt-2`}>{QUALITY_LEVELS.map((l) => `${l.code} ${l.label.toLowerCase()}`).join(" · ")}. « prof » = l&apos;avis de ton prof quand il est différent du tien.</p>
              </section>
            )}

            {[...evals].reverse().map((e) => (
              <section key={e.sessionId} className={`${ui.card} p-3 space-y-2`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display font-extrabold text-ink capitalize">{e.wodName} · {fmtDate(new Date(e.dateMs).toISOString())}</h3>
                  <Link href={`/eleve/${e.sessionId}`} className="text-xs font-bold text-brand-ink hover:underline whitespace-nowrap">Voir le WOD ›</Link>
                </div>
                {e.teamName && <p className={ui.hint}>{e.teamName}</p>}
                <ul className="space-y-1">
                  {SELF_EVAL_CRITERIA.map((c) => {
                    const code = e.answers[c.id] as QualityCode | undefined;
                    const prof = e.review?.answers?.[c.id];
                    return (
                      <li key={c.id} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold text-ink">{c.label}</span>
                          <span className="whitespace-nowrap"><Code code={code} />{prof && <span className="text-xs text-ink-3"> · prof <Code code={prof} small /></span>}</span>
                        </div>
                        {code && <p className="text-xs text-ink-2 leading-snug mt-0.5">{c.levels[code]}</p>}
                      </li>
                    );
                  })}
                </ul>
                {e.review?.comment && <p className="rounded-lg border-2 border-brand/40 bg-brand-soft/40 px-2.5 py-1.5 text-sm text-ink whitespace-pre-line">💬 {e.review.by} : {e.review.comment}</p>}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
