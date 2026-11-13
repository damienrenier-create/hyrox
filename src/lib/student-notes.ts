// Notes perso d'un prof sur ses eleves (Sartay 13/11 : « des notes perso qui pop en debut de cours, jusqu'a ce que je
// clique sur me le rappeler au prochain cours ou je ne veux plus voir cette notification ; l'app garde en memoire toutes
// les notifs et me les remontre a chaque fin de periode »). Module PUR (importable cote client). Donnees : tables
// StudentNote et NotePeriod ; chargement : student-notes-server.ts ; actions : app/admin/notes/actions.ts.
// Regles : seul l'AUTEUR voit ses notes ; rien n'est jamais efface (masquer = hiddenAt, reactivable).

export const NOTE_CATEGORIES = [
  { id: "MEDICAL", icon: "🩺", name: "Médical" },
  { id: "ADMIN", icon: "📋", name: "Administratif" },
  { id: "TENUE", icon: "👕", name: "Tenue" },
  { id: "AUTRE", icon: "📝", name: "Autre" },
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]["id"];
export const noteIcon = (c: string | null) => NOTE_CATEGORIES.find((x) => x.id === c)?.icon ?? "📝";
export const readCategory = (c: unknown): NoteCategory | null => (NOTE_CATEGORIES.some((x) => x.id === c) ? (c as NoteCategory) : null);
export const isDateKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const fmtDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

// Une note s'affiche en debut de cours si elle n'est pas masquee et que sa date de fin (s'il y en a une) n'est pas passee.
export function noteActive(n: { hiddenAt: unknown; until: string | null }, today: string): boolean {
  return !n.hiddenAt && (!n.until || n.until >= today);
}

// sessionId : la seance pour laquelle la note s'affiche (« Me le rappeler au prochain cours » = vue pour CETTE seance).
export type NoteView = { id: string; studentId: string; studentName: string; className: string | null; category: string | null; text: string; until: string | null; createdAt: number; hiddenAt: number | null; sessionId?: string };
export type PeriodView = { id: string; endDate: string; label: string | null; seen: boolean };

// Rappel de fin de periode : des REMIND_DAYS jours avant la date, jusqu'a ce que le recapitulatif soit ouvert (au plus
// REMIND_AFTER jours apres la date).
export const REMIND_DAYS = 7;
export const REMIND_AFTER = 30;
