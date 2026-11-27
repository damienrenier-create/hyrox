// VOTE DU MEILLEUR COACH (Sartay 27/11 : « un systeme de vote a la fin du cours pour que les eleves puissent voter, parmi
// les eleves de leur poule, pour le meilleur coach »). Module PUR.
// - Qui : chaque joueur du tournoi de la seance vote pour UN autre joueur de son groupe : sa poule (poules, championnat a
//   handicap), son equipe (tournoi par equipes), tout le tableau (grand tableau). Jamais pour soi.
// - Quand : des 10 minutes avant la fin du cours, et jusqu'a 24 h apres ; il peut changer son vote jusque-la.
// - Ou : settings.coachVotes de la seance (liste ou l'on ajoute seulement ; la derniere voix d'un eleve compte).
import type { TourKind, TourPlayer } from "@/lib/badminton-tournament";

export const VOTE_BEFORE_MS = 10 * 60_000;
export const VOTE_AFTER_MS = 24 * 3600_000;
export type CoachVote = { by: string; for: string; at: number };
export function readCoachVotes(settings: unknown): CoachVote[] {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).coachVotes : null;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    return o && typeof o.by === "string" && typeof o.for === "string" && Number(o.at) > 0 ? [{ by: o.by, for: o.for, at: Number(o.at) }] : [];
  });
}
// La voix qui compte pour chaque eleve : la derniere.
export function latestVotes(list: CoachVote[]): Map<string, string> {
  const out = new Map<string, { for: string; at: number }>();
  for (const v of list) { const cur = out.get(v.by); if (!cur || cur.at < v.at) out.set(v.by, { for: v.for, at: v.at }); }
  return new Map([...out].map(([k, v]) => [k, v.for]));
}
// Mon groupe pour le vote (sans moi) ; null : je ne joue pas ce tournoi.
export function voteGroup(t: { kind: TourKind; players: TourPlayer[] }, me: string): string[] | null {
  const mine = t.players.find((p) => p.studentId === me);
  if (!mine) return null;
  const same = t.kind === "BRACKET" ? t.players : t.players.filter((p) => p.pool === mine.pool);
  return same.map((p) => p.studentId).filter((id) => id !== me);
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
