import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { readFrozenFromSettings } from "@/lib/level";
import { readStarSwitches, DEMOTE_AT_LOSSES, type StarSwitch, type Stars, activeCards, attemptEvents, cardSeconds, cardsForTeam, coinsInPlay, coinsState, emomSchedule, emomWaveEvents, emomZombieSim, heartCarryBites, ladderFor, readCoinEvents, readCoinsCarry, SOFT_LOSSES, ZOMBIE_COIN_LOSS, type CoinEvent, orderedLevels, progressOf, readEmom, readFixedZombie, readLadders, readLevelOrder, readPenalties, readTeamFormats, readTeamStars, teamFormatOf, teamSizeOf, teamStarsOf, zombieSim, zombieSpeedLevel, EMOM_ZOMBIE_SPEED, type Loss, type Tick } from "@/lib/wod-engines/templates/level-engine";

// Mode zombies du WOD Level (regle de Sartay) : sur chaque niveau, un zombie part de la gauche et avance au
// rythme « duree estimee du niveau + 3 min » vers le coeur de l'equipe ; chaque fiche cochee eloigne le
// coeur (la ligne se retrecit vers la droite). S'il l'atteint, l'equipe perd une vie et retombe au niveau
// precedent (ses fiches des niveaux >= niveau-1 sont effacees), et le zombie repart.
// Le rattrapage est constate ici, cote serveur, a partir du chrono de course : les ecrans ne font que
// l'afficher. Appele avant chaque lecture d'etat (bundle, pouls) et avant chaque coche.

export function readZombies(settings: unknown): boolean {
  const v = (settings as { zombies?: unknown } | null)?.zombies;
  return v !== false; // active par defaut
}

// Instant absolu correspondant a un instant du chrono de course (les pauses decalent).
export function absoluteFromRace(startedAtMs: number, pauses: { from: number; to: number | null }[], raceMs: number, nowMs: number): number {
  let abs = startedAtMs + raceMs;
  for (const p of [...pauses].sort((a, b) => a.from - b.from)) {
    if (p.from <= abs) abs += (p.to ?? nowMs) - p.from;
  }
  return abs;
}

// Donnees deja chargees par l'appelant (pouls, coche) : aucune relecture, seules les ecritures touchent la base.
export type ZombieContext = {
  session: { wodType: string; settings: unknown; raceEndedAt: unknown | null };
  rs: { id: string; startedAt: unknown | null; endedAt: unknown | null } | null;
  pauses: { from: number; to: number | null }[];
  teams: { id: string }[];
  ticks: { id: string; teamId: string; level: number; card: number; at: unknown }[];
  losses: { teamId: string; level: number; at: unknown; soft?: boolean }[];
};

export async function loadZombieContext(sessionId: string, onlyTeamId?: string): Promise<ZombieContext | null> {
  const [session, rs] = await Promise.all([db.orm.public.Session.where({ id: sessionId }).first(), db.orm.public.RaceState.where({ sessionId }).first()]);
  if (!session) return null;
  const [pausesRaw, teams, ticks, losses] = await Promise.all([
    rs ? db.orm.public.RacePause.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    onlyTeamId ? Promise.resolve([{ id: onlyTeamId }]) : db.orm.public.Team.where({ sessionId }).all(),
    onlyTeamId ? db.orm.public.LevelTick.where({ sessionId, teamId: onlyTeamId }).all() : db.orm.public.LevelTick.where({ sessionId }).all(),
    onlyTeamId ? db.orm.public.LevelLoss.where({ sessionId, teamId: onlyTeamId }).all() : db.orm.public.LevelLoss.where({ sessionId }).all(),
  ]);
  return { session, rs, pauses: pausesRaw.map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })), teams, ticks, losses };
}

export async function applyZombieCatches(sessionId: string, onlyTeamId?: string, preloaded?: ZombieContext | null): Promise<number> {
  const ctx = preloaded ?? (await loadZombieContext(sessionId, onlyTeamId));
  if (!ctx) return 0;
  const { session, rs, pauses, teams } = ctx;
  if (session.wodType !== "LEVEL" || !readZombies(session.settings) || session.raceEndedAt) return 0;
  const levels = readFrozenFromSettings(session.settings);
  if (!levels.length) return 0;
  if (!rs?.startedAt || rs.endedAt) return 0;
  const startedAtMs = toMs(rs.startedAt);
  if (pauses.some((p) => p.to === null)) return 0; // en pause : le chrono n'avance pas, le zombie non plus
  const nowMs = Date.now();
  // Temps impose : au bout du chrono plus aucune coche n'est acceptee, donc plus aucun rattrapage non plus
  // (le zombie se fige avec le chrono, il ne devore pas les coeurs pendant que le greffier declare la fin).
  const capMin = (session.settings as { levelCapMin?: unknown } | null)?.levelCapMin;
  const capMs = typeof capMin === "number" && Number.isFinite(capMin) && capMin > 0 ? Math.round(capMin) * 60_000 : null;
  const nowRace = Math.min(elapsed(startedAtMs, pauses, nowMs) ?? 0, capMs ?? Number.POSITIVE_INFINITY);
  let ticks: (Tick & { id: string })[] = ctx.ticks.map((t) => ({ id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
  const losses: Loss[] = ctx.losses.map((l) => ({ teamId: l.teamId, level: l.level, soft: !!(l as { soft?: unknown }).soft, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  let applied = 0;
  const order = readLevelOrder(session.settings);
  const fixed = readFixedZombie(session.settings);
  const ladders = readLadders(session.settings);
  const teamStars = readTeamStars(session.settings);
  const teamFormats = readTeamFormats(session.settings);
  const voided = new Set<string>(); // fiches recues (fusees) annulees par une chute
  // WOD principal (pas l'echauffement ni le finisher) : regles du 28/09 (vies douces, pieces perdues).
  const isMain = !(session.settings as { child?: unknown } | null)?.child;
  const coinEvents: CoinEvent[] = readCoinEvents(session.settings);
  const coinsCarry = readCoinsCarry(session.settings);
  const zombieCoins: CoinEvent[] = []; // pieces mangees a enregistrer
  const switches = readStarSwitches(session.settings);
  const newSwitches: Record<string, StarSwitch> = {}; // descentes de categorie a enregistrer
  const penalties = readPenalties(session.settings).map((p) => ({ ...p, atMs: typeof p.at === "number" ? elapsed(startedAtMs, pauses, p.at) ?? undefined : undefined }));

  // Finisher (EMOM) : une vie perdue par vague non bouclee a sa fin ; les coches restent (les vagues
  // s'enchainent au chrono, rien a rejouer).
  const emom = readEmom(session.settings);
  if (emom) {
    const speed = fixed ?? EMOM_ZOMBIE_SPEED;
    for (const t of teams) {
      for (const w of emomSchedule(emom.waveMinutes)) {
        if (nowRace < w.startMs) break;
        const level = levels.find((l) => l.number === w.wave);
        if (!level) continue;
        const cards = activeCards(level);
        if (!cards.length || losses.some((l) => l.teamId === t.id && l.level === w.wave)) continue;
        const sim = emomZombieSim(w.endMs - w.startMs, cards.length, cards.reduce((s, x) => s + cardSeconds(x.card), 0), emomWaveEvents(level, t.id, ticks, w), nowRace - w.startMs, speed);
        if (sim.catchAtMs === null) continue;
        const deadline = w.startMs + sim.catchAtMs;
        await db.orm.public.LevelLoss.create({ sessionId, teamId: t.id, level: w.wave, at: Temporal.Instant.fromEpochMilliseconds(Math.round(absoluteFromRace(startedAtMs, pauses, deadline, nowMs))) });
        losses.push({ teamId: t.id, level: w.wave, atMs: deadline });
        applied++;
      }
    }
    return applied;
  }

  for (const t of teams) {
    const format = teamFormatOf(teamFormats, t.id);
    let mine = orderedLevels(ladderFor(levels, ladders, teamStarsOf(teamStars, t.id), format, switches[t.id]), order?.[t.id]);
    for (let guard = 0; guard < 20; guard++) {
      const p = progressOf(mine, t.id, ticks, losses, penalties);
      if (p.currentLevel === null) break;
      const level = mine.find((l) => l.number === p.currentLevel);
      if (!level) break;
      // Rattrape = coeur mange en entier (3 bouchees), bouchees conservees entre deux fiches (simulation).
      const cards = cardsForTeam(level, t.id, penalties);
      const ev = attemptEvents(level, t.id, ticks, p.attemptStartMs, penalties);
      // Coeur deja croque au niveau precedent (il reste en l'etat, sauf apres une vie perdue).
      const carry = heartCarryBites(mine, t.id, ticks, losses, penalties, (l, k) => fixed ?? zombieSpeedLevel(l.number, k), teamSizeOf(format));
      const sim = zombieSim(level, ev.initialTotalSec, ev.events, nowRace - p.attemptStartMs, fixed ?? zombieSpeedLevel(level.number, p.losses), cards.length, teamSizeOf(format), carry);
      if (sim.catchAtMs === null) break;
      const deadline = p.attemptStartMs + sim.catchAtMs;
      // Rattrape : vie perdue a l'instant exact ou le zombie a touche le coeur, retour au niveau precedent.
      const catchAbs = absoluteFromRace(startedAtMs, pauses, deadline, nowMs);
      // Sartay 28/09 : au WOD principal, les 5 premieres vies perdues sont « douces » (pas de descente, fiches
      // gardees, le zombie repart du debut avec un coeur neuf) ; ensuite, retour au niveau precedent comme avant.
      const soft = isMain && losses.filter((x) => x.teamId === t.id).length < SOFT_LOSSES;
      const lossRow = await db.orm.public.LevelLoss.create({ sessionId, teamId: t.id, level: p.currentLevel, soft, at: Temporal.Instant.fromEpochMilliseconds(Math.round(catchAbs)) });
      if (!soft) {
        // Retour au niveau precedent DANS L'ORDRE DE L'EQUIPE : on efface les fiches du niveau en cours et du
        // precedent de sa sequence (au premier niveau de la sequence, seulement le niveau en cours).
        const seq = mine.map((l) => l.number);
        const at = seq.indexOf(p.currentLevel);
        const doomedLevels = new Set(at > 0 ? [seq[at - 1], p.currentLevel] : [p.currentLevel]);
        const doomed = ticks.filter((x) => x.teamId === t.id && doomedLevels.has(x.level));
        for (const x of doomed) await db.orm.public.LevelTick.where({ id: x.id }).delete();
        ticks = ticks.filter((x) => !doomed.includes(x));
        // Les fiches recues d'une fusee qui ne sont pas dans un niveau encore boucle apres la chute sont effacees.
        const kept = new Set(seq.slice(0, Math.max(0, at - 1)));
        for (const g of penalties) if (g.kind === "gift" && g.teamId === t.id && g.id && !kept.has(g.level)) voided.add(g.id);
      }
      losses.push({ teamId: t.id, level: p.currentLevel, atMs: deadline, soft });
      applied++;
      // Chaque vie perdue au WOD principal coute la moitie des pieces en banque (arrondi vers le bas).
      if (isMain) {
        const bank = coinsState(mine, t.id, ticks, losses, penalties, [...coinEvents, ...zombieCoins], coinsCarry, coinsInPlay).bank;
        const lostCoins = Math.floor(bank * ZOMBIE_COIN_LOSS);
        if (lostCoins > 0) zombieCoins.push({ id: lossRow.id, teamId: t.id, kind: "zombie", coins: lostCoins, at: nowMs, level: p.currentLevel });
      }
      // 3e vie perdue au WOD principal : l'equipe descend d'une categorie (une seule fois), sans perdre son niveau ;
      // la nouvelle echelle commence au niveau suivant.
      const st = teamStarsOf(teamStars, t.id);
      if (isMain && !switches[t.id] && st > 1 && losses.filter((x) => x.teamId === t.id).length === DEMOTE_AT_LOSSES) {
        const cur = progressOf(mine, t.id, ticks, losses, penalties).currentLevel;
        const at = mine.findIndex((l) => l.number === cur);
        const next = at >= 0 ? mine[at + 1] : undefined;
        if (next) {
          const sw: StarSwitch = { from: st, to: (st - 1) as Stars, fromLevel: next.number };
          switches[t.id] = sw;
          newSwitches[t.id] = sw;
          teamStars[t.id] = sw.to;
          mine = orderedLevels(ladderFor(levels, ladders, sw.to, format, sw), order?.[t.id]);
        }
      }
    }
  }
  if (voided.size || zombieCoins.length || Object.keys(newSwitches).length) {
    // Relecture juste avant d'ecrire : un autre appareil a pu depenser des pieces ou lancer une fusee entre-temps.
    const fresh = ((await db.orm.public.Session.where({ id: sessionId }).first())?.settings as Record<string, unknown> | null) ?? {};
    const gifts = (Array.isArray(fresh.gifts) ? (fresh.gifts as Record<string, unknown>[]) : []).map((g) => (typeof g.id === "string" && voided.has(g.id) ? { ...g, void: true } : g));
    const existing = Array.isArray(fresh.coinEvents) ? (fresh.coinEvents as { id?: unknown }[]) : [];
    const coinEventsNext = [...existing, ...zombieCoins.filter((z) => !existing.some((e) => e.id === z.id))];
    const starsNext = { ...readTeamStars(fresh), ...Object.fromEntries(Object.entries(newSwitches).map(([id, sw]) => [id, sw.to])) };
    const switchNext = { ...readStarSwitches(fresh), ...newSwitches };
    await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...fresh, gifts, coinEvents: coinEventsNext, teamStars: starsNext, starSwitch: switchNext })) });
  }
  return applied;
}
