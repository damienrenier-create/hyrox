"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { DEFAULT_PERIODS, MAX_SLOT_CLASSES, WEEKDAYS, fmtMin, overlaps, periodsCovered, slotEndFor, type SlotRow } from "@/lib/journal";
import { teacherNameById } from "@/lib/staff";

// Actions du journal de classe. Chaque prof (ADMIN) ne modifie que le sien ; DAMZER (MASTER_ADMIN) les modifie
// tous. Toute verification de conflit se fait ici, cote serveur : le client ne fait que poser et deplacer.

export type JournalResult = { ok: true } | { error: string };

const MINUTES_IN_DAY = 24 * 60;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function requireOwner(teacherId: string | null) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  if (user.role === "MASTER_ADMIN") return user;
  if (!teacherId) throw new Error("Créneau de l'ancien horaire commun : seul DAMZER peut le modifier.");
  if (user.id !== teacherId) throw new Error("Ce journal de classe n'est pas le tien.");
  return user;
}

function bump() {
  revalidatePath("/admin/journal");
  revalidatePath("/admin/carnet");
  revalidatePath("/admin");
}

async function allSlots(): Promise<SlotRow[]> {
  return (await db.orm.public.ClassSlot.where({}).all()) as SlotRow[];
}

function validTimes(startMin: number, endMin: number): string | null {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > MINUTES_IN_DAY) return "Heures invalides.";
  if (endMin <= startMin) return "L'heure de fin doit être après le début.";
  return null;
}

const dayName = (weekday: number) => (WEEKDAYS[weekday] ?? "").toLowerCase();

// Ces classes peuvent-elles occuper [startMin, endMin) ce jour-la, pour ce prof ?
// - une classe n'a cours qu'a un seul endroit a la fois (chez ce prof ou chez un autre) ;
// - un prof ne tient qu'une seance a la fois : ses autres creneaux ne peuvent pas chevaucher.
// `ignore` = lignes qu'on est en train de deplacer/retimer (elles ne comptent pas contre elles-memes).
async function conflictFor(
  rows: SlotRow[],
  teacherId: string,
  weekday: number,
  startMin: number,
  endMin: number,
  classNames: string[],
  ignore: Set<string>
): Promise<string | null> {
  let names: Map<string, string> | null = null;
  for (const r of rows) {
    if (ignore.has(r.id) || r.weekday !== weekday || !overlaps(startMin, endMin, r.startMin, r.endMin)) continue;
    const sameGroup = r.teacherId === teacherId && r.startMin === startMin && r.endMin === endMin;
    if (classNames.includes(r.className)) {
      if (sameGroup) return `${r.className} est déjà dans ce créneau.`;
      names ??= await teacherNameById();
      const who = r.teacherId === teacherId ? "dans ton journal" : r.teacherId ? `chez ${names.get(r.teacherId) ?? "un autre prof"}` : "dans l'ancien horaire commun";
      return `${r.className} a déjà cours le ${dayName(weekday)} de ${fmtMin(r.startMin)} à ${fmtMin(r.endMin)} ${who}.`;
    }
    if (r.teacherId === teacherId && !sameGroup) {
      return `Tu as déjà un créneau ${fmtMin(r.startMin)}–${fmtMin(r.endMin)} le ${dayName(weekday)} qui chevauche celui-ci : ajoute la classe dedans, ou déplace-le.`;
    }
  }
  return null;
}

// Pose une classe a une heure de depart. Si le prof a deja un creneau qui contient cette minute, la classe
// s'y ajoute (memes heures, meme seance-type) ; sinon un nouveau creneau est cree : `endMin` s'il est donne,
// sinon deux periodes de la grille (la petite recre entre les deux est enjambee, jamais le temps de midi).
export async function placeClassAction(input: { teacherId: string; weekday: number; startMin: number; className: string; endMin?: number | null }): Promise<JournalResult> {
  try {
    const { teacherId, weekday } = input;
    const className = input.className.trim();
    await requireOwner(teacherId);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 5) return { error: "Jour invalide (lundi à vendredi)." };
    if (!className) return { error: "Classe requise." };

    const rows = await allSlots();
    const mine = rows.filter((r) => r.teacherId === teacherId && r.weekday === weekday);
    const host = mine.find((r) => r.startMin <= input.startMin && input.startMin < r.endMin);
    let startMin: number;
    let endMin: number;
    let planId: string | null = null;
    if (host) {
      startMin = host.startMin;
      endMin = host.endMin;
      const group = mine.filter((r) => r.startMin === host.startMin && r.endMin === host.endMin);
      if (group.length >= MAX_SLOT_CLASSES) return { error: `Ce créneau a déjà ${MAX_SLOT_CLASSES} classes : c'est le maximum pour une seule séance.` };
      planId = group.find((r) => r.planId)?.planId ?? null;
    } else {
      startMin = input.startMin;
      endMin = input.endMin ?? slotEndFor(startMin, DEFAULT_PERIODS);
    }
    const bad = validTimes(startMin, endMin);
    if (bad) return { error: bad };
    const conflict = await conflictFor(rows, teacherId, weekday, startMin, endMin, [className], new Set());
    if (conflict) return { error: conflict };

    await db.orm.public.ClassSlot.create({ className, weekday, startMin, endMin, teacherId, planId });
    bump();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

// Deplace UNE classe vers une autre case : dans un creneau existant du prof (elle s'y ajoute) ou vers une
// heure libre (elle garde son nombre de periodes ; hors grille, sa duree brute).
export async function moveClassAction(input: { slotId: string; weekday: number; startMin: number }): Promise<JournalResult> {
  try {
    const row = (await db.orm.public.ClassSlot.where({ id: input.slotId }).first()) as SlotRow | null;
    if (!row) return { error: "Ce créneau n'existe plus (la page va se rafraîchir)." };
    await requireOwner(row.teacherId);
    if (!row.teacherId) return { error: "Créneau de l'ancien horaire commun : supprime-le et recrée-le dans le journal." };
    if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 5) return { error: "Jour invalide." };

    const rows = await allSlots();
    const others = rows.filter((r) => r.id !== row.id);
    const mine = others.filter((r) => r.teacherId === row.teacherId && r.weekday === input.weekday);
    const host = mine.find((r) => r.startMin <= input.startMin && input.startMin < r.endMin);
    let startMin: number;
    let endMin: number;
    let planId = row.planId;
    if (host) {
      startMin = host.startMin;
      endMin = host.endMin;
      const group = mine.filter((r) => r.startMin === host.startMin && r.endMin === host.endMin);
      if (group.length >= MAX_SLOT_CLASSES) return { error: `Ce créneau a déjà ${MAX_SLOT_CLASSES} classes : c'est le maximum pour une seule séance.` };
      planId = group.find((r) => r.planId)?.planId ?? null;
    } else {
      startMin = input.startMin;
      const n = periodsCovered(row.startMin, row.endMin);
      endMin = n > 0 ? slotEndFor(startMin, n) : startMin + (row.endMin - row.startMin);
    }
    if (input.weekday === row.weekday && startMin === row.startMin && endMin === row.endMin) return { ok: true };
    const bad = validTimes(startMin, endMin);
    if (bad) return { error: bad };
    const conflict = await conflictFor(others, row.teacherId, input.weekday, startMin, endMin, [row.className], new Set());
    if (conflict) return { error: conflict };

    await db.orm.public.ClassSlot.where({ id: row.id }).update({ weekday: input.weekday, startMin, endMin, planId });
    bump();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function removeClassAction(input: { slotId: string }): Promise<JournalResult> {
  try {
    const row = (await db.orm.public.ClassSlot.where({ id: input.slotId }).first()) as SlotRow | null;
    if (!row) return { ok: true }; // deja retiree
    await requireOwner(row.teacherId);
    await db.orm.public.ClassSlot.where({ id: row.id }).delete();
    bump();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

type GroupRef = { teacherId: string; weekday: number; startMin: number; endMin: number };

async function groupRows(rows: SlotRow[], g: GroupRef): Promise<SlotRow[]> {
  return rows.filter((r) => r.teacherId === g.teacherId && r.weekday === g.weekday && r.startMin === g.startMin && r.endMin === g.endMin);
}

// Change les heures d'un creneau entier (toutes ses classes ensemble), a la minute pres.
export async function setSlotTimesAction(input: GroupRef & { newStart: number; newEnd: number }): Promise<JournalResult> {
  try {
    await requireOwner(input.teacherId);
    const bad = validTimes(input.newStart, input.newEnd);
    if (bad) return { error: bad };
    const rows = await allSlots();
    const group = await groupRows(rows, input);
    if (!group.length) return { error: "Créneau introuvable : il a peut-être déjà été modifié (la page va se rafraîchir)." };
    if (input.newStart === input.startMin && input.newEnd === input.endMin) return { ok: true };

    const ids = new Set(group.map((r) => r.id));
    // Fusion avec un creneau du prof qui aurait deja exactement ces heures : pas plus de MAX classes au total.
    const twin = rows.filter((r) => !ids.has(r.id) && r.teacherId === input.teacherId && r.weekday === input.weekday && r.startMin === input.newStart && r.endMin === input.newEnd);
    if (twin.length + group.length > MAX_SLOT_CLASSES) return { error: `En fusionnant avec ton créneau ${fmtMin(input.newStart)}–${fmtMin(input.newEnd)}, tu dépasserais ${MAX_SLOT_CLASSES} classes.` };
    const conflict = await conflictFor(rows, input.teacherId, input.weekday, input.newStart, input.newEnd, group.map((r) => r.className), ids);
    if (conflict) return { error: conflict };

    for (const r of group) await db.orm.public.ClassSlot.where({ id: r.id }).update({ startMin: input.newStart, endMin: input.newEnd });
    bump();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

// Impose une seance-type a un creneau (null = revenir a la seance de la semaine).
export async function setSlotPlanAction(input: GroupRef & { planId: string | null }): Promise<JournalResult> {
  try {
    await requireOwner(input.teacherId);
    if (input.planId && !(await db.orm.public.CyclePlan.where({ id: input.planId }).first())) return { error: "Séance-type introuvable." };
    const group = await groupRows(await allSlots(), input);
    if (!group.length) return { error: "Créneau introuvable." };
    for (const r of group) await db.orm.public.ClassSlot.where({ id: r.id }).update({ planId: input.planId });
    bump();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

// Supprime un creneau entier (toutes ses classes). Ne touche a aucune seance deja ouverte ou jouee.
export async function deleteSlotGroupAction(input: GroupRef): Promise<JournalResult> {
  try {
    await requireOwner(input.teacherId);
    const group = await groupRows(await allSlots(), input);
    for (const r of group) await db.orm.public.ClassSlot.where({ id: r.id }).delete();
    bump();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}
