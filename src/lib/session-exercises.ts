import { getWodEngine } from "@/lib/wod-engines";

export type ExerciseDef = { id: string; label: string; number: number };
export type ExerciseOverride = { label?: string; number?: number };

// Le greffier peut, avant le depart, renommer / reordonner les exercices d'une seance : les surcharges vivent
// dans Session.settings.exercises = { [exerciseId]: { label?, number? } }. Le moteur reste la source des ids.
export function readExerciseOverrides(settings: unknown): Record<string, ExerciseOverride> {
  const s = settings as { exercises?: unknown } | null;
  const raw = s?.exercises;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ExerciseOverride> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as { label?: unknown; number?: unknown };
    out[id] = {
      ...(typeof o.label === "string" && o.label.trim() ? { label: o.label.trim() } : {}),
      ...(typeof o.number === "number" && Number.isFinite(o.number) ? { number: o.number } : {}),
    };
  }
  return out;
}

export function exercisesFor(session: { wodType: string; settings?: unknown }): ExerciseDef[] {
  const base = getWodEngine(session.wodType).exercises;
  const ov = readExerciseOverrides(session.settings);
  return base
    .map((e) => ({ id: e.id, label: ov[e.id]?.label ?? e.label, number: ov[e.id]?.number ?? e.number }))
    .sort((a, b) => a.number - b.number);
}
