import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { buildSessionRecap, type RecapFact } from "@/lib/session-recap";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Recap d'une seance Level par classe, pour les admins (Sartay 28/09) : les faits a retenir d'un coup d'oeil.
export default async function RecapPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { session } = await searchParams;
  const recap = session ? await buildSessionRecap(session) : null;
  const toneCls = (t: RecapFact["tone"]) => (t === "bad" ? "border-danger/40 bg-danger-soft/50" : t === "good" ? "border-success/40 bg-success-soft/50" : t === "warn" ? "border-warn/40 bg-warn-soft/50" : "border-line bg-paper");
  const block = (title: string, facts: RecapFact[]) => (
    <div>
      <p className="font-bold text-sm mb-1">{title}</p>
      {facts.length === 0 ? <p className={ui.hint}>Rien à signaler.</p> : (
        <ul className="space-y-1">{facts.map((f, i) => <li key={i} className={cx("rounded-lg border px-2 py-1 text-sm", toneCls(f.tone))}>{f.text}</li>)}</ul>
      )}
    </div>
  );
  return (
    <div className={ui.page}>
      <TopBar title="📋 Récap de séance" subtitle={recap ? `${recap.label} · ${recap.evaluations} évaluation(s) d'arbitres${recap.ended ? "" : " · WOD pas encore terminé"}` : "Séance introuvable"} back={{ href: "/admin" }} />
      <main className={`${ui.container} py-6 space-y-4`}>
        {!recap ? (
          <p className={ui.alertErr}>Séance Level introuvable.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Link href={`/greffier?session=${recap.sessionId}`} className={btn.smGhost}>Greffier (résultats, rythme, arbitrage)</Link>
            </div>
            {recap.classes.length === 0 && <p className={ui.muted}>Aucune équipe dans cette séance.</p>}
            {recap.classes.map((c) => {
              const alerts = c.refereeing.length + c.cheating.length + c.teamsLevel.filter((f) => f.tone !== "good").length + c.evals.filter((f) => f.tone === "bad").length;
              return (
                <section key={c.className} className={ui.cardPad}>
                  <div className="flex flex-wrap items-baseline gap-3 mb-3">
                    <h2 className={ui.h2}>{c.className}</h2>
                    <span className={ui.hint}>{c.teams} équipe{c.teams > 1 ? "s" : ""} · {c.students} élève{c.students > 1 ? "s" : ""}</span>
                    <span className={cx(ui.chip, alerts ? ui.chipWarn : ui.chipOk, "ml-auto")}>{alerts ? `${alerts} point${alerts > 1 ? "s" : ""} à regarder` : "RAS"}</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {block("🧑‍⚖️ Arbitrages bizarres", c.refereeing)}
                    {block("🏋️ Équipes trop fortes ou trop faibles", c.teamsLevel)}
                    {block("🕵️ Triche suspectée", c.cheating)}
                    {block("📊 Évaluations très basses ou très hautes", c.evals)}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
