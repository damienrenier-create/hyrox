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

export * from "./core/types";
export { PyramideClassique };
