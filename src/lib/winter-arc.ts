// « Winter arc » (Sartay 01/10) : petit theme de saison du WOD Level (flocons) et interrupteur par eleve a la
// creation des equipes (« es-tu en winter arc ? »). Un oui est garde sur le compte de l'eleve jusqu'au 30 decembre
// (User.winterArcUntil, fin de journee a Bruxelles). Module pur, importable cote client (pas de Temporal).

const TZ = "Europe/Brussels";
// Saison : du 1er octobre au 30 decembre inclus (dates de Bruxelles).
export const WINTER_ARC_FROM = "10-01";
export const WINTER_ARC_TO = "12-30";

// Date de Bruxelles « AAAA-MM-JJ ».
export function brusselsDateKey(nowMs = Date.now()): string {
  return new Date(nowMs).toLocaleDateString("en-CA", { timeZone: TZ });
}

export function isWinterArcSeason(nowMs = Date.now()): boolean {
  const md = brusselsDateKey(nowMs).slice(5);
  return md >= WINTER_ARC_FROM && md <= WINTER_ARC_TO;
}

// Dernier jour du winter arc en cours (« AAAA-12-30 »).
export function winterArcEndKey(nowMs = Date.now()): string {
  return `${brusselsDateKey(nowMs).slice(0, 4)}-${WINTER_ARC_TO}`;
}

// L'eleve est-il en winter arc ? (date de fin pas encore passee)
export function isWinterArc(until: unknown, nowMs = Date.now()): boolean {
  if (!until) return false;
  const ms = new Date(String(until)).getTime();
  return Number.isFinite(ms) && ms > nowMs;
}
