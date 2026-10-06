import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { notDeleted, readSessionClasses } from "@/lib/session-roles";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { loadEvalGrades } from "@/lib/eval-grades-server";
import { evalGradesCsv } from "@/lib/eval-grades";
import { EVAL_CARD_PENALTY, EVAL_PERF_FLOOR, EVAL_TECH_POINTS, EVAL_WEIGHTS, starsText } from "@/lib/eval-bareme";
import { TopBar } from "../../../_components/TopBar";
import { ExportCsvButton } from "../../resultats/ExportCsvButton";
import { btn, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Notes /20 de l'Eval S.O.R.O (Sartay 06/10 : « uniquement pour les admins »). Formule : src/lib/eval-grades.ts.
export default async function EvalNotesPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { session: requested } = await searchParams;
  const all = (await db.orm.public.Session.where({ wodType: "HYROX" }).orderBy((s) => s.createdAt.desc()).all()).filter(notDeleted);
  const session = all.find((s) => s.id === requested) ?? all[0] ?? null;
  const back = { href: "/admin", label: "Console" };

  if (!session) {
    return (
      <div className={ui.page}>
        <TopBar title="Notes de l'Eval" back={back} />
        <main className={`${ui.container} py-6`}><p className={`${ui.cardPad} ${ui.muted}`}>Aucune séance Eval pour l&apos;instant.</p></main>
      </div>
    );
  }
  const data = await loadEvalGrades(session.id);
  const classes = readSessionClasses(session.settings);
  const rows = data.rows;
  const p0 = rows[0]?.perf ?? null;
  const n1 = (x: number | null) => (x === null ? "—" : x.toFixed(1).replace(".", ","));
  const pc = (x: number) => `${Math.round(x * 100)} %`;
  const min = (ms: number) => `${Math.round(ms / 60000)} min`;
  const label = (id: string) => (id === "run" ? "Run" : data.settings.stations.find((s) => s.id === id)?.label ?? id);
  const mean = rows.length ? rows.reduce((a, r) => a + r.note, 0) / rows.length : null;
  const W = EVAL_WEIGHTS;

  return (
    <div className={ui.page}>
      <TopBar
        title="Notes /20 · Eval S.O.R.O"
        subtitle={`${session.label ?? wodLabel(session.wodType)} · ${fmtDate(session.createdAt)}${classes.length ? ` · ${classes.join(", ")}` : ""}`}
        back={back}
        wide
        right={
          <nav className="flex flex-wrap gap-2">
            <Link href={`/admin/observations?session=${session.id}`} className={btn.smGhost}>📋 Compte rendu arbitres</Link>
            <Link href={`/greffier?session=${session.id}`} className={btn.smGhost}>Greffier</Link>
          </nav>
        }
      >
        {all.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {all.slice(0, 12).map((s) => (
              <Link key={s.id} href={`/admin/eval/notes?session=${s.id}`} className={`${ui.pill} ${s.id === session.id ? ui.pillOn : ui.pillOff}`}>
                {s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}{readSessionClasses(s.settings).length ? ` · ${readSessionClasses(s.settings).join("+")}` : ""}
              </Link>
            ))}
          </div>
        )}
      </TopBar>
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-4">
        <details className={ui.cardPad}>
          <summary className="cursor-pointer font-bold">
            Formule : perf {W.perf} % · technique perso {W.personal} % · technique de l&apos;équipe {W.team} % · implication {W.involvement} % · −{EVAL_CARD_PENALTY} par carte jaune
          </summary>
          <ul className={`${ui.muted} mt-2 space-y-1.5 list-disc pl-5`}>
            <li><b>Perf de l&apos;équipe</b> : le travail validé à la fin officielle ({data.settings.capMin}:00), chaque segment pesant son temps de référence (équipe moyenne du 05/10 ; un run 50 s). 0/20 sous {Math.round(EVAL_PERF_FLOOR * 100)} % du WOD de base (parcours 3★), le même seuil pour tous ; puis les points montent jusqu&apos;à la note du parcours, atteinte au parcours complet (ou quand il est bouclé avant la fin).{p0 && <> Ici : WOD de base {min(p0.baseMs)} de travail, seuil {min(p0.floorMs)}, 1 point ≈ {(p0.pointPct * 100).toFixed(1).replace(".", ",")} % du WOD de base pour un parcours à {p0.max}.</>}</li>
            <li><b>Technique perso</b> : par exercice, les appréciations du prof s&apos;il y en a, sinon celles des arbitres élèves ; {Object.entries(EVAL_TECH_POINTS).map(([c, p]) => `${c} ${String(p).replace(".", ",")}`).join(" · ")} sur 5 ; moyenne des exercices, ramenée sur 20. Élève pas observé : la technique de ses coéquipiers.</li>
            <li><b>Technique de l&apos;équipe</b> : la technique perso de ses coéquipiers.</li>
            <li><b>Implication</b> : la part des lignes « implication » cochées par les profs ; à défaut (séances d&apos;avant le 06/10), les critères d&apos;équipe des grilles (rester groupés, partir au complet, transitions), marqués ≈. Une part sans donnée laisse son poids aux autres.</li>
            <li>Les validations trop rapides (station &lt; 30 s, run &lt; 20 s) sont signalées, jamais retirées.</li>
          </ul>
        </details>

        {data.startedAtMs === null ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Le WOD n&apos;a pas encore commencé : pas de note.</p>
        ) : !rows.length ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Aucun élève dans les équipes.</p>
        ) : (
          <div className={`${ui.card} overflow-x-auto`}>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-line">
              <p className={ui.muted}>
                <b>{rows.length}</b> élèves · moyenne <b>{n1(mean === null ? null : Math.round(mean * 10) / 10)}</b> · sous 10 : <b>{rows.filter((r) => r.note < 10).length}</b>
                {data.endedAtMs === null && <span className={`${ui.chip} ${ui.chipWarn} ml-2`}>WOD en cours : notes provisoires</span>}
              </p>
              <ExportCsvButton csv={evalGradesCsv(rows, data.settings)} filename={`notes-eval-${classes.join("+") || session.id.slice(0, 8)}.csv`} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={ui.th}>Équipe</th>
                  <th className={`${ui.th} sticky left-0 bg-card z-10`}>Élève</th>
                  <th className={`${ui.th} text-center`}>Parcours</th>
                  <th className={`${ui.th} text-center`}>Fait à la fin</th>
                  <th className={`${ui.th} text-center`}>Perf<br />{W.perf} %</th>
                  <th className={`${ui.th} text-center`}>Tech. perso<br />{W.personal} %</th>
                  <th className={`${ui.th} text-center`}>Tech. équipe<br />{W.team} %</th>
                  <th className={`${ui.th} text-center`}>Implication<br />{W.involvement} %</th>
                  <th className={`${ui.th} text-center`}>🟨</th>
                  <th className={`${ui.th} text-center`}>Note /20</th>
                  <th className={ui.th}>Détail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pupil.userId} className={ui.tr}>
                    <td className="p-2 font-bold whitespace-nowrap">E{r.team.order}</td>
                    <td className="p-2 sticky left-0 bg-card z-10 whitespace-nowrap">
                      <span className="font-semibold">{r.pupil.name}</span> <span className={ui.hint}>{r.pupil.className}</span>
                    </td>
                    <td className="p-2 text-center whitespace-nowrap"><span className="text-accent-ink">{starsText(r.perf.stars)}</span> <span className={ui.hint}>/{r.perf.max}</span></td>
                    <td className="p-2 text-center tabular-nums whitespace-nowrap" title={`${r.perf.segmentsDone} segments validés sur ${r.perf.segmentsTotal}`}>{r.perf.inTime ? "✅ bouclé" : pc(r.perf.share)}</td>
                    <td className="p-2 text-center tabular-nums">{n1(r.perf.note)}</td>
                    <td className="p-2 text-center tabular-nums">{n1(r.personalNote)}</td>
                    <td className="p-2 text-center tabular-nums">{n1(r.teamNote)}</td>
                    <td className="p-2 text-center tabular-nums" title={r.involvement.total ? `${r.involvement.met} coché${r.involvement.met > 1 ? "s" : ""} sur ${r.involvement.total}` : "aucune donnée"}>{r.involvement.estimated ? "≈ " : ""}{n1(r.involvement.note)}</td>
                    <td className="p-2 text-center tabular-nums">{r.cards || ""}</td>
                    <td className="p-2 text-center tabular-nums font-extrabold text-base">{n1(r.note)}</td>
                    <td className="p-2 text-xs text-ink-3 min-w-[280px]">
                      {r.personal.exercises.length ? r.personal.exercises.map((x) => `${label(x.exerciseId)} ${n1(x.points).replace(",0", "")}${x.staff ? " (prof)" : ""}`).join(" · ") : "pas observé"}
                      {r.flags.length > 0 && <span className="block text-warn-ink">{r.flags.join(" · ")}</span>}
                      {r.perf.suspects.length > 0 && <span className="block">À vérifier : {r.perf.suspects.map((s) => `${s.label} ${Math.round(s.ms / 1000)} s`).join(" · ")}{r.perfWithoutSuspects !== null ? ` (perf sans : ${n1(r.perfWithoutSuspects)})` : ""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
