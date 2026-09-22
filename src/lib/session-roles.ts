// Constantes partagees client/serveur pour la preparation d'une seance par le greffier.
export const MAX_CLASSES = 5;

// Motif obligatoire pour arbitrer : un eleve qui arbitre au lieu de jouer dit pourquoi.
export const REFEREE_REASONS = ["Blessé(e)", "Abandon (DNF)", "Pas de tenue", "Sanctionné(e)", "Autre"] as const;
export type RefereeReason = (typeof REFEREE_REASONS)[number];
export const REFEREE_STATUSES = ["PENDING", "APPROVED", "REFUSED"] as const;
export type RefereeStatus = (typeof REFEREE_STATUSES)[number];

export function readSessionClasses(settings: unknown): string[] {
  const s = settings as { classes?: unknown } | null;
  return Array.isArray(s?.classes) ? (s!.classes as unknown[]).filter((c): c is string => typeof c === "string") : [];
}
