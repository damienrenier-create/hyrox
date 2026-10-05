// Temps attendus par station du WOD Eval (Sartay 05/10 : « avant de commencer le cours, on affiche dans la colonne top
// les tops deja joues ; s'il n'y en a pas encore, on affiche des temps calcules sur base de ce que les eleves devraient
// faire comme temps »). Base : moyenne nettoyee des equipes de 3 des deux seances auditees du lundi 05/10 (3GTa+4GTc,
// 3GTd+4GTe ; la seance des 5-6 est exclue a la demande de Sartay), en secondes, mesuree a 3 allers-retours ou a
// 60 repetitions. Helico : jamais chronometre, suppose entre les squats et le KB swing. Module PUR.

const REF: Record<string, { ar3?: number; per60?: number }> = {
  "BURPEES BROAD JUMP": { ar3: 279 },
  "FENTES MARCHÉES": { ar3: 236 },
  "FARMER CARRY": { ar3: 80 },
  "BREAK DANCE": { per60: 197 },
  SQUATS: { per60: 118 },
  POMPAGE: { per60: 135 },
  POMPES: { per60: 135 },
  "HÉLICO": { per60: 136 },
  HELICO: { per60: 136 },
  "WALL BALL SHOT": { per60: 173 },
  "KB SWING": { per60: 154 },
  CORDE: { per60: 90 },
};

// Temps attendu (ms) d'une equipe moyenne a une station, pour `qty` = ses repetitions (station en « rép. ») ou ses
// allers-retours (« A/R ») ; null si la station n'a pas de reference.
export function evalExpectedMs(label: string, unit: string, qty: number): number | null {
  const r = REF[label.trim().toUpperCase()];
  if (!r) return null;
  if (unit === "A/R" && r.ar3) return Math.round((r.ar3 / 3) * qty * 1000);
  if (unit === "rép." && r.per60) return Math.round((r.per60 / 60) * qty * 1000);
  return null;
}
