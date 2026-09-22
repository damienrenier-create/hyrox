// Auto-evaluation de l'eleve apres un WOD = la grille officielle « AUTO-ÉVALUATION – CYCLE HYROX »
// (Downloads/Grille d'évaluation Hyrox.pdf), reprise mot pour mot : 5 criteres x 6 niveaux (TI..E).
// Sur mobile, l'eleve ne l'entoure pas : il touche la case qui correspond le mieux (une par ligne).
// ⚠️ Le PDF est coupe en bas de page sur la 5e ligne (« Tenue et Coopération ») : les fins de phrase
// marquees [~] sont completees au plus naturel, a valider par Sartay.
// Le meme mecanisme (criteres + reponses JSON) servira plus tard aux "petits tests" en ligne.

import type { QualityCode } from "./quality";

export type SelfEvalCriterion = { id: string; label: string; levels: Record<QualityCode, string> };

export const SELF_EVAL_TITLE = "AUTO-ÉVALUATION – CYCLE HYROX";
export const SELF_EVAL_INSTRUCTION =
  "Touche la case qui correspond le mieux à ton investissement et ta pratique lors de cette séance. Sois honnête et objectif sur tes ressentis et tes actions.";

export const SELF_EVAL_CRITERIA: SelfEvalCriterion[] = [
  {
    id: "engagement",
    label: "Implication / Engagement",
    levels: {
      TI: "Refuse souvent de participer ou abandonne rapidement.",
      I: "Participe peu, doit être souvent relancé face à la difficulté cardio ou musculaire.",
      S: "Participe régulièrement mais avec une implication variable selon les ateliers.",
      B: "Est investi tout au long de la séance et maintient son effort en continu.",
      TB: "Très investi, persévère même en difficulté (fatigue extrême).",
      E: "S'investit pleinement et entraîne positivement les autres par sa détermination.",
    },
  },
  {
    id: "technique",
    label: "Qualité d'exécution des mouvements",
    levels: {
      TI: "Mouvements dangereux ou totalement incorrects. Ne tient pas compte des consignes (dos rond, etc.).",
      I: "Mouvements souvent dégradés nécessitant de nombreuses corrections. Posture fragile.",
      S: "Exécution globalement correcte, mais la technique se dégrade visiblement avec la fatigue.",
      B: "Bonne exécution générale, maintient une posture sécuritaire sur la majorité des ateliers.",
      TB: "Mouvements maîtrisés et constants. Conserve une excellente technique même sous l'épuisement.",
      E: "Technique parfaite et fluide sur l'ensemble des stations. Grande efficacité et économie gestuelle.",
    },
  },
  {
    id: "quotas",
    label: "Respect des quotas et standards",
    levels: {
      TI: "Ne respecte pas du tout les consignes (triche ouvertement sur les répétitions).",
      I: "Diminue souvent les répétitions ou la difficulté sans justification.",
      S: "Essaie de respecter les quotas mais s'y perd parfois dans le comptage ou adapte à la baisse.",
      B: "Respecte scrupuleusement le nombre de répétitions demandé sur chaque atelier.",
      TB: "Valide chaque répétition avec rigueur en respectant les standards de mouvement complet.",
      E: "Rigueur totale sur les standards et les quotas, c'est un modèle d'intégrité pour le reste du groupe.",
    },
  },
  {
    id: "effort",
    label: "Gestion de l'effort et transitions",
    levels: {
      TI: "Travaille peu. N'est efficace ni dans la gestion de ses efforts, ni dans les transitions.",
      I: "Fournit un effort trop haché. Gère mal son énergie et perd beaucoup de temps entre les ateliers.",
      S: "Fournit un effort régulier mais subit la fatigue sur la durée. Temps de récupération parfois longs.",
      B: "Gère bien son énergie sur l'ensemble de la séance. Enchaîne les ateliers avec peu de temps mort.",
      TB: "Maintient une belle intensité de travail globale, gère la fatigue et optimise ses transitions.",
      E: "Travaille énormément et donne tout. Transitions impeccables, termine avec un rythme soutenu.",
    },
  },
  {
    id: "tenue_cooperation",
    label: "Tenue et Coopération (Solidarité)",
    levels: {
      TI: "Tenue inadaptée (dangereuse). Ne communique pas et gêne parfois les autres. [~]",
      I: "Oublis réguliers d'équipement. Communique rarement et coopère peu.",
      S: "Tenue correcte. Coopère avec ses partenaires lorsqu'il y pense ou lorsqu'on le lui demande. [~]",
      B: "Tenue impeccable. Communique régulièrement et aide efficacement ses partenaires. [~]",
      TB: "Aide spontanément pour le matériel. Encourage, annonce ses intentions et soutient ses partenaires. [~]",
      E: "Attitude irréprochable. Anime le groupe, valorise toute l'équipe et pousse les autres à se dépasser. [~]",
    },
  },
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
