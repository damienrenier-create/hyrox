import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { inPeriod, notesOf, periodBounds, periodsOf, todayKeyBxl } from "@/lib/student-notes-server";
import { fmtDay, noteActive, noteIcon, type NoteView } from "@/lib/student-notes";
import { TopBar } from "../../_components/TopBar";
import { MarkPeriodSeen, NoteForm, NoteToggle, PeriodCancel, PeriodForm, PrintButton, type NoteRosterRow } from "./NotesClient";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// « 📝 Mes notes sur les élèves » (Sartay 13/11) : en ecrire, les retrouver (actives, masquees, terminees), les fins de
// periode de bulletin et leur recapitulatif. Seul l'auteur voit ses notes ; rien ne s'efface.
const VUES = [
  { id: "actives", name: "Actives" },
  { id: "masquees", name: "Masquées" },
  { id: "terminees", name: "Date passée" },
  { id: "toutes", name: "Toutes" },
] as const;
const day = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });

function NoteList({ notes, today, actions = true }: { notes: NoteView[]; today: string; actions?: boolean }) {
  const classes = [...new Set(notes.map((n) => n.className ?? "sans classe"))].sort();
  return (
    <div className="space-y-4">
      {classes.map((c) => {
        const inClass = notes.filter((n) => (n.className ?? "sans classe") === c);
        const students = [...new Set(inClass.map((n) => n.studentId))];
        return (
          <div key={c} className="space-y-2">
            <h4 className="font-display font-bold text-ink">{c}</h4>
            {students.map((sid) => {
              const mine = inClass.filter((n) => n.studentId === sid);
              return (
                <div key={sid} className="rounded-xl border border-line p-3 space-y-2 break-inside-avoid">
                  <Link href={`/admin/eleves/${sid}`} className="font-bold underline-offset-2 hover:underline">{mine[0].studentName}</Link>
                  {mine.map((n) => {
                    const active = noteActive({ hiddenAt: n.hiddenAt, until: n.until }, today);
                    return (
                      <div key={n.id} className={cx("flex flex-wrap items-start gap-2", !active && "opacity-70")}>
                        <span className="text-lg" aria-hidden>{noteIcon(n.category)}</span>
                        <div className="flex-1 min-w-[12rem]">
                          <p className="whitespace-pre-wrap">{n.text}</p>
                          <p className={ui.hint}>
                            notée le {day(n.createdAt)}
                            {n.until ? ` · jusqu'au ${fmtDay(n.until)}${n.until < today ? " (passée)" : ""}` : ""}
                            {n.hiddenAt ? ` · masquée le ${day(n.hiddenAt)}` : ""}
                          </p>
                        </div>
                        {actions && <NoteToggle id={n.id} hidden={!!n.hiddenAt} />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ eleve?: string; vue?: string; periode?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { eleve, vue, periode } = await searchParams;
  const today = todayKeyBxl();
  const [notes, periods] = await Promise.all([notesOf(user.id), periodsOf(user.id)]);

  // Recapitulatif d'une fin de periode : toutes les notes de la periode, masquees comprises.
  const p = periode ? periods.find((x) => x.id === periode) ?? null : null;
  if (p) {
    const { from, to } = periodBounds(periods, p);
    const list = notes.filter((n) => inPeriod(n, from, to));
    return (
      <div className={ui.page}>
        <TopBar title="📝 Récapitulatif de mes notes" subtitle={`${p.label ? `${p.label} · ` : ""}${from ? `du ${fmtDay(from)} au ${fmtDay(to)}` : `jusqu'au ${fmtDay(to)}`}`} back={{ href: "/admin/notes", label: "Mes notes" }} right={<PrintButton />} />
        <main className={`${ui.container} py-6 space-y-4`}>
          <MarkPeriodSeen id={p.id} />
          <p className={ui.hint}>{list.length} note{list.length > 1 ? "s" : ""} : celles écrites avant la fin de la période et pas masquées avant son début (les notes masquées pendant la période y sont).</p>
          {list.length ? <section className={ui.cardPad}><NoteList notes={list} today={today} actions={false} /></section> : <p className={ui.cardPad}>Aucune note pour cette période.</p>}
        </main>
      </div>
    );
  }

  const v = VUES.find((x) => x.id === vue)?.id ?? "actives";
  const shown = notes.filter((n) => {
    const active = noteActive({ hiddenAt: n.hiddenAt, until: n.until }, today);
    return v === "toutes" || (v === "actives" && active) || (v === "masquees" && !!n.hiddenAt) || (v === "terminees" && !n.hiddenAt && !active);
  });
  const roster: NoteRosterRow[] = (await db.orm.public.User.where({ role: "STUDENT" }).all()).map((s) => ({ id: s.id, name: s.name, className: s.className ?? null })).sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "") || a.name.localeCompare(b.name));
  const count = (id: (typeof VUES)[number]["id"]) => notes.filter((n) => { const a = noteActive({ hiddenAt: n.hiddenAt, until: n.until }, today); return id === "toutes" || (id === "actives" && a) || (id === "masquees" && !!n.hiddenAt) || (id === "terminees" && !n.hiddenAt && !a); }).length;
  return (
    <div className={ui.page}>
      <TopBar title="📝 Mes notes sur les élèves" subtitle="Elles s'affichent au début des cours ; vous seul les voyez" back={{ href: "/admin", label: "Console" }} />
      <main className={`${ui.container} py-6 space-y-5`}>
        <NoteForm roster={roster} preset={eleve ?? null} />
        <section className={`${ui.cardPad} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={ui.h3}>Mes notes</h3>
            <div className={cx(ui.segmented, "flex-wrap")}>
              {VUES.map((x) => <Link key={x.id} href={`/admin/notes?vue=${x.id}`} className={cx("text-sm font-bold px-3 py-1.5 rounded-lg whitespace-nowrap", v === x.id ? ui.segOn : ui.segOff)}>{x.name} · {count(x.id)}</Link>)}
            </div>
          </div>
          {shown.length ? <NoteList notes={shown} today={today} /> : <p className={ui.hint}>Aucune note ici.</p>}
        </section>
        <section className={`${ui.cardPad} space-y-3`}>
          <h3 className={ui.h3}>🗓️ Fins de période de bulletin</h3>
          <p className={ui.hint}>Une semaine avant chaque date, la console vous rappelle de relire le récapitulatif de vos notes de la période (toutes, masquées comprises).</p>
          {periods.length > 0 && (
            <ul className="space-y-1.5">
              {periods.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2">
                  <b>{fmtDay(x.endDate)}</b>{x.label && <span>· {x.label}</span>}
                  <Link href={`/admin/notes?periode=${x.id}`} className="text-sm underline">Récapitulatif</Link>
                  {x.endDate < today && x.seen && <span className={cx(ui.chip, ui.chipOk)}>vu</span>}
                  <PeriodCancel id={x.id} when={fmtDay(x.endDate)} />
                </li>
              ))}
            </ul>
          )}
          <PeriodForm />
        </section>
      </main>
    </div>
  );
}
