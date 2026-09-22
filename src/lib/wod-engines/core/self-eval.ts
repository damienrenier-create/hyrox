// Auto-evaluation de l'eleve apres un WOD : 5 criteres, une reponse par ligne sur l'echelle TI..E.
// Les libelles sont a ajuster avec Sartay ; ils vivent ici pour etre modifies en un seul endroit.
// Le meme mecanisme (criteres + reponses JSON) servira plus tard aux "petits tests" en ligne.

export type SelfEvalCriterion = { id: string; label: string; hint?: string };

export const SELF_EVAL_CRITERIA: SelfEvalCriterion[] = [
  { id: "engagement", label: "Engagement", hint: "Je me suis donné à fond du début à la fin du WOD." },
  { id: "technique", label: "Qualité d'exécution", hint: "J'ai respecté la technique demandée sur chaque exercice." },
  { id: "regles", label: "Respect des consignes", hint: "J'ai respecté les règles, le comptage et l'organisation." },
  { id: "equipe", label: "Esprit d'équipe", hint: "J'ai aidé, encouragé et écouté mon équipe." },
  { id: "effort", label: "Gestion de l'effort", hint: "J'ai bien réparti mon effort et ma récupération." },
];

export const SELF_EVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

// La fenetre s'ouvre a la fin de l'equipe de l'eleve si elle est arrivee, sinon a la fin officielle du WOD.
export function selfEvalWindow(teamFinishedAtMs: number | null, raceEndedAtMs: number | null) {
  const opensAt = teamFinishedAtMs ?? raceEndedAtMs;
  if (opensAt === null) return { opensAt: null, closesAt: null, isOpen: false, notYet: true, expired: false };
  const closesAt = opensAt + SELF_EVAL_WINDOW_MS;
  const now = Date.now();
  return { opensAt, closesAt, isOpen: now >= opensAt && now <= closesAt, notYet: now < opensAt, expired: now > closesAt };
}
