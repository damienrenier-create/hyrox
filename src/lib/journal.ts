// Journal de classe : l'horaire hebdomadaire d'UN prof (lundi-vendredi, heure de Bruxelles), fait de creneaux
// (`ClassSlot`) qui lui appartiennent. Meme prof + meme debut + meme fin = un « groupe » : jusqu'a MAX_CLASSES
// classes qui feront une seule seance commune, ouverte automatiquement a l'heure dite (voir src/lib/scheduling.ts).
// Module PUR (aucun acces base) : partage par le serveur, les actions et le composant client de la grille.

import { MAX_CLASSES } from "@/lib/session-roles";

export const WEEKDAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const MAX_SLOT_CLASSES = MAX_CLASSES;

// ===== Grille horaire de l'ecole =====
// Deduite de l'horaire de DAMZER (23/09/2026) : 8 periodes de 50 min, deux petites recres (09:55-10:10 et
// 14:20-14:35) et le temps de midi (12:40-13:30). Un cours = 2 periodes ; quand la recre tombe entre les deux,
// le creneau l'enjambe (09:05-11:00) : la seance reste ouverte pendant la recre.
export type Period = { id: string; start: number; end: number };
export const PERIOD_MIN = 50;
export const PERIODS: Period[] = [
  { id: "P1", start: 8 * 60 + 15, end: 9 * 60 + 5 },
  { id: "P2", start: 9 * 60 + 5, end: 9 * 60 + 55 },
  { id: "P3", start: 10 * 60 + 10, end: 11 * 60 },
  { id: "P4", start: 11 * 60, end: 11 * 60 + 50 },
  { id: "P5", start: 11 * 60 + 50, end: 12 * 60 + 40 },
  { id: "P6", start: 13 * 60 + 30, end: 14 * 60 + 20 },
  { id: "P7", start: 14 * 60 + 35, end: 15 * 60 + 25 },
  { id: "P8", start: 15 * 60 + 25, end: 16 * 60 + 15 },
];
export const DAY_START = PERIODS[0].start;
export const DAY_END = PERIODS[PERIODS.length - 1].end;
export const DEFAULT_PERIODS = 2; // un cours = 2 x 50 min
export const LUNCH_GAP_MIN = 20; // au-dela de 20 min entre deux periodes, c'est le temps de midi : un cours ne l'enjambe pas

// Pauses entre deux periodes (recre ou midi), pour dessiner la grille.
export type Break = { start: number; end: number; label: string };
export const BREAKS: Break[] = PERIODS.slice(1)
  .map((p, i) => ({ start: PERIODS[i].end, end: p.start, label: p.start - PERIODS[i].end > LUNCH_GAP_MIN ? "midi" : "récré" }))
  .filter((b) => b.end > b.start);

// Indice de la periode qui contient cette minute (debut inclus, fin exclue), -1 hors periode.
export function periodIndexAt(min: number): number {
  return PERIODS.findIndex((p) => p.start <= min && min < p.end);
}

// Fin d'un creneau de n periodes qui commence a startMin : on enchaine les periodes suivantes en incluant les
// petites recres, jamais le temps de midi. Hors grille (heure libre) : n x 50 min.
export function slotEndFor(startMin: number, nPeriods: number): number {
  const n = Math.max(1, Math.floor(nPeriods));
  const i = periodIndexAt(startMin);
  if (i === -1) return startMin + n * PERIOD_MIN;
  let end = PERIODS[i].end;
  for (let k = 1; k < n && i + k < PERIODS.length; k++) {
    if (PERIODS[i + k].start - PERIODS[i + k - 1].end > LUNCH_GAP_MIN) break;
    end = PERIODS[i + k].end;
  }
  return end;
}

// Nombre de periodes couvertes par [startMin, endMin) : celles dont le debut tombe dans l'intervalle.
export function periodsCovered(startMin: number, endMin: number): number {
  return PERIODS.filter((p) => p.start >= startMin && p.start < endMin).length;
}

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

// Minutes de cours par semaine : les periodes couvertes (les recres enjambees ne comptent pas), sinon la duree brute.
export function weeklyMinutes(groups: SlotGroup[]): number {
  return groups.reduce((n, g) => {
    const p = periodsCovered(g.startMin, g.endMin);
    return n + (p > 0 ? p * PERIOD_MIN : g.endMin - g.startMin);
  }, 0);
}
