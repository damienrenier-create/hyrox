import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { fmtDate } from "@/lib/student-sessions";
import { loadSelfEvalHistory } from "@/lib/student-self-evals";
import { type QualityCode } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { TopBar } from "../../../_components/TopBar";
import { QualityCodeTag } from "../../EleveTabs";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Recap d'UNE auto-evaluation (Sartay 29/09 nuit) : chaque critere avec le niveau choisi et sa phrase, l'avis et le
// commentaire du prof s'il les a rendus visibles, et le lien vers le WOD.
export default async function AutoEvaluationRecapPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");
  const { evals } = await loadSelfEvalHistory(user.id);
  const e = evals.find((x) => x.sessionId === sessionId);
  if (!e) redirect("/eleve/auto-evaluations");

  return (
    <div className={ui.page}>
      <TopBar brand={false} back={{ href: "/eleve/auto-evaluations", label: "Retour" }} title="📝 Mon auto-évaluation" subtitle={<span className="capitalize">{e.wodName} · {fmtDate(new Date(e.dateMs).toISOString())}{e.teamName ? ` · ${e.teamName}` : ""}</span>} />
      <main className="max-w-2xl mx-auto p-4 space-y-3">
        <ul className="space-y-2">
          {SELF_EVAL_CRITERIA.map((c) => {
            const code = e.answers[c.id] as QualityCode | undefined;
            const prof = e.review?.answers?.[c.id] as QualityCode | undefined;
            return (
              <li key={c.id} className={`${ui.card} p-3`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display font-extrabold text-ink">{c.label}</span>
                  <span className="whitespace-nowrap text-lg"><QualityCodeTag code={code} /></span>
                </div>
                {code && <p className="text-sm text-ink-2 leading-snug mt-1">{c.levels[code]}</p>}
                {prof && (
                  <p className="text-xs text-ink-2 leading-snug mt-2 rounded-lg bg-brand-soft/50 border border-brand/30 px-2 py-1">
                    Avis de {e.review!.by} : <QualityCodeTag code={prof} small />{prof !== code && <> · {c.levels[prof]}</>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {e.review?.comment && <p className="rounded-2xl border-2 border-brand/40 bg-brand-soft/40 px-3 py-2 text-sm text-ink whitespace-pre-line">💬 {e.review.by} : {e.review.comment}</p>}
        <Link href={`/eleve/${e.sessionId}`} className={`block text-center ${ui.card} hover:border-brand p-3 font-bold text-brand-ink transition`}>Voir le WOD (résultats, arbitrages) ›</Link>
      </main>
    </div>
  );
}
