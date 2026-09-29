import { elapsed } from "./pyramide-engine";
import {
  activeCards, attemptEvents, cardSeconds, cardsForTeam, coinsInPlay, coinsState, emomNextCard, emomSchedule, emomWaveAt, emomWaveEvents, emomZombieSim,
  hasDemotion, heartCarryBites, ladderFor, masteredExercises, orderedLevels, parcoursKey, pickRocketTarget, progressOf, rankTeams, rightmostCard, rocketPayload, teamSizeOf, teamStarsOf, zombieSim, zombieSpeedLevel,
  DEMOTE_AT_LOSSES, DISCOUNT_STEPS, EMOM_ZOMBIE_SPEED, PENALTY_INDEX0, PENALTY_STEPS, ROCKET_PRICE, SOFT_LOSSES, ZOMBIE_COIN_LOSS,
  type BossEntry, type CoinEvent, type EmomSettings, type Format, type FrozenLevel, type Ladders, type LevelOrder, type Loss, type Stars, type StarSwitch, type TeamPenalty, type Tick,
} from "./level-engine";

// Rejeu du WOD Level (Sartay 28-29/09, « la séance doit pouvoir être jouée 100 % hors ligne et envoyée à la fin »)
// — module PUR, le meme sur le PC du greffier et sur le serveur. Une fois le WOD lance, TOUT ce que fait le greffier
// est une operation datee gardee sur son PC : coche, carte jaune, allegement, fusee, cordes du finisher, pause,
// reprise, fin du WOD. L'ecran les applique ici, en direct, avec les zombies (vies douces ou avec descente, pieces
// mangees, fiches recues annulees, descente de categorie) et les fusees construites. A l'envoi, le serveur rejoue
// le meme lot avec CE code et ecrit le resultat en une fois : la base contient exactement ce que l'ecran montrait.
// Les heures : `absMs` = instant absolu (horloge du PC recalee sur le serveur), `atMs` = temps de course (deduit des
// pauses connues a cet instant). Les evenements sont rejoues dans l'ordre des `absMs`.

export type OpKind = "tick" | "untick" | "yellow" | "discount" | "rocket" | "scores" | "pause" | "resume" | "end";
export type ReplayOp = {
  id: string;
  kind: OpKind;
  teamId?: string;
  level?: number; // tick / untick
  card?: number;
  atMs?: number; // temps de course au clic (anciennes files : seule heure connue)
  absMs?: number; // instant absolu du clic
  delta?: 1 | -1; // yellow
  reps?: number; // discount
  draw?: number; // rocket : tirage au sort (0-1) fait sur le PC, rejoue tel quel par le serveur
  scores?: Record<string, number>; // scores : cordes par joueur
};
export type ReplayResult = { id: string; ok: boolean; error?: string };
export type ReplayTick = Tick & { id: string };
export type ReplayLoss = Loss & { id: string };
export type ReplayPause = { id: string; from: number; to: number | null }; // instants absolus
export type ReplayCard = { id: string; teamId: string; absMs: number; atMs: number }; // carte jaune

export type ReplayConfig = {
  levels: FrozenLevel[]; // echelle figee (2 etoiles, format par defaut)
  ladders: Ladders;
  order: LevelOrder | null; // echauffement en differe
  formatOf: (teamId: string) => Format;
  teamIds: string[];
  zombies: boolean;
  fixedSpeed: number | null; // palier impose (echauffement), null = regle normale
  isMain: boolean; // WOD principal (pas l'echauffement ni le finisher) : vies douces, pieces perdues, descente
  spending: boolean; // pieces et fusees (WOD principal hors EMOM)
  emom: EmomSettings | null;
  capMs: number | null; // temps impose
  coinsCarry: Record<string, number>;
  startedAtMs: number; // coup d'envoi (absolu)
  now: () => number; // « maintenant » absolu (ecran : horloge recalee ; serveur : heure de la lecture)
  newId: (key: string) => string; // ecran : la cle elle-meme (stable d'un rendu a l'autre) ; serveur : un uuid
  demote?: boolean; // descente de categorie a la 3e vie (defaut : oui ; non pour rejouer une seance d'avant le 28/09 17 h 49)
};

export type ReplayState = {
  ticks: ReplayTick[];
  losses: ReplayLoss[];
  penalties: TeamPenalty[]; // fiches en jeu : penalites (cartes jaunes), fiches recues non annulees, allegements ; avec atMs
  coinEvents: CoinEvent[];
  teamStars: Record<string, Stars>;
  switches: Record<string, StarSwitch>;
  voided: string[]; // fiches recues annulees par une chute
  newSwitches: Record<string, StarSwitch>; // descentes de categorie decidees pendant le rejeu
  pauses: ReplayPause[];
  yellowCards: ReplayCard[];
  endedAtMs: number | null; // fin du WOD (absolu)
  emomScores: Record<string, number>;
  emomPlayerScores: Record<string, Record<string, number>>;
  giftCount: number; // fiches recues jamais creees (annulees comprises) : index des suivantes
  removedPenalties: { teamId: string; index: number }[]; // cartes jaunes retirees (les penalites n'ont pas d'identifiant en base)
  scoredTeams: string[]; // equipes dont les cordes ont ete saisies
  bossEntry: Record<string, BossEntry>; // 1re de sa categorie en entrant dans son BOSS en cours ? (montee de categorie)
};

export function cloneState(s: ReplayState): ReplayState {
  return {
    ticks: [...s.ticks], losses: [...s.losses], penalties: [...s.penalties], coinEvents: [...s.coinEvents], teamStars: { ...s.teamStars }, switches: { ...s.switches },
    voided: [...s.voided], newSwitches: { ...s.newSwitches }, pauses: s.pauses.map((p) => ({ ...p })), yellowCards: [...s.yellowCards], endedAtMs: s.endedAtMs,
    emomScores: { ...s.emomScores }, emomPlayerScores: { ...s.emomPlayerScores }, giftCount: s.giftCount, removedPenalties: [...s.removedPenalties], scoredTeams: [...s.scoredTeams], bossEntry: { ...s.bossEntry },
  };
}

// Instant absolu correspondant a un instant du chrono de course (les pauses decalent).
export function absoluteFromRace(startedAtMs: number, pauses: { from: number; to: number | null }[], raceMs: number, nowMs: number): number {
  let abs = startedAtMs + raceMs;
  for (const p of [...pauses].sort((a, b) => a.from - b.from)) {
    if (p.from <= abs) abs += (p.to ?? nowMs) - p.from;
  }
  return abs;
}
// Temps de course d'un instant absolu, avec les pauses connues de l'etat (une pause ouverte fige le chrono).
export const raceOf = (cfg: ReplayConfig, st: ReplayState, absMs: number) => Math.max(0, elapsed(cfg.startedAtMs, st.pauses, absMs) ?? 0);
export const absOf = (cfg: ReplayConfig, st: ReplayState, raceMs: number) => absoluteFromRace(cfg.startedAtMs, st.pauses, raceMs, cfg.now());
export const endRaceOf = (cfg: ReplayConfig, st: ReplayState): number | null => (st.endedAtMs === null ? null : raceOf(cfg, st, st.endedAtMs));
// « Maintenant » en temps de course, borne par la fin du WOD.
export function nowRace(cfg: ReplayConfig, st: ReplayState): number {
  const end = endRaceOf(cfg, st);
  const now = raceOf(cfg, st, cfg.now());
  return end === null ? now : Math.min(now, end);
}
const isOpen = (st: ReplayState) => st.pauses.some((p) => p.to === null);

// Echelle d'une equipe : son parcours (apres une eventuelle descente), dans son ordre.
export function replayLadder(cfg: ReplayConfig, st: ReplayState, teamId: string): FrozenLevel[] {
  return orderedLevels(ladderFor(cfg.levels, cfg.ladders, teamStarsOf(st.teamStars, teamId), cfg.formatOf(teamId), st.switches[teamId]), cfg.order?.[teamId]);
}

// Zombies d'UNE equipe constates jusqu'a `untilRaceMs` (chrono de course). Meme regle que le serveur depuis le 28/09.
export function catchUpTeam(cfg: ReplayConfig, st: ReplayState, teamId: string, untilRaceMs: number): number {
  if (!cfg.zombies || !cfg.levels.length) return 0;
  const end = endRaceOf(cfg, st);
  const untilMs = Math.max(0, Math.min(untilRaceMs, cfg.capMs ?? Number.POSITIVE_INFINITY, end ?? Number.POSITIVE_INFINITY));
  let applied = 0;
  // Finisher (EMOM) : une vie perdue par vague non bouclee a sa fin ; les coches restent.
  if (cfg.emom) {
    const speed = cfg.fixedSpeed ?? EMOM_ZOMBIE_SPEED;
    for (const w of emomSchedule(cfg.emom.waveMinutes)) {
      if (untilMs < w.startMs) break;
      const level = cfg.levels.find((l) => l.number === w.wave);
      if (!level) continue;
      const cards = activeCards(level);
      if (!cards.length || st.losses.some((l) => l.teamId === teamId && l.level === w.wave)) continue;
      const sim = emomZombieSim(w.endMs - w.startMs, cards.length, cards.reduce((s, x) => s + cardSeconds(x.card), 0), emomWaveEvents(level, teamId, st.ticks, w), untilMs - w.startMs, speed);
      if (sim.catchAtMs === null) continue;
      const atMs = w.startMs + sim.catchAtMs;
      st.losses.push({ id: cfg.newId(`loss:${teamId}:${w.wave}:${Math.round(atMs)}`), teamId, level: w.wave, atMs });
      applied++;
    }
    return applied;
  }
  const format = cfg.formatOf(teamId);
  let mine = replayLadder(cfg, st, teamId);
  for (let guard = 0; guard < 20; guard++) {
    const p = progressOf(mine, teamId, st.ticks, st.losses, st.penalties);
    if (p.currentLevel === null) break;
    const level = mine.find((l) => l.number === p.currentLevel);
    if (!level) break;
    // Rattrape = coeur mange en entier (3 bouchees), bouchees conservees entre deux fiches (simulation).
    const cards = cardsForTeam(level, teamId, st.penalties);
    const ev = attemptEvents(level, teamId, st.ticks, p.attemptStartMs, st.penalties);
    // Coeur deja croque au niveau precedent (il reste en l'etat, sauf apres une vie perdue).
    const carry = heartCarryBites(mine, teamId, st.ticks, st.losses, st.penalties, (l, k) => cfg.fixedSpeed ?? zombieSpeedLevel(l.number, k), teamSizeOf(format));
    const sim = zombieSim(level, ev.initialTotalSec, ev.events, untilMs - p.attemptStartMs, cfg.fixedSpeed ?? zombieSpeedLevel(level.number, p.losses), cards.length, teamSizeOf(format), carry);
    if (sim.catchAtMs === null) break;
    const deadline = p.attemptStartMs + sim.catchAtMs;
    // Au WOD principal, les 5 premieres vies perdues sont « douces » (pas de descente, fiches gardees, le zombie
    // repart du debut avec un coeur neuf) ; ensuite, retour au niveau precedent.
    const soft = cfg.isMain && st.losses.filter((x) => x.teamId === teamId).length < SOFT_LOSSES;
    const lossId = cfg.newId(`loss:${teamId}:${p.currentLevel}:${Math.round(deadline)}`);
    if (!soft) {
      // Retour au niveau precedent DANS L'ORDRE DE L'EQUIPE : fiches du niveau en cours et du precedent effacees.
      const seq = mine.map((l) => l.number);
      const at = seq.indexOf(p.currentLevel);
      const doomedLevels = new Set(at > 0 ? [seq[at - 1], p.currentLevel] : [p.currentLevel]);
      st.ticks = st.ticks.filter((x) => !(x.teamId === teamId && doomedLevels.has(x.level)));
      // Les fiches recues d'une fusee hors des niveaux encore boucles apres la chute sont annulees.
      const kept = new Set(seq.slice(0, Math.max(0, at - 1)));
      const doomedGifts = st.penalties.filter((g) => g.kind === "gift" && g.teamId === teamId && g.id && !kept.has(g.level));
      if (doomedGifts.length) {
        st.voided.push(...doomedGifts.map((g) => g.id!));
        st.penalties = st.penalties.filter((g) => !doomedGifts.includes(g));
      }
    }
    st.losses.push({ id: lossId, teamId, level: p.currentLevel, atMs: deadline, soft });
    applied++;
    // Chaque vie perdue au WOD principal coute la moitie des pieces en banque (arrondi vers le bas).
    if (cfg.isMain) {
      const bank = coinsState(mine, teamId, st.ticks, st.losses, st.penalties, st.coinEvents, cfg.coinsCarry, coinsInPlay).bank;
      const lost = Math.floor(bank * ZOMBIE_COIN_LOSS);
      if (lost > 0) st.coinEvents.push({ id: lossId, teamId, kind: "zombie", coins: lost, at: Math.round(absOf(cfg, st, deadline)), level: p.currentLevel });
    }
    // 3e vie perdue au WOD principal : l'equipe descend d'une categorie (une seule fois), sans perdre son niveau ;
    // la nouvelle echelle commence au niveau suivant.
    const stars = teamStarsOf(st.teamStars, teamId);
    if (cfg.isMain && cfg.demote !== false && !hasDemotion(st.switches[teamId]) && stars > 1 && st.losses.filter((x) => x.teamId === teamId).length === DEMOTE_AT_LOSSES) {
      const cur = progressOf(mine, teamId, st.ticks, st.losses, st.penalties).currentLevel;
      const at = mine.findIndex((l) => l.number === cur);
      const next = at >= 0 ? mine[at + 1] : undefined;
      if (next) {
        const sw: StarSwitch = { from: stars, to: (stars - 1) as Stars, fromLevel: next.number, ...(st.switches[teamId] ? { prev: st.switches[teamId] } : {}) };
        st.switches[teamId] = sw;
        st.newSwitches[teamId] = sw;
        st.teamStars[teamId] = sw.to;
        mine = replayLadder(cfg, st, teamId);
      }
    }
  }
  return applied;
}

export function catchUpAll(cfg: ReplayConfig, st: ReplayState, untilRaceMs: number): number {
  let n = 0;
  for (const id of cfg.teamIds) n += catchUpTeam(cfg, st, id, untilRaceMs);
  return n;
}

// Fusee construite des que la banque atteint son prix (une a la fois) : meme regle que le serveur.
export function buildRocket(cfg: ReplayConfig, st: ReplayState, teamId: string, absMs: number): boolean {
  if (!cfg.spending) return false;
  const s = coinsState(replayLadder(cfg, st, teamId), teamId, st.ticks, st.losses, st.penalties, st.coinEvents, cfg.coinsCarry);
  if (s.stock !== 0 || s.bank < ROCKET_PRICE) return false;
  const n = st.coinEvents.filter((e) => e.teamId === teamId && e.kind === "rocket").length;
  st.coinEvents.push({ id: cfg.newId(`rocket:${teamId}:${n + 1}`), teamId, kind: "rocket", coins: ROCKET_PRICE, at: Math.round(absMs) });
  return true;
}

// ----- Les operations du greffier (portees de level-actions.ts / level-coins.ts, 28/09 soir) -----

// Carte jaune : +1 = une carte et une fiche de cordes (PENALTY_STEPS) sur le niveau en cours ; -1 = la derniere
// carte et sa fiche retirees (sa coche aussi).
export function applyYellow(cfg: ReplayConfig, st: ReplayState, teamId: string, delta: 1 | -1, raceMs: number, absMs: number): string | null {
  const mine = st.penalties.filter((p) => p.kind === "penalty" && p.teamId === teamId);
  if (delta > 0) {
    catchUpTeam(cfg, st, teamId, raceMs);
    st.yellowCards.push({ id: cfg.newId(`card:${teamId}:${Math.round(absMs)}`), teamId, absMs, atMs: raceMs });
    const p = progressOf(replayLadder(cfg, st, teamId), teamId, st.ticks, st.losses, st.penalties);
    if (p.currentLevel !== null) {
      const k = mine.length;
      st.penalties.push({ id: cfg.newId(`pen:${teamId}:${k}`), teamId, level: p.currentLevel, index: PENALTY_INDEX0 + k, reps: PENALTY_STEPS[Math.min(k, PENALTY_STEPS.length - 1)], label: "CORDE", weight: 1, at: Math.round(absMs), atMs: raceMs, kind: "penalty" });
    }
    return null;
  }
  const last = [...st.yellowCards].filter((c) => c.teamId === teamId).sort((a, b) => b.absMs - a.absMs)[0];
  if (last) st.yellowCards = st.yellowCards.filter((c) => c !== last);
  const lastPen = [...mine].sort((a, b) => b.index - a.index)[0];
  if (lastPen) {
    st.penalties = st.penalties.filter((p) => p !== lastPen);
    st.removedPenalties.push({ teamId, index: lastPen.index });
    st.ticks = st.ticks.filter((t) => !(t.teamId === teamId && t.level === lastPen.level && t.card === lastPen.index));
  }
  return null;
}

// Allegement : retirer des reps a la fiche la plus a droite du niveau en cours, 1 piece par seconde de travail.
export function applyDiscount(cfg: ReplayConfig, st: ReplayState, teamId: string, reps: number, raceMs: number, absMs: number): string | null {
  if (!cfg.spending) return "Les pièces se dépensent sur le WOD principal seulement.";
  if (!DISCOUNT_STEPS.includes(reps)) return "Montant inconnu.";
  catchUpTeam(cfg, st, teamId, raceMs);
  const levels = replayLadder(cfg, st, teamId);
  const p = progressOf(levels, teamId, st.ticks, st.losses, st.penalties);
  const level = p.currentLevel !== null ? levels.find((l) => l.number === p.currentLevel) : null;
  if (!level) return "Échelle bouclée : rien à alléger.";
  const card = rightmostCard(level, teamId, st.penalties, p.doneCards);
  if (!card) return "Aucune fiche à alléger sur ce niveau.";
  const n = Math.min(reps, card.card.reps - 1);
  const cost = n * card.card.weight;
  const bank = coinsState(levels, teamId, st.ticks, st.losses, st.penalties, st.coinEvents, cfg.coinsCarry).bank;
  if (cost > bank) return `Il faut ${cost} pièces pour retirer ${n} ${card.card.label} ; l'équipe en a ${bank}.`;
  const id = cfg.newId(`disc:${teamId}:${level.number}:${card.index}:${Math.round(absMs)}`);
  st.penalties.push({ id, teamId, level: level.number, index: card.index, reps: -n, label: card.card.label, weight: card.card.weight, exerciseId: card.card.exerciseId, at: Math.round(absMs), atMs: raceMs, kind: "discount" });
  st.coinEvents.push({ id, teamId, kind: "discount", coins: cost, at: Math.round(absMs), label: card.card.label, reps: n, level: level.number, index: card.index });
  return null;
}

// Fusee (clic du greffier) : cible et charge choisies par la regle (`pickRocketTarget`, `rocketPayload`), le seul
// tirage au sort venant de `draw`. Le classement de toutes les equipes decide de la cible : elles sont d'abord
// toutes rattrapees jusqu'a l'instant du clic.
export function applyRocket(cfg: ReplayConfig, st: ReplayState, teamId: string, draw: number, raceMs: number, absMs: number): string | null {
  if (!cfg.spending) return "Les fusées se lancent sur le WOD principal seulement.";
  catchUpAll(cfg, st, raceMs);
  const stateOf = (id: string) => coinsState(replayLadder(cfg, st, id), id, st.ticks, st.losses, st.penalties, st.coinEvents, cfg.coinsCarry);
  const mine = stateOf(teamId);
  if (mine.stock < 1) return "Pas de fusée construite (100 pièces).";
  const groupOf = (id: string) => parcoursKey(teamStarsOf(st.teamStars, id), cfg.formatOf(id));
  const progress = cfg.teamIds.map((x) => progressOf(replayLadder(cfg, st, x), x, st.ticks, st.losses, st.penalties));
  const ranked = rankTeams(progress, (x) => stateOf(x).score);
  const rows = cfg.teamIds.map((x) => {
    const g = groupOf(x);
    const p = progress.find((pp) => pp.teamId === x)!;
    const lv = replayLadder(cfg, st, x);
    const at = lv.findIndex((l) => l.number === p.currentLevel);
    const next = at >= 0 ? lv[at + 1] ?? null : null;
    return { teamId: x, group: g, rankInGroup: ranked.filter((pp) => groupOf(pp.teamId) === g).findIndex((pp) => pp.teamId === x) + 1, groupSize: 0, finished: p.currentLevel === null, hasNext: !!next, next };
  });
  for (const r of rows) r.groupSize = rows.filter((x) => x.group === r.group).length;
  const sendTargets = st.coinEvents.filter((e) => e.kind === "send").sort((a, b) => a.at - b.at).map((e) => e.toTeamId ?? "");
  const pick = pickRocketTarget(teamId, rows, sendTargets, () => Math.min(0.999999, Math.max(0, draw)));
  const payload = rocketPayload(masteredExercises(replayLadder(cfg, st, teamId), teamId, st.ticks, st.penalties), mine.score);
  if (!payload) return "Aucun exercice maîtrisé pour l'instant (3 fiches du même exercice).";
  if (!pick) return "Aucune cible possible pour l'instant.";
  // Sartay 29/09 : la fusee se construit toute seule a 100 pieces, puis CHAQUE envoi coute la charge (reps x ponderation,
  // 1 piece par seconde de travail, comme l'allegement). Banque trop courte : la charge est reduite a ce qu'elle
  // peut payer (par 5), jamais sous 5 reps.
  const w = Math.max(0.1, payload.weight);
  const affordable = Math.floor(mine.bank / w);
  const reps = Math.min(payload.reps, affordable >= 5 ? Math.floor(affordable / 5) * 5 : affordable);
  if (reps < 5) return `Il faut ${5 * payload.weight} pièces pour envoyer 5 ${payload.label} ; l'équipe en a ${mine.bank}.`;
  const cost = reps * payload.weight;
  const target = pick.target;
  const giftId = cfg.newId(`gift:${teamId}:${Math.round(absMs)}`);
  const at = Math.round(absMs);
  st.penalties.push({ id: giftId, teamId: target.teamId, fromTeamId: teamId, level: target.next!.number, index: 200 + st.giftCount, reps, label: payload.label, weight: payload.weight, exerciseId: payload.exerciseId, at, atMs: raceMs, kind: "gift" });
  st.giftCount++;
  st.coinEvents.push({ id: giftId, teamId, kind: "send", coins: cost, at, toTeamId: target.teamId, label: payload.label, reps, giftId, level: target.next!.number });
  return null;
}

// Rang d'une equipe dans sa categorie (parcours x format) a l'instant `raceMs`, et taille de la categorie : toutes
// les equipes d'abord rattrapees jusque-la (le classement depend des vies et des pieces de chacune).
export function groupRank(cfg: ReplayConfig, st: ReplayState, teamId: string, raceMs: number): { rank: number; size: number } {
  catchUpAll(cfg, st, raceMs);
  const groupOf = (id: string) => parcoursKey(teamStarsOf(st.teamStars, id), cfg.formatOf(id));
  const g = groupOf(teamId);
  const ids = cfg.teamIds.filter((x) => groupOf(x) === g);
  const progress = ids.map((x) => progressOf(replayLadder(cfg, st, x), x, st.ticks, st.losses, st.penalties));
  const score = (x: string) => coinsState(replayLadder(cfg, st, x), x, st.ticks, st.losses, st.penalties, st.coinEvents, cfg.coinsCarry).score;
  return { rank: rankTeams(progress, score).findIndex((p) => p.teamId === teamId) + 1, size: ids.length };
}
// 1re d'une categorie d'au moins deux equipes (seule dans sa categorie, une equipe n'est « premiere » de personne).
const leads = (r: { rank: number; size: number }) => r.rank === 1 && r.size >= 2;

// Montee de categorie (Sartay 29/09) : l'equipe est 1re de sa categorie quand elle ENTRE dans un BOSS (derniere
// fiche du niveau d'avant) et l'est encore quand elle le BOUCLE -> +1 etoile a partir du niveau suivant, sans perdre
// son niveau (comme la descente, a l'envers). A chaque BOSS, jusqu'a 3 etoiles. WOD principal seulement. Categorie
// d'au moins deux equipes, a l'entree comme a la sortie.
export function checkPromotion(cfg: ReplayConfig, st: ReplayState, teamId: string, level: number, raceMs: number): void {
  if (!cfg.isMain || cfg.emom) return;
  const ladder = replayLadder(cfg, st, teamId);
  const idx = ladder.findIndex((l) => l.number === level);
  const lv = ladder[idx];
  if (!lv) return;
  const p = progressOf(ladder, teamId, st.ticks, st.losses, st.penalties);
  if (p.currentLevel === level) return; // niveau pas encore boucle
  const next = ladder[idx + 1];
  if (next?.boss) st.bossEntry[teamId] = { level: next.number, first: leads(groupRank(cfg, st, teamId, raceMs)) };
  if (!lv.boss) return;
  const entry = st.bossEntry[teamId];
  const stars = teamStarsOf(st.teamStars, teamId);
  if (!entry || entry.level !== lv.number || !entry.first || stars >= 3 || !next) return;
  if (!leads(groupRank(cfg, st, teamId, raceMs))) return;
  const sw: StarSwitch = { from: stars, to: (stars + 1) as Stars, fromLevel: next.number, ...(st.switches[teamId] ? { prev: st.switches[teamId] } : {}) };
  st.switches[teamId] = sw;
  st.newSwitches[teamId] = sw;
  st.teamStars[teamId] = sw.to;
}

// Finisher : cordes de la derniere vague, joueur par joueur ; le score de l'equipe = la somme.
export function applyScores(cfg: ReplayConfig, st: ReplayState, teamId: string, scores: Record<string, number>): string | null {
  if (!cfg.emom) return "Cette séance n'est pas un EMOM.";
  const clean: Record<string, number> = {};
  for (const [uid, n] of Object.entries(scores)) {
    if (!Number.isInteger(n) || n < 0 || n > 5000) return "Nombre de cordes invalide (entre 0 et 5000).";
    clean[uid] = n;
  }
  st.emomPlayerScores[teamId] = clean;
  st.emomScores[teamId] = Object.values(clean).reduce((s, n) => s + n, 0);
  if (!st.scoredTeams.includes(teamId)) st.scoredTeams.push(teamId);
  return null;
}

export function applyPause(cfg: ReplayConfig, st: ReplayState, absMs: number): string | null {
  if (st.endedAtMs !== null) return "La course est terminée.";
  if (isOpen(st)) return null; // deja en pause : rien a faire
  st.pauses.push({ id: cfg.newId(`pause:${Math.round(absMs)}`), from: Math.round(absMs), to: null });
  return null;
}
export function applyResume(cfg: ReplayConfig, st: ReplayState, absMs: number): string | null {
  if (st.endedAtMs !== null) return "La course est terminée.";
  const open = st.pauses.find((p) => p.to === null);
  if (open) open.to = Math.max(open.from, Math.round(absMs));
  return null;
}
// Fin du WOD : derniers rattrapages jusqu'a cet instant, pause ouverte fermee, chrono arrete.
export function applyEnd(cfg: ReplayConfig, st: ReplayState, absMs: number): string | null {
  if (st.endedAtMs !== null) return null;
  const at = Math.round(absMs);
  catchUpAll(cfg, st, raceOf(cfg, st, at));
  const open = st.pauses.find((p) => p.to === null);
  if (open) open.to = Math.max(open.from, at);
  st.endedAtMs = at;
  return null;
}

// Rejoue un lot d'operations dans l'ordre des clics. Une coche : zombies de l'equipe constates jusqu'a l'heure du
// clic, puis verification (niveau en cours, vague du finisher) et enregistrement a l'heure reelle. Apres la fin du
// WOD : les coches arrivees apres coup comptent a leur heure (bornee a la fin), les cordes se saisissent encore,
// le reste est refuse.
export function replayOps(cfg: ReplayConfig, st: ReplayState, ops: ReplayOp[]): ReplayResult[] {
  const results: ReplayResult[] = [];
  const known = new Set(cfg.teamIds);
  const sorted = ops
    .map((o, i) => ({ o, i, abs: typeof o.absMs === "number" ? o.absMs : absOf(cfg, st, o.atMs ?? 0) }))
    .sort((a, b) => a.abs - b.abs || a.i - b.i);
  for (const { o: op, abs } of sorted) {
    const ended = st.endedAtMs !== null;
    // Heure du clic : jamais dans le futur, jamais apres la fin.
    const raceMs = Math.min(raceOf(cfg, st, abs), nowRace(cfg, st));
    const needsTeam = op.kind !== "pause" && op.kind !== "resume" && op.kind !== "end";
    if (needsTeam && (typeof op.teamId !== "string" || !known.has(op.teamId))) { results.push({ id: op.id, ok: false, error: "Équipe introuvable." }); continue; }
    const teamId = op.teamId ?? "";
    const capped = cfg.capMs !== null && raceMs >= cfg.capMs && (op.kind === "tick" || op.kind === "yellow" || op.kind === "discount" || op.kind === "rocket");
    if (capped) { results.push({ id: op.id, ok: false, error: "Temps écoulé." }); continue; }
    if (ended && (op.kind === "yellow" || op.kind === "discount" || op.kind === "rocket" || op.kind === "pause" || op.kind === "resume")) { results.push({ id: op.id, ok: false, error: "La course est terminée." }); continue; }
    let error: string | null = null;
    switch (op.kind) {
      case "untick":
        st.ticks = st.ticks.filter((t) => !(t.teamId === teamId && t.level === op.level && t.card === op.card));
        break;
      case "tick": {
        catchUpTeam(cfg, st, teamId, raceMs);
        const levels = replayLadder(cfg, st, teamId);
        const l = levels.find((x) => x.number === op.level);
        if (!l || !cardsForTeam(l, teamId, st.penalties).some((x) => x.index === op.card)) { error = "Cette fiche n'est plus en jeu."; break; }
        const mine = st.ticks.filter((t) => t.teamId === teamId);
        const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
        if (done.has(`${op.level}_${op.card}`)) break;
        if (cfg.emom) {
          const wave = emomWaveAt(cfg.emom.waveMinutes, raceMs);
          if (!wave) error = "L'EMOM est terminé.";
          else if (wave.wave !== op.level) error = `La coche est arrivée pendant la vague ${wave.wave}, pas la ${op.level}.`;
          else {
            const next = emomNextCard(l, teamId, mine);
            if (next && next.index !== op.card) error = "Les fiches se cochent dans l'ordre.";
          }
        } else {
          for (const prev of levels) {
            if (prev.number === op.level) break;
            if (cardsForTeam(prev, teamId, st.penalties).some(({ index }) => !done.has(`${prev.number}_${index}`))) { error = `Le niveau ${prev.number} n'est pas terminé (le zombie a pu faire redescendre l'équipe).`; break; }
          }
        }
        if (error) break;
        st.ticks.push({ id: cfg.newId(`tick:${teamId}:${op.level}:${op.card}:${op.id}`), teamId, level: op.level!, card: op.card!, atMs: raceMs });
        buildRocket(cfg, st, teamId, abs);
        checkPromotion(cfg, st, teamId, op.level!, raceMs);
        break;
      }
      case "yellow": error = applyYellow(cfg, st, teamId, op.delta === -1 ? -1 : 1, raceMs, abs); break;
      case "discount": error = applyDiscount(cfg, st, teamId, op.reps ?? 0, raceMs, abs); break;
      case "rocket": error = applyRocket(cfg, st, teamId, op.draw ?? 0, raceMs, abs); break;
      case "scores": error = applyScores(cfg, st, teamId, op.scores ?? {}); break;
      case "pause": error = applyPause(cfg, st, abs); break;
      case "resume": error = applyResume(cfg, st, abs); break;
      case "end": error = applyEnd(cfg, st, abs); break;
    }
    results.push(error ? { id: op.id, ok: false, error } : { id: op.id, ok: true });
  }
  return results;
}
