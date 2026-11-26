// SCOUTING DES COUPS : etape 2 du scouting (Sartay 26/11 soir : « scouter les coups : noter autant de fois que possible
// les coups utilises ; chaque coup se divise en 3 : le coup amene une perte de point, le coup ne termine pas le point, le
// coup fait gagner le point ; le scout denombre ainsi qui utilise quel coup et sur quoi ca debouche ; a la fin du match,
// le scout evalue les x coups (3 par defaut) les plus utilises avec les 4 criteres » ; « un scout par joueur »).
// Le scout suit UN joueur pendant son match : une OBSERVATION (comme le scouting des impacts : ni ELO, ni tournoi), dont la
// ligne SCOUTING porte { mode: "STROKES", player } ; chaque coup vu = une ligne STROKE (targetId = le joueur observe,
// { stroke, out }) ; « annuler le dernier coup » = une ligne UNRALLY qui le vise (rien n'est efface) ; a la fin, la fiche
// technique (ligne SCOUT) des coups les plus utilises. Module PUR.
import { END_STROKES, STROKES, type EndStroke, type StrokeId } from "@/lib/badminton-scout";

export type StrokeOut = -1 | 0 | 1; // ❌ fait perdre le point · ↔️ l'echange continue · ✅ fait gagner le point
export const STROKE_OUTS: { v: StrokeOut; emoji: string; name: string }[] = [
  { v: -1, emoji: "❌", name: "perd le point" },
  { v: 0, emoji: "↔️", name: "continue" },
  { v: 1, emoji: "✅", name: "gagne le point" },
];
export const TOP_STROKES = 3; // coups evalues a la fin (les plus utilises)
export type StrokeTap = { stroke: EndStroke; out: StrokeOut };
export function readStrokeTap(raw: unknown): StrokeTap | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || !END_STROKES.some((s) => s.id === o.stroke)) return null;
  const out = Number(o.out);
  return out === -1 || out === 0 || out === 1 ? { stroke: o.stroke as EndStroke, out } : null;
}

// L'observation des coups : son joueur (ligne SCOUTING { mode: "STROKES", player }), sinon null (scouting des impacts).
export function strokeScoutOf(m: { events: { kind: string; data?: unknown }[] }): string | null {
  const d = m.events.find((e) => e.kind === "SCOUTING")?.data;
  const o = d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  return o && o.mode === "STROKES" && typeof o.player === "string" ? o.player : null;
}

// Les coups notes pour un joueur dans une liste d'evenements (sans ceux annules).
export function strokeTapsOf(events: { id?: string; kind: string; targetId?: string | null; data?: unknown }[], playerId: string): StrokeTap[] {
  const undone = new Set(events.filter((e) => e.kind === "UNRALLY" && e.targetId).map((e) => e.targetId as string));
  return events.flatMap((e) => (e.kind === "STROKE" && e.targetId === playerId && !(e.id && undone.has(e.id)) ? [readStrokeTap(e.data)].filter((x): x is StrokeTap => !!x) : []));
}

export type StrokeCount = { id: EndStroke; total: number; win: number; cont: number; lose: number };
// Par coup : combien de fois, et sur quoi ca debouche ; les plus utilises d'abord.
export function strokeCounts(taps: StrokeTap[]): StrokeCount[] {
  return END_STROKES.map((s) => {
    const mine = taps.filter((t) => t.stroke === s.id);
    return { id: s.id, total: mine.length, win: mine.filter((t) => t.out === 1).length, cont: mine.filter((t) => t.out === 0).length, lose: mine.filter((t) => t.out === -1).length };
  }).filter((c) => c.total > 0).sort((a, b) => b.total - a.total || END_STROKES.findIndex((s) => s.id === a.id) - END_STROKES.findIndex((s) => s.id === b.id));
}
// Les coups a evaluer a la fin : les plus utilises parmi les 6 qui ont des criteres (pas « jeu au filet » ni « autre »).
export function topStrokes(counts: StrokeCount[], n = TOP_STROKES): StrokeId[] {
  return counts.filter((c) => STROKES.some((s) => s.id === c.id)).slice(0, n).map((c) => c.id as StrokeId);
}
