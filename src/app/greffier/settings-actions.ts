"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWodEngine } from "@/lib/wod-engines";
import { setTeamCount } from "@/lib/team-count";

type Result = { error: string } | { ok: true };

// Tous les reglages de seance sont modifiables par le greffier AVANT le depart, puis verrouilles (verifie serveur).
async function requirePreStart(sessionId: string) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs?.startedAt) return { user, session, rs, locked: true as const };
  return { user, session, rs, locked: false as const };
}

export type RaceSettingsInput = {
  rep0: number;
  peak: number;
  step: number;
  capMin: number;
  afterMin: number;
  penMin: number;
  noStartExerciseIds: string[];
};

export async function updateRaceSettingsAction(sessionId: string, s: RaceSettingsInput): Promise<Result> {
  const { session, rs, locked } = await requirePreStart(sessionId);
  if (locked) return { error: "La course est lancée : les réglages sont verrouillés." };
  const int = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!int(s.rep0, 1, 99)) return { error: "Reps de départ : entier entre 1 et 99." };
  if (!int(s.peak, s.rep0, 99)) return { error: "Sommet : entier ≥ reps de départ (max 99)." };
  if (!int(s.step, 1, 20)) return { error: "Pas : entier entre 1 et 20." };
  if (!int(s.capMin, 1, 180)) return { error: "Durée max : entre 1 et 180 min." };
  if (!int(s.afterMin, 0, 60)) return { error: "Après la 1re arrivée : entre 0 et 60 min." };
  if (!int(s.penMin, 0, 30)) return { error: "Retrait par arrivée : entre 0 et 30 min." };
  const ids = new Set(getWodEngine(session.wodType).exercises.map((e) => e.id));
  const noStart = [...new Set(s.noStartExerciseIds)].filter((id) => ids.has(id));
  if (noStart.length >= ids.size) return { error: "Il faut au moins un exercice de départ autorisé." };

  const data = { rep0: s.rep0, peak: s.peak, step: s.step, capMin: s.capMin, afterMin: s.afterMin, penMin: s.penMin, noStartExerciseIds: noStart };
  if (rs) await db.orm.public.RaceState.where({ id: rs.id }).update(data);
  else await db.orm.public.RaceState.create({ sessionId, ...data });
  return { ok: true };
}

export type ExerciseInput = { id: string; label: string; number: number };

// Renommer / reordonner les exercices de la seance (surcharges dans Session.settings.exercises).
export async function updateExercisesAction(sessionId: string, list: ExerciseInput[]): Promise<Result> {
  const { session, locked } = await requirePreStart(sessionId);
  if (locked) return { error: "La course est lancée : les exercices sont verrouillés." };
  const base = getWodEngine(session.wodType).exercises;
  if (list.length !== base.length || new Set(list.map((e) => e.id)).size !== base.length || list.some((e) => !base.some((b) => b.id === e.id))) {
    return { error: "Liste d'exercices incohérente." };
  }
  const numbers = [...list.map((e) => e.number)].sort((a, b) => a - b);
  if (numbers.some((n, i) => n !== i + 1)) return { error: "L'ordre doit numéroter les exercices de 1 à n." };
  const overrides: Record<string, { label: string; number: number }> = {};
  for (const e of list) {
    const label = e.label.trim().slice(0, 40);
    if (!label) return { error: "Un exercice n'a pas de nom." };
    overrides[e.id] = { label, number: e.number };
  }
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, exercises: overrides } });
  return { ok: true };
}

// Nombre d'equipes (crop de la carte + flottes hors carte) : logique dans src/lib/team-count.ts (testable).
export async function setTeamCountAction(sessionId: string, n: number): Promise<Result> {
  const { locked } = await requirePreStart(sessionId);
  if (locked) return { error: "La course est lancée : le nombre d'équipes est verrouillé." };
  const res = await setTeamCount(sessionId, n);
  return "error" in res ? res : { ok: true };
}
