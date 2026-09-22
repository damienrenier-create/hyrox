// Echelle d'appreciation unique, partagee par les arbitres (Touche-Coule) et l'auto-evaluation des eleves.
// Les valeurs numeriques conservent les codes historiques (TI=-1, I=0, S=3, B=4, TB=5) pour ne pas
// casser les evaluations deja enregistrees ni l'algorithme de fiabilite ; E (Excellent) = 6.
export type QualityCode = "TI" | "I" | "S" | "B" | "TB" | "E";

export const QUALITY_LEVELS: { code: QualityCode; label: string; value: number; color: string }[] = [
  { code: "TI", label: "Très insuffisant", value: -1, color: "text-red-500" },
  { code: "I", label: "Insuffisant", value: 0, color: "text-orange-500" },
  { code: "S", label: "Satisfaisant", value: 3, color: "text-yellow-500" },
  { code: "B", label: "Bien", value: 4, color: "text-green-400" },
  { code: "TB", label: "Très bien", value: 5, color: "text-emerald-400" },
  { code: "E", label: "Excellent", value: 6, color: "text-cyan-300" },
];

export const QUALITY_VALUES = QUALITY_LEVELS.map((l) => l.value);
export const QUALITY_CODES = QUALITY_LEVELS.map((l) => l.code);

export function qualityCodeFromValue(value: number): QualityCode | null {
  return QUALITY_LEVELS.find((l) => l.value === value)?.code ?? null;
}

export function isQualityCode(x: unknown): x is QualityCode {
  return typeof x === "string" && (QUALITY_CODES as string[]).includes(x);
}
