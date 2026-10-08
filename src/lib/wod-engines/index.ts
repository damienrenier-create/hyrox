import { WodTemplate } from "./core/types";
import { PyramideClassique } from "./templates/pyramide";
import { FeteForaine } from "./templates/fete-foraine";
import { LevelWod } from "./templates/level";
import { HyroxWod } from "./templates/hyrox";
import { AmrapWod } from "./templates/amrap";

const templates: Record<string, WodTemplate> = {
  [PyramideClassique.id]: PyramideClassique,
  [FeteForaine.id]: FeteForaine,
  [LevelWod.id]: LevelWod,
  [HyroxWod.id]: HyroxWod,
  [AmrapWod.id]: AmrapWod, // Sartay 08/10 : le plus de tours possible en 20 minutes
  // Prochaines seances du cycle Hyrox (AMRAP, EMOM, Cindy, Intro, Eval) et autres cycles : ajouter ici.
};

export function getWodEngine(id: string): WodTemplate {
  const engine = templates[id];
  if (!engine) {
    throw new Error(`WOD Engine template for id "${id}" not found.`);
  }
  return engine;
}

// Seances-types disponibles pour la console (seuls les moteurs reellement codes sont proposes).
export function listWodEngines(): { id: string; name: string; teamSize: number | null }[] {
  return Object.values(templates).map((t) => ({ id: t.id, name: (t as { name?: string }).name ?? t.id, teamSize: t.teamSize ?? null }));
}

export * from "./core/types";
export { PyramideClassique };
