// Bareme de la partie « intensite » du WOD Eval (Sartay 05/10 : « en fonction du groupe classe, les objectifs sont pas
// tout a fait les memes (…) si les 5-6 garcons (ou mixte) termine le wod en faisant 65 reps alors ils ont 20/20 pour la
// partie intensite », apres « on decline pour les annees et pour les filles et pour les gars, en mode n+1 et n-1 »).
// Une equipe qui BOUCLE le WOD avant la fin officielle obtient la note de son niveau : chaque palier de 5 repetitions
// sous le niveau du 20/20 de son groupe coute 1 point. Seul l'exemple des 5es-6es garcons vient de Sartay ; le reste de
// la grille (un palier de moins pour une equipe de filles, deux pour les 3es-4es) est la proposition faite a partir des
// deux seances du 05/10, A FAIRE VALIDER : tout se regle ici, dans `top`. Module PUR (greffier, espace eleve, dias).

export type EvalGroup = "56M" | "56F" | "34M" | "34F";
// `top` = nombre de repetitions par station qui vaut 20/20 pour ce groupe.
export const EVAL_GROUPS: { key: EvalGroup; years: string; team: string; top: number }[] = [
  { key: "56M", years: "5e – 6e", team: "garçons ou mixte", top: 65 },
  { key: "56F", years: "5e – 6e", team: "filles", top: 60 },
  { key: "34M", years: "3e – 4e", team: "garçons ou mixte", top: 55 },
  { key: "34F", years: "3e – 4e", team: "filles", top: 50 },
];
export const EVAL_NOTE_MAX = 20;
export const EVAL_STEP_REPS = 5; // un palier = 5 repetitions = 1 point

export const evalGroup = (key: EvalGroup) => EVAL_GROUPS.find((g) => g.key === key) ?? EVAL_GROUPS[0];
export const evalGroupLabel = (key: EvalGroup) => `${evalGroup(key).years} · ${evalGroup(key).team}`;
export const isEvalGroup = (v: unknown): v is EvalGroup => EVAL_GROUPS.some((g) => g.key === v);

// Note maximale (sur 20) d'une equipe de ce groupe qui boucle le WOD a `reps` repetitions par station.
export function evalMaxNote(key: EvalGroup, reps: number): number {
  return Math.max(0, Math.min(EVAL_NOTE_MAX, EVAL_NOTE_MAX - (evalGroup(key).top - reps) / EVAL_STEP_REPS));
}
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
// Niveau d'une equipe qui n'a rien choisi (Sartay : « pour les 5-6 on garde 60 reps, pour les 3-4 on fait 50 reps ») :
// 5 etoiles en 5e-6e, 3 etoiles en 3e-4e.
export const evalDefaultStars = (key: EvalGroup): number => (key.startsWith("56") ? 5 : 3);
