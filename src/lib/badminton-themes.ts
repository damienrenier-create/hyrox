// Matchs A THEME du badminton (Sartay 24/11, projet « scouting »). Module PUR (importable cote client), sans dependance.
// Le prof choisit le theme des matchs de la seance (settings.bmTheme) ; chaque match cree dans la seance le garde dans son
// journal (ligne THEME, parametres dans la colonne JSON) ; l'arbitre en direct applique la regle du theme a chaque echange.
//
// - CLASSIC : le gagnant de l'echange marque 1 point (et sert).
// - SERVE (« le joueur ne marque des points que s'il a le service ») : le serveur qui gagne l'echange marque 1 point ; le
//   receveur qui gagne l'echange prend le service, sans point.
// - PRICE_UP (« l'arbitre clique sur le bouton central a chaque echange pour augmenter le prix de l'echange ; quand le
//   point est termine, l'arbitre le cloture puis l'attribue ; le joueur marque autant de points que l'echange a ete long,
//   plafond parametrable ») : prix = nombre d'echanges (au moins 1), au plus `cap` (0 = sans plafond).
// - PRICE_DOWN (« exact inverse : le point commence a 10, perd un point de valeur a chaque echange jusqu'a tomber au montant
//   parametre (5, 1, 0…) ; le gagnant gagne le service ») : prix = `start` − echanges, au moins `floor`.
// - Option serveFault (« l'arbitre peut noter si le service est rate, ce qui fait perdre un point au joueur en plus d'en
//   faire gagner un a l'adversaire ») : avec n'importe quel theme ; le service passe a l'adversaire. Un score ne descend
//   jamais sous 0.
// - A L'ELO (Sartay : « qu'il compte a l'ELO mais dans une moins grande mesure ») : un match a theme compte pour
//   THEME_ELO_WEIGHT d'un match normal, sans l'ecart au score (les scores des themes ne se comparent pas).
export type ThemeKind = "CLASSIC" | "SERVE" | "PRICE_UP" | "PRICE_DOWN";
export type BmTheme = { kind: ThemeKind; serveFault: boolean; cap: number; start: number; floor: number };
export const THEME_ELO_WEIGHT = 0.5;
export const THEME_KINDS: { id: ThemeKind; name: string; rule: string }[] = [
  { id: "CLASSIC", name: "Classique", rule: "Le gagnant de l'échange marque 1 point." },
  { id: "SERVE", name: "Points au service", rule: "On ne marque que si on a le service ; le receveur qui gagne l'échange reprend le service, sans point." },
  { id: "PRICE_UP", name: "Prix de l'échange qui monte", rule: "L'arbitre compte les échanges : le gagnant marque autant de points que l'échange a été long." },
  { id: "PRICE_DOWN", name: "Prix de l'échange qui descend", rule: "L'échange vaut d'abord 10 points, puis 1 de moins à chaque échange ; le gagnant prend le service." },
];
export const THEME_CAPS = [0, 3, 5, 8, 10] as const; // 0 = sans plafond
export const THEME_STARTS = [5, 8, 10, 15] as const;
export const THEME_FLOORS = [0, 1, 2, 3, 5] as const;

export function readTheme(raw: unknown): BmTheme | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind: ThemeKind = o.kind === "SERVE" || o.kind === "PRICE_UP" || o.kind === "PRICE_DOWN" ? o.kind : "CLASSIC";
  const serveFault = o.serveFault === true;
  if (kind === "CLASSIC" && !serveFault) return null; // classique sans option = pas de theme
  const cap = THEME_CAPS.includes(Number(o.cap) as never) ? Number(o.cap) : 5;
  const start = THEME_STARTS.includes(Number(o.start) as never) ? Number(o.start) : 10;
  const floor = THEME_FLOORS.includes(Number(o.floor) as never) && Number(o.floor) < start ? Number(o.floor) : 1;
  return { kind, serveFault, cap, start, floor };
}
export function themeText(t: BmTheme): string {
  const base = t.kind === "SERVE" ? "Points au service" : t.kind === "PRICE_UP" ? `Prix qui monte${t.cap ? ` (plafond ${t.cap})` : " (sans plafond)"}` : t.kind === "PRICE_DOWN" ? `Prix qui descend (de ${t.start} à ${t.floor})` : "Classique";
  return t.serveFault ? `${base} · service raté −1` : base;
}
// Theme des matchs d'une seance (settings.bmTheme), choisi par le prof ; null = matchs classiques.
export const sessionTheme = (settings: unknown): BmTheme | null => readTheme((settings as { bmTheme?: unknown } | null)?.bmTheme);
export const needsServer =(t: BmTheme | null) => !!t && (t.kind === "SERVE" || t.serveFault);
export const priced = (t: BmTheme | null) => !!t && (t.kind === "PRICE_UP" || t.kind === "PRICE_DOWN");

// Valeur de l'echange en cours apres `exchanges` appuis sur le bouton central.
export function priceOf(t: BmTheme | null, exchanges: number): number {
  if (!t) return 1;
  if (t.kind === "PRICE_UP") { const p = Math.max(1, exchanges); return t.cap ? Math.min(t.cap, p) : p; }
  if (t.kind === "PRICE_DOWN") return Math.max(t.floor, t.start - exchanges);
  return 1;
}
// Un echange gagne par `winner` (0 = A, 1 = B) : points ajoutes [A, B] et le serveur suivant.
export function rallyOutcome(t: BmTheme | null, winner: 0 | 1, server: 0 | 1 | null, exchanges: number): { add: [number, number]; server: 0 | 1 } {
  const add: [number, number] = [0, 0];
  if (t?.kind === "SERVE") {
    if (server === null || server === winner) add[winner] = 1; // service inconnu : on compte (et il sert ensuite)
    return { add, server: winner };
  }
  add[winner] = priceOf(t, exchanges);
  return { add, server: winner };
}
// Service rate : le serveur perd 1 point (jamais sous 0), l'adversaire en gagne 1 et prend le service.
export function faultOutcome(server: 0 | 1): { add: [number, number]; server: 0 | 1 } {
  const other = (1 - server) as 0 | 1;
  const add: [number, number] = [0, 0];
  add[server] = -1;
  add[other] = 1;
  return { add, server: other };
}
