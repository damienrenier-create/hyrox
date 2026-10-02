import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { buildObsReport } from "@/lib/observations";
import { notDeleted, readSessionClasses } from "@/lib/session-roles";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { TopBar } from "../../_components/TopBar";
import { ObsReportView } from "../../_components/ObsReportView";
import { btn, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Compte rendu des arbitres d'une seance Eval : observations, series horodatees, appreciations, concordance avec les
// clics du greffier. Profs et coachs.
export default async function ObservationsPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { session: requested } = await searchParams;
  const all = (await db.orm.public.Session.where({ wodType: "HYROX" }).orderBy((s) => s.createdAt.desc()).all()).filter(notDeleted);
  const session = all.find((s) => s.id === requested) ?? all[0] ?? null;

  if (!session) {
    return (
      <div className={ui.page}>
        <TopBar title="Compte rendu des arbitres" back={{ href: "/admin", label: "Console" }} />
        <main className={`${ui.container} py-6`}><p className={`${ui.cardPad} ${ui.muted}`}>Aucune séance Eval pour l&apos;instant.</p></main>
      </div>
    );
  }
  const report = await buildObsReport(session.id);
  const classes = readSessionClasses(session.settings);

  return (
    <div className={ui.page}>
      <TopBar
        title="Compte rendu des arbitres"
        subtitle={`${session.label ?? wodLabel(session.wodType)} · ${fmtDate(session.createdAt)}${classes.length ? ` · ${classes.join(", ")}` : ""}`}
        back={{ href: "/admin", label: "Console" }}
        wide
        right={
          <nav className="flex flex-wrap gap-2">
            <Link href={`/touche-coule?session=${session.id}`} className={btn.smSea}>👁 Arbitrer</Link>
            <Link href={`/greffier?session=${session.id}`} className={btn.smGhost}>Greffier</Link>
          </nav>
        }
      >
        {all.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {all.slice(0, 12).map((s) => (
              <Link key={s.id} href={`/admin/observations?session=${s.id}`} className={`${ui.pill} ${s.id === session.id ? ui.pillOn : ui.pillOff}`}>
                {s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}{readSessionClasses(s.settings).length ? ` · ${readSessionClasses(s.settings).join("+")}` : ""}
              </Link>
            ))}
          </div>
        )}
      </TopBar>
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <ObsReportView report={report} />
      </main>
    </div>
  );
}
