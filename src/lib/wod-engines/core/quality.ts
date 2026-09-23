// Echelle d'appreciation unique, partagee par les arbitres (Touche-Coule) et l'auto-evaluation des eleves.
// Les valeurs numeriques conservent les codes historiques (TI=-1, I=0, S=3, B=4, TB=5) pour ne pas
// casser les evaluations deja enregistrees ni l'algorithme de fiabilite ; E (Excellent) = 6.
// Les couleurs sont pensees pour des fonds clairs (DA « terrain clair »).
// `grade` = bareme du carnet de cotes de Sartay (23/09), sur 5 : TI 0 · I 1,5 · S 3 · B 3,5 · TB 4 · E 5.
// Il ne sert QU'a transformer une appreciation en note ; `value` reste le code historique des calculs.
export type QualityCode = "TI" | "I" | "S" | "B" | "TB" | "E";

export const GRADE_MAX = 5;

export const QUALITY_LEVELS: { code: QualityCode; label: string; value: number; grade: number; color: string }[] = [
  { code: "TI", label: "Très insuffisant", value: -1, grade: 0, color: "text-red-600" },
  { code: "I", label: "Insuffisant", value: 0, grade: 1.5, color: "text-orange-600" },
  { code: "S", label: "Satisfaisant", value: 3, grade: 3, color: "text-amber-600" },
  { code: "B", label: "Bien", value: 4, grade: 3.5, color: "text-lime-700" },
  { code: "TB", label: "Très bien", value: 5, grade: 4, color: "text-emerald-600" },
  { code: "E", label: "Excellent", value: 6, grade: 5, color: "text-sky-600" },
];

export const QUALITY_VALUES = QUALITY_LEVELS.map((l) => l.value);
export const QUALITY_CODES = QUALITY_LEVELS.map((l) => l.code);

export function qualityCodeFromValue(value: number): QualityCode | null {
  return QUALITY_LEVELS.find((l) => l.value === value)?.code ?? null;
}

export function isQualityCode(x: unknown): x is QualityCode {
  return typeof x === "string" && (QUALITY_CODES as string[]).includes(x);
}

// Note sur 5 d'une appreciation (null si le code est inconnu ou absent).
export function gradeOfCode(code: unknown): number | null {
  return QUALITY_LEVELS.find((l) => l.code === code)?.grade ?? null;
}
