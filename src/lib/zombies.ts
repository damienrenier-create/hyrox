import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { readFrozenFromSettings } from "@/lib/level";
import {
  readCoinEvents, readCoinsCarry, readEmom, readFixedZombie, readLadders, readLevelOrder, readPenalties, readStarSwitches, readTeamFormats, readTeamStars, teamFormatOf,
} from "@/lib/wod-engines/templates/level-engine";
import { absoluteFromRace, catchUpAll, catchUpTeam, cloneState, type ReplayConfig, type ReplayState } from "@/lib/wod-engines/templates/level-replay";

export { absoluteFromRace };

// Mode zombies du WOD Level (regle de Sartay) : sur chaque niveau, un zombie part de la gauche et avance au
// rythme « duree estimee du niveau + 3 min » vers le coeur de l'equipe ; chaque fiche cochee eloigne le
// coeur (la ligne se retrecit vers la droite). S'il l'atteint, l'equipe perd une vie (douce les 5 premieres fois au
// WOD principal, sinon retour au niveau precedent), la moitie de ses pieces, et descend d'une categorie a la 3e.
// Depuis le 28/09 (soir), le calcul vit dans `level-replay.ts` (module pur) : l'ecran du greffier l'execute en
// direct sur ses coches locales, le serveur le rejoue a la sauvegarde (Pause, Fin du WOD, bouton serveur). Le
// serveur ne constate PLUS rien a la lecture pendant la course : il ne connait pas les coches restees sur le PC.

export function readZombies(settings: unknown): boolean {
  const v = (settings as { zombies?: unknown } | null)?.zombies;
  return v !== false; // active par defaut
}

// Donnees deja chargees par l'appelant (pouls, coche) : aucune relecture, seules les ecritures touchent la base.
export type ZombieContext = {
  session: { wodType: string; settings: unknown; raceEndedAt: unknown | null };
  rs: { id: string; startedAt: unknown | null; endedAt: unknown | null } | null;
  pauses: { from: number; to: number | null }[];
  teams: { id: string }[];
  ticks: { id: string; teamId: string; level: number; card: number; at: unknown }[];
  losses: { id?: string; teamId: string; level: number; at: unknown; soft?: boolean }[];
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

// Etat de rejeu d'une seance a partir de la base. null = pas de course en cours (pas lancee, ou terminee).
export type ServerReplay = { cfg: ReplayConfig; st: ReplayState; initial: ReplayState; startedAtMs: number; pauses: { from: number; to: number | null }[]; nowMs: number; nowRaceMs: number };
export function replayFromContext(ctx: ZombieContext, opts: { allowEnded?: boolean } = {}): ServerReplay | null {
  const { session, rs, pauses, teams } = ctx;
  if (session.wodType !== "LEVEL" || !rs?.startedAt) return null;
  if (!opts.allowEnded && (rs.endedAt || session.raceEndedAt)) return null;
  const settings = session.settings;
  const startedAtMs = toMs(rs.startedAt);
  const nowMs = Date.now();
  const endAbs = rs.endedAt ? toMs(rs.endedAt) : nowMs;
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
    absOf: (raceMs) => absoluteFromRace(startedAtMs, pauses, raceMs, nowMs),
    newId: () => randomUUID(),
  };
  const st: ReplayState = {
    ticks: ctx.ticks.map((t) => ({ id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 })),
    losses: ctx.losses.map((l, i) => ({ id: l.id ?? `db-${i}`, teamId: l.teamId, level: l.level, soft: !!l.soft, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 })),
    penalties: readPenalties(settings).map((p) => ({ ...p, atMs: typeof p.at === "number" ? elapsed(startedAtMs, pauses, p.at) ?? undefined : undefined })),
    coinEvents: readCoinEvents(settings),
    teamStars: readTeamStars(settings),
    switches: readStarSwitches(settings),
    voided: [],
    newSwitches: {},
  };
  const nowRaceMs = elapsed(startedAtMs, pauses, endAbs) ?? 0; // en pause : fige au debut de la pause
  return { cfg, st, initial: cloneState(st), startedAtMs, pauses, nowMs, nowRaceMs };
}

// Ecrit en une transaction ce que le rejeu a change : coches ajoutees et effacees, vies perdues, puis dans les
// reglages (relus juste avant) les pieces (zombie, fusees construites), fiches recues annulees et descentes.
export async function persistReplay(sessionId: string, r: ServerReplay, by: string): Promise<{ ticksAdded: number; ticksRemoved: number; losses: number }> {
  const { st, initial, startedAtMs, pauses, nowMs } = r;
  const before = new Set(initial.ticks.map((t) => t.id));
  const after = new Set(st.ticks.map((t) => t.id));
  const added = st.ticks.filter((t) => !before.has(t.id));
  const removed = initial.ticks.filter((t) => !after.has(t.id)).map((t) => t.id);
  const lossIds = new Set(initial.losses.map((l) => l.id));
  const newLosses = st.losses.filter((l) => !lossIds.has(l.id));
  const eventIds = new Set(initial.coinEvents.map((e) => e.id));
  const newEvents = st.coinEvents.filter((e) => !eventIds.has(e.id));
  const voided = new Set(st.voided);
  const switches = st.newSwitches;
  const abs = (raceMs: number) => Temporal.Instant.fromEpochMilliseconds(Math.round(absoluteFromRace(startedAtMs, pauses, raceMs, nowMs)));
  if (!added.length && !removed.length && !newLosses.length && !newEvents.length && !voided.size && !Object.keys(switches).length) return { ticksAdded: 0, ticksRemoved: 0, losses: 0 };
  const tickRow = (t: ReplayState["ticks"][number]) => ({ id: t.id, sessionId, teamId: t.teamId, level: t.level, card: t.card, by, at: abs(t.atMs) });
  const lossRow = (l: ReplayState["losses"][number]) => ({ id: l.id, sessionId, teamId: l.teamId, level: l.level, soft: !!l.soft, at: abs(l.atMs) });
  try {
    await db.transaction(async (tx) => {
      if (removed.length) await tx.orm.public.LevelTick.where((t) => t.id.in(removed)).deleteAndCount();
      if (added.length) await tx.orm.public.LevelTick.createAndCount(added.map(tickRow));
      if (newLosses.length) await tx.orm.public.LevelLoss.createAndCount(newLosses.map(lossRow));
    });
  } catch {
    // Une coche identique vient d'etre ecrite par un autre appareil (unicite seance/equipe/niveau/fiche) : on reprend
    // ligne par ligne en ignorant les doublons, comme avant le 28/09.
    for (const id of removed) { try { await db.orm.public.LevelTick.where({ id }).delete(); } catch { /* deja effacee */ } }
    for (const t of added) { try { await db.orm.public.LevelTick.create(tickRow(t)); } catch { /* deja cochee par un autre appareil */ } }
    for (const l of newLosses) { try { await db.orm.public.LevelLoss.create(lossRow(l)); } catch { /* deja constatee */ } }
  }
  if (newEvents.length || voided.size || Object.keys(switches).length) {
    // Reglages relus juste avant d'ecrire : un autre appareil a pu depenser des pieces ou lancer une fusee entre-temps.
    const fresh = ((await db.orm.public.Session.where({ id: sessionId }).first())?.settings as Record<string, unknown> | null) ?? {};
    const gifts = (Array.isArray(fresh.gifts) ? (fresh.gifts as Record<string, unknown>[]) : []).map((g) => (typeof g.id === "string" && voided.has(g.id) ? { ...g, void: true } : g));
    const existing = Array.isArray(fresh.coinEvents) ? (fresh.coinEvents as { id?: unknown }[]) : [];
    const coinEvents = [...existing, ...newEvents.filter((z) => !existing.some((e) => e.id === z.id))];
    const teamStars = { ...readTeamStars(fresh), ...Object.fromEntries(Object.entries(switches).map(([id, sw]) => [id, sw.to])) };
    const starSwitch = { ...readStarSwitches(fresh), ...switches };
    await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...fresh, gifts, coinEvents, teamStars, starSwitch })) });
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
