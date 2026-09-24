// Echauffement et finisher du WOD Level (Sartay, 24/09) : deux mini-WOD lances depuis le greffier, joues sur
// une seance ENFANT (memes equipes, chrono et zombies a part), pour ne rien melanger au WOD principal.
//
// Echauffement : 5 series A-E + BOSS, toutes avec le zombie du palier 1. Les equipes partent en differe
// (equipe 1 sur A, equipe 2 sur B, ...) puis enchainent en boucle A->B->C->D->E, et finissent toutes par le
// BOSS (horde de z1) : les ateliers sensibles ne sont jamais pris d'assaut par tout le monde en meme temps.
// Module pur : les libelles sont resolus contre le catalogue au moment du gel.

export type ChildKind = "warmup" | "finisher";

export type SeriesDef = { name: string; boss?: boolean; cards: [label: string, reps: number][] };

export const WARMUP_SERIES: SeriesDef[] = [
  { name: "Série A", cards: [["SMASH DOWN", 20], ["CORDE", 100], ["ONE REP", 20]] },
  { name: "Série B", cards: [["WALL BALL SHOT", 20], ["FLIP TAPIS", 20], ["KB SWING", 50], ["CORDE", 10]] },
  { name: "Série C", cards: [["POMPES", 30], ["WALL BALL SHOT", 30], ["TRACTIONS", 30]] },
  { name: "Série D", cards: [["SMASH DOWN", 30], ["BREAK DANCE", 20], ["KB SNATCH", 60]] },
  { name: "Série E", cards: [["TIRE TAPIS AR", 1], ["ALLER-RETOUR", 10], ["CORDE", 100]] },
  { name: "BOSS · Horde", boss: true, cards: [["BURPEES", 60]] },
];

// Finisher (Sartay) : EMOM en cinq vagues cadencees par le chrono. Dans une vague les fiches se decouvrent
// une a une ; la 5e vague est un maximum de cordes en 5 min, qui fait le score final.
export type EmomWaveDef = { minutes: number; cards: [label: string, reps: number][]; max?: string };
export const FINISHER_EMOM: EmomWaveDef[] = [
  { minutes: 1, cards: [["TIRE TAPIS AR", 1]] },
  { minutes: 2, cards: [["TIRE TAPIS AR", 1], ["POMPES", 40]] },
  { minutes: 3, cards: [["TIRE TAPIS AR", 1], ["POMPES", 40], ["SQUATS JUMP", 40]] },
  { minutes: 4, cards: [["TIRE TAPIS AR", 1], ["POMPES", 40], ["SQUATS JUMP", 40], ["BURPEES", 20]] },
  { minutes: 5, cards: [], max: "CORDE" },
];
export const FINISHER_SERIES: SeriesDef[] = FINISHER_EMOM.map((w, i) => ({ name: w.max ? `Vague ${i + 1} · MAX de ${w.max.toLowerCase()} (${w.minutes} min)` : `Vague ${i + 1} (${w.minutes} min)`, cards: w.cards }));

// Ordre des niveaux par equipe : depart decale d'une serie par equipe, boucle sur les series ordinaires,
// BOSS en dernier pour tout le monde. Les numeros de niveau sont ceux de l'echelle figee (1..n).
export function staggeredOrder(teamIds: string[], levelNumbers: number[], bossNumbers: number[]): Record<string, number[]> {
  const plain = levelNumbers.filter((n) => !bossNumbers.includes(n));
  const out: Record<string, number[]> = {};
  teamIds.forEach((id, i) => {
    const k = plain.length ? i % plain.length : 0;
    out[id] = [...plain.slice(k), ...plain.slice(0, k), ...bossNumbers];
  });
  return out;
}

export const childLabel = (kind: ChildKind, parentLabel: string) => `${kind === "warmup" ? "Échauffement" : "Finisher"} · ${parentLabel}`;
