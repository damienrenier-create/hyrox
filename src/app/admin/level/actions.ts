"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { LEVEL_STAFF, listLevels, seedDefaultExercises } from "@/lib/level";
import type { Temporal as TemporalNS } from "temporal-spec";
import { isBoss, readCards, MAX_CARDS, DEFAULT_STARS, type LevelCard, type Stars } from "@/lib/wod-engines/templates/level-engine";
import { asStars } from "@/lib/level";

// Catalogue d'exercices et echelle des niveaux du WOD Level. Profs, coachs ET greffier construisent ;
// seul DAMZER supprime (regle de la console : les coachs ne suppriment rien).
type Res = { ok: true } | { error: string };
const PATH = "/admin/level";

async function requireLevelStaff() {
  const user = await getSession();
  if (!user || !(LEVEL_STAFF as readonly string[]).includes(user.role)) throw new Error("Accès refusé.");
  return user;
}
async function requireMaster() {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") throw new Error("Accès refusé (réservé à DAMZER).");
  return user;
}

const cleanLabel = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 40);
const parseWeight = (v: number | string) => {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 600 ? Math.round(n * 100) / 100 : null;
};

// ===== Catalogue =====
export async function createExerciseAction(label: string, weight: number | string): Promise<Res> {
  const user = await requireLevelStaff();
  const l = cleanLabel(label);
  const w = parseWeight(weight);
  if (l.length < 2) return { error: "Nom d'exercice trop court." };
  if (w === null) return { error: "Pondération invalide (entre 0,01 et 600 secondes par rep)." };
  if (await db.orm.public.LevelExercise.where({ label: l }).first()) return { error: `« ${l} » existe déjà.` };
  const all = await db.orm.public.LevelExercise.where({}).all();
  await db.orm.public.LevelExercise.create({ label: l, weight: w, active: true, order: all.length, createdBy: user.name });
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateExerciseAction(id: string, patch: { label?: string; weight?: number | string; active?: boolean }): Promise<Res> {
  await requireLevelStaff();
  const row = await db.orm.public.LevelExercise.where({ id }).first();
  if (!row) return { error: "Exercice introuvable." };
  const data: { label?: string; weight?: number; active?: boolean; updatedAt: TemporalNS.Instant } = { updatedAt: Temporal.Now.instant() };
  if (patch.label !== undefined) {
    const l = cleanLabel(patch.label);
    if (l.length < 2) return { error: "Nom d'exercice trop court." };
    const dup = await db.orm.public.LevelExercise.where({ label: l }).first();
    if (dup && dup.id !== id) return { error: `« ${l} » existe déjà.` };
    data.label = l;
  }
  if (patch.weight !== undefined) {
    const w = parseWeight(patch.weight);
    if (w === null) return { error: "Pondération invalide (entre 0,01 et 600 secondes par rep)." };
    data.weight = w;
  }
  if (patch.active !== undefined) data.active = patch.active;
  await db.orm.public.LevelExercise.where({ id }).update(data);
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteExerciseAction(id: string): Promise<Res> {
  await requireMaster();
  const used = (await listLevels()).filter((l) => l.cards.some((c) => c.exerciseId === id)).map((l) => l.number);
  if (used.length) return { error: `Impossible : cet exercice est utilisé au niveau ${used.join(", ")}. Désactive-le plutôt.` };
  await db.orm.public.LevelExercise.where({ id }).delete();
  revalidatePath(PATH);
  return { ok: true };
}

export async function seedExercisesAction(): Promise<Res & { added?: number }> {
  const user = await requireLevelStaff();
  const added = await seedDefaultExercises(user.name);
  revalidatePath(PATH);
  return { ok: true, added };
}

// ===== Niveaux =====
export async function createLevelAction(stars: Stars = DEFAULT_STARS): Promise<Res & { id?: string }> {
  await requireLevelStaff();
  const levels = await listLevels(asStars(stars));
  const number = (levels.at(-1)?.number ?? 0) + 1;
  const row = await db.orm.public.Level.create({ stars: asStars(stars), number, cards: [] });
  revalidatePath(PATH);
  return { ok: true, id: row.id };
}

export async function saveLevelAction(id: string, input: { name: string | null; cards: LevelCard[] }): Promise<Res> {
  await requireLevelStaff();
  const row = await db.orm.public.Level.where({ id }).first();
  if (!row) return { error: "Niveau introuvable." };
  const cards = readCards(input.cards);
  if (cards.length !== input.cards.length) return { error: "Une fiche est incomplète (exercice et nombre de reps entier > 0)." };
  if (cards.length > MAX_CARDS) return { error: `${MAX_CARDS} fiches maximum par niveau.` };
  if (isBoss(row.number) && cards.length > 1) return { error: "Un niveau BOSS n'a qu'un seul exercice : toute l'équipe travaille dessus." };
  if (cards.some((c) => c.reps > 10000)) return { error: "10 000 reps maximum par fiche." };
  const known = new Set((await db.orm.public.LevelExercise.where({}).all()).map((e) => e.id));
  if (cards.some((c) => !known.has(c.exerciseId))) return { error: "Une fiche pointe vers un exercice supprimé." };
  const name = (input.name ?? "").trim().slice(0, 40) || null;
  await db.orm.public.Level.where({ id }).update({ name, cards, updatedAt: Temporal.Now.instant() });
  revalidatePath(PATH);
  return { ok: true };
}

// Deplacer un niveau d'un cran : echange des numeros avec le voisin, en trois temps a cause de l'unicite.
export async function moveLevelAction(id: string, dir: "up" | "down"): Promise<Res> {
  await requireLevelStaff();
  const row = await db.orm.public.Level.where({ id }).first();
  if (!row) return { error: "Niveau introuvable." };
  const levels = await listLevels(asStars(row.stars));
  const i = levels.findIndex((l) => l.id === id);
  if (i < 0) return { error: "Niveau introuvable." };
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= levels.length) return { ok: true };
  const a = levels[i];
  const b = levels[j];
  await db.transaction(async (tx) => {
    await tx.orm.public.Level.where({ id: a.id }).update({ number: -1 });
    await tx.orm.public.Level.where({ id: b.id }).update({ number: a.number });
    await tx.orm.public.Level.where({ id: a.id }).update({ number: b.number });
  });
  revalidatePath(PATH);
  return { ok: true };
}

// Supprimer un niveau resserre la numerotation (les BOSS restent « tous les 5 », par position).
export async function deleteLevelAction(id: string): Promise<Res> {
  await requireMaster();
  const row = await db.orm.public.Level.where({ id }).first();
  if (!row) return { error: "Niveau introuvable." };
  const levels = await listLevels(asStars(row.stars));
  if (!levels.some((l) => l.id === id)) return { error: "Niveau introuvable." };
  await db.transaction(async (tx) => {
    await tx.orm.public.Level.where({ id }).delete();
    const rest = levels.filter((l) => l.id !== id);
    // D'abord hors de la plage (numeros negatifs), puis 1..n : jamais deux niveaux sur le meme numero.
    for (const [k, l] of rest.entries()) await tx.orm.public.Level.where({ id: l.id }).update({ number: -(k + 1) });
    for (const [k, l] of rest.entries()) await tx.orm.public.Level.where({ id: l.id }).update({ number: k + 1 });
  });
  revalidatePath(PATH);
  return { ok: true };
}
