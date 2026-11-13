"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { isDateKey, readCategory } from "@/lib/student-notes";

// Notes perso des profs sur leurs eleves (Sartay 13/11, voir src/lib/student-notes.ts). Seul l'AUTEUR agit sur ses notes ;
// rien n'est jamais efface : « Ne plus me la montrer » = hiddenAt, une date de fin de periode retiree = cancelledAt.

type R = { ok: true } | { error: string };
async function staff() {
  const u = await getSession();
  return u && ["MASTER_ADMIN", "ADMIN"].includes(u.role) ? u : null;
}
function refresh() {
  revalidatePath("/admin");
  revalidatePath("/admin/notes");
  revalidatePath("/admin/badminton");
  revalidatePath("/admin/eleves/[id]", "page");
}
async function ownNote(noteId: string, userId: string) {
  const n = await db.orm.public.StudentNote.where({ id: String(noteId ?? "") }).first();
  return n && n.authorId === userId ? n : null;
}

export async function addNoteAction(input: { studentId: string; category?: string | null; text: string; until?: string | null }): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  const text = String(input.text ?? "").trim().slice(0, 600);
  if (!text) return { error: "Écris la note." };
  const s = await db.orm.public.User.where({ id: String(input.studentId ?? ""), role: "STUDENT" }).first();
  if (!s) return { error: "Choisis un élève." };
  const until = input.until && isDateKey(input.until) ? input.until : null;
  await db.orm.public.StudentNote.create({ authorId: u.id, studentId: s.id, category: readCategory(input.category), text, until });
  refresh();
  return { ok: true };
}

// « 🔁 Me le rappeler au prochain cours » : vue pour CETTE seance, elle reviendra au cours suivant.
export async function snoozeNotesAction(noteIds: string[], sessionId: string): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  const sid = String(sessionId ?? "");
  if (!sid) return { error: "Séance inconnue." };
  for (const id of [...new Set((noteIds ?? []).map(String))]) {
    if (!(await ownNote(id, u.id))) continue;
    await db.orm.public.StudentNote.where({ id }).update({ seenSessionId: sid, seenAt: Temporal.Now.instant() });
  }
  refresh();
  return { ok: true };
}

// « 🙈 Ne plus me la montrer » : masquee (gardee dans l'historique et le recapitulatif de fin de periode).
export async function hideNoteAction(noteId: string): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  if (!(await ownNote(noteId, u.id))) return { error: "Note introuvable." };
  await db.orm.public.StudentNote.where({ id: noteId }).update({ hiddenAt: Temporal.Now.instant() });
  refresh();
  return { ok: true };
}

// Reactiver une note masquee : elle se remontre au prochain cours.
export async function unhideNoteAction(noteId: string): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  if (!(await ownNote(noteId, u.id))) return { error: "Note introuvable." };
  await db.orm.public.StudentNote.where({ id: noteId }).update({ hiddenAt: null, seenSessionId: null });
  refresh();
  return { ok: true };
}

export async function addPeriodAction(input: { endDate: string; label?: string | null }): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  if (!isDateKey(input.endDate)) return { error: "Choisis la date de fin de période." };
  const label = String(input.label ?? "").trim().slice(0, 60) || null;
  await db.orm.public.NotePeriod.create({ authorId: u.id, endDate: input.endDate, label });
  refresh();
  return { ok: true };
}

export async function cancelPeriodAction(id: string): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  const p = await db.orm.public.NotePeriod.where({ id: String(id ?? "") }).first();
  if (!p || p.authorId !== u.id) return { error: "Date introuvable." };
  await db.orm.public.NotePeriod.where({ id: p.id }).update({ cancelledAt: Temporal.Now.instant() });
  refresh();
  return { ok: true };
}

// Recapitulatif ouvert : le rappel de fin de periode ne s'affiche plus.
export async function seePeriodAction(id: string): Promise<R> {
  const u = await staff();
  if (!u) return { error: "Réservé aux profs." };
  const p = await db.orm.public.NotePeriod.where({ id: String(id ?? "") }).first();
  if (!p || p.authorId !== u.id) return { error: "Date introuvable." };
  if (!p.seenAt) await db.orm.public.NotePeriod.where({ id: p.id }).update({ seenAt: Temporal.Now.instant() });
  return { ok: true };
}
