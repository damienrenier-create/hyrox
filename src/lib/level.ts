import { db } from "@/lib/db";
import {
  isBoss, readCards, readFrozenLevels, statsOf, MAX_CARDS,
  type FrozenLevel, type LevelCard,
} from "@/lib/wod-engines/templates/level-engine";

// WOD Level, cote serveur : catalogue d'exercices ponderes, echelle des niveaux, et son gel dans une seance.

export type ExerciseRow = { id: string; label: string; weight: number; active: boolean; order: number };
export type LevelRow = { id: string; number: number; name: string | null; cards: LevelCard[] };
export const LEVEL_STAFF = ["MASTER_ADMIN", "ADMIN", "GREFFIER"] as const;

// Le listing de Sartay (« listing exos.xlsx », 24/09/2026) : ponderation = temps theorique d'une rep, en s.
export const DEFAULT_EXERCISES: { label: string; weight: number }[] = [
  { label: "CORDE", weight: 1 },
  { label: "KB TOUR", weight: 1 },
  { label: "COMMANDO BRAS", weight: 2 },
  { label: "SQUATS JUMP", weight: 2 },
  { label: "KB SWING", weight: 2 },
  { label: "FENTES DISK", weight: 2 },
  { label: "SMASH DOWN", weight: 3 },
  { label: "BOX JUMP", weight: 3 },
  { label: "POMPES", weight: 3 },
  { label: "KB SNATCH", weight: 3 },
  { label: "MONKEY SLIDE", weight: 3 },
  { label: "PLANK SLIDE", weight: 3 },
  { label: "WALL BALL SHOT", weight: 3 },
  { label: "FLIP TAPIS", weight: 4 },
  { label: "TRACTIONS", weight: 5 },
  { label: "TOUR DE POUTRE", weight: 5 },
  { label: "BURPEES", weight: 7 },
  { label: "BREAK DANCE", weight: 8 },
  { label: "AR", weight: 15 },
  { label: "ONE REP", weight: 15 },
  { label: "TIRE TAPIS AR", weight: 30 },
];

export async function listExercises(): Promise<ExerciseRow[]> {
  const rows = await db.orm.public.LevelExercise.where({}).all();
  return rows
    .map((r) => ({ id: r.id, label: r.label, weight: Number(r.weight), active: r.active, order: r.order }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "fr"));
}

export async function listLevels(): Promise<LevelRow[]> {
  const rows = await db.orm.public.Level.where({}).all();
  return rows
    .map((r) => ({ id: r.id, number: r.number, name: r.name ?? null, cards: readCards(r.cards) }))
    .sort((a, b) => a.number - b.number);
}

// Ajoute les exercices du listing qui manquent (par libelle), sans toucher aux existants ni a leur ponderation.
export async function seedDefaultExercises(by: string): Promise<number> {
  const existing = new Set((await db.orm.public.LevelExercise.where({}).all()).map((r) => r.label.trim().toUpperCase()));
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
export async function freezeLevels(): Promise<FrozenLevel[]> {
  const [levels, exercises] = await Promise.all([listLevels(), listExercises()]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
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

export function readFrozenFromSettings(settings: unknown): FrozenLevel[] {
  const s = settings as { levels?: unknown } | null;
  return readFrozenLevels(s?.levels);
}

export type LevelSummary = { number: number; boss: boolean; cards: number; reps: number; weighted: number; intensity: number };
export function summarize(levels: FrozenLevel[]): LevelSummary[] {
  return levels.map((l) => ({ number: l.number, boss: l.boss, cards: l.cards.length, ...statsOf(l.cards) }));
}
