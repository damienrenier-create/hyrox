// Journal de classe : l'horaire hebdomadaire d'UN prof (lundi-vendredi, heure de Bruxelles), fait de creneaux
// (`ClassSlot`) qui lui appartiennent. Meme prof + meme debut + meme fin = un « groupe » : jusqu'a 5 classes
// qui feront une seule seance commune, ouverte automatiquement a l'heure dite (voir src/lib/scheduling.ts).
// Module PUR (aucun acces base) : partage par le serveur, les actions et le composant client de la grille.

import { MAX_CLASSES } from "@/lib/session-roles";

export const WEEKDAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// Grille affichee : de 08:00 a 17:00 par pas de 30 min. Les heures reelles d'un creneau restent libres
// (08:25, 10:15…) : la grille sert a poser, l'editeur du creneau sert a ajuster a la minute.
export const DAY_START = 8 * 60;
export const DAY_END = 17 * 60;
export const STEP = 30;
export const DEFAULT_DURATION = 100; // deux periodes de 50 min, comme les formulaires de la console (08:00-09:40)
export const MAX_SLOT_CLASSES = MAX_CLASSES;

export type SlotRow = {
  id: string;
  className: string;
  weekday: number;
  startMin: number;
  endMin: number;
  teacherId: string | null;
  planId: string | null;
};

export type SlotGroup = {
  key: string;
  teacherId: string | null;
  weekday: number;
  startMin: number;
  endMin: number;
  planId: string | null; // seance-type imposee (premiere trouvee dans le groupe), sinon null = seance de la semaine
  classes: { id: string; className: string }[];
};

export function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export const groupKeyOf = (teacherId: string | null, weekday: number, startMin: number, endMin: number) =>
  `${teacherId ?? "global"}_${weekday}_${startMin}_${endMin}`;

// Deux intervalles [aS,aE) et [bS,bE) se chevauchent-ils ?
export const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

// Regroupe les lignes en creneaux (prof, jour, debut, fin), classes triees, dans l'ordre de la semaine.
export function groupSlots(rows: SlotRow[]): SlotGroup[] {
  const map = new Map<string, SlotGroup>();
  for (const r of rows) {
    const key = groupKeyOf(r.teacherId, r.weekday, r.startMin, r.endMin);
    let g = map.get(key);
    if (!g) {
      g = { key, teacherId: r.teacherId, weekday: r.weekday, startMin: r.startMin, endMin: r.endMin, planId: null, classes: [] };
      map.set(key, g);
    }
    g.classes.push({ id: r.id, className: r.className });
    if (!g.planId && r.planId) g.planId = r.planId;
  }
  const out = [...map.values()];
  for (const g of out) g.classes.sort((a, b) => a.className.localeCompare(b.className, "fr", { numeric: true }));
  out.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin || a.endMin - b.endMin);
  return out;
}

// Libelle d'un groupe de classes tel qu'on le lit dans le journal : « 5GTb + 6GTa ».
export const groupLabel = (classes: string[]) => [...classes].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })).join(" + ");

// Minutes totales de cours par semaine (chaque groupe compte une fois, quel que soit son nombre de classes).
export function weeklyMinutes(groups: SlotGroup[]): number {
  return groups.reduce((n, g) => n + (g.endMin - g.startMin), 0);
}
