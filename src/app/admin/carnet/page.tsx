import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { GRADE_MAX, QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { GRADED_CRITERIA, buildCarnet, carnetCsv, fmtGrade, gradeTone, type CarnetCell } from "@/lib/carnet";
import { groupLabel, groupSlots, type SlotRow } from "@/lib/journal";
import { listTeachers } from "@/lib/staff";
import { TopBar } from "../../_components/TopBar";
import { ExportCsvButton } from "../resultats/ExportCsvButton";
import { btn, cx, ui } from "@/lib/ui";

type Params = Record<string, string | string[] | undefined>;
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });

// Carnet de cotes : la note (sur 5) que chaque eleve s'est donnee a chaque WOD via son auto-evaluation,
// par classe ou par groupe du journal de classe. Bareme et regle de calcul dans src/lib/carnet.ts.
export default async function CarnetPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const isMaster = user.role === "MASTER_ADMIN";
  const sp = await searchParams;

  const teachers = await listTeachers();
  const prof = one(sp.prof);
  const viewedId = isMaster && prof && teachers.some((t) => t.id === prof) ? prof : user.id;
  const profParam = viewedId !== user.id ? `&prof=${viewedId}` : "";

  const [slots, students] = await Promise.all([
    db.orm.public.ClassSlot.where({}).all().then((rows) => rows as SlotRow[]),
    db.orm.public.User.where({ role: "STUDENT" }).all(),
  ]);
  const allClasses = [...new Set(students.map((u) => u.className).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const known = new Set(allClasses);
  const selected = [...new Set(many(sp.classes).filter((c) => known.has(c)))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));

  // Groupements du journal de classe : chaque creneau = un groupe ; les memes classes sur deux creneaux = un seul groupe.
  const groups = groupSlots(slots.filter((s) => s.teacherId === viewedId));
  const groupSets = new Map<string, string[]>();
  for (const g of groups) {
    const names = g.classes.map((c) => c.className);
    groupSets.set(groupLabel(names), names);
  }
  const myClasses = [...new Set(groups.flatMap((g) => g.classes.map((c) => c.className)))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const selectedLabel = groupLabel(selected);
  const linkTo = (classes: string[]) => `/admin/carnet?classes=${encodeURIComponent(classes.join(","))}${profParam}`;

  const carnet = selected.length ? await buildCarnet(selected) : null;
  const csv = carnet ? carnetCsv(carnet) : "";

  const tooltip = (cell: CarnetCell) => {
    if (!cell.submitted) return cell.participated ? "A participé, mais n'a pas rendu son auto-évaluation." : "Pas dans cette séance.";
    const lines = GRADED_CRITERIA.map((c) => `${c.label} : ${cell.codes[c.id] ?? "—"}`);
    const forme = SELF_EVAL_CRITERIA.find((c) => c.id === "forme");
    if (forme && cell.forme) lines.push(`${forme.label} : ${cell.forme} (hors note)`);
    if (cell.reviewGrade !== null) lines.push(`Grille du prof : ${fmtGrade(cell.reviewGrade)}/${GRADE_MAX}`);
    return lines.join("\n");
  };

  return (
    <div className={ui.page}>
      <TopBar
        title="Carnet de cotes"
        subtitle={selected.length ? <>{selectedLabel} · {carnet?.rows.length ?? 0} élève{(carnet?.rows.length ?? 0) > 1 ? "s" : ""} · {carnet?.columns.length ?? 0} WOD</> : "Choisis un groupe ou une classe"}
        back={{ href: "/admin", label: "Console" }}
        wide
        right={
          <nav className="flex flex-wrap items-center gap-2">
            {carnet && carnet.rows.length > 0 && <ExportCsvButton csv={csv} filename={`carnet-${selected.join("+")}.csv`} />}
            <Link href={viewedId === user.id ? "/admin/journal" : `/admin/journal?prof=${viewedId}`} className={btn.smGhost}>Journal de classe</Link>
            <Link href="/admin/auto-evaluations" className={btn.smGhost}>Auto-évaluations</Link>
          </nav>
        }
      >
        {isMaster && teachers.length > 1 && (
          <div className={`${ui.segmented} flex-wrap`}>
            {teachers.map((t) => (
              <Link
                key={t.id}
                href={`/admin/carnet?${selected.length ? `classes=${encodeURIComponent(selected.join(","))}&` : ""}${t.id === user.id ? "" : `prof=${t.id}`}`}
                className={cx("px-3 py-1.5 rounded-lg text-xs font-bold transition", t.id === viewedId ? ui.segOn : ui.segOff)}
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </TopBar>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* ===== Choix du groupe / de la classe ===== */}
        <section className={`${ui.cardPad} space-y-3`}>
          <div>
            <div className={`${ui.eyebrow} mb-1.5`}>Groupes du journal de classe</div>
            {groupSets.size === 0 ? (
              <p className={ui.hint}>Aucun créneau dans ce journal : pose tes classes dans le <Link href="/admin/journal" className="underline font-semibold">journal de classe</Link>, les groupes apparaîtront ici.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {[...groupSets.entries()].map(([label, classes]) => (
                  <Link key={label} href={linkTo(classes)} className={cx(ui.pill, label === selectedLabel ? ui.pillOn : ui.pillOff)}>{label}</Link>
                ))}
              </div>
            )}
          </div>
          {myClasses.length > 0 && (
            <div>
              <div className={`${ui.eyebrow} mb-1.5`}>Classes de ce journal, une par une</div>
              <div className="flex flex-wrap gap-1.5">
                {myClasses.map((c) => (
                  <Link key={c} href={linkTo([c])} className={cx(ui.pill, selectedLabel === c ? ui.pillOn : ui.pillOff)}>{c}</Link>
                ))}
              </div>
            </div>
          )}
          <details>
            <summary className="text-xs font-bold text-ink-2 cursor-pointer select-none">Une autre classe, ou un groupe à la carte</summary>
            <form className="mt-2">
              {profParam && <input type="hidden" name="prof" value={viewedId} />}
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-9 gap-1.5 mb-2">
                {allClasses.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-xs font-semibold bg-paper border border-line rounded-lg px-2 py-1.5 cursor-pointer hover:border-brand">
                    <input type="checkbox" name="classes" value={c} defaultChecked={selected.includes(c)} className={ui.check} /> {c}
                  </label>
                ))}
              </div>
              <button type="submit" className={btn.smPrimary}>Afficher</button>
            </form>
          </details>
        </section>

        {/* ===== Bareme ===== */}
        <p className={`${ui.hint} px-1`}>
          Barème sur {GRADE_MAX} : {QUALITY_LEVELS.map((l) => `${l.code} ${fmtGrade(l.grade)}`).join(" · ")}. Note d&apos;un WOD = moyenne des {GRADED_CRITERIA.length} critères de la grille officielle ;
          « Ma forme du jour » n&apos;est pas comptée (visible au survol). <b>∅</b> = a participé sans rendre son auto-évaluation, <b>·</b> = pas dans cette séance.
        </p>

        {/* ===== Tableau ===== */}
        {!carnet ? (
          <section className={`${ui.cardPad} text-center`}>
            <div className="text-4xl mb-2">📒</div>
            <p className={ui.muted}>Choisis un groupe ou une classe ci-dessus.</p>
          </section>
        ) : carnet.rows.length === 0 ? (
          <section className={ui.cardPad}>
            <p className={ui.muted}>Aucun élève dans {selectedLabel}.</p>
          </section>
        ) : (
          <section className={`${ui.card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${ui.th} sticky left-0 bg-card z-10`}>Élève</th>
                  {carnet.columns.map((c) => (
                    <th key={c.sessionId} className={`${ui.th} text-center whitespace-nowrap`} title={c.classes.length ? `Classes annoncées : ${c.classes.join(", ")}` : undefined}>
                      <Link href={`/admin/auto-evaluations?session=${c.sessionId}`} className="hover:underline">{c.label}</Link>
                      <span className="block font-normal normal-case tracking-normal text-ink-3">{fmtDay(c.dateMs)}</span>
                    </th>
                  ))}
                  <th className={`${ui.th} text-center`}>Moyenne</th>
                </tr>
              </thead>
              <tbody>
                {carnet.rows.map((r) => (
                  <tr key={r.studentId} className={ui.tr}>
                    <td className="p-2 sticky left-0 bg-card z-10 whitespace-nowrap">
                      <Link href={`/admin/eleves/${r.studentId}`} className="font-semibold hover:underline">{r.lastName} {r.firstName}</Link>
                      {selected.length > 1 && <span className={`${ui.chip} ${ui.chipMuted} ml-2`}>{r.className}</span>}
                    </td>
                    {carnet.columns.map((c) => {
                      const cell = r.cells[c.sessionId];
                      return (
                        <td key={c.sessionId} className="p-2 text-center tabular-nums whitespace-pre-line" title={tooltip(cell)}>
                          {cell.grade !== null ? (
                            <span className={cx("font-extrabold", gradeTone(cell.grade))}>{fmtGrade(cell.grade)}</span>
                          ) : cell.participated ? (
                            <span className="text-ink-3 font-bold">∅</span>
                          ) : (
                            <span className="text-line-2">·</span>
                          )}
                          {cell.reviewGrade !== null && <span className="block text-[10px] text-ink-3 leading-tight">prof {fmtGrade(cell.reviewGrade)}</span>}
                        </td>
                      );
                    })}
                    <td className="p-2 text-center tabular-nums">
                      <b className={gradeTone(r.mean)}>{fmtGrade(r.mean)}</b>
                      <span className="block text-[10px] text-ink-3 leading-tight">{r.graded} WOD</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line">
                  <td className="p-2 sticky left-0 bg-card z-10 text-xs font-bold uppercase tracking-wider text-ink-2">Moyenne {selected.length > 1 ? "du groupe" : "de la classe"}</td>
                  {carnet.columns.map((c) => (
                    <td key={c.sessionId} className={cx("p-2 text-center tabular-nums font-bold", gradeTone(carnet.columnMeans[c.sessionId]))}>{fmtGrade(carnet.columnMeans[c.sessionId])}</td>
                  ))}
                  <td className={cx("p-2 text-center tabular-nums font-extrabold", gradeTone(carnet.overallMean))}>{fmtGrade(carnet.overallMean)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
