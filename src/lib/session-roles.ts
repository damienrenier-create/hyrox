// Constantes partagees client/serveur pour la preparation d'une seance par le greffier.
export const MAX_CLASSES = 5;
export const REFEREE_NOTES = ["Arbitre", "DNF", "Blessé(e)", "Autre"] as const;
export type RefereeNote = (typeof REFEREE_NOTES)[number];

export function readSessionClasses(settings: unknown): string[] {
  const s = settings as { classes?: unknown } | null;
  return Array.isArray(s?.classes) ? (s!.classes as unknown[]).filter((c): c is string => typeof c === "string") : [];
}
