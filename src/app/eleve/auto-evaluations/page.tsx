import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { fmtDate } from "@/lib/student-sessions";
import { loadSelfEvalHistory, sessionHref, SELF_EVAL_SHORT } from "@/lib/student-self-evals";
import { evalBaremeVisible } from "@/lib/eval-bareme-server";
import { badmintonTabVisible } from "@/lib/badminton-server";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_GRIDS } from "@/lib/wod-engines/core/self-eval";
import { TopBar } from "../../_components/TopBar";
import { LogoutButton } from "../../_components/LogoutButton";
import { EleveTabs, QualityCodeTag } from "../EleveTabs";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });

// Onglet « Mes auto-évaluations » (Sartay 29/09 nuit) : la liste (et l'evolution critere par critere) ; un clic
// ouvre le recap de chacune.
export default async function MesAutoEvaluationsPage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");
  const { evals, todo } = await loadSelfEvalHistory(user.id);
  const bareme = await evalBaremeVisible(user.className, todo.some((r) => r.wodType === "HYROX"));
  const classement = await badmintonTabVisible(user.id, user.className ?? null);
  const newest = [...evals].reverse();
  // « Mon évolution » : un tableau par grille (Hyrox, badminton), des qu'une grille a au moins 2 auto-evaluations.
  const byGrid = Object.values(SELF_EVAL_GRIDS).map((g) => ({ grid: g, evals: evals.filter((e) => e.grid === g.key) })).filter((x) => x.evals.length > 1);
  const severalGrids = new Set(evals.map((e) => e.grid)).size > 1;

  return (
    <div className={ui.page}>
      <TopBar title={user.name} subtitle={user.className ?? ""} right={<LogoutButton />} />
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <EleveTabs active="selfevals" todo={todo.length} bareme={bareme} classement={classement} />

        {todo.map((r) => (
          <Link key={r.sessionId} href={r.wodType === "BADMINTON" ? `${sessionHref(r.sessionId, r.wodType)}?autoeval=1#auto-eval` : sessionHref(r.sessionId, r.wodType)} className={`block ${ui.card} border-accent bg-accent-soft/40 p-3`}>
            <span className="font-display font-extrabold text-ink">✍️ À remplir : {r.wodName} du {shortDate(r.dateMs)}</span>
            <span className="block text-xs text-ink-2">Tu as 24 h après la fin {r.wodType === "BADMINTON" ? "du cours" : "du WOD"} pour t&apos;auto-évaluer.</span>
          </Link>
        ))}

        {evals.length === 0 ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Tes auto-évaluations apparaîtront ici après ton premier WOD.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {newest.map((e) => (
                <li key={e.sessionId}>
                  <Link href={`/eleve/auto-evaluations/${e.sessionId}`} className={`flex items-center justify-between gap-3 ${ui.card} hover:border-brand p-3 transition`}>
                    <span className="min-w-0">
                      <span className="block font-display font-extrabold text-ink capitalize">{e.wodName} · {fmtDate(new Date(e.dateMs).toISOString())}</span>
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-2 mt-0.5">
                        {SELF_EVAL_GRIDS[e.grid].criteria.map((c) => (
                          <span key={c.id} className="whitespace-nowrap">{SELF_EVAL_SHORT[c.id] ?? c.label} <QualityCodeTag code={e.answers[c.id]} small /></span>
                        ))}
                      </span>
                      {e.review && <span className="block text-xs text-brand-ink font-bold mt-0.5">💬 Avis de {e.review.by}</span>}
                    </span>
                    <span className="text-ink-3 font-black">›</span>
                  </Link>
                </li>
              ))}
            </ul>

            {byGrid.map(({ grid, evals }) => (
              <section key={grid.key} className={`${ui.card} p-3`}>
                <h2 className={`${ui.eyebrow} mb-2`}>Mon évolution{severalGrids ? ` · ${grid.name}` : ""}</h2>
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr>
                        <th className={ui.th} />
                        {evals.map((e) => (
                          <th key={e.sessionId} className={`${ui.th} text-center whitespace-nowrap`}>
                            <Link href={`/eleve/auto-evaluations/${e.sessionId}`} className="hover:underline">{shortDate(e.dateMs)}</Link>
                            <span className="block text-[10px] font-normal text-ink-3">{e.wodName.replace(/^WOD /, "")}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.criteria.map((c) => (
                        <tr key={c.id} className={ui.tr}>
                          <td className="p-1.5 pr-3 font-bold text-ink whitespace-nowrap">{SELF_EVAL_SHORT[c.id] ?? c.label}</td>
                          {evals.map((e) => (
                            <td key={e.sessionId} className="p-1.5 text-center">
                              <QualityCodeTag code={e.answers[c.id]} />
                              {e.review?.answers?.[c.id] && e.review.answers[c.id] !== e.answers[c.id] && (
                                <span className="block text-[10px] text-ink-3">prof <QualityCodeTag code={e.review.answers[c.id]} small /></span>
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
            ))}
          </>
        )}
      </main>
    </div>
  );
}
