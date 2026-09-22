import { WodTemplate } from "./core/types";
import { PyramideClassique } from "./templates/pyramide";

const templates: Record<string, WodTemplate> = {
  [PyramideClassique.id]: PyramideClassique,
  // Add future templates here
};

export function getWodEngine(id: string): WodTemplate {
  const engine = templates[id];
  if (!engine) {
    throw new Error(`WOD Engine template for id "${id}" not found.`);
  }
  return engine;
}

// Seances-types disponibles pour la console (seuls les moteurs reellement codes sont proposes).
export function listWodEngines(): { id: string; name: string }[] {
  return Object.values(templates).map((t) => ({ id: t.id, name: (t as { name?: string }).name ?? t.id }));
}

export * from "./core/types";
export { PyramideClassique };
