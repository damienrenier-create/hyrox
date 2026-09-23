import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { currentCycleAndPlan } from "@/lib/scheduling";
import { WEEKDAYS, fmtMin, groupLabel, groupSlots, type SlotRow } from "@/lib/journal";
import { listTeachers } from "@/lib/staff";
import { readCycleClasses } from "@/lib/session-roles";
import { displayPseudo } from "@/lib/staff-names";
import { TopBar } from "../../_components/TopBar";
import { JournalClient, type Elsewhere, type PlanOption } from "./JournalClient";
import { btn, cx, ui } from "@/lib/ui";

// Journal de classe : l'horaire hebdomadaire d'un prof. Chaque coach voit et modifie le sien ; DAMZER peut
// ouvrir celui de n'importe quel prof (?prof=<id>). Les seances s'ouvrent automatiquement d'apres ces creneaux.
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ prof?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const isMaster = user.role === "MASTER_ADMIN";
  const { prof } = await searchParams;

  const teachers = await listTeachers();
  const viewedId = isMaster && prof && teachers.some((t) => t.id === prof) ? prof : user.id;
  const viewedName = teachers.find((t) => t.id === viewedId)?.name ?? displayPseudo(user.name);
  const nameOf = new Map(teachers.map((t) => [t.id, t.name]));

  const [allSlots, students, { cycle, plan }] = await Promise.all([
    db.orm.public.ClassSlot.where({}).all().then((rows) => rows as SlotRow[]),
    db.orm.public.User.where({ role: "STUDENT" }).all(),
    currentCycleAndPlan(),
  ]);
  const classes = [...new Set(students.map((u) => u.className).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const mine = allSlots.filter((s) => s.teacherId === viewedId);
  const groups = groupSlots(mine);

  // Ou les classes ont cours chez les AUTRES : affiche en info-bulle dans la palette, tranche par le serveur.
  const elsewhere: Record<string, Elsewhere[]> = {};
  for (const s of allSlots) {
    if (s.teacherId === viewedId) continue;
    (elsewhere[s.className] ??= []).push({ weekday: s.weekday, startMin: s.startMin, endMin: s.endMin, who: s.teacherId ? nameOf.get(s.teacherId) ?? "un autre prof" : "horaire commun" });
  }

  const plans: PlanOption[] = cycle
    ? (await db.orm.public.CyclePlan.where({ cycleId: cycle.id }).orderBy((p) => p.order.asc()).all()).map((p) => ({ id: p.id, label: p.label, isCurrent: p.isCurrent }))
    : [];

  return (
    <div className={ui.page}>
      <TopBar
        title="Journal de classe"
        subtitle={<>{viewedName} · {groups.length} créneau{groups.length > 1 ? "x" : ""} par semaine · cycle : <b className="text-ink">{cycle?.name ?? "aucun"}</b> · séance de la semaine : <b className="text-ink">{plan?.label ?? "aucune"}</b></>}
        back={{ href: "/admin", label: "Console" }}
        wide
        right={
          <nav className="flex flex-wrap items-center gap-2">
            <Link href={viewedId === user.id ? "/admin/carnet" : `/admin/carnet?prof=${viewedId}`} className={btn.smGhost}>Carnet de cotes</Link>
            <Link href="/admin" className={btn.smGhost}>Console</Link>
          </nav>
        }
      >
        {isMaster && teachers.length > 1 && (
          <div className={`${ui.segmented} flex-wrap`}>
            {teachers.map((t) => (
              <Link
                key={t.id}
                href={t.id === user.id ? "/admin/journal" : `/admin/journal?prof=${t.id}`}
                className={cx("px-3 py-1.5 rounded-lg text-xs font-bold transition", t.id === viewedId ? ui.segOn : ui.segOff)}
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </TopBar>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-4">
        {!plan && (
          <p className={ui.alertWarn}>
            Aucune « séance de la semaine » n&apos;est définie dans la console : les créneaux sans séance-type imposée ne pourront rien ouvrir tant qu&apos;un cycle et une séance de la semaine n&apos;existent pas.
          </p>
        )}

        <JournalClient
          teacherId={viewedId}
          slots={mine}
          classes={classes}
          plans={plans}
          elsewhere={elsewhere}
          cycleClasses={cycle ? readCycleClasses(cycle.classes) : null}
          cycleName={cycle?.name ?? null}
        />

        <section className={ui.cardPad}>
          <h2 className={`${ui.h3} mb-1`}>Groupes de ce journal</h2>
          <p className={`${ui.hint} mb-3`}>
            Chaque créneau forme un groupe : ses classes partagent la même séance, et le carnet de cotes les lit ensemble.
          </p>
          {groups.length === 0 ? (
            <p className={ui.muted}>Aucun créneau pour l&apos;instant : pose une classe dans la grille ci-dessus.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {groups.map((g) => {
                const names = g.classes.map((c) => c.className);
                const href = `/admin/carnet?classes=${encodeURIComponent(names.join(","))}${viewedId !== user.id ? `&prof=${viewedId}` : ""}`;
                return (
                  <li key={g.key} className={`${ui.inset} p-3 flex items-center justify-between gap-2`}>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold uppercase text-ink-3">{WEEKDAYS[g.weekday]} {fmtMin(g.startMin)}–{fmtMin(g.endMin)}</div>
                      <div className="font-bold truncate">{groupLabel(names)}</div>
                    </div>
                    <Link href={href} className={btn.smGhost}>Carnet</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
