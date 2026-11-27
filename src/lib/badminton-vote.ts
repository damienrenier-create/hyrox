// VOTE DU MEILLEUR COACH (Sartay 27/11 : « un systeme de vote a la fin du cours pour que les eleves puissent voter, parmi
// les eleves de leur poule, pour le meilleur coach »). Module PUR.
// - Qui : chaque joueur du tournoi de la seance vote pour UN autre joueur de son groupe : sa poule (poules, championnat a
//   handicap), son equipe (tournoi par equipes), tout le tableau (grand tableau). Jamais pour soi.
// - Quand : des 10 minutes avant la fin du cours, et jusqu'a 24 h apres ; il peut changer son vote jusque-la.
// - Ou : settings.coachVotes de la seance (liste ou l'on ajoute seulement ; la derniere voix d'un eleve compte).
// Puis (meme jour) deux autres votes, « des datas qui serviront a l'eval » : parmi ses ADVERSAIRES DU JOUR, celui qui est
// le plus difficile a jouer (« leur nemesis, pas sur qu'ils comprennent ce terme ») et celui contre qui c'est le plus
// agreable de jouer (saine competitivite, fair-play). Seulement s'il a joue au moins 2 adversaires dans le cours.
import { matchState, type BmMatch } from "@/lib/badminton";
import type { TourKind, TourPlayer } from "@/lib/badminton-tournament";

export type VoteKind = "COACH" | "HARD" | "NICE";
export const VOTE_KINDS: { id: VoteKind; emoji: string; title: string; hint: string }[] = [
  { id: "COACH", emoji: "👑", title: "Le meilleur coach", hint: "Celui qui a donné les meilleurs conseils, à toi ou aux autres." },
  { id: "HARD", emoji: "💪", title: "L'adversaire le plus difficile à jouer aujourd'hui", hint: "Celui qui t'a posé le plus de problèmes sur le terrain." },
  { id: "NICE", emoji: "🤝", title: "L'adversaire le plus agréable à jouer", hint: "Fair-play, bonne ambiance, saine compétition." },
];
const readKind = (v: unknown): VoteKind => (v === "HARD" || v === "NICE" ? v : "COACH");

export const VOTE_BEFORE_MS = 10 * 60_000;
export const VOTE_AFTER_MS = 24 * 3600_000;
export type CoachVote = { by: string; for: string; at: number; kind: VoteKind };
export function readCoachVotes(settings: unknown): CoachVote[] {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).coachVotes : null;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    return o && typeof o.by === "string" && typeof o.for === "string" && Number(o.at) > 0 ? [{ by: o.by, for: o.for, at: Number(o.at), kind: readKind(o.kind) }] : [];
  });
}
// La voix qui compte pour chaque eleve (pour ce vote) : la derniere.
export function latestVotes(list: CoachVote[], kind: VoteKind = "COACH"): Map<string, string> {
  const out = new Map<string, { for: string; at: number }>();
  for (const v of list.filter((x) => x.kind === kind)) { const cur = out.get(v.by); if (!cur || cur.at < v.at) out.set(v.by, { for: v.for, at: v.at }); }
  return new Map([...out].map(([k, v]) => [k, v.for]));
}
// Mon groupe pour le vote (sans moi) ; null : je ne joue pas ce tournoi.
export function voteGroup(t: { kind: TourKind; players: TourPlayer[] }, me: string): string[] | null {
  const mine = t.players.find((p) => p.studentId === me);
  if (!mine) return null;
  const same = t.kind === "BRACKET" ? t.players : t.players.filter((p) => p.pool === mine.pool);
  return same.map((p) => p.studentId).filter((id) => id !== me);
}
// Mes adversaires du jour : ceux contre qui j'ai un match encode dans ce cours (ni annule, ni en direct).
export function opponentsToday(matches: BmMatch[], me: string): string[] {
  const out = new Set<string>();
  for (const m of matches) {
    const st = matchState(m).status;
    if (st === "CANCELLED" || st === "LIVE") continue;
    if (m.playerAId === me) out.add(m.playerBId);
    else if (m.playerBId === me) out.add(m.playerAId);
  }
  return [...out];
}
// Les voix recues par chacun pour un vote (la derniere voix de chaque votant).
export function votesReceived(list: CoachVote[], kind: VoteKind): Map<string, number> {
  const out = new Map<string, number>();
  for (const [by, to] of latestVotes(list, kind)) if (by !== to) out.set(to, (out.get(to) ?? 0) + 1);
  return out;
}
// Le vote est-il ouvert ? endMs = fin du cours.
export const voteOpen = (endMs: number, nowMs: number) => nowMs >= endMs - VOTE_BEFORE_MS && nowMs <= endMs + VOTE_AFTER_MS;
// Le resultat par groupe : pour chaque groupe (poule, equipe…), les voix recues, et combien ont vote.
export type VoteTally = { group: string; votes: { id: string; n: number }[]; voters: number; size: number }[];
export function tallyVotes(t: { kind: TourKind; players: TourPlayer[] }, list: CoachVote[]): VoteTally {
  const last = latestVotes(list);
  const groups = t.kind === "BRACKET" ? [{ key: "Tableau", ids: t.players.map((p) => p.studentId) }] : [...new Set(t.players.map((p) => p.pool))].sort().map((g) => ({ key: g, ids: t.players.filter((p) => p.pool === g).map((p) => p.studentId) }));
  return groups.map(({ key, ids }) => {
    const set = new Set(ids);
    const count = new Map<string, number>();
    let voters = 0;
    for (const [by, to] of last) if (set.has(by) && set.has(to) && by !== to) { voters++; count.set(to, (count.get(to) ?? 0) + 1); }
    return { group: key, votes: [...count].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n), voters, size: ids.length };
  });
}
