import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { readFrozenFromSettings } from "@/lib/level";
import {
  readBossEntry, readCoinEvents, readCoinsCarry, readEmom, readEmomPlayerScores, readEmomScores, readFixedZombie, readLadders, readLevelOrder, readPenalties, readReorient, readStarSwitches, readStreaks, readTeamFormats, readTeamStars, teamFormatOf,
  type TeamPenalty,
} from "@/lib/wod-engines/templates/level-engine";
import { absoluteFromRace, catchUpAll, catchUpTeam, cloneState, nowRace, type ReplayConfig, type ReplayState } from "@/lib/wod-engines/templates/level-replay";

export { absoluteFromRace };

// Mode zombies du WOD Level (regle de Sartay) : sur chaque niveau, un zombie part de la gauche et avance au
// rythme « duree estimee du niveau + 3 min » vers le coeur de l'equipe ; chaque fiche cochee eloigne le
// coeur (la ligne se retrecit vers la droite). S'il l'atteint, l'equipe perd une vie (douce les 5 premieres fois au
// WOD principal, sinon retour au niveau precedent), la moitie de ses pieces, et descend d'une categorie a la 3e.
// Depuis le 28/09 (soir), le calcul vit dans `level-replay.ts` (module pur) : l'ecran du greffier l'execute en
// direct sur ses operations locales, le serveur le rejoue a la sauvegarde (fin du WOD, ou plus tot si le greffier
// envoie). Le serveur ne constate PLUS rien a la lecture pendant la course : il ne connait pas les coches du PC.

export function readZombies(settings: unknown): boolean {
  const v = (settings as { zombies?: unknown } | null)?.zombies;
  return v !== false; // active par defaut
}
// Operations deja appliquees (identifiants, les 5 000 dernieres) : un lot renvoye parce que la reponse s'est perdue
// ne rejoue pas une carte jaune, une fusee ou une pause deja enregistrees.
export const APPLIED_OPS_KEPT = 5000;
export function readAppliedOps(settings: unknown): string[] {
  const raw = (settings as { appliedOps?: unknown } | null)?.appliedOps;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

// Donnees deja chargees par l'appelant (pouls, coche) : aucune relecture, seules les ecritures touchent la base.
export type ZombieContext = {
  session: { wodType: string; settings: unknown; raceEndedAt: unknown | null };
  rs: { id: string; startedAt: unknown | null; endedAt: unknown | null } | null;
  pauses: { id?: string; from: number; to: number | null }[];
  teams: { id: string }[];
  ticks: { id: string; teamId: string; level: number; card: number; at: unknown }[];
  losses: { id?: string; teamId: string; level: number; at: unknown; soft?: boolean }[];
  cards: { id: string; teamId: string; at: unknown }[]; // cartes jaunes
};

export async function loadZombieContext(sessionId: string, onlyTeamId?: string): Promise<ZombieContext | null> {
  const [session, rs] = await Promise.all([db.orm.public.Session.where({ id: sessionId }).first(), db.orm.public.RaceState.where({ sessionId }).first()]);
  if (!session) return null;
  const [pausesRaw, teams, ticks, losses, cards] = await Promise.all([
    rs ? db.orm.public.RacePause.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    onlyTeamId ? Promise.resolve([{ id: onlyTeamId }]) : db.orm.public.Team.where({ sessionId }).all(),
    onlyTeamId ? db.orm.public.LevelTick.where({ sessionId, teamId: onlyTeamId }).all() : db.orm.public.LevelTick.where({ sessionId }).all(),
    onlyTeamId ? db.orm.public.LevelLoss.where({ sessionId, teamId: onlyTeamId }).all() : db.orm.public.LevelLoss.where({ sessionId }).all(),
    rs ? (onlyTeamId ? db.orm.public.YellowCard.where({ raceStateId: rs.id, teamId: onlyTeamId }).all() : db.orm.public.YellowCard.where({ raceStateId: rs.id }).all()) : Promise.resolve([]),
  ]);
  return { session, rs, pauses: pausesRaw.map((p) => ({ id: p.id, from: toMs(p.from), to: p.to ? toMs(p.to) : null })), teams, ticks, losses, cards };
}

// Etat de rejeu d'une seance a partir de la base. null = pas de course en cours (pas lancee, ou terminee).
export type ServerReplay = { cfg: ReplayConfig; st: ReplayState; initial: ReplayState; rsId: string; startedAtMs: number; nowMs: number; nowRaceMs: number };
export function replayFromContext(ctx: ZombieContext, opts: { allowEnded?: boolean } = {}): ServerReplay | null {
  const { session, rs, pauses, teams } = ctx;
  if (session.wodType !== "LEVEL" || !rs?.startedAt) return null;
  if (!opts.allowEnded && (rs.endedAt || session.raceEndedAt)) return null;
  const settings = session.settings;
  const startedAtMs = toMs(rs.startedAt);
  const nowMs = Date.now();
  const capMin = (settings as { levelCapMin?: unknown } | null)?.levelCapMin;
  const capMs = typeof capMin === "number" && Number.isFinite(capMin) && capMin > 0 ? Math.round(capMin) * 60_000 : null;
  const formats = readTeamFormats(settings);
  const isMain = !(settings as { child?: unknown } | null)?.child;
  const emom = readEmom(settings);
  const cfg: ReplayConfig = {
    levels: readFrozenFromSettings(settings),
    ladders: readLadders(settings),
    order: readLevelOrder(settings),
    formatOf: (id) => teamFormatOf(formats, id),
    teamIds: teams.map((t) => t.id),
    zombies: readZombies(settings),
    fixedSpeed: readFixedZombie(settings),
    isMain,
    spending: isMain && !emom,
    emom,
    capMs,
    coinsCarry: readCoinsCarry(settings),
    startedAtMs,
    now: () => nowMs,
    newId: () => randomUUID(),
    reorient: readReorient(settings),
  };
  const race = (abs: number) => elapsed(startedAtMs, pauses, abs) ?? 0;
  const gifts = (settings as { gifts?: unknown } | null)?.gifts;
  const st: ReplayState = {
    ticks: ctx.ticks.map((t) => ({ id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: race(toMs(t.at)) })),
    losses: ctx.losses.map((l, i) => ({ id: l.id ?? `db-${i}`, teamId: l.teamId, level: l.level, soft: !!l.soft, atMs: race(toMs(l.at)) })),
    penalties: readPenalties(settings).map((p) => ({ ...p, atMs: typeof p.at === "number" ? race(p.at) : undefined })),
    coinEvents: readCoinEvents(settings),
    teamStars: readTeamStars(settings),
    switches: readStarSwitches(settings),
    voided: [],
    newSwitches: {},
    pauses: pauses.map((p, i) => ({ id: p.id ?? `db-pause-${i}`, from: p.from, to: p.to })),
    yellowCards: ctx.cards.map((c) => ({ id: c.id, teamId: c.teamId, absMs: toMs(c.at), atMs: race(toMs(c.at)) })),
    endedAtMs: rs.endedAt ? toMs(rs.endedAt) : null,
    emomScores: readEmomScores(settings),
    emomPlayerScores: readEmomPlayerScores(settings),
    giftCount: Array.isArray(gifts) ? gifts.length : 0,
    removedPenalties: [],
    scoredTeams: [],
    bossEntry: readBossEntry(settings),
    streaks: readStreaks(settings),
  };
  return { cfg, st, initial: cloneState(st), rsId: rs.id, startedAtMs, nowMs, nowRaceMs: nowRace(cfg, st) };
}

// Ecrit ce que le rejeu a change : coches ajoutees et effacees, vies perdues, cartes jaunes, pauses, fin du WOD
// (une transaction ; repli ligne par ligne si l'unicite d'une coche saute = doublon multi-appareils), puis dans les
// reglages (relus juste avant) les pieces (zombie, fusees, allegements), fiches recues (nouvelles, annulees),
// penalites, descentes de categorie et cordes du finisher.
export async function persistReplay(sessionId: string, r: ServerReplay, by: string, appliedOpIds: string[] = []): Promise<{ ticksAdded: number; ticksRemoved: number; losses: number }> {
  const { st, initial, rsId, startedAtMs, nowMs } = r;
  const inst = (absMs: number) => Temporal.Instant.fromEpochMilliseconds(Math.round(absMs));
  const abs = (raceMs: number) => inst(absoluteFromRace(startedAtMs, st.pauses, raceMs, nowMs));
  const before = new Set(initial.ticks.map((t) => t.id));
  const after = new Set(st.ticks.map((t) => t.id));
  const added = st.ticks.filter((t) => !before.has(t.id));
  const removed = initial.ticks.filter((t) => !after.has(t.id)).map((t) => t.id);
  const lossIds = new Set(initial.losses.map((l) => l.id));
  const newLosses = st.losses.filter((l) => !lossIds.has(l.id));
  const cardIds = new Set(initial.yellowCards.map((c) => c.id));
  const cardsAfter = new Set(st.yellowCards.map((c) => c.id));
  const newCards = st.yellowCards.filter((c) => !cardIds.has(c.id));
  const removedCards = initial.yellowCards.filter((c) => !cardsAfter.has(c.id)).map((c) => c.id);
  const pauseIds = new Set(initial.pauses.map((p) => p.id));
  const newPauses = st.pauses.filter((p) => !pauseIds.has(p.id));
  const closedPauses = st.pauses.filter((p) => pauseIds.has(p.id) && p.to !== null && initial.pauses.find((x) => x.id === p.id)?.to === null);
  const ended = st.endedAtMs !== null && initial.endedAtMs === null ? st.endedAtMs : null;
  const eventIds = new Set(initial.coinEvents.map((e) => e.id));
  const newEvents = st.coinEvents.filter((e) => !eventIds.has(e.id));
  const voided = new Set(st.voided);
  const switches = st.newSwitches;
  const giftIds = new Set(initial.penalties.filter((p) => p.kind === "gift").map((p) => p.id));
  const newGifts = st.penalties.filter((p) => p.kind === "gift" && !giftIds.has(p.id));
  const penKey = (p: { teamId: string; index: number }) => `${p.teamId}_${p.index}`;
  const penKeys = new Set(initial.penalties.filter((p) => p.kind === "penalty").map(penKey));
  const newPens = st.penalties.filter((p) => p.kind === "penalty" && !penKeys.has(penKey(p)));
  const discIds = new Set(initial.penalties.filter((p) => p.kind === "discount").map((p) => p.id));
  const newDiscs = st.penalties.filter((p) => p.kind === "discount" && !discIds.has(p.id));
  const raw = (p: TeamPenalty) => { const { kind, atMs, ...rest } = p; void kind; void atMs; return rest; };
  const rowsChanged = added.length || removed.length || newLosses.length || newCards.length || removedCards.length || newPauses.length || closedPauses.length || ended !== null;
  const bossEntryChanged = JSON.stringify(st.bossEntry) !== JSON.stringify(initial.bossEntry) || JSON.stringify(st.streaks) !== JSON.stringify(initial.streaks);
  const settingsChanged = newEvents.length || voided.size || Object.keys(switches).length || newGifts.length || newPens.length || st.removedPenalties.length || newDiscs.length || st.scoredTeams.length || appliedOpIds.length || bossEntryChanged;
  if (!rowsChanged && !settingsChanged) return { ticksAdded: 0, ticksRemoved: 0, losses: 0 };

  const tickRow = (t: ReplayState["ticks"][number]) => ({ id: t.id, sessionId, teamId: t.teamId, level: t.level, card: t.card, by, at: abs(t.atMs) });
  const lossRow = (l: ReplayState["losses"][number]) => ({ id: l.id, sessionId, teamId: l.teamId, level: l.level, soft: !!l.soft, at: abs(l.atMs) });
  const cardRow = (c: ReplayState["yellowCards"][number]) => ({ id: c.id, raceStateId: rsId, teamId: c.teamId, at: inst(c.absMs) });
  const pauseRow = (p: ReplayState["pauses"][number]) => (p.to === null ? { id: p.id, raceStateId: rsId, from: inst(p.from) } : { id: p.id, raceStateId: rsId, from: inst(p.from), to: inst(p.to) });
  if (rowsChanged) {
    try {
      await db.transaction(async (tx) => {
        if (removed.length) await tx.orm.public.LevelTick.where((t) => t.id.in(removed)).deleteAndCount();
        if (added.length) await tx.orm.public.LevelTick.createAndCount(added.map(tickRow));
        if (newLosses.length) await tx.orm.public.LevelLoss.createAndCount(newLosses.map(lossRow));
        if (removedCards.length) await tx.orm.public.YellowCard.where((c) => c.id.in(removedCards)).deleteAndCount();
        if (newCards.length) await tx.orm.public.YellowCard.createAndCount(newCards.map(cardRow));
        for (const p of newPauses) await tx.orm.public.RacePause.create(pauseRow(p));
        for (const p of closedPauses) await tx.orm.public.RacePause.where({ id: p.id }).update({ to: inst(p.to!) });
        if (ended !== null) {
          await tx.orm.public.RaceState.where({ id: rsId }).update({ endedAt: inst(ended) });
          await tx.orm.public.Session.where({ id: sessionId }).update({ raceEndedAt: inst(ended) });
        }
      });
    } catch {
      // Une coche identique vient d'etre ecrite par un autre appareil (unicite seance/equipe/niveau/fiche) : on reprend
      // ligne par ligne en ignorant les doublons, comme avant le 28/09.
      for (const id of removed) { try { await db.orm.public.LevelTick.where({ id }).delete(); } catch { /* deja effacee */ } }
      for (const t of added) { try { await db.orm.public.LevelTick.create(tickRow(t)); } catch { /* deja cochee par un autre appareil */ } }
      for (const l of newLosses) { try { await db.orm.public.LevelLoss.create(lossRow(l)); } catch { /* deja constatee */ } }
      for (const id of removedCards) { try { await db.orm.public.YellowCard.where({ id }).delete(); } catch { /* deja retiree */ } }
      for (const c of newCards) { try { await db.orm.public.YellowCard.create(cardRow(c)); } catch { /* deja posee */ } }
      for (const p of newPauses) { try { await db.orm.public.RacePause.create(pauseRow(p)); } catch { /* deja creee */ } }
      for (const p of closedPauses) { try { await db.orm.public.RacePause.where({ id: p.id }).update({ to: inst(p.to!) }); } catch { /* deja fermee */ } }
      if (ended !== null) {
        try { await db.orm.public.RaceState.where({ id: rsId }).update({ endedAt: inst(ended) }); } catch { /* deja terminee */ }
        try { await db.orm.public.Session.where({ id: sessionId }).update({ raceEndedAt: inst(ended) }); } catch { /* idem */ }
      }
    }
  }
  if (settingsChanged) {
    // Reglages relus juste avant d'ecrire : un autre appareil a pu depenser des pieces ou lancer une fusee entre-temps.
    const fresh = ((await db.orm.public.Session.where({ id: sessionId }).first())?.settings as Record<string, unknown> | null) ?? {};
    const list = (k: string) => (Array.isArray(fresh[k]) ? (fresh[k] as Record<string, unknown>[]) : []);
    const has = (arr: Record<string, unknown>[], id: unknown) => arr.some((x) => x.id === id);
    const gifts = [...list("gifts").map((g) => (typeof g.id === "string" && voided.has(g.id) ? { ...g, void: true } : g)), ...newGifts.filter((g) => !has(list("gifts"), g.id)).map(raw)];
    const removedKeys = new Set(st.removedPenalties.map(penKey));
    const freshPens = list("penalties").filter((p) => !(typeof p.teamId === "string" && typeof p.index === "number" && removedKeys.has(penKey(p as { teamId: string; index: number }))));
    const penalties = [...freshPens, ...newPens.filter((p) => !freshPens.some((x) => x.teamId === p.teamId && x.index === p.index)).map(raw)];
    const discounts = [...list("discounts"), ...newDiscs.filter((d) => !has(list("discounts"), d.id)).map(raw)];
    const coinEvents = [...list("coinEvents"), ...newEvents.filter((z) => !has(list("coinEvents"), z.id))];
    const teamStars = { ...readTeamStars(fresh), ...Object.fromEntries(Object.entries(switches).map(([id, sw]) => [id, sw.to])) };
    const starSwitch = { ...readStarSwitches(fresh), ...switches };
    const emomScores = { ...readEmomScores(fresh), ...Object.fromEntries(st.scoredTeams.map((id) => [id, st.emomScores[id] ?? 0])) };
    const emomPlayerScores = { ...readEmomPlayerScores(fresh), ...Object.fromEntries(st.scoredTeams.map((id) => [id, st.emomPlayerScores[id] ?? {}])) };
    const appliedOps = [...readAppliedOps(fresh), ...appliedOpIds].slice(-APPLIED_OPS_KEPT);
    const bossEntry = { ...readBossEntry(fresh), ...st.bossEntry };
    const streaks = { ...readStreaks(fresh), ...st.streaks };
    await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...fresh, gifts, penalties, discounts, coinEvents, teamStars, starSwitch, emomScores, emomPlayerScores, appliedOps, bossEntry, streaks })) });
  }
  return { ticksAdded: added.length, ticksRemoved: removed.length, losses: newLosses.length };
}

// Ancien delai de grace des lectures (greffier synchronise a la minute) : plus utilise depuis le 28/09 (soir).
export const SYNC_GRACE_MS = 75_000;
export type CatchOptions = { untilRaceMs?: number; graceMs?: number };
// Zombies constates jusqu'a maintenant (ou `untilRaceMs`), puis ecrits. Appele a la Fin du WOD (apres la derniere
// sauvegarde du greffier) et par la coche directe d'une seule equipe.
export async function applyZombieCatches(sessionId: string, onlyTeamId?: string, preloaded?: ZombieContext | null, opts: CatchOptions = {}): Promise<number> {
  const ctx = preloaded ?? (await loadZombieContext(sessionId, onlyTeamId));
  if (!ctx) return 0;
  const r = replayFromContext(ctx);
  if (!r) return 0;
  const until = Math.max(0, Math.min(r.nowRaceMs, opts.untilRaceMs ?? Number.POSITIVE_INFINITY) - (opts.graceMs ?? 0));
  const n = onlyTeamId ? catchUpTeam(r.cfg, r.st, onlyTeamId, until) : catchUpAll(r.cfg, r.st, until);
  if (n > 0) await persistReplay(sessionId, r, "zombie");
  return n;
}
