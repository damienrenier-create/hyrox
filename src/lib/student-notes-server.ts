import { db } from "@/lib/db";
import { linkedClassesFor, toMs, TZ } from "@/lib/scheduling";
import { readSessionClasses, readSessionSex } from "@/lib/session-roles";
import { REMIND_AFTER, REMIND_DAYS, noteActive, type NoteView, type PeriodView } from "@/lib/student-notes";

// Notes perso des profs (voir student-notes.ts) : chargement cote serveur.

export const todayKeyBxl = () => Temporal.Now.zonedDateTimeISO(TZ).toPlainDate().toString();
const shift = (key: string, days: number) => Temporal.PlainDate.from(key).add({ days }).toString();

type NoteRow = Awaited<ReturnType<typeof db.orm.public.StudentNote.all>>[number];
type Who = { id: string; name: string; className: string | null; sex: string | null };
const view = (n: NoteRow, u: Who | undefined, sessionId?: string): NoteView => ({
  id: n.id, studentId: n.studentId, studentName: u?.name ?? "?", className: u?.className ?? null, category: n.category ?? null, text: n.text,
  until: n.until ?? null, createdAt: toMs(n.createdAt), hiddenAt: n.hiddenAt ? toMs(n.hiddenAt) : null, ...(sessionId ? { sessionId } : {}),
});
async function people(ids: string[]): Promise<Map<string, Who>> {
  if (!ids.length) return new Map();
  const users = await db.orm.public.User.where((u) => u.id.in([...new Set(ids)])).all();
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, className: u.className ?? null, sex: u.sex ?? null }]));
}

// Les notes a montrer EN DEBUT DE COURS a un prof pour ces seances : ses notes actives sur les eleves de ces seances (leurs
// classes, le bon sexe si la seance est garcons/filles, les eleves de 1P rattaches a ces classes), sauf celles deja
// reportees « au prochain cours » pendant CETTE seance. Une note n'apparait qu'une fois (pour la 1re seance concernee).
export async function notesForSessions(authorId: string, sessions: { id: string; settings: unknown }[]): Promise<NoteView[]> {
  if (!sessions.length) return [];
  const today = todayKeyBxl();
  const notes = (await db.orm.public.StudentNote.where({ authorId }).all()).filter((n) => noteActive({ hiddenAt: n.hiddenAt, until: n.until ?? null }, today));
  if (!notes.length) return [];
  const who = await people(notes.map((n) => n.studentId));
  const oneP = [...who.values()].filter((u) => /^1P/i.test(u.className ?? "")).map((u) => u.id);
  const linked = oneP.length ? await linkedClassesFor(oneP) : new Map<string, Set<string>>();
  const out: NoteView[] = [];
  for (const s of sessions) {
    const classes = readSessionClasses(s.settings);
    const sex = readSessionSex(s.settings);
    for (const n of notes) {
      if (n.seenSessionId === s.id || out.some((x) => x.id === n.id)) continue;
      const u = who.get(n.studentId);
      if (!u) continue;
      const inClass = (!!u.className && classes.includes(u.className)) || [...(linked.get(u.id) ?? [])].some((c) => classes.includes(c));
      if (!inClass || (sex && u.sex && u.sex !== sex)) continue;
      out.push(view(n, u, s.id));
    }
  }
  return out.sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "") || a.studentName.localeCompare(b.studentName) || a.createdAt - b.createdAt);
}

// Toutes les notes d'un prof (fiche d'un eleve : studentId), masquees comprises, les plus recentes d'abord.
export async function notesOf(authorId: string, studentId?: string): Promise<NoteView[]> {
  const rows = (await db.orm.public.StudentNote.where(studentId ? { authorId, studentId } : { authorId }).all());
  const who = await people(rows.map((n) => n.studentId));
  return rows.map((n) => view(n, who.get(n.studentId))).sort((a, b) => b.createdAt - a.createdAt);
}

// Fins de periode de bulletin (dates retirees exclues), dans l'ordre.
export async function periodsOf(authorId: string): Promise<PeriodView[]> {
  return (await db.orm.public.NotePeriod.where({ authorId }).all()).filter((p) => !p.cancelledAt).sort((a, b) => a.endDate.localeCompare(b.endDate)).map((p) => ({ id: p.id, endDate: p.endDate, label: p.label ?? null, seen: !!p.seenAt }));
}
// La fin de periode a rappeler aujourd'hui (REMIND_DAYS jours avant, tant que le recapitulatif n'a pas ete ouvert).
export function dueReminder(periods: PeriodView[], today: string): PeriodView | null {
  return periods.find((p) => !p.seen && today >= shift(p.endDate, -REMIND_DAYS) && today <= shift(p.endDate, REMIND_AFTER)) ?? null;
}
// Bornes d'une periode : du lendemain de la fin de periode precedente (sinon depuis toujours) a sa date de fin.
export function periodBounds(periods: PeriodView[], p: PeriodView): { from: string | null; to: string } {
  const prev = periods.filter((x) => x.endDate < p.endDate).pop();
  return { from: prev ? shift(prev.endDate, 1) : null, to: p.endDate };
}
// Les notes d'une periode : ecrites avant sa fin, et pas masquees avant son debut (les notes masquees pendant la periode
// en font partie : l'app « garde en memoire toutes les notifs »).
export function inPeriod(n: NoteView, from: string | null, to: string): boolean {
  const created = new Date(n.createdAt).toLocaleDateString("en-CA", { timeZone: TZ });
  const hidden = n.hiddenAt ? new Date(n.hiddenAt).toLocaleDateString("en-CA", { timeZone: TZ }) : null;
  return created <= to && (!hidden || !from || hidden >= from);
}
