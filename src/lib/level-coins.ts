import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { freezeLadders, readFrozenFromSettings } from "@/lib/level";
import { phaseTotals, readChild, readChildren } from "@/lib/level-context";
import { loadZombieContext } from "@/lib/zombies";
import {
  activeCards, coinsState, ladderFor, masteredExercises, orderedLevels, progressOf, rankTeams, readCoinEvents, readCoinsCarry, readEmom, readLadders,
  autoRocketPool, pickRocketTarget, parcoursKey, readStarSwitches, readLevelOrder, readPenalties, readTeamFormats, readTeamStars, rightmostCard, rocketPayload, rocketTargets, sendOptions, starsLabel, teamFormatOf, teamStarsOf,
  DISCOUNT_STEPS, LADDER_KEYS, ROCKET_PRICE, type CoinEvent, type Format, type FrozenLevel, type Loss, type Stars, type Tick,
} from "@/lib/wod-engines/templates/level-engine";

// Pieces, fusees et equipes par parcours du WOD Level, cote serveur et SANS authentification (les actions du
// greffier verifient l'acces puis appellent ces fonctions ; les scripts de test aussi). Tout vit dans
// Session.settings : coinEvents (depenses), discounts (allegements), gifts (fiches recues), coinsCarry
// (report de l'echauffement), teamStars (parcours). Chaque ecriture RELIT les reglages juste avant pour ne
// pas ecraser ce qu'un autre appareil vient d'ecrire (coches en parallele, rattrapage qui annule une fiche).

type Res = { error: string } | { ok: true };
type Settings = Record<string, unknown>;
const settingsOf = (s: unknown): Settings => ((s as Settings | null) ?? {});
async function freshSettings(sessionId: string): Promise<Settings> {
  return settingsOf((await db.orm.public.Session.where({ id: sessionId }).first())?.settings);
}
async function writeSettings(sessionId: string, patch: (fresh: Settings) => Settings): Promise<Settings> {
  const next = JSON.parse(JSON.stringify(patch(await freshSettings(sessionId))));
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: next });
  return next;
}

// Echelle d'une equipe dans une seance : son parcours (etoiles) dans son ordre.
export function teamLadder(settings: unknown, teamId: string): FrozenLevel[] {
  return orderedLevels(ladderFor(readFrozenFromSettings(settings), readLadders(settings), teamStarsOf(readTeamStars(settings), teamId), teamFormatOf(readTeamFormats(settings), teamId), readStarSwitches(settings)[teamId]), readLevelOrder(settings)?.[teamId]);
}
// Banque d'une equipe (pieces gagnees + report de l'echauffement - depenses), sur l'echelle de son parcours.
export function bankOf(settings: unknown, teamId: string, ticks: Tick[], losses: Loss[]) {
  return coinsState(teamLadder(settings, teamId), teamId, ticks, losses, readPenalties(settings), readCoinEvents(settings), readCoinsCarry(settings));
}
// Pieces et fusees ne se depensent que sur le WOD principal (pas a l'echauffement, pas au finisher).
export const spendingAllowed = (settings: unknown) => !readEmom(settings) && !readChild(settings);

// La fusee se construit et se paie toute seule des que la banque atteint son prix, une en stock au plus.
// Ecrit les reglages seulement s'il y a une construction ; renvoie les reglages a jour.
// Construction (a 100 pieces) et, quand toutes les equipes sont connues (`launch`), decollage automatique
// (Sartay 28/09) : cible tiree au sort dans le top 4 du parcours, charge choisie d'apres les pieces. Le tirage
// est fait une fois, cote serveur, puis enregistre (fiche recue + evenement « send ») : tous les ecrans voient
// la meme fusee.
function planRockets(settings: Settings, teamIds: string[], ticks: Tick[], losses: Loss[], launch: boolean, launchOnly: string | null = null): { next: Settings; changed: boolean; blocked: string | null } {
  let blocked: string | null = null;
  const events = [...readCoinEvents(settings)];
  const gifts = Array.isArray(settings.gifts) ? [...(settings.gifts as Record<string, unknown>[])] : [];
  const carry = readCoinsCarry(settings);
  const extrasNow = () => readPenalties({ ...settings, gifts });
  const stateOf = (id: string) => coinsState(teamLadder(settings, id), id, ticks, losses, extrasNow(), events, carry);
  let changed = false;
  for (const id of teamIds) {
    const s = stateOf(id);
    if (s.stock === 0 && s.bank >= ROCKET_PRICE) { events.push({ id: randomUUID(), teamId: id, kind: "rocket", coins: ROCKET_PRICE, at: Date.now() }); changed = true; }
  }
  if (launch) {
    const teamStars = readTeamStars(settings);
    const teamFormats = readTeamFormats(settings);
    const groupOf = (id: string) => parcoursKey(teamStarsOf(teamStars, id), teamFormatOf(teamFormats, id));
    for (const id of teamIds) {
      const mine = stateOf(id);
      if (mine.stock < 1) continue;
      const extras = extrasNow();
      const progress = teamIds.map((x) => progressOf(teamLadder(settings, x), x, ticks, losses, extras));
      const ranked = rankTeams(progress, (x) => stateOf(x).score);
      const rows = teamIds.map((x) => {
        const g = groupOf(x);
        const p = progress.find((pp) => pp.teamId === x)!;
        const lv = teamLadder(settings, x);
        const at = lv.findIndex((l) => l.number === p.currentLevel);
        const next = at >= 0 ? lv[at + 1] ?? null : null;
        return { teamId: x, group: g, rankInGroup: ranked.filter((pp) => groupOf(pp.teamId) === g).findIndex((pp) => pp.teamId === x) + 1, finished: p.currentLevel === null, hasNext: !!next, next };
      });
      const sendTargets = events.filter((e) => e.kind === "send").sort((a, b) => a.at - b.at).map((e) => e.toTeamId ?? "");
      if (launchOnly && launchOnly !== id) continue;
      const groupSize = (g: string) => rows.filter((r) => r.group === g).length;
      const pick = pickRocketTarget(id, rows.map((r) => ({ ...r, groupSize: groupSize(r.group) })), sendTargets);
      void autoRocketPool;
      const payload = rocketPayload(masteredExercises(teamLadder(settings, id), id, ticks, extras), mine.score);
      if (!pick || !payload) { if (launchOnly) blocked = !payload ? "Aucun exercice maîtrisé pour l'instant (3 fiches du même exercice)." : "Aucune cible possible pour l'instant."; continue; }
      const target = pick.target;
      const giftId = randomUUID();
      const at = Date.now();
      gifts.push({ id: giftId, teamId: target.teamId, fromTeamId: id, level: target.next!.number, index: 200 + gifts.length, reps: payload.reps, label: payload.label, weight: payload.weight, exerciseId: payload.exerciseId, at });
      events.push({ id: giftId, teamId: id, kind: "send", coins: 0, at, toTeamId: target.teamId, label: payload.label, reps: payload.reps, giftId, level: target.next!.number });
      changed = true;
    }
  }
  return { next: { ...settings, coinEvents: events, gifts }, changed, blocked };
}
// Lancer la fusee d'une equipe (clic du greffier, Sartay 28/09) : cible et charge choisies par la regle, jamais
// par le greffier. Toutes les equipes sont chargees (le classement decide de la cible).
export async function launchRocket(sessionId: string, teamId: string): Promise<Res & { settings?: unknown }> {
  const settings = await freshSettings(sessionId);
  if (!spendingAllowed(settings)) return { error: "Les fusées se lancent sur le WOD principal seulement." };
  const data = await raceData(sessionId);
  if (!data) return { error: "Lance d'abord la course." };
  const ids = data.ctx.teams.map((t) => t.id);
  const dry = planRockets(settings, ids, data.ticks, data.losses, true, teamId);
  if (!dry.changed || !readCoinEvents(dry.next).some((e) => e.kind === "send" && e.teamId === teamId && !readCoinEvents(settings).some((x) => x.id === e.id))) {
    return { error: bankOf(settings, teamId, data.ticks, data.losses).stock < 1 ? "Pas de fusée construite (100 pièces)." : dry.blocked ?? "La fusée ne peut pas partir pour l'instant." };
  }
  const next = await writeSettings(sessionId, (fresh) => planRockets(fresh, ids, data.ticks, data.losses, true, teamId).next);
  return { ok: true, settings: next };
}
export async function settleRockets(sessionId: string, settings: unknown, ticks: Tick[], losses: Loss[], teamIds: string[], launch = false): Promise<unknown> {
  if (!spendingAllowed(settings)) return settings;
  // Rien a faire sur l'etat connu : pas d'ecriture (le greffier interroge souvent). Depuis le 28/09 (soir), la
  // fusee ne decolle plus toute seule : settle ne fait que la construire.
  void launch;
  if (!planRockets(settingsOf(settings), teamIds, ticks, losses, false).changed) return settings;
  // Relecture avant d'ecrire : un autre appareil a pu construire ou lancer entre-temps.
  return writeSettings(sessionId, (fresh) => planRockets(fresh, teamIds, ticks, losses, false).next);
}

// Chrono de course et coches/vies d'une seance (ms de course).
async function raceData(sessionId: string, teamId?: string) {
  const ctx = await loadZombieContext(sessionId, teamId);
  if (!ctx?.rs?.startedAt) return null;
  const startedAtMs = toMs(ctx.rs.startedAt);
  const ticks: Tick[] = ctx.ticks.map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, ctx.pauses, toMs(t.at)) ?? 0 }));
  const losses: Loss[] = ctx.losses.map((l) => ({ teamId: l.teamId, level: l.level, soft: !!(l as { soft?: unknown }).soft, atMs: elapsed(startedAtMs, ctx.pauses, toMs(l.at)) ?? 0 }));
  return { ctx, ticks, losses };
}

// Retirer des reps a la fiche la plus a droite du niveau en cours (la plus longue de l'echelle) : 1 piece par
// seconde de travail (reps x ponderation). Jamais sous 1 rep.
export async function applyDiscount(sessionId: string, teamId: string, reps: number): Promise<Res & { settings?: unknown }> {
  const settings = await freshSettings(sessionId);
  if (!spendingAllowed(settings)) return { error: "Les pièces se dépensent sur le WOD principal seulement." };
  if (!DISCOUNT_STEPS.includes(reps)) return { error: "Montant inconnu." };
  const data = await raceData(sessionId, teamId);
  if (!data) return { error: "Lance d'abord la course." };
  const levels = teamLadder(settings, teamId);
  const extras = readPenalties(settings);
  const p = progressOf(levels, teamId, data.ticks, data.losses, extras);
  const level = p.currentLevel !== null ? levels.find((l) => l.number === p.currentLevel) : null;
  if (!level) return { error: "Échelle bouclée : rien à alléger." };
  const card = rightmostCard(level, teamId, extras, p.doneCards);
  if (!card) return { error: "Aucune fiche à alléger sur ce niveau." };
  const n = Math.min(reps, card.card.reps - 1);
  const cost = n * card.card.weight;
  const state = bankOf(settings, teamId, data.ticks, data.losses);
  if (cost > state.bank) return { error: `Il faut ${cost} pièces pour retirer ${n} ${card.card.label} ; l'équipe en a ${state.bank}.` };
  const at = Date.now();
  const id = randomUUID();
  const next = await writeSettings(sessionId, (fresh) => ({
    ...fresh,
    discounts: [...(Array.isArray(fresh.discounts) ? (fresh.discounts as unknown[]) : []), { id, teamId, level: level.number, index: card.index, reps: -n, label: card.card.label, weight: card.card.weight, exerciseId: card.card.exerciseId, at }],
    coinEvents: [...readCoinEvents(fresh), { id, teamId, kind: "discount", coins: cost, at, label: card.card.label, reps: n, level: level.number, index: card.index } satisfies CoinEvent],
  }));
  return { ok: true, settings: next };
}

// Envoyer des reps d'un exercice maitrise a une equipe : la fusee en stock part, le prix (reps x ponderation) est
// debite, la cible recoit une fiche a son prochain niveau (le niveau qui suit son niveau en cours).
export async function sendRocket(sessionId: string, teamId: string, exerciseId: string, reps: number, toTeamId: string): Promise<Res & { settings?: unknown; giftId?: string; label?: string }> {
  const settings = await freshSettings(sessionId);
  if (!spendingAllowed(settings)) return { error: "Les fusées se lancent sur le WOD principal seulement." };
  if (toTeamId === teamId) return { error: "Pas à soi-même." };
  const data = await raceData(sessionId);
  if (!data) return { error: "Lance d'abord la course." };
  const { ctx, ticks, losses } = data;
  const extras = readPenalties(settings);
  const state = bankOf(settings, teamId, ticks, losses);
  if (state.stock < 1) return { error: `Pas de fusée en stock : il faut d'abord la construire (${ROCKET_PRICE} pièces).` };
  const mastered = masteredExercises(teamLadder(settings, teamId), teamId, ticks, extras).find((m) => m.exerciseId === exerciseId);
  if (!mastered) return { error: "Cet exercice n'est pas encore maîtrisé (3 fiches cochées)." };
  if (!sendOptions(mastered.weight).some((o) => o.reps === reps)) return { error: "Quantité inconnue." };
  const price = reps * mastered.weight;
  if (price > state.bank) return { error: `Il faut ${price} pièces ; l'équipe en a ${state.bank}.` };
  // Cibles : rang dans le parcours (pieces comprises), taille du groupe, equipes arrivees au bout.
  const teamStars = readTeamStars(settings);
  const teamFormats = readTeamFormats(settings);
  const groupOf = (id: string) => parcoursKey(teamStarsOf(teamStars, id), teamFormatOf(teamFormats, id));
  const carry = readCoinsCarry(settings);
  const progress = ctx.teams.map((t) => progressOf(teamLadder(settings, t.id), t.id, ticks, losses, extras));
  const ranked = rankTeams(progress, (id) => bankOf(settings, id, ticks, losses).score);
  const rows = ctx.teams.map((t) => {
    const group = groupOf(t.id);
    const grp = ranked.filter((p) => groupOf(p.teamId) === group);
    return { teamId: t.id, group, rankInGroup: grp.findIndex((p) => p.teamId === t.id) + 1, groupSize: grp.length, finished: progress.find((p) => p.teamId === t.id)!.currentLevel === null };
  });
  if (!rocketTargets(teamId, rows).some((t) => t.teamId === toTeamId)) return { error: "Cette équipe n'est pas une cible autorisée (même parcours, jamais la dernière, jamais une équipe arrivée au bout)." };
  const targetLevels = teamLadder(settings, toTeamId);
  const tp = progress.find((p) => p.teamId === toTeamId)!;
  const idx = targetLevels.findIndex((l) => l.number === tp.currentLevel);
  const nextLevel = idx >= 0 ? targetLevels[idx + 1] : undefined;
  if (!nextLevel) return { error: "Cette équipe joue son dernier niveau : rien ne peut lui être envoyé." };
  const at = Date.now();
  const id = randomUUID();
  const next = await writeSettings(sessionId, (fresh) => {
    const existing = Array.isArray(fresh.gifts) ? (fresh.gifts as unknown[]) : [];
    return {
      ...fresh,
      gifts: [...existing, { id, teamId: toTeamId, fromTeamId: teamId, level: nextLevel.number, index: 200 + existing.length, reps, label: mastered.label, weight: mastered.weight, exerciseId, at }],
      coinEvents: [...readCoinEvents(fresh), { id, teamId, kind: "send", coins: price, at, toTeamId, label: mastered.label, reps, giftId: id, level: nextLevel.number } satisfies CoinEvent],
    };
  });
  return { ok: true, settings: next, giftId: id, label: mastered.label };
}

// ===== Equipes par parcours : la categorie d'abord, les numeros a la fin =====
// Une equipe se cree dans un parcours avec un nom provisoire (« ★★☆ A ») et un numero hors plage ; la
// numerotation range tout : 3 etoiles d'abord, puis 2, puis 1, dans l'ordre de creation, noms « Équipe n ».
export async function createStarTeam(sessionId: string, stars: Stars): Promise<Res & { id?: string }> {
  if (stars !== 1 && stars !== 2 && stars !== 3) return { error: "Parcours inconnu." };
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs?.startedAt) return { error: "La course est lancée : plus de nouvelle équipe." };
  const settings = await freshSettings(sessionId);
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const teamStars = readTeamStars(settings);
  const sameStars = teams.filter((t) => teamStarsOf(teamStars, t.id) === stars).length;
  const letter = String.fromCharCode(65 + (sameStars % 26));
  const provisional = 1000 + teams.length + 1;
  const team = await db.orm.public.Team.create({ sessionId, name: `${starsLabel(stars)} ${letter}`, order: provisional });
  await writeSettings(sessionId, (fresh) => ({ ...fresh, teamStars: { ...readTeamStars(fresh), [team.id]: stars }, numTeams: teams.length + 1 }));
  return { ok: true, id: team.id };
}
export async function numberTeams(sessionId: string): Promise<number> {
  const settings = await freshSettings(sessionId);
  const teamStars = readTeamStars(settings);
  const teams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => teamStarsOf(teamStars, b.id) - teamStarsOf(teamStars, a.id) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "fr"));
  // Sartay 28/09 : une equipe numerotee garde son numero pour toujours (il est annonce aux eleves), meme si les
  // numeros ne se suivent plus d'un parcours a l'autre. Seules les equipes provisoires (creees par parcours,
  // numero >= 1000) en recoivent un : les plus petits libres, 3 etoiles d'abord.
  const PROVISIONAL = 1000;
  const isNumbered = (o: number | null) => (o ?? 0) >= 1 && (o ?? 0) < PROVISIONAL;
  const used = new Set(teams.filter((t) => isNumbered(t.order)).map((t) => t.order as number));
  let n = 0;
  let changed = 0;
  for (const t of teams) {
    if (isNumbered(t.order)) continue;
    do n++; while (used.has(n));
    used.add(n);
    await db.orm.public.Team.where({ id: t.id }).update({ order: n, name: `Équipe ${n}` });
    changed++;
  }
  // Format des equipes (Sartay 27/09) : fige ici d'apres l'effectif (1 a 3 membres -> petit format), sauf
  // choix explicite dans les reglages. Les enfants (echauffement, finisher) en heritent, le zombie s'y regle.
  const formats = readTeamFormats(settings);
  const missing = teams.filter((t) => !formats[t.id]);
  if (missing.length) {
    const members = await db.orm.public.TeamMember.where((m) => m.teamId.in(missing.map((t) => t.id))).all();
    const auto: Record<string, Format> = {};
    for (const t of missing) auto[t.id] = teamFormatOf(formats, t.id, members.filter((m) => m.teamId === t.id).length);
    await writeSettings(sessionId, (fresh) => ({ ...fresh, teamFormat: { ...auto, ...readTeamFormats(fresh) } }));
  }
  return changed;
}

// Coup d'envoi du WOD principal : les trois echelles sont figees (un parcours vide dans l'atelier retombe sur
// le 2 etoiles), les equipes sont numerotees, les pieces de l'echauffement sont reportees, le chrono part.
export async function startLevelRace(sessionId: string): Promise<Res> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  if (!readFrozenFromSettings(session.settings).length) {
    const all = await freezeLadders();
    if (!all[2].some((l) => activeCards(l).length > 0)) return { error: "L'échelle 2 étoiles est vide : compose les niveaux dans l'atelier Level avant de lancer." };
    const ladders = Object.fromEntries(LADDER_KEYS.filter((k) => k !== 2 && all[k].length).map((k) => [String(k), all[k]]));
    await writeSettings(sessionId, (fresh) => ({ ...fresh, levels: all[2], ladders }));
  }
  let rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) rs = await db.orm.public.RaceState.create({ sessionId, noStartExerciseIds: [] });
  if (rs.startedAt) return { ok: true };
  await numberTeams(sessionId);
  const children = readChildren(await freshSettings(sessionId));
  if (children.warmup) {
    const ph = await phaseTotals("warmup", children.warmup);
    if (ph) {
      const teams = await db.orm.public.Team.where({ sessionId }).all();
      const coinsCarry: Record<string, number> = {};
      for (const t of teams) { const c = ph.byOrder[t.order ?? 0]?.coins ?? 0; if (c > 0) coinsCarry[t.id] = c; }
      await writeSettings(sessionId, (fresh) => ({ ...fresh, coinsCarry }));
    }
  }
  await db.orm.public.RaceState.where({ id: rs.id }).update({ startedAt: Temporal.Now.instant() });
  return { ok: true };
}
