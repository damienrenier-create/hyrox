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
  validFrom: string | null; // version d'horaire : en vigueur a partir de cette date (AAAA-MM-JJ), null = depuis toujours
  sex: string | null; // "M" garcons, "F" filles, null = mixte
};

export type SlotGroup = {
  key: string;
  teacherId: string | null;
  weekday: number;
  startMin: number;
  endMin: number;
  planId: string | null; // seance-type imposee (premiere trouvee dans le groupe), sinon null = seance de la semaine
  validFrom: string | null; // version d'horaire du groupe
  sex: string | null; // garcons / filles / mixte (premier renseigne dans le groupe)
  teacherIds: string[]; // profs qui tiennent ce creneau ensemble (co-enseignement, voir mergeCoTaught) ; teacherId = le principal
  classes: { id: string; className: string }[];
};

// ===== Versions d'horaire (01/10) =====
// L'ecole change les horaires en cours d'annee (« a partir du lundi 5 octobre »). Chaque creneau porte la date a
// partir de laquelle sa version s'applique ; pour un prof et un jour donne, seule compte la version la plus recente
// dont la date est atteinte. L'ancien horaire reste en vigueur jusqu'a la veille et n'est jamais efface.
const ownerOf = (r: { teacherId: string | null }) => r.teacherId ?? "global";
const laterVersion = (a: string | null, b: string | null) => (a === null ? b !== null : b !== null && b > a);

// Pour chaque prof, la date de la version retenue : la plus recente qui ne depasse pas `upTo` (toutes si absent).
function versionByOwner(rows: SlotRow[], upTo?: string): Map<string, string | null> {
  const best = new Map<string, string | null>();
  for (const r of rows) {
    const v = r.validFrom ?? null;
    if (upTo !== undefined && v !== null && v > upTo) continue;
    const k = ownerOf(r);
    if (!best.has(k) || laterVersion(best.get(k)!, v)) best.set(k, v);
  }
  return best;
}
const keepVersion = (rows: SlotRow[], best: Map<string, string | null>) => rows.filter((r) => best.has(ownerOf(r)) && (r.validFrom ?? null) === best.get(ownerOf(r)));

// Les creneaux en vigueur un jour donne (AAAA-MM-JJ, Bruxelles) : ce que l'ouverture automatique doit lire.
export function slotsInForceAt(rows: SlotRow[], dateKey: string): SlotRow[] {
  return keepVersion(rows, versionByOwner(rows, dateKey));
}

// La version la plus recente de chaque prof, meme si elle n'est pas encore en vigueur : celle qu'on voit et
// qu'on modifie dans le journal de classe.
export function latestSlots(rows: SlotRow[]): SlotRow[] {
  return keepVersion(rows, versionByOwner(rows));
}

// Date de la version la plus recente d'un prof (null = horaire sans date, ou aucun creneau).
export function versionStart(rows: SlotRow[], teacherId: string | null): string | null {
  return versionByOwner(rows).get(teacherId ?? "global") ?? null;
}

// ===== Garcons / filles =====
// Les horaires de l'ecole marquent (G) / (F), mais au Sartay les deux profs donnent le meme cours ensemble (Sartay 02/10) :
// un creneau est MIXTE par defaut. Garcons / Filles ne sert que si deux profs separent vraiment les groupes : chaque
// eleve ne voit alors que la seance de son sexe.
export const SEX_LABEL: Record<string, string> = { M: "garçons", F: "filles" };
export const sexLabel = (sex: string | null | undefined): string | null => (sex ? SEX_LABEL[sex] ?? null : null);

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
      g = { key, teacherId: r.teacherId, weekday: r.weekday, startMin: r.startMin, endMin: r.endMin, planId: null, validFrom: r.validFrom ?? null, sex: null, teacherIds: r.teacherId ? [r.teacherId] : [], classes: [] };
      map.set(key, g);
    }
    g.classes.push({ id: r.id, className: r.className });
    if (!g.planId && r.planId) g.planId = r.planId;
    if (!g.sex && r.sex) g.sex = r.sex;
  }
  const out = [...map.values()];
  for (const g of out) g.classes.sort((a, b) => a.className.localeCompare(b.className, "fr", { numeric: true }));
  out.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin || a.endMin - b.endMin);
  return out;
}

// Co-enseignement (Sartay 02/10 : « on donne le même cours en même temps ensemble ») : deux profs qui ont les MEMES
// classes aux memes heures (meme sexe : mixte en general) tiennent UNE seule seance. Les groupes identiques de profs
// differents sont fusionnes pour l'ouverture automatique ; `teacherIds` = tous, `teacherId` = le principal (le premier
// par identifiant, stable d'un jour a l'autre : la cle d'ouverture en depend).
export function mergeCoTaught(groups: SlotGroup[]): SlotGroup[] {
  const map = new Map<string, SlotGroup>();
  for (const g of groups) {
    const key = `${g.weekday}_${g.startMin}_${g.endMin}_${g.sex ?? ""}_${g.classes.map((c) => c.className).sort().join(",")}`;
    const m = map.get(key);
    if (!m) {
      map.set(key, { ...g, classes: [...g.classes], teacherIds: [...g.teacherIds] });
      continue;
    }
    for (const t of g.teacherIds) if (!m.teacherIds.includes(t)) m.teacherIds.push(t);
    if (!m.planId && g.planId) m.planId = g.planId;
  }
  const out = [...map.values()];
  for (const g of out) {
    g.teacherIds.sort();
    if (g.teacherIds.length) g.teacherId = g.teacherIds[0];
    g.key = groupKeyOf(g.teacherId, g.weekday, g.startMin, g.endMin);
  }
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
