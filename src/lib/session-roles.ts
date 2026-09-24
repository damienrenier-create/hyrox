// Constantes partagees client/serveur pour la preparation d'une seance par le greffier.
// 6 depuis le 23/09 : les groupes AC Sport de DAMZER (2Ce, 2Cf, 2Cg, 2Sb, 2Sd, 2Se) comptent six classes.
export const MAX_CLASSES = 6;

// Classes de TEST (7A : 20 eleves fictifs, PIN 1234) : elles servent a tout essayer et n'entrent JAMAIS dans
// une statistique ou un palmares. Une classe est « test » si elle commence par 7 (il n'y a pas de 7e annee).
export const TEST_CLASS_PREFIX = "7";
export const isTestClass = (className: string | null | undefined): boolean => !!className && className.trim().startsWith(TEST_CLASS_PREFIX);

// Motif obligatoire pour arbitrer : un eleve qui arbitre au lieu de jouer dit pourquoi.
export const REFEREE_REASONS = ["Blessé(e)", "Abandon (DNF)", "Pas de tenue", "Sanctionné(e)", "Autre"] as const;
export type RefereeReason = (typeof REFEREE_REASONS)[number];
export const REFEREE_STATUSES = ["PENDING", "APPROVED", "REFUSED"] as const;
export type RefereeStatus = (typeof REFEREE_STATUSES)[number];

// Phrase a taper en toutes lettres avant un effacement definitif (page /admin/nettoyage).
// C'est le « mot de passe » du grand menage : rien ne part tant qu'elle n'est pas saisie exactement.
export const CLEANUP_PHRASE = "EFFACER LES TESTS";

export function readSessionClasses(settings: unknown): string[] {
  const s = settings as { classes?: unknown } | null;
  return Array.isArray(s?.classes) ? (s!.classes as unknown[]).filter((c): c is string => typeof c === "string") : [];
}

// Classes concernees par un cycle (Cycle.classes, JSON) : null ou vide = toutes les classes.
// Ex. : le cycle Hyrox n'a jamais de deuxiemes ; leurs creneaux ne doivent alors rien ouvrir dans ce cycle.
export function readCycleClasses(classes: unknown): string[] | null {
  const list = Array.isArray(classes) ? (classes as unknown[]).filter((c): c is string => typeof c === "string" && c.trim() !== "") : [];
  return list.length ? [...new Set(list)] : null;
}
