// temporal-polyfill/full/global ne fournit pas de types ambiants pour `Temporal`
// (son .d.ts est vide) même s'il le pose bien sur globalThis à l'exécution.
// On declare nous-memes le type global une bonne fois, a partir du package de spec.
import type { Temporal as TemporalNS } from "temporal-spec";

declare global {
  // eslint-disable-next-line no-var
  var Temporal: typeof TemporalNS;
}

export {};
