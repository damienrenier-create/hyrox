// Lecture des evaluations du demineur (module pur : ecran du greffier et recap des admins).
// - Dissonance (Sartay 28/09) : deux arbitres differents ont evalue le MEME eleve sur le MEME exercice avec au
//   moins 2 appreciations d'ecart (ex. S contre TB, I contre B).
// - Classement des arbitres : note moyenne donnee, evaluations dissonantes.

import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";

export type EvalLike = {
  id: string;
  targetUserId: string;
  targetName: string;
  teamName: string;
  exerciseId: string;
  exerciseLabel: string;
  note: number;
  refereeId: string;
  refereeName: string;
};

export const DISSONANCE_GAP = 2;
export const levelIndex = (note: number) => QUALITY_LEVELS.findIndex((l) => l.value === note);
export const gradeOf = (note: number) => QUALITY_LEVELS.find((l) => l.value === note)?.grade ?? 0;
export const codeOf = (note: number) => QUALITY_LEVELS.find((l) => l.value === note)?.code ?? "?";

export type Dissonance<E extends EvalLike> = { a: E; b: E; gap: number };
export function dissonances<E extends EvalLike>(evals: E[]): Dissonance<E>[] {
  const by = new Map<string, E[]>();
  for (const e of evals) { const k = `${e.targetUserId}_${e.exerciseId}`; by.set(k, [...(by.get(k) ?? []), e]); }
  const out: Dissonance<E>[] = [];
  for (const group of by.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a.refereeId === b.refereeId) continue;
      const gap = Math.abs(levelIndex(a.note) - levelIndex(b.note));
      if (gap >= DISSONANCE_GAP) out.push({ a, b, gap });
    }
  }
  return out.sort((x, y) => y.gap - x.gap);
}

export type RefereeStat = { refereeId: string; name: string; count: number; avgGrade: number; avgCode: string; dissonant: number; rate: number };
// Classement : les arbitres les plus fiables d'abord (moins d'evaluations dissonantes en proportion), puis les
// plus actifs. Note moyenne = moyenne sur 5 des appreciations DONNEES (severite ou largesse de l'arbitre).
export function refereeRanking<E extends EvalLike>(evals: E[]): RefereeStat[] {
  const dis = new Set<string>();
  for (const d of dissonances(evals)) { dis.add(d.a.id); dis.add(d.b.id); }
  const by = new Map<string, E[]>();
  for (const e of evals) by.set(e.refereeId, [...(by.get(e.refereeId) ?? []), e]);
  return [...by.entries()].map(([refereeId, es]) => {
    const avgGrade = es.reduce((s, e) => s + gradeOf(e.note), 0) / es.length;
    const nearest = [...QUALITY_LEVELS].sort((x, y) => Math.abs(x.grade - avgGrade) - Math.abs(y.grade - avgGrade))[0];
    const dissonant = es.filter((e) => dis.has(e.id)).length;
    return { refereeId, name: es[0].refereeName, count: es.length, avgGrade, avgCode: nearest.code, dissonant, rate: dissonant / es.length };
  }).sort((a, b) => a.rate - b.rate || b.count - a.count || a.name.localeCompare(b.name, "fr"));
}

export const isBad = (note: number) => levelIndex(note) <= 1; // TI ou I
export const isExcellent = (note: number) => levelIndex(note) === QUALITY_LEVELS.length - 1; // E
