import {
  activeCards, attemptEvents, cardSeconds, cardsForTeam, coinsInPlay, coinsState, emomNextCard, emomSchedule, emomWaveAt, emomWaveEvents, emomZombieSim,
  heartCarryBites, ladderFor, orderedLevels, progressOf, teamSizeOf, teamStarsOf, zombieSim, zombieSpeedLevel,
  DEMOTE_AT_LOSSES, EMOM_ZOMBIE_SPEED, ROCKET_PRICE, SOFT_LOSSES, ZOMBIE_COIN_LOSS,
  type CoinEvent, type EmomSettings, type Format, type FrozenLevel, type Ladders, type LevelOrder, type Loss, type Stars, type StarSwitch, type TeamPenalty, type Tick,
} from "./level-engine";

// Rejeu du WOD Level (Sartay 28/09, « greffier fluide ») — module PUR, le meme sur le PC du greffier et sur le serveur.
// Pendant la course, l'ecran garde ses coches sur le PC et calcule lui-meme les zombies (vies perdues, douces ou avec
// descente, pieces mangees, fiches recues annulees, descente de categorie) et les fusees construites ; rien ne part
// sur Neon avant la Pause, la Fin du WOD ou un bouton qui a besoin du serveur. Le serveur rejoue alors le lot avec
// CE code : il obtient exactement ce que l'ecran affichait, puis l'ecrit en une fois.

export type ReplayTick = Tick & { id: string };
export type ReplayLoss = Loss & { id: string };
export type ReplayOp = { id: string; kind: "tick" | "untick"; teamId: string; level: number; card: number; atMs: number };
export type ReplayResult = { id: string; ok: boolean; error?: string };

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
  absOf: (raceMs: number) => number; // instant absolu d'un instant du chrono (horodatage des evenements de pieces)
  newId: (key: string) => string; // ecran : la cle elle-meme (stable d'un rendu a l'autre) ; serveur : un uuid
  demote?: boolean; // descente de categorie a la 3e vie (defaut : oui ; non pour rejouer une seance d'avant le 28/09 17 h 49)
};

export type ReplayState = {
  ticks: ReplayTick[];
  losses: ReplayLoss[];
  penalties: TeamPenalty[]; // fiches en jeu (penalites, fiches recues non annulees, allegements), avec atMs
  coinEvents: CoinEvent[];
  teamStars: Record<string, Stars>;
  switches: Record<string, StarSwitch>;
  voided: string[]; // fiches recues annulees par une chute
  newSwitches: Record<string, StarSwitch>; // descentes de categorie decidees pendant le rejeu
};

export function cloneState(s: ReplayState): ReplayState {
  return { ticks: [...s.ticks], losses: [...s.losses], penalties: [...s.penalties], coinEvents: [...s.coinEvents], teamStars: { ...s.teamStars }, switches: { ...s.switches }, voided: [...s.voided], newSwitches: { ...s.newSwitches } };
}

// Echelle d'une equipe : son parcours (apres une eventuelle descente), dans son ordre.
export function replayLadder(cfg: ReplayConfig, st: ReplayState, teamId: string): FrozenLevel[] {
  return orderedLevels(ladderFor(cfg.levels, cfg.ladders, teamStarsOf(st.teamStars, teamId), cfg.formatOf(teamId), st.switches[teamId]), cfg.order?.[teamId]);
}

// Zombies d'UNE equipe constates jusqu'a `untilMs` (chrono de course). Meme regle que le serveur depuis le 28/09.
export function catchUpTeam(cfg: ReplayConfig, st: ReplayState, teamId: string, untilRaceMs: number): number {
  if (!cfg.zombies || !cfg.levels.length) return 0;
  const untilMs = Math.max(0, Math.min(untilRaceMs, cfg.capMs ?? Number.POSITIVE_INFINITY));
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
      if (lost > 0) st.coinEvents.push({ id: lossId, teamId, kind: "zombie", coins: lost, at: Math.round(cfg.absOf(deadline)), level: p.currentLevel });
    }
    // 3e vie perdue au WOD principal : l'equipe descend d'une categorie (une seule fois), sans perdre son niveau ;
    // la nouvelle echelle commence au niveau suivant.
    const stars = teamStarsOf(st.teamStars, teamId);
    if (cfg.isMain && cfg.demote !== false && !st.switches[teamId] && stars > 1 && st.losses.filter((x) => x.teamId === teamId).length === DEMOTE_AT_LOSSES) {
      const cur = progressOf(mine, teamId, st.ticks, st.losses, st.penalties).currentLevel;
      const at = mine.findIndex((l) => l.number === cur);
      const next = at >= 0 ? mine[at + 1] : undefined;
      if (next) {
        const sw: StarSwitch = { from: stars, to: (stars - 1) as Stars, fromLevel: next.number };
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
export function buildRocket(cfg: ReplayConfig, st: ReplayState, teamId: string, atRaceMs: number): boolean {
  if (!cfg.spending) return false;
  const s = coinsState(replayLadder(cfg, st, teamId), teamId, st.ticks, st.losses, st.penalties, st.coinEvents, cfg.coinsCarry);
  if (s.stock !== 0 || s.bank < ROCKET_PRICE) return false;
  const n = st.coinEvents.filter((e) => e.teamId === teamId && e.kind === "rocket").length;
  st.coinEvents.push({ id: cfg.newId(`rocket:${teamId}:${n + 1}`), teamId, kind: "rocket", coins: ROCKET_PRICE, at: Math.round(cfg.absOf(atRaceMs)) });
  return true;
}

// Rejoue un lot de coches dans l'ordre des clics : pour chaque coche, les zombies de l'equipe sont constates jusqu'a
// l'heure du clic, puis la coche est verifiee (niveau en cours, vague du finisher) et appliquee a son heure reelle.
// `endRaceMs` : borne des heures de clic (fin de course, ou maintenant).
export function replayOps(cfg: ReplayConfig, st: ReplayState, ops: ReplayOp[], endRaceMs: number): ReplayResult[] {
  const results: ReplayResult[] = [];
  const known = new Set(cfg.teamIds);
  const sorted = ops.map((o, i) => ({ o, i })).sort((a, b) => a.o.atMs - b.o.atMs || a.i - b.i).map((x) => x.o);
  for (const op of sorted) {
    if (!known.has(op.teamId)) { results.push({ id: op.id, ok: false, error: "Équipe introuvable." }); continue; }
    const atMs = Math.max(0, Math.min(op.atMs, endRaceMs));
    if (cfg.capMs !== null && atMs > cfg.capMs) { results.push({ id: op.id, ok: false, error: "Temps écoulé." }); continue; }
    if (op.kind === "untick") {
      st.ticks = st.ticks.filter((t) => !(t.teamId === op.teamId && t.level === op.level && t.card === op.card));
      results.push({ id: op.id, ok: true });
      continue;
    }
    catchUpTeam(cfg, st, op.teamId, atMs);
    const levels = replayLadder(cfg, st, op.teamId);
    const l = levels.find((x) => x.number === op.level);
    if (!l || !cardsForTeam(l, op.teamId, st.penalties).some((x) => x.index === op.card)) { results.push({ id: op.id, ok: false, error: "Cette fiche n'est plus en jeu." }); continue; }
    const mine = st.ticks.filter((t) => t.teamId === op.teamId);
    const done = new Set(mine.map((t) => `${t.level}_${t.card}`));
    if (done.has(`${op.level}_${op.card}`)) { results.push({ id: op.id, ok: true }); continue; }
    let refused: string | null = null;
    if (cfg.emom) {
      const wave = emomWaveAt(cfg.emom.waveMinutes, atMs);
      if (!wave) refused = "L'EMOM est terminé.";
      else if (wave.wave !== op.level) refused = `La coche est arrivée pendant la vague ${wave.wave}, pas la ${op.level}.`;
      else {
        const next = emomNextCard(l, op.teamId, mine);
        if (next && next.index !== op.card) refused = "Les fiches se cochent dans l'ordre.";
      }
    } else {
      for (const prev of levels) {
        if (prev.number === op.level) break;
        if (cardsForTeam(prev, op.teamId, st.penalties).some(({ index }) => !done.has(`${prev.number}_${index}`))) { refused = `Le niveau ${prev.number} n'est pas terminé (le zombie a pu faire redescendre l'équipe).`; break; }
      }
    }
    if (refused) { results.push({ id: op.id, ok: false, error: refused }); continue; }
    st.ticks.push({ id: cfg.newId(`tick:${op.teamId}:${op.level}:${op.card}:${op.id}`), teamId: op.teamId, level: op.level, card: op.card, atMs });
    buildRocket(cfg, st, op.teamId, atMs);
    results.push({ id: op.id, ok: true });
  }
  return results;
}

// Instant absolu correspondant a un instant du chrono de course (les pauses decalent).
export function absoluteFromRace(startedAtMs: number, pauses: { from: number; to: number | null }[], raceMs: number, nowMs: number): number {
  let abs = startedAtMs + raceMs;
  for (const p of [...pauses].sort((a, b) => a.from - b.from)) {
    if (p.from <= abs) abs += (p.to ?? nowMs) - p.from;
  }
  return abs;
}
