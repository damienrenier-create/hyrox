// Le prochain match a scouter (Sartay 26/11 : « quand un joueur est scout, il faut lui attribuer le prochain match qui
// n'est pas encore joue, pour ne pas qu'il arrive dans un match qui a deja commence ; on ne peut scouter qu'un match qui
// est sur le point de commencer »). Module PUR.
//
// Pendant un tournoi : les rencontres « a jouer » (ni en direct, ni encodees), dans l'ordre du tournoi, sans le scout
// lui-meme ni un joueur parti. Un match deja pris par un autre scout (il l'a ouvert en direct) n'est plus « a jouer » :
// deux scouts ne recoivent jamais le meme match.
// - Par equipes : la ronde (et la vague) du prochain coup de sifflet.
// - Tableau : le premier tour qui a encore des matchs a jouer.
// - Poules (et handicap) : la ronde en cours de chaque poule, puis ses matchs en retard.
import type { BmMatch } from "@/lib/badminton";
import { teamsOf } from "@/lib/badminton-teams";
import { bracketOf, poolsOf, type TourKind, type TourPlayer, type TourSettings } from "@/lib/badminton-tournament";

export type ScoutPick = { a: string; b: string; label: string };
// busy : paires deja observees par un autre scout (observation en cours) : jamais proposees deux fois.
export function scoutQueue(t: { kind: TourKind; players: TourPlayer[]; settings: TourSettings }, matches: BmMatch[], scoutId: string, busy: Set<string> = new Set()): ScoutPick[] {
  const gone = new Set(t.players.filter((p) => p.gone).map((p) => p.studentId));
  const ok = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a !== scoutId && b !== scoutId && !gone.has(a) && !gone.has(b);
  const out: ScoutPick[] = [];
  const seen = new Set<string>();
  const push = (a: string, b: string, label: string) => { const k = [a, b].sort().join("|"); if (!seen.has(k) && !busy.has(k)) { seen.add(k); out.push({ a, b, label }); } };
  if (t.kind === "TEAMS") {
    const st = teamsOf(t.players, matches, t.settings);
    if (!st.next) return out;
    const r = st.rounds.find((x) => x.n === st.next!.round);
    for (const x of r?.rencontres ?? []) {
      for (const p of x.matches) if (p.wave === st.next.wave && p.status === "todo" && ok(p.a, p.b)) push(p.a, p.b, `${x.stage ? `${x.stage} · ` : ""}équipes ${x.x} – ${x.y}`);
    }
    return out;
  }
  if (t.kind === "BRACKET") {
    const br = bracketOf(t.players, matches);
    for (const r of br.rounds) {
      for (const g of r.groups) for (const p of g.pairings) if (p.status === "todo" && ok(p.a, p.b)) push(p.a as string, p.b as string, `Tour ${r.n}`);
      if (out.length) return out;
    }
    return out;
  }
  const pools = poolsOf(t.players, matches, t.kind === "HANDICAP" ? t.settings : null, t.settings.poolLegs);
  for (const pool of pools) {
    const r = pool.rounds.find((x) => x.n === pool.current);
    for (const p of [...(r?.pairings ?? []), ...pool.catchUp]) if (p.status === "todo" && ok(p.a, p.b)) push(p.a, p.b as string, `Poule ${pool.name}`);
  }
  return out;
}
