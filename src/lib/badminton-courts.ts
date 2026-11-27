// TERRAINS du tournoi (Sartay 27/11 : « je dois pouvoir parametrer le nombre de terrains dispo pour le tournoi et que
// l'app designe un terrain pour chaque joueur ; plus facile si les joueurs d'une meme poule sont, si possible, l'un a cote
// de l'autre. Par defaut 8 terrains ; parfois 9 ou 10, parfois 7, 6, 5 ou 4 ») ; un match par terrain par defaut, ou deux
// (demi-terrains A et B), reglable. Module PUR.
//
// Chaque poule (rencontre entre deux equipes, bloc de places du tableau) recoit un BLOC de terrains voisins, de la taille
// du nombre de matchs qu'elle joue en meme temps (moins s'il n'y a pas assez de terrains : chacun au moins un, dans
// l'ordre). Dans un bloc, les matchs de la ronde en cours prennent les terrains dans l'ordre de l'horaire, et ne bougent
// plus ; ceux qui n'ont pas de place ATTENDENT, et prennent dans l'ordre le terrain d'un match termine.
import type { BmMatch } from "@/lib/badminton";
import { bracketOf, pairKey, poolsOf, type PairingStatus, type TourKind, type TourPlayer, type TourSettings } from "@/lib/badminton-tournament";
import { teamsOf } from "@/lib/badminton-teams";

export const COURT_COUNTS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const DEFAULT_COURTS = 8;
export type CourtSettings = { courts: number; perCourt: 1 | 2 };
export function readCourtSettings(raw: unknown): CourtSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = Number(o.courts);
  return { courts: Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_COURTS, perCourt: Number(o.perCourt) === 2 ? 2 : 1 };
}
// Nom d'une place : « 3 » (un match par terrain) ou « 3A » / « 3B » (demi-terrains).
export const slotLabel = (slot: number, perCourt: 1 | 2) => (perCourt === 1 ? String(slot) : `${Math.ceil(slot / 2)}${slot % 2 ? "A" : "B"}`);

type Pair = { a: string; b: string; status: PairingStatus };
export type CourtGroup = { key: string; capacity: number; pairings: Pair[] };
// Pour chaque rencontre en cours ou a jouer : sa place (numero), ou null = en attente d'un terrain.
export function assignCourts(groups: CourtGroup[], cs: CourtSettings): Map<string, number | null> {
  const total = Math.max(1, cs.courts * cs.perCourt);
  const live = groups.filter((g) => g.pairings.some((p) => p.status === "todo" || p.status === "live" || p.status === "disputed"));
  // Taille des blocs : ce qu'il faut, sinon une part (au moins 1 par groupe, tant qu'il reste des places).
  const want = live.map((g) => Math.max(1, g.capacity));
  const sum = want.reduce((t, x) => t + x, 0);
  let size = want.slice();
  if (sum > total) {
    size = want.map((w) => Math.floor((w * total) / sum));
    let left = total - size.reduce((t, x) => t + x, 0);
    for (let i = 0; i < size.length && left > 0; i++) if (size[i] === 0) { size[i] = 1; left--; }
    for (let i = 0; left > 0 && i < size.length * 4; i++) { const k = i % size.length; if (size[k] < want[k]) { size[k]++; left--; } }
    // Plus de groupes que de places : les derniers n'en ont pas (leurs matchs attendent).
    let over = size.reduce((t, x) => t + x, 0) - total;
    for (let i = size.length - 1; over > 0 && i >= 0; i--) { const cut = Math.min(over, size[i]); size[i] -= cut; over -= cut; }
  }
  const out = new Map<string, number | null>();
  let next = 1;
  live.forEach((g, i) => {
    const slots = Array.from({ length: size[i] }, (_, j) => next + j);
    next += size[i];
    // Positions fixes dans l'ordre de l'horaire ; les matchs sans place prennent, dans l'ordre, celle d'un match termine.
    const freed: number[] = [];
    const waiting: Pair[] = [];
    g.pairings.forEach((p, j) => {
      const s = j < slots.length ? slots[j] : null;
      if (s === null) { waiting.push(p); return; }
      if (p.status === "played" || p.status === "gone" || p.status === "bye") freed.push(s);
      else out.set(pairKey(p.a, p.b), s);
    });
    for (const p of waiting) {
      if (p.status === "played" || p.status === "gone" || p.status === "bye") continue;
      out.set(pairKey(p.a, p.b), freed.length ? freed.shift()! : null);
    }
  });
  return out;
}

// Les groupes d'un tournoi : poules (ronde en cours + rattrapages), rencontres d'equipes (prochaine vague), blocs du tableau.
export function courtGroups(t: { kind: TourKind; players: TourPlayer[]; settings: TourSettings }, matches: BmMatch[]): CourtGroup[] {
  // Rencontres reelles (deux joueurs connus, ni repos ni attente du tour precedent).
  const real = (list: { a: string | null | undefined; b: string | null | undefined; status: PairingStatus }[]): Pair[] => list.flatMap((p) => (typeof p.a === "string" && typeof p.b === "string" && p.status !== "bye" && p.status !== "wait" ? [{ a: p.a, b: p.b, status: p.status }] : []));
  if (t.kind === "TEAMS") {
    const st = teamsOf(t.players, matches, t.settings);
    if (!st.next) return [];
    const r = st.rounds.find((x) => x.n === st.next!.round);
    return (r?.rencontres ?? []).map((x) => {
      const ps = real(x.matches.filter((p) => p.wave === st.next!.wave));
      return { key: x.key, capacity: ps.length, pairings: ps };
    });
  }
  if (t.kind === "BRACKET") {
    const br = bracketOf(t.players, matches);
    return br.rounds.flatMap((r) => r.groups.map((g) => {
      const ps = real(g.pairings);
      return { key: `${r.n}:${g.lo}`, capacity: ps.length, pairings: ps };
    })).filter((g) => g.pairings.some((p) => p.status === "todo" || p.status === "live" || p.status === "disputed"));
  }
  const pools = poolsOf(t.players, matches, t.kind === "HANDICAP" ? t.settings : null, t.settings.poolLegs);
  return pools.map((pool) => {
    const active = pool.players.filter((id) => !t.players.find((p) => p.studentId === id)?.gone).length;
    const round = pool.rounds.find((x) => x.n === pool.current);
    const ps = real([...(round?.pairings ?? []), ...pool.catchUp]);
    return { key: pool.name, capacity: Math.max(1, Math.floor(active / 2)), pairings: ps };
  });
}

// Le terrain de chaque rencontre du tournoi (cle pairKey) : son nom, ou null = en attente.
export function tourCourts(t: { kind: TourKind; players: TourPlayer[]; settings: TourSettings & { courts?: number; perCourt?: 1 | 2 } }, matches: BmMatch[]): Map<string, string | null> {
  const cs = readCourtSettings(t.settings);
  const slots = assignCourts(courtGroups(t, matches), cs);
  return new Map([...slots].map(([k, s]) => [k, s === null ? null : slotLabel(s, cs.perCourt)]));
}
