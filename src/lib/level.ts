import { db } from "@/lib/db";
import { DEFAULT_EXERCISES } from "@/lib/level-catalog";
import {
  isBoss, readCards, readFrozenLevels, readLadders, ladderFor, statsOf, MAX_CARDS, STARS, DEFAULT_STARS,
  type FrozenLevel, type LevelCard, type Stars,
} from "@/lib/wod-engines/templates/level-engine";

// WOD Level, cote serveur : catalogue d'exercices ponderes, echelle des niveaux, et son gel dans une seance.

export type ExerciseRow = { id: string; label: string; weight: number; active: boolean; order: number };
export type LevelRow = { id: string; stars: Stars; number: number; name: string | null; cards: LevelCard[] };
export const asStars = (v: unknown): Stars => (v === 1 || v === 3 ? v : DEFAULT_STARS);
export const LEVEL_STAFF = ["MASTER_ADMIN", "ADMIN", "GREFFIER"] as const;

export { DEFAULT_EXERCISES } from "@/lib/level-catalog";

export async function listExercises(): Promise<ExerciseRow[]> {
  const rows = await db.orm.public.LevelExercise.where({}).all();
  return rows
    .map((r) => ({ id: r.id, label: r.label, weight: Number(r.weight), active: r.active, order: r.order }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "fr"));
}

// Echelle d'un parcours (stars) ou les trois (stars absent), par parcours puis par numero.
export async function listLevels(stars?: Stars): Promise<LevelRow[]> {
  const rows = await db.orm.public.Level.where(stars ? { stars } : {}).all();
  return rows
    .map((r) => ({ id: r.id, stars: asStars(r.stars), number: r.number, name: r.name ?? null, cards: readCards(r.cards) }))
    .sort((a, b) => a.stars - b.stars || a.number - b.number);
}

// Ajoute les exercices du listing qui manquent (par libelle), sans toucher aux existants ni a leur ponderation.
export async function seedDefaultExercises(by: string): Promise<number> {
  // Renommage du 24/09 : « AR » s'ecrit « ALLER-RETOUR » partout.
  const rows = await db.orm.public.LevelExercise.where({}).all();
  const ar = rows.find((r) => r.label.trim().toUpperCase() === "AR");
  if (ar && !rows.some((r) => r.label.trim().toUpperCase() === "ALLER-RETOUR")) {
    await db.orm.public.LevelExercise.where({ id: ar.id }).update({ label: "ALLER-RETOUR" });
    ar.label = "ALLER-RETOUR";
  }
  const existing = new Set(rows.map((r) => r.label.trim().toUpperCase()));
  let n = 0;
  for (const [i, e] of DEFAULT_EXERCISES.entries()) {
    if (existing.has(e.label)) continue;
    await db.orm.public.LevelExercise.create({ label: e.label, weight: e.weight, active: true, order: i, createdBy: by });
    n++;
  }
  return n;
}

// L'echelle telle qu'elle sera figee dans une seance : chaque fiche emporte le libelle et la ponderation du
// moment. Une fiche dont l'exercice a disparu est ignoree (le constructeur refuse d'en enregistrer).
export async function freezeLevels(stars: Stars = DEFAULT_STARS): Promise<FrozenLevel[]> {
  const [levels, exercises] = await Promise.all([listLevels(stars), listExercises()]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return freezeRows(levels, byId);
}
// Les trois parcours d'un coup (coup d'envoi) : un parcours vide retombe sur le 2 etoiles au moment de jouer.
export async function freezeLadders(): Promise<Record<Stars, FrozenLevel[]>> {
  const [levels, exercises] = await Promise.all([listLevels(), listExercises()]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return { 1: freezeRows(levels.filter((l) => l.stars === 1), byId), 2: freezeRows(levels.filter((l) => l.stars === 2), byId), 3: freezeRows(levels.filter((l) => l.stars === 3), byId) };
}
function freezeRows(levels: LevelRow[], byId: Map<string, ExerciseRow>): FrozenLevel[] {
  return levels.map((l) => ({
    number: l.number,
    name: l.name,
    boss: isBoss(l.number),
    cards: l.cards
      .slice(0, MAX_CARDS)
      .map((c) => {
        const e = byId.get(c.exerciseId);
        return e ? { exerciseId: c.exerciseId, reps: c.reps, label: e.label, weight: e.weight } : null;
      })
      .filter((c): c is NonNullable<typeof c> => !!c),
  }));
}

// Echelle figee d'une seance : le parcours 2 etoiles (settings.levels), ou celui demande s'il est fige.
export function readFrozenFromSettings(settings: unknown, stars: Stars = DEFAULT_STARS): FrozenLevel[] {
  const s = settings as { levels?: unknown } | null;
  const levels = readFrozenLevels(s?.levels);
  return stars === DEFAULT_STARS ? levels : ladderFor(levels, readLadders(settings), stars);
}
export { STARS };

export type LevelSummary = { number: number; boss: boolean; cards: number; reps: number; weighted: number; intensity: number };
export function summarize(levels: FrozenLevel[]): LevelSummary[] {
  return levels.map((l) => ({ number: l.number, boss: l.boss, cards: l.cards.length, ...statsOf(l.cards) }));
}
