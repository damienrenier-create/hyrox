"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { freezeLadders, listExercises, readFrozenFromSettings } from "@/lib/level";
import { activeCards, cardsForTeam, coinsState, emomNextCard, emomWaveAt, isBoss, ladderFor, masteredExercises, orderedLevels, progressOf, rankTeams, readCoinEvents, readCoinsCarry, readEmom, readEmomScores, readFrozenLevels, readLadders, readLevelOrder, readPenalties, readTeamStars, rightmostCard, rocketTargets, sendOptions, starsLabel, teamStarsOf, DISCOUNT_STEPS, MAX_CARDS, PENALTY_INDEX0, PENALTY_STEPS, DEFAULT_STARS, ROCKET_PRICE, type CoinEvent, type FrozenLevel, type Loss, type Stars, type TeamPenalty, type Tick } from "@/lib/wod-engines/templates/level-engine";
import { randomUUID } from "node:crypto";
import { createChildSession } from "@/lib/level-child";
import type { ChildKind } from "@/lib/level-warmup";
import { phaseTotals, readChildren, readLevelCap } from "@/lib/level-context";
import { resetRace } from "@/lib/cleanup";
import { applyZombieCatches, loadZombieContext } from "@/lib/zombies";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { toMs } from "@/lib/scheduling";
import { hash32 } from "@/lib/mine-core";

// Actions du WOD Level. Profs, coachs ET greffier cochent (les BOSS se valident a plusieurs sur la meme
// seance) ; l'unicite en base rend le double-tap et deux appareils sur la meme fiche inoffensifs.
type Res = { error: string } | { ok: true };
const STAFF = ["MASTER_ADMIN", "ADMIN", "GREFFIER"];

// Etat « vivant » d'une seance Level : ce qui bouge pendant la course, sans les equipes, l'echelle ni le
// catalogue. Les ecrans le rechargent a la place de la page entiere (30 a 40 requetes) a chaque pouls.
export type LiveTick = { id: string; teamId: string; level: number; card: number; atMs: number; absMs: number; by: string };
export type LiveLoss = { id: string; teamId: string; level: number; atMs: number };
export type LiveCard = { id: string; teamId: string; atMs: number };
export type LevelLive = {
  ticks: LiveTick[];
  losses: LiveLoss[];
  yellowCards: LiveCard[];
  pauses: { from: number; to: number | null }[];
  startedAtMs: number | null;
  endedAtMs: number | null;
  raceEndedAtMs: number | null;
  // Signature de la structure (equipes, membres, echelle, temps impose) : si elle change, l'ecran recharge la page.
  structure: string;
  at: number; // heure serveur de la lecture : l'ecran n'applique jamais un etat plus ancien qu'un deja applique
  penalties: TeamPenalty[]; // penalites, fiches recues et allegements de toutes les equipes
  emomScores: Record<string, number>;
  coinEvents: CoinEvent[];
};
export type TeamLive = { teamId: string; ticks: LiveTick[]; losses: LiveLoss[]; yellowCards: LiveCard[]; penalties: TeamPenalty[]; score: number | null; at: number; coinEvents: CoinEvent[] };
type TeamRes = { error: string } | { ok: true; caught: boolean; team: TeamLive };

async function raceClock(sessionId: string) {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const pauses = rs ? (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })) : [];
  return { rs, startedAtMs, pauses };
}
const liveTick = (startedAtMs: number | null, pauses: { from: number; to: number | null }[]) => (t: { id: string; teamId: string; level: number; card: number; at: unknown; by: string }): LiveTick => {
  const abs = toMs(t.at);
  return { id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, abs) ?? 0, absMs: abs, by: t.by };
};

// Etat d'une seule equipe, apres une coche : 3 requetes, l'ecran remplace juste cette equipe.
async function teamLive(sessionId: string, teamId: string, startedAtMs: number | null, pauses: { from: number; to: number | null }[], rsId: string | null, settings: unknown): Promise<TeamLive> {
  const at = Date.now();
  const [ticks, losses, cards] = await Promise.all([
    db.orm.public.LevelTick.where({ sessionId, teamId }).all(),
    db.orm.public.LevelLoss.where({ sessionId, teamId }).all(),
    rsId ? db.orm.public.YellowCard.where({ raceStateId: rsId, teamId }).all() : Promise.resolve([]),
  ]);
  const liveTicks = ticks.map(liveTick(startedAtMs, pauses));
  const liveLosses = losses.map((l) => ({ id: l.id, teamId: l.teamId, level: l.level, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  const settled = await settleRockets(sessionId, settings, liveTicks, liveLosses, [teamId]);
  return {
    teamId,
    at,
    penalties: readPenalties(settled).filter((p) => p.teamId === teamId).map((p) => ({ ...p, atMs: typeof p.at === "number" ? elapsed(startedAtMs, pauses, p.at) ?? undefined : undefined })),
    score: readEmomScores(settled)[teamId] ?? null,
    coinEvents: readCoinEvents(settled).filter((e) => e.teamId === teamId),
    ticks: liveTicks,
    losses: liveLosses,
    yellowCards: cards.map((c) => ({ id: c.id, teamId: c.teamId, atMs: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 })),
  };
}

// Banque d'une equipe (pieces gagnees + report de l'echauffement - depenses), sur l'echelle de son parcours.
function bankOf(settings: unknown, teamId: string, ticks: Tick[], losses: Loss[]) {
  return coinsState(teamLadder(settings, teamId), teamId, ticks, losses, readPenalties(settings), readCoinEvents(settings), readCoinsCarry(settings));
}
// La fusee se construit et se paie toute seule des que la banque atteint son prix, une en stock au plus.
// Ecrit les reglages seulement s'il y a une construction ; renvoie les reglages a jour.
async function settleRockets(sessionId: string, settings: unknown, ticks: Tick[], losses: Loss[], teamIds: string[]): Promise<unknown> {
  if (readEmom(settings)) return settings; // finisher : pas de pieces
  const events = [...readCoinEvents(settings)];
  let built = 0;
  for (const teamId of teamIds) {
    const state = coinsState(teamLadder(settings, teamId), teamId, ticks, losses, readPenalties(settings), events, readCoinsCarry(settings));
    if (state.stock === 0 && state.bank >= ROCKET_PRICE) { events.push({ id: randomUUID(), teamId, kind: "rocket", coins: ROCKET_PRICE, at: Date.now() }); built++; }
  }
  if (!built) return settings;
  const prev = (settings as Record<string, unknown> | null) ?? {};
  const next = JSON.parse(JSON.stringify({ ...prev, coinEvents: events }));
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: next });
  return next;
}

// L'unique appel du pouls (8 requetes, en parallele) : rattrapages calcules sur ces memes donnees (ecriture
// seulement s'il y en a), etat vivant complet et signature de structure. Si rien n'a bouge, l'ecran ne rend rien.
export async function levelLiveAction(sessionId: string): Promise<LevelLive | { error: string }> {
  const user = await getSession();
  if (!user || !STAFF.includes(user.role)) return { error: "Accès refusé." };
  const at = Date.now();
  const ctx = await loadZombieContext(sessionId);
  if (!ctx) return { error: "Séance introuvable." };
  const caught = await applyZombieCatches(sessionId, undefined, ctx);
  const { rs, pauses } = ctx;
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const teamIds = ctx.teams.map((t) => t.id);
  const [cards, members, ticks, losses] = await Promise.all([
    rs ? db.orm.public.YellowCard.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    teamIds.length ? db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).aggregate((a) => ({ n: a.count() })).catch(() => ({ n: -1 })) : Promise.resolve({ n: 0 }),
    // Un rattrapage vient de modifier les coches : on relit ; sinon les donnees du contexte suffisent.
    caught > 0 ? db.orm.public.LevelTick.where({ sessionId }).all() : Promise.resolve(ctx.ticks as { id: string; teamId: string; level: number; card: number; at: unknown; by: string }[]),
    caught > 0 ? db.orm.public.LevelLoss.where({ sessionId }).all() : Promise.resolve(ctx.losses as { id: string; teamId: string; level: number; at: unknown }[]),
  ]);
  const s = ctx.session.settings as { levels?: unknown; ladders?: unknown; teamStars?: unknown; levelCapMin?: unknown } | null;
  const structure = `${teamIds.length}|${members.n}|${hash32(JSON.stringify([s?.levels ?? "", s?.ladders ?? "", s?.teamStars ?? ""]))}|${readLevelCap(ctx.session.settings) ?? 0}|${startedAtMs ?? 0}|${rs?.endedAt ? 1 : 0}`;
  const liveTicks = ticks.map(liveTick(startedAtMs, pauses));
  const liveLosses = losses.map((l) => ({ id: l.id, teamId: l.teamId, level: l.level, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  // Rattrapages appliques : les reglages (fiches recues annulees) ont pu changer, on relit avant les fusees.
  const settingsNow = caught > 0 ? (await db.orm.public.Session.where({ id: sessionId }).first())?.settings ?? ctx.session.settings : ctx.session.settings;
  const settled = rs?.startedAt && !rs.endedAt ? await settleRockets(sessionId, settingsNow, liveTicks, liveLosses, teamIds) : settingsNow;
  return {
    ticks: liveTicks,
    losses: liveLosses,
    yellowCards: cards.map((c) => ({ id: c.id, teamId: c.teamId, atMs: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 })),
    pauses,
    startedAtMs,
    endedAtMs: rs?.endedAt ? toMs(rs.endedAt) : null,
    raceEndedAtMs: ctx.session.raceEndedAt ? toMs(ctx.session.raceEndedAt) : null,
    structure,
    at,
    penalties: readPenalties(settled).map((p) => ({ ...p, atMs: typeof p.at === "number" ? elapsed(startedAtMs, pauses, p.at) ?? undefined : undefined })),
    emomScores: readEmomScores(settled),
    coinEvents: readCoinEvents(settled),
  };
}

// Finisher EMOM : score de la vague « max » (reps), saisi par le greffier, modifiable jusqu'a la fin du WOD.
export async function setEmomScoreAction(sessionId: string, teamId: string, reps: number): Promise<TeamRes> {
  const { session } = await requireLevelStaff(sessionId);
  if (!readEmom(session.settings)) return { error: "Cette séance n'est pas un EMOM." };
  if (!Number.isInteger(reps) || reps < 0 || reps > 5000) return { error: "Nombre de reps invalide." };
  const { rs, startedAtMs, pauses } = await raceClock(sessionId);
  if (!rs?.startedAt) return { error: "Lance d'abord la course." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const scores = { ...readEmomScores(session.settings), [teamId]: reps };
  const settings = JSON.parse(JSON.stringify({ ...prev, emomScores: scores }));
  await db.orm.public.Session.where({ id: sessionId }).update({ settings });
  return { ok: true, caught: false, team: await teamLive(sessionId, teamId, startedAtMs, pauses, rs.id, settings) };
}

async function requireLevelStaff(sessionId: string) {
  const user = await getSession();
  if (!user || !STAFF.includes(user.role)) throw new Error("Accès refusé.");
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");
  if (session.wodType !== "LEVEL") throw new Error("Cette séance n'est pas un WOD Level.");
  return { user, session };
}

async function count(fn: () => Promise<{ n: number }>): Promise<number> {
  try {
    return (await fn()).n;
  } catch {
    return -1;
  }
}

// Pouls de l'ecran greffier Level : coches, cartes, membres, equipes, etat de course, version de l'echelle.
export async function levelPulseAction(sessionId: string): Promise<string> {
  const user = await getSession();
  if (!user || !STAFF.includes(user.role)) return "";
  await applyZombieCatches(sessionId);
  const [rs, teams, session] = await Promise.all([
    db.orm.public.RaceState.where({ sessionId }).first(),
    db.orm.public.Team.where({ sessionId }).all(),
    db.orm.public.Session.where({ id: sessionId }).first(),
  ]);
  const teamIds = teams.map((t) => t.id);
  const [ticks, cards, members, pauses, losses] = await Promise.all([
    count(() => db.orm.public.LevelTick.where({ sessionId }).aggregate((a) => ({ n: a.count() }))),
    count(() => db.orm.public.LevelLoss.where({ sessionId }).aggregate((a) => ({ n: a.count() }))),
    rs ? count(() => db.orm.public.YellowCard.where({ raceStateId: rs.id }).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
    teamIds.length ? count(() => db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
    rs ? count(() => db.orm.public.RacePause.where({ raceStateId: rs.id }).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
  ]);
  const version = hash32(JSON.stringify((session?.settings as { levels?: unknown } | null)?.levels ?? ""));
  return `${ticks}|${cards}|${members}|${teams.length}|${pauses}|${rs?.startedAt ? 1 : 0}|${rs?.endedAt ? 1 : 0}|${version}|${readLevelCap(session?.settings) ?? 0}|${losses}`;
}

// Coup d'envoi : l'echelle est FIGEE dans la seance (copie des fiches avec libelle et ponderation), puis le
// chrono part. Une echelle vide ne se lance pas.
export async function startLevelAction(sessionId: string): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  let levels = readFrozenFromSettings(session.settings);
  if (!levels.length) {
    // Les trois parcours sont figes d'un coup ; un parcours vide dans l'atelier retombe sur le 2 etoiles.
    const all = await freezeLadders();
    levels = all[2];
    if (!levels.some((l) => activeCards(l).length > 0)) return { error: "L'échelle 2 étoiles est vide : compose les niveaux dans l'atelier Level avant de lancer." };
    const prev = (session.settings as Record<string, unknown> | null) ?? {};
    const ladders = { ...(all[1].length ? { "1": all[1] } : {}), ...(all[3].length ? { "3": all[3] } : {}) };
    await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, levels, ladders })) });
  }
  let rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) rs = await db.orm.public.RaceState.create({ sessionId, noStartExerciseIds: [] });
  if (rs.startedAt) return { ok: true };
  // Numeros d'equipe (3 etoiles d'abord) s'ils n'ont pas ete attribues, puis report des pieces de l'echauffement.
  await numberTeams(sessionId);
  const fresh = (await db.orm.public.Session.where({ id: sessionId }).first())!;
  const children = readChildren(fresh.settings);
  if (children.warmup) {
    const ph = await phaseTotals("warmup", children.warmup);
    if (ph) {
      const teams = await db.orm.public.Team.where({ sessionId }).all();
      const coinsCarry: Record<string, number> = {};
      for (const t of teams) { const c = ph.byOrder[t.order ?? 0]?.coins ?? 0; if (c > 0) coinsCarry[t.id] = c; }
      const prev = (fresh.settings as Record<string, unknown> | null) ?? {};
      await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, coinsCarry })) });
    }
  }
  await db.orm.public.RaceState.where({ id: rs.id }).update({ startedAt: Temporal.Now.instant() });
  return { ok: true };
}

// ===== Equipes par parcours (Sartay 26/09) : la categorie d'abord, les numeros a la fin =====
// Une equipe se cree dans un parcours avec un nom provisoire ; « Attribuer les numeros » (ou le coup d'envoi)
// numerote toutes les equipes : 3 etoiles d'abord, puis 2, puis 1, dans l'ordre de creation.
export async function createStarTeamAction(sessionId: string, stars: Stars): Promise<Res & { id?: string }> {
  const { session } = await requireLevelStaff(sessionId);
  if (stars !== 1 && stars !== 2 && stars !== 3) return { error: "Parcours inconnu." };
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs?.startedAt) return { error: "La course est lancée : plus de nouvelle équipe." };
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const teamStars = readTeamStars(session.settings);
  const sameStars = teams.filter((t) => teamStarsOf(teamStars, t.id) === stars).length;
  const letter = String.fromCharCode(65 + (sameStars % 26));
  const provisional = 1000 + teams.length + 1; // apres toutes les equipes numerotees, dans l'ordre de creation
  const team = await db.orm.public.Team.create({ sessionId, name: `${starsLabel(stars)} ${letter}`, order: provisional });
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, teamStars: { ...teamStars, [team.id]: stars }, numTeams: teams.length + 1 })) });
  return { ok: true, id: team.id };
}
async function numberTeams(sessionId: string): Promise<number> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return 0;
  const teamStars = readTeamStars(session.settings);
  const teams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => teamStarsOf(teamStars, b.id) - teamStarsOf(teamStars, a.id) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "fr"));
  let n = 0;
  let changed = 0;
  // Deux passes (numeros hors plage puis 1..N) : l'ordre n'est pas unique en base mais on garde les etapes propres.
  for (const t of teams) { n++; if (t.order !== n || t.name !== `Équipe ${n}`) { await db.orm.public.Team.where({ id: t.id }).update({ order: n, name: `Équipe ${n}` }); changed++; } }
  return changed;
}
export async function numberTeamsAction(sessionId: string): Promise<Res & { changed?: number }> {
  await requireLevelStaff(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs?.startedAt) return { error: "La course est lancée : les numéros sont figés." };
  return { ok: true, changed: await numberTeams(sessionId) };
}

// ===== Pieces : allegement d'une fiche, fusee =====
// Retirer des reps a la fiche la plus a droite du niveau en cours (la plus longue de l'echelle) : 1 piece par
// seconde de travail (reps x ponderation). Jamais sous 1 rep.
export async function discountAction(sessionId: string, teamId: string, reps: number): Promise<TeamRes> {
  const { session } = await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  if (!DISCOUNT_STEPS.includes(reps)) return { error: "Montant inconnu." };
  const ctx = await loadZombieContext(sessionId, teamId);
  const ticks: Tick[] = (ctx?.ticks ?? []).map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(gate.startedAtMs, gate.pauses, toMs(t.at)) ?? 0 }));
  const losses: Loss[] = (ctx?.losses ?? []).map((l) => ({ teamId: l.teamId, level: l.level, atMs: elapsed(gate.startedAtMs, gate.pauses, toMs(l.at)) ?? 0 }));
  const levels = teamLadder(session.settings, teamId);
  const extras = readPenalties(session.settings);
  const p = progressOf(levels, teamId, ticks, losses, extras);
  const level = p.currentLevel !== null ? levels.find((l) => l.number === p.currentLevel) : null;
  if (!level) return { error: "Échelle bouclée : rien à alléger." };
  const card = rightmostCard(level, teamId, extras, p.doneCards);
  if (!card) return { error: "Aucune fiche à alléger sur ce niveau." };
  const n = Math.min(reps, card.card.reps - 1);
  const cost = n * card.card.weight;
  const state = bankOf(session.settings, teamId, ticks, losses);
  if (cost > state.bank) return { error: `Il faut ${cost} pièces pour retirer ${n} ${card.card.label} ; l'équipe en a ${state.bank}.` };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const at = Date.now();
  const id = randomUUID();
  const discounts = [...(Array.isArray(prev.discounts) ? (prev.discounts as unknown[]) : []), { id, teamId, level: level.number, index: card.index, reps: -n, label: card.card.label, weight: card.card.weight, exerciseId: card.card.exerciseId, at }];
  const coinEvents = [...readCoinEvents(session.settings), { id, teamId, kind: "discount", coins: cost, at, label: card.card.label, reps: n, level: level.number, index: card.index }];
  const settings = JSON.parse(JSON.stringify({ ...prev, discounts, coinEvents }));
  await db.orm.public.Session.where({ id: sessionId }).update({ settings });
  return { ok: true, caught: false, team: await teamLive(sessionId, teamId, gate.startedAtMs, gate.pauses, gate.rsId, settings) };
}
// Envoyer des reps d'un exercice maitrise a une equipe : la fusee en stock part, le prix (reps x ponderation) est
// debite, la cible recoit une fiche a son prochain niveau (le niveau qui suit son niveau en cours).
export async function sendRocketAction(sessionId: string, teamId: string, exerciseId: string, reps: number, toTeamId: string): Promise<TeamRes> {
  const { session } = await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  if (toTeamId === teamId) return { error: "Pas à soi-même." };
  const ctx = await loadZombieContext(sessionId);
  if (!ctx) return { error: "Séance introuvable." };
  const ticks: Tick[] = ctx.ticks.map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(gate.startedAtMs, gate.pauses, toMs(t.at)) ?? 0 }));
  const losses: Loss[] = ctx.losses.map((l) => ({ teamId: l.teamId, level: l.level, atMs: elapsed(gate.startedAtMs, gate.pauses, toMs(l.at)) ?? 0 }));
  const extras = readPenalties(session.settings);
  const state = bankOf(session.settings, teamId, ticks, losses);
  if (state.stock < 1) return { error: "Pas de fusée en stock : il faut d'abord la construire (100 pièces)." };
  const mastered = masteredExercises(teamLadder(session.settings, teamId), teamId, ticks, extras).find((m) => m.exerciseId === exerciseId);
  if (!mastered) return { error: "Cet exercice n'est pas encore maîtrisé (3 fiches cochées)." };
  if (!sendOptions(mastered.weight).some((o) => o.reps === reps)) return { error: "Quantité inconnue." };
  const price = reps * mastered.weight;
  if (price > state.bank) return { error: `Il faut ${price} pièces ; l'équipe en a ${state.bank}.` };
  // Cibles : rang dans le parcours, taille du groupe, equipes arrivees au bout.
  const teamStars = readTeamStars(session.settings);
  const progress = ctx.teams.map((t) => progressOf(teamLadder(session.settings, t.id), t.id, ticks, losses, extras));
  const ranked = rankTeams(progress, (id) => bankOf(session.settings, id, ticks, losses).earned + (readCoinsCarry(session.settings)[id] ?? 0));
  const rows = ctx.teams.map((t) => {
    const stars = teamStarsOf(teamStars, t.id);
    const group = ranked.filter((p) => teamStarsOf(teamStars, p.teamId) === stars);
    return { teamId: t.id, stars, rankInStars: group.findIndex((p) => p.teamId === t.id) + 1, groupSize: group.length, finished: progress.find((p) => p.teamId === t.id)!.currentLevel === null };
  });
  if (!rocketTargets(teamId, rows).some((t) => t.teamId === toTeamId)) return { error: "Cette équipe n'est pas une cible autorisée (même parcours, jamais la dernière, jamais une équipe arrivée au bout)." };
  const targetLevels = teamLadder(session.settings, toTeamId);
  const tp = progress.find((p) => p.teamId === toTeamId)!;
  const idx = targetLevels.findIndex((l) => l.number === tp.currentLevel);
  const next = idx >= 0 ? targetLevels[idx + 1] : undefined;
  if (!next) return { error: "Cette équipe joue son dernier niveau : rien ne peut lui être envoyé." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const at = Date.now();
  const id = randomUUID();
  const existing = Array.isArray(prev.gifts) ? (prev.gifts as unknown[]) : [];
  const gifts = [...existing, { id, teamId: toTeamId, fromTeamId: teamId, level: next.number, index: 200 + existing.length, reps, label: mastered.label, weight: mastered.weight, exerciseId, at }];
  const coinEvents = [...readCoinEvents(session.settings), { id, teamId, kind: "send", coins: price, at, toTeamId, label: mastered.label, reps, giftId: id, level: next.number }];
  const settings = JSON.parse(JSON.stringify({ ...prev, gifts, coinEvents }));
  await db.orm.public.Session.where({ id: sessionId }).update({ settings });
  return { ok: true, caught: false, team: await teamLive(sessionId, teamId, gate.startedAtMs, gate.pauses, gate.rsId, settings) };
}

export async function levelPauseAction(sessionId: string): Promise<Res> {
  await requireLevelStaff(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt || rs.endedAt) return { error: "Course non démarrée ou déjà terminée." };
  const open = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).find((p) => p.to === null);
  if (open) await db.orm.public.RacePause.where({ id: open.id }).update({ to: Temporal.Now.instant() });
  else await db.orm.public.RacePause.create({ raceStateId: rs.id, from: Temporal.Now.instant() });
  return { ok: true };
}

// Fin du WOD : chrono arrete, classement fige (les coches suivantes sont refusees). La seance reste
// consultable ; elle se ferme d'elle-meme a la fin de son creneau.
export async function endLevelAction(sessionId: string): Promise<Res> {
  await requireLevelStaff(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "La course n'a pas démarré." };
  if (rs.endedAt) return { ok: true };
  const open = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).find((p) => p.to === null);
  await db.transaction(async (tx) => {
    const now = Temporal.Now.instant();
    if (open) await tx.orm.public.RacePause.where({ id: open.id }).update({ to: now });
    await tx.orm.public.RaceState.where({ id: rs.id }).update({ endedAt: now });
    await tx.orm.public.Session.where({ id: sessionId }).update({ raceEndedAt: now });
  });
  return { ok: true };
}

async function raceOpen(sessionId: string): Promise<{ error: string } | { rsId: string; startedAtMs: number; pauses: { from: number; to: number | null }[] }> {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "Lance d'abord la course." };
  if (rs.endedAt) return { error: "La course est terminée." };
  const pauses = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: new Date(String(p.from)).getTime(), to: p.to ? new Date(String(p.to)).getTime() : null }));
  if (pauses.some((p) => p.to === null)) return { error: "Chrono en pause : reprends la course avant de cocher." };
  // Temps impose : une fois le chrono au bout, plus aucune coche ni carte (le greffier declare la fin du WOD).
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  const cap = readLevelCap(session?.settings);
  if (cap !== null && (elapsed(new Date(String(rs.startedAt)).getTime(), pauses, Date.now()) ?? 0) >= cap * 60_000) return { error: "Temps écoulé : déclare la fin du WOD." };
  return { rsId: rs.id, startedAtMs: new Date(String(rs.startedAt)).getTime(), pauses };
}

// Remise a zero du WOD (apres confirmation cote client) : chrono, fiches cochees, cartes jaunes, demineur et
// evaluations sont effaces ; equipes, arbitres et reglages restent ; l'echelle est re-figee au prochain depart.
export async function resetLevelAction(sessionId: string): Promise<Res> {
  await requireLevelStaff(sessionId);
  const r = await resetRace(sessionId, { clearReferees: true });
  return "error" in r ? r : { ok: true };
}

// Echauffement / finisher : seance enfant (memes equipes, series figees, chrono lance) ; l'ecran y navigue.
export async function startChildAction(sessionId: string, kind: ChildKind): Promise<{ error: string } | { ok: true; id: string }> {
  const { user } = await requireLevelStaff(sessionId);
  return createChildSession(sessionId, kind, user.name);
}

// Mode zombies (vies, retour au niveau precedent) pour cette seance.
export async function setZombiesAction(sessionId: string, on: boolean): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, zombies: on })) });
  return { ok: true };
}

// Activite des dispenses (demineur) pour cette seance, modifiable a tout moment.
export async function setLevelRefereeModeAction(sessionId: string, on: boolean): Promise<Res> {
  await requireLevelStaff(sessionId);
  await db.orm.public.Session.where({ id: sessionId }).update({ refereeMode: on });
  return { ok: true };
}

// Temps impose (minutes de chrono), modifiable avant ou pendant le WOD ; null = temps libre.
export async function setLevelCapAction(sessionId: string, minutes: number | null): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 180)) return { error: "Entre 1 et 180 minutes, ou vide pour un temps libre." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const settings = { ...prev };
  if (minutes === null) delete settings.levelCapMin;
  else settings.levelCapMin = Math.round(minutes);
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify(settings)) });
  return { ok: true };
}

// Cocher une fiche : uniquement une fiche en jeu du niveau EN COURS de l'equipe (pas d'avance sur les niveaux
// suivants). Deja cochee = rien a faire (deux profs sur le meme BOSS, double-tap).
// Coche : ne verifie le zombie que pour CETTE equipe, et renvoie l'etat de cette equipe (pas de rechargement
// de page : l'ecran remplace juste la ligne). Une equipe rattrapee entre-temps est signalee (caught).
export async function tickCardAction(sessionId: string, teamId: string, level: number, card: number): Promise<TeamRes> {
  const { user, session } = await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  // Contexte de l'equipe charge une fois : rattrapage en memoire, puis verification du niveau en cours.
  const ctx = await loadZombieContext(sessionId, teamId);
  const caught = (await applyZombieCatches(sessionId, teamId, ctx)) > 0;
  const levels = teamLadder(session.settings, teamId);
  const l = levels.find((x) => x.number === level);
  const penalties = readPenalties(session.settings);
  if (!l || !cardsForTeam(l, teamId, penalties).some((x) => x.index === card)) return { error: "Cette fiche n'est plus en jeu." };
  const ticks = caught ? await db.orm.public.LevelTick.where({ sessionId, teamId }).all() : (ctx?.ticks ?? []);
  const done = new Set(ticks.map((t) => `${t.level}_${t.card}`));
  let refused: string | null = null;
  const emom = readEmom(session.settings);
  if (emom) {
    // EMOM : seule la vague EN COURS (chrono) accepte des coches, et seulement sa prochaine fiche.
    const wave = emomWaveAt(emom.waveMinutes, elapsed(gate.startedAtMs, gate.pauses, Date.now()) ?? 0);
    if (!wave) refused = "L'EMOM est terminé.";
    else if (wave.wave !== level) refused = `On est dans la vague ${wave.wave}, pas la ${level}.`;
    else {
      const next = emomNextCard(l, teamId, ticks.map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: 0 })));
      if (next && next.index !== card) refused = "Les fiches se cochent dans l'ordre.";
    }
  } else {
    // Le niveau doit etre le niveau en cours : toutes les fiches en jeu des niveaux precedents sont cochees.
    for (const prev of levels) {
      if (prev.number === level) break;
      if (cardsForTeam(prev, teamId, penalties).some(({ index }) => !done.has(`${prev.number}_${index}`))) { refused = `Le niveau ${prev.number} n'est pas terminé.`; break; }
    }
  }
  if (refused && !caught) return { error: refused };
  if (!refused && !done.has(`${level}_${card}`)) {
    try {
      await db.orm.public.LevelTick.create({ sessionId, teamId, level, card, by: user.name });
    } catch {
      /* unicite : deja cochee par un autre appareil */
    }
  }
  return { ok: true, caught, team: await teamLive(sessionId, teamId, gate.startedAtMs, gate.pauses, gate.rsId, session.settings) };
}

export async function untickCardAction(sessionId: string, teamId: string, level: number, card: number): Promise<TeamRes> {
  const { session } = await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  const row = await db.orm.public.LevelTick.where({ sessionId, teamId, level, card }).first();
  if (row) await db.orm.public.LevelTick.where({ id: row.id }).delete();
  return { ok: true, caught: false, team: await teamLive(sessionId, teamId, gate.startedAtMs, gate.pauses, gate.rsId, session.settings) };
}

// Carte jaune : compte pour le classement ET ajoute une fiche de penalite (cordes) sur le niveau en cours de
// l'equipe, de plus en plus lourde a chaque carte (PENALTY_STEPS). Retirer une carte retire la derniere penalite.
export async function levelYellowCardAction(sessionId: string, teamId: string, delta: 1 | -1): Promise<TeamRes> {
  const { session } = await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  // settings.penalties seulement : readPenalties y ajoute les fiches recues et les allegements, qui vivent ailleurs.
  let penalties = readPenalties(session.settings).filter((p) => p.kind === "penalty");
  const mine = penalties.filter((p) => p.teamId === teamId);
  if (delta > 0) {
    await db.orm.public.YellowCard.create({ raceStateId: gate.rsId, teamId });
    const [ticks, losses] = await Promise.all([db.orm.public.LevelTick.where({ sessionId, teamId }).all(), db.orm.public.LevelLoss.where({ sessionId, teamId }).all()]);
    const levels = teamLadder(session.settings, teamId);
    const p = progressOf(levels, teamId, ticks.map((t): Tick => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(gate.startedAtMs, gate.pauses, toMs(t.at)) ?? 0 })), losses.map((l): Loss => ({ teamId: l.teamId, level: l.level, atMs: elapsed(gate.startedAtMs, gate.pauses, toMs(l.at)) ?? 0 })), readPenalties(session.settings));
    if (p.currentLevel !== null) {
      const k = mine.length;
      penalties = [...penalties, { teamId, level: p.currentLevel, index: PENALTY_INDEX0 + k, reps: PENALTY_STEPS[Math.min(k, PENALTY_STEPS.length - 1)], label: "CORDE", weight: 1, at: Date.now() }];
    }
  } else {
    const last = await db.orm.public.YellowCard.where({ raceStateId: gate.rsId, teamId }).orderBy((c) => c.at.desc()).first();
    if (last) await db.orm.public.YellowCard.where({ id: last.id }).delete();
    const lastPen = [...mine].sort((a, b) => b.index - a.index)[0];
    if (lastPen) {
      penalties = penalties.filter((p) => p !== lastPen);
      const tick = await db.orm.public.LevelTick.where({ sessionId, teamId, level: lastPen.level, card: lastPen.index }).first();
      if (tick) await db.orm.public.LevelTick.where({ id: tick.id }).delete();
    }
  }
  const settings = JSON.parse(JSON.stringify({ ...prev, penalties }));
  await db.orm.public.Session.where({ id: sessionId }).update({ settings });
  return { ok: true, caught: false, team: await teamLive(sessionId, teamId, gate.startedAtMs, gate.pauses, gate.rsId, settings) };
}

// Modifier l'echelle FIGEE de la seance pendant qu'elle tourne (greffier, profs) : reps ou exercice d'une
// fiche, fiche ajoutee, fiche retiree (`off`, jamais supprimee : les coches referencent l'index), niveau
// ajoute en fin d'echelle. L'echelle commune de l'atelier n'est pas touchee.
export async function updateSessionLevelsAction(sessionId: string, input: FrozenLevel[], stars: Stars = DEFAULT_STARS): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  if (!readFrozenFromSettings(session.settings).length) return { error: "L'échelle n'est pas encore figée : modifie-la dans l'atelier Level." };
  // Parcours 1 ou 3 etoiles jamais fige (atelier vide au depart) : il se cree ici, a partir de la copie proposee.
  const current = stars === DEFAULT_STARS ? readFrozenFromSettings(session.settings) : readLadders(session.settings)[stars] ?? [];
  const catalog = new Map((await listExercises()).map((e) => [e.id, e]));
  const parsed = readFrozenLevels(input);
  if (!parsed.length) return { error: "Échelle vide." };
  const numbers = parsed.map((l) => l.number);
  if (new Set(numbers).size !== numbers.length || numbers.some((n, i) => n !== i + 1)) return { error: "Les niveaux doivent être numérotés 1, 2, 3… sans trou." };
  if (parsed.length < current.length) return { error: "On ne supprime pas un niveau en cours de WOD : retire ses fiches à la place." };
  const levels: FrozenLevel[] = parsed.map((l) => ({
    number: l.number,
    name: l.name ? l.name.slice(0, 40) : null,
    boss: isBoss(l.number),
    cards: l.cards.slice(0, MAX_CARDS).map((c) => {
      const e = catalog.get(c.exerciseId);
      const reps = Math.max(1, Math.min(10000, Math.round(c.reps)));
      return { exerciseId: c.exerciseId, reps, label: e?.label ?? c.label, weight: e?.weight ?? c.weight, ...(c.off ? { off: true } : {}) };
    }),
  }));
  for (const [i, prev] of current.entries()) {
    const next = levels[i];
    if (next.cards.length < prev.cards.length) return { error: `Niveau ${prev.number} : une fiche a disparu. Retire-la plutôt que de la supprimer.` };
  }
  for (const l of levels) {
    if (l.boss && activeCards(l).length > 1) return { error: `Le niveau ${l.number} est un BOSS : une seule fiche en jeu.` };
  }
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  if (stars === DEFAULT_STARS) await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, levels } });
  else {
    const prevLadders = (prev.ladders && typeof prev.ladders === "object" ? prev.ladders : {}) as Record<string, unknown>;
    await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, ladders: { ...prevLadders, [String(stars)]: levels } })) });
  }
  return { ok: true };
}

// Echelle d'une equipe dans une seance : son parcours (etoiles) dans son ordre.
function teamLadder(settings: unknown, teamId: string): FrozenLevel[] {
  return orderedLevels(ladderFor(readFrozenFromSettings(settings), readLadders(settings), teamStarsOf(readTeamStars(settings), teamId)), readLevelOrder(settings)?.[teamId]);
}

// Parcours (1, 2 ou 3 etoiles) d'une equipe. Modifiable tant que l'equipe n'a rien coche : les coches
// referencent des numeros de niveau et des index de fiche propres a une echelle.
export async function setTeamStarsAction(sessionId: string, teamId: string, stars: Stars): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  if (stars !== 1 && stars !== 2 && stars !== 3) return { error: "Parcours inconnu." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const ticked = await db.orm.public.LevelTick.where({ sessionId, teamId }).first();
  if (ticked) return { error: "Cette équipe a déjà coché des fiches : son parcours est verrouillé (annule ses coches d'abord)." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const teamStars = { ...readTeamStars(session.settings), [teamId]: stars };
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, teamStars })) });
  return { ok: true };
}
