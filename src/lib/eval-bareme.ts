// Bareme du WOD Eval (Sartay, 05/10 au soir). Version retenue : « on doit proposer seulement des parcours a
// 40-45-50-55-60 ; le niveau de base est a 3 etoiles pour tout le monde ; max 5 etoiles ; mais les etoiles ne valent pas
// les memes points en fonction des annees et des sexes », avec son tableau (EVAL_GROUPS.notes, tel quel). Le PARCOURS
// fixe les repetitions par station, les memes pour tout le monde ; la note de PERF (equipe qui boucle le WOD avant la fin
// officielle) depend du parcours ET du groupe de l'equipe : a chacun son 20/20. Tout se regle ici. Module PUR.

export const EVAL_LEVELS = [
  { stars: 1, reps: 40 },
  { stars: 2, reps: 45 },
  { stars: 3, reps: 50 },
  { stars: 4, reps: 55 },
  { stars: 5, reps: 60 },
] as const;
export const EVAL_DEFAULT_STARS = 3; // « le niveau de base est a 3 etoiles pour tout le monde »
export const EVAL_NOTE_MAX = 20;

export type EvalGroup = "56M" | "56F" | "34M" | "34F";
// `notes` = points sur 20 a chaque parcours, de 1★ (40 rep.) a 5★ (60 rep.) : le tableau de Sartay du 05/10.
export const EVAL_GROUPS: { key: EvalGroup; years: string; team: string; notes: readonly number[] }[] = [
  { key: "56M", years: "5e – 6e", team: "garçons ou mixte", notes: [12, 14, 16, 18, 20] },
  { key: "56F", years: "5e – 6e", team: "filles", notes: [14, 16, 18, 20, 20] },
  { key: "34M", years: "3e – 4e", team: "garçons ou mixte", notes: [16, 18, 20, 20, 20] },
  { key: "34F", years: "3e – 4e", team: "filles", notes: [18, 20, 20, 20, 20] },
];
export const EVAL_BASE_GROUP: EvalGroup = "34M"; // equipe dont le groupe est inconnu

// Repartition des points (Sartay 05/10, pour les dias et l'espace eleve) : 50 % les cours precedents (memes criteres
// que les auto-evaluations), 50 % l'eval du jour ; dans l'eval du jour : 50 % la perf, 25 % l'evaluation personnelle,
// 15 % l'evaluation de l'equipe, 10 % l'implication de l'equipe (transitions, suivi des coequipiers, engagement).
export const EVAL_WEIGHTS = { previous: 50, today: 50, perf: 50, personal: 25, team: 15, involvement: 10 } as const;

// Note /20 de l'eval du jour (Sartay 06/10, eval-grades.ts) :
// - perf : 0/20 tant que l'equipe n'a pas fait 60 % du WOD de base (le parcours 3 etoiles), le meme seuil pour tous les
//   parcours ; au-dela, les points montent regulierement jusqu'a la note de son parcours (années, filles / garcons),
//   atteinte quand le parcours est boucle avant la fin officielle ;
// - technique : TI 0 · I 1 · S 2,5 · B 3 · TB 4 · E 5, sur 5 (une appreciation d'un prof l'emporte sur celle d'un
//   arbitre eleve pour le meme exercice) ;
// - une carte jaune de l'equipe : -1 point.
export const EVAL_PERF_FLOOR = 0.6;
export const EVAL_TECH_POINTS: Record<"TI" | "I" | "S" | "B" | "TB" | "E", number> = { TI: 0, I: 1, S: 2.5, B: 3, TB: 4, E: 5 };
export const EVAL_TECH_MAX = 5;
export const EVAL_CARD_PENALTY = 1;

export const isEvalStars = (v: unknown): v is number => typeof v === "number" && EVAL_LEVELS.some((l) => l.stars === v);
export const isEvalGroup = (v: unknown): v is EvalGroup => EVAL_GROUPS.some((g) => g.key === v);
export const evalGroup = (key: EvalGroup) => EVAL_GROUPS.find((g) => g.key === key) ?? EVAL_GROUPS.find((g) => g.key === EVAL_BASE_GROUP)!;
export const evalGroupLabel = (key: EvalGroup) => `${evalGroup(key).years} · ${evalGroup(key).team}`;
// Repetitions par station d'un parcours (celles du 3★ si le parcours est inconnu).
export const evalLevelReps = (stars: number): number => (EVAL_LEVELS.find((l) => l.stars === stars) ?? EVAL_LEVELS[2]).reps;
// Note de perf (sur 20) d'une equipe de ce groupe qui boucle le WOD avant la fin officielle sur ce parcours.
export const evalNote = (key: EvalGroup, stars: number): number => evalGroup(key).notes[stars - 1] ?? 0;
// Premier parcours qui vaut 20/20 pour ce groupe (« a chacun son 20/20 »).
export const evalTopStars = (key: EvalGroup): number => EVAL_LEVELS.find((l) => evalNote(key, l.stars) >= EVAL_NOTE_MAX)?.stars ?? EVAL_LEVELS[4].stars;
export const starsText = (stars: number) => "★".repeat(Math.max(1, stars));
// « 19 », « 17,5 » : une note telle qu'on l'ecrit.
export const noteText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

const yearOf = (className: string | null | undefined): number | null => {
  const m = (className ?? "").match(/\d/);
  return m ? Number(m[0]) : null;
};
// « 5e – 6e » si toutes les classes citees sont de 5e ou de 6e ; sinon « 3e – 4e », qui accueille aussi les plus jeunes
// (la 1P2 a cours avec la 3GTf).
export const evalYears = (classNames: (string | null | undefined)[]): "56" | "34" => {
  const years = classNames.map(yearOf).filter((y): y is number => y !== null);
  return years.length > 0 && years.every((y) => y >= 5) ? "56" : "34";
};
// Groupe d'une equipe d'apres ses eleves : « filles » seulement si l'equipe ne compte que des filles (une equipe mixte
// suit le bareme des garcons, Sartay : « garcons (ou mixte) »). Equipe encore vide : les classes de la seance.
export function evalGroupOf(members: { className: string | null; sex: string | null }[], sessionClasses: string[] = []): EvalGroup {
  const years = evalYears(members.length ? members.map((m) => m.className) : sessionClasses);
  const girls = members.length > 0 && members.every((m) => m.sex === "F");
  return `${years}${girls ? "F" : "M"}` as EvalGroup;
}
