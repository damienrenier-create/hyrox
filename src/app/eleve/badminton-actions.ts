"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { BM_FREE, BM_WITNESSES_NEEDED, mustSign, recentDuel, recentTwin, checkLiveSets, checkSets, isOfficial, matchState, readSets, sameSets, setsText, trimLiveSets, type BmKind, type BmMatch, type BmRole, type BmSet } from "@/lib/badminton";
import { BM_STAFF_ROLES, loadScoutingMatches, activeTournament, handicapSamples, loadTournamentMatches, badmintonRoster, freeRoster, loadEloBoard, loadMatch, loadMatches, loadTournaments, peopleOf, pupilWindowOpen, studentInSession } from "@/lib/badminton-server";
import { HANDICAP_ELO_PER_POINT, TOUR_KINDS, calibrateHandicap, checkManualPools, makeManualPools, handicapFor, playersNow, lateBracketSeat, latePool, makePlayers, pairKey, pendingPairing, readGone, readLate, readTeamSettings, readTourKind, readTourSettings, ruleFor, POOL_NAMES } from "@/lib/badminton-tournament";
import { checkTeams, coachOf, makeTeams, pendingTeamPairing, readyState, runningTimer, subCandidates, teamPlayers, teamsOf } from "@/lib/badminton-teams";
import { readTheme, sessionTheme, type BmTheme } from "@/lib/badminton-themes";
import { readStrokeTap, strokeScoutOf } from "@/lib/badminton-strokes";
import { MAX_LAYER, readCourt, readRally, readScoutConfig, readStrokeSheet, scoutUnlocked, undoneRallies } from "@/lib/badminton-scout";
import { ELO_START } from "@/lib/badminton-elo";
import { betPair, betsAtCreation, headStartOf, readBet, readPendingBets, readSessionConstraints, type BmBets } from "@/lib/badminton-constraints";
import { isTestClass } from "@/lib/session-roles";
import { toMs } from "@/lib/scheduling";

// Badminton (Sartay 20/10) : chaque action AJOUTE une ligne au journal du match (BadmintonEvent), rien n'est jamais
// efface ni reecrit ; l'etat du match se relit sur ce journal (src/lib/badminton.ts). Un eleve n'agit que sur ses matchs
// (ou ceux qu'il a arbitres), pendant la seance et jusqu'a 24 h apres ; un prof partout et tout le temps.
// Matchs LIBRES (03/11) : sessionId = BM_FREE dans les actions, null en base ; a toute heure, entre toutes les classes ;
// officiels une fois attestes par 2 autres eleves (ou valides par un prof).

// `sets` (arbitrage en direct d'un match a handicap) : le score de depart, avec les points d'avance ; `target` (match de
// tournoi) : les points du set du tournoi, proposes d'office au tableau de score de l'arbitre.
// `rule` (match de tournoi, 12/11) : 2 points d'ecart ou pas, plafond.
// endsAt (tournoi par equipes au temps, 24/11) : fin du chrono en cours, affichee au tableau de l'arbitre.
// theme (24/11) : le theme du match ouvert en direct (regle appliquee par le tableau de l'arbitre).
export type BmResult = { error: string } | { ok: true; eventId?: string; matchId?: string; sets?: BmSet[]; target?: number; rule?: { deuce: boolean; cap: number; sets: 1 | 2 | 3; endsAt?: number }; theme?: BmTheme | null; head?: BmSet; bets?: BmBets | null } | { duplicate: { matchId: string; text: string } };
type Ctx = { userId: string; staff: boolean; free: boolean; test: boolean; session: Awaited<ReturnType<typeof sessionOf>> };

const sessionOf = (id: string) => db.orm.public.Session.where({ id }).first();

async function context(sessionId: string): Promise<{ error: string } | Ctx> {
  const user = await getSession();
  if (!user) return { error: "Connecte-toi d'abord." };
  if (await inPreview()) return { error: PREVIEW_READ_ONLY };
  const staff = BM_STAFF_ROLES.includes(user.role);
  if (sessionId === BM_FREE) {
    // Match libre : tout eleve, a toute heure (les eleves de test entre eux seulement) ; un prof aussi.
    if (!staff && user.role !== "STUDENT") return { error: "Réservé aux élèves." };
    const me = staff ? null : await db.orm.public.User.where({ id: user.id }).first();
    return { userId: user.id, staff, free: true, test: isTestClass(me?.className), session: null };
  }
  const session = await sessionOf(sessionId);
  if (!session || session.deletedAt || session.wodType !== "BADMINTON") return { error: "Séance introuvable." };
  if (!staff) {
    const me = await db.orm.public.User.where({ id: user.id }).first();
    if (!me || !(await studentInSession(session, me.id, me.className ?? null))) return { error: "Cette séance n'est pas celle de ta classe." };
    if (!pupilWindowOpen(session)) return { error: "La séance est terminée depuis plus de 24 h : demande à ton prof." };
  }
  return { userId: user.id, staff, free: false, test: false, session };
}

// Eleves qu'on peut nommer : ceux de la seance, ou (match libre) tous les eleves.
async function rosterIds(c: Ctx): Promise<Set<string>> {
  if (c.session) return new Set((await badmintonRoster(c.session)).map((p) => p.id));
  const list = c.staff ? [...(await freeRoster(false)), ...(await freeRoster(true))] : await freeRoster(c.test);
  return new Set(list.map((p) => p.id));
}
const notFound = (c: Ctx) => (c.free ? "Élève introuvable." : "Cet élève n'est pas dans cette séance.");
const dbSession = (c: Ctx) => c.session?.id ?? null;

async function addEvent(matchId: string, sessionId: string | null, kind: BmKind, authorId: string, role: BmRole, sets: BmSet[] | null, targetId: string | null = null) {
  await db.orm.public.BadmintonEvent.create({ matchId, sessionId, kind, authorId, role, targetId, sets: sets ? JSON.parse(JSON.stringify(sets)) : null, at: Temporal.Now.instant() });
}

// Ligne RALLY / SCOUT / THEME (24/11) : ses parametres (un objet, pas des sets) vont dans la colonne JSON.
async function addEventData(matchId: string, sessionId: string | null, kind: BmKind, authorId: string, role: BmRole, data: unknown, targetId: string | null = null): Promise<string> {
  return (await db.orm.public.BadmintonEvent.create({ matchId, sessionId, kind, authorId, role, targetId, sets: JSON.parse(JSON.stringify(data)), at: Temporal.Now.instant() })).id;
}

function done(sessionId: string | null) {
  revalidatePath(`/eleve/badminton/${sessionId ?? BM_FREE}`);
  revalidatePath("/admin/badminton");
}

// Tournoi en cours de la seance (09/11) : un match entre deux joueurs qui doivent s'y affronter lui est rattache.
// Championnat a handicap : le match part avec les points d'avance du moins bien classe ([a, b]).
// Tournoi par equipes (24/11) : le match doit etre un match d'une rencontre encore a jouer ; au temps, pas d'objectif
// (le score au coup de sifflet) et la fin du chrono en cours.
async function tournamentFor(c: Ctx, a: string, b: string): Promise<{ id: string; start: BmSet | null; points: number; deuce: boolean; cap: number; sets: 1 | 2 | 3; endsAt?: number } | null> {
  if (!c.session) return null;
  const t = activeTournament(await loadTournaments(c.session.id));
  const tm = t ? await loadTournamentMatches(t.id) : [];
  if (!t) return null;
  if (t.kind === "TEAMS") {
    if (!pendingTeamPairing(teamsOf(t.players, tm, t.settings), a, b)) return null;
    if (t.settings.team?.mode === "TIME") { const run = runningTimer(t.settings.team); return { id: t.id, start: null, points: 0, deuce: false, cap: 0, sets: 1, ...(run ? { endsAt: run.endsAt } : {}) }; }
    return { id: t.id, start: null, ...ruleFor(t.settings, t.players, a, b) };
  }
  if (!pendingPairing(t.kind, t.players, tm, a, b, t.settings.poolLegs)) return null;
  const rule = ruleFor(t.settings, t.players, a, b); // objectif du match (match, poule ou tournoi), 2 points d'ecart, plafond
  if (t.kind !== "HANDICAP") return { id: t.id, start: null, ...rule };
  // ELO du moment (13/11) et bareme du moment, ou avance imposee par le prof.
  return { id: t.id, start: handicapFor(t.settings, playersNow(t.players, tm, t.settings), a, b), ...rule };
}

// Match libre : les temoins demandes a la saisie (au plus 2, ni joueurs, ni celui qui encode).
async function askWitnesses(c: Ctx, matchId: string, a: string, b: string, role: BmRole, raw: string[] | undefined): Promise<string | null> {
  if (!c.free || !raw?.length) return null;
  const ids = [...new Set(raw.map(String))].filter((id) => id && id !== a && id !== b && id !== c.userId).slice(0, BM_WITNESSES_NEEDED);
  const roster = await rosterIds(c);
  if (ids.some((id) => !roster.has(id))) return "Témoin introuvable.";
  for (const id of ids) await addEvent(matchId, null, "WITNESS_ASK", c.userId, role, null, id);
  return null;
}

// Contraintes de la lecon (26/11 soir, src/lib/badminton-constraints.ts) pour un nouveau match entre a et b : les points
// d'avance du handicap (ELO actuel, bareme de la lecon ; pas pour le championnat a handicap, qui a deja les siens) et les
// mises posees AVANT (depuis le dernier match entre eux). Recopiees dans le match : la mise n'est plus secrete.
async function constraintsFor(c: Ctx, a: string, b: string, tour: { points: number; start: BmSet | null } | null, all: BmMatch[]): Promise<{ head: BmSet | null; handicap: { head: BmSet; eloPerPoint: number; gap: number } | null; bets: BmBets | null }> {
  if (!c.session) return { head: null, handicap: null, bets: null };
  const k = readSessionConstraints(c.session.settings);
  let handicap: { head: BmSet; eloPerPoint: number; gap: number } | null = null;
  if (k.handicap && !tour?.start) {
    const board = await loadEloBoard();
    const ra = board.entries.get(a)?.rating ?? ELO_START, rb = board.entries.get(b)?.rating ?? ELO_START;
    handicap = { head: headStartOf(ra, rb, k.handicap.eloPerPoint, tour?.points ?? 15), eloPerPoint: k.handicap.eloPerPoint, gap: Math.round(ra - rb) };
  }
  let bets: BmBets | null = null;
  if (k.bet) {
    const pair = betPair(a, b);
    const since = Math.max(0, ...all.filter((m) => betPair(m.playerAId, m.playerBId) === pair).map((m) => m.createdAt));
    const x = betsAtCreation(readPendingBets(c.session.settings), a, b, since);
    bets = x[0] === null && x[1] === null ? null : x;
  }
  return { head: handicap?.head ?? null, handicap, bets };
}

// Le meme duel encode il y a peu (par l'adversaire ou un arbitre) : on le signale plutot que d'en creer un deuxieme
// (sauf revanche : voir recentTwin, src/lib/badminton.ts). Un ARBITRE est toujours prevenu (« es-tu sur ? ») : s'il
// confirme, sa saisie devra etre signee par un des joueurs (REMATCH).
async function twinOf(all: Awaited<ReturnType<typeof loadMatches>>, a: string, b: string, live: boolean, referee: boolean): Promise<{ matchId: string; text: string } | null> {
  const twin = referee ? recentDuel(all, a, b, Date.now()) : recentTwin(all, a, b, Date.now());
  if (!twin) return null;
  const st = matchState(twin);
  const people = await peopleOf([twin]);
  const nm = (id: string) => people.get(id)?.name ?? "?";
  if (live) {
    const at = new Date(twin.createdAt).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
    return { matchId: twin.id, text: st.status === "LIVE" ? `${nm(twin.createdById)} arbitre déjà ce match en direct depuis ${at}.` : `${nm(st.scoreBy?.id ?? twin.createdById)} a déjà encodé ce match à ${at} : ${nm(twin.playerAId)} ${setsText(st.sets)} ${nm(twin.playerBId)}.` };
  }
  const by = st.scoreBy ? nm(st.scoreBy.id) : nm(twin.createdById);
  const at = new Date(st.scoreBy?.at ?? twin.createdAt).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return { matchId: twin.id, text: `${by} a déjà encodé ce match à ${at} : ${nm(twin.playerAId)} ${setsText(st.sets)} ${nm(twin.playerBId)}.` };
}

// Nouveau match. Un eleve qui l'a JOUE : playerAId absent (ou lui-meme), playerBId = son adversaire. Un eleve ARBITRE :
// les deux joueurs, aucun des deux n'est lui. Un prof : les deux joueurs. `sets` = points de A puis de B.
// Match libre : `witnessIds` = les eleves a qui demander d'attester le match.
export async function recordMatchAction(sessionId: string, input: { playerAId?: string | null; playerBId: string; sets: BmSet[]; force?: boolean; witnessIds?: string[] }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  const asPlayer = !c.staff && (!input.playerAId || input.playerAId === c.userId);
  const role: BmRole = c.staff ? "STAFF" : asPlayer ? "PLAYER" : "REFEREE";
  const a = asPlayer ? c.userId : String(input.playerAId ?? "");
  const b = String(input.playerBId ?? "");
  if (!a || !b) return { error: role === "PLAYER" ? "Choisis ton adversaire." : "Choisis les deux joueurs." };
  if (a === b) return { error: "Un match se joue à deux : choisis deux élèves différents." };
  if (role === "REFEREE" && (a === c.userId || b === c.userId)) return { error: "Tu joues ce match : encode-le comme joueur, pas comme arbitre." };
  const roster = await rosterIds(c);
  if (!roster.has(b) || (role !== "PLAYER" && !roster.has(a))) return { error: notFound(c) };
  const sets = readSets(input.sets);
  const bad = sets ? checkSets(sets) : "Score illisible.";
  if (bad || !sets) return { error: bad ?? "Score illisible." };

  const all = await loadMatches(sessionId);
  const repeat = role === "REFEREE" && !!recentDuel(all, a, b, Date.now());
  if (!input.force) {
    const twin = await twinOf(all, a, b, false, role === "REFEREE");
    if (twin) return { duplicate: twin };
  }

  const sid = dbSession(c);
  const tourRec = await tournamentFor(c, a, b);
  const tournamentId = tourRec?.id ?? null;
  const theme = c.session ? sessionTheme(c.session.settings) : null; // match a theme de la seance (24/11)
  const k = await constraintsFor(c, a, b, tourRec, all); // handicap et mises (26/11 soir)
  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId: sid, playerAId: a, playerBId: b, createdById: c.userId, tournamentId });
    if (theme) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "THEME", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(theme)), at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    if (k.handicap) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "HANDICAP", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(k.handicap)), at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    if (k.bets) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "BET", authorId: c.userId, role, sets: { a: k.bets[0], b: k.bets[1] }, at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "SCORE", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(sets)), at: Temporal.Now.instant() });
    if (repeat) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "REMATCH", authorId: c.userId, role, sets: null, at: Temporal.Now.instant().add({ milliseconds: 1 }) });
    return m;
  });
  const err = await askWitnesses(c, match.id, a, b, role, input.witnessIds);
  done(sid);
  return err ? { error: `Match enregistré, mais : ${err}` } : { ok: true, matchId: match.id };
}

type MatchCtx = { c: Ctx; m: NonNullable<Awaited<ReturnType<typeof loadMatch>>>; st: ReturnType<typeof matchState> };
async function matchCtx(matchId: string): Promise<{ error: string } | MatchCtx> {
  const m = await loadMatch(matchId);
  if (!m) return { error: "Ce match n'existe plus." };
  const c = await context(m.sessionId ?? BM_FREE);
  if ("error" in c) return c;
  return { c, m, st: matchState(m) };
}

// Signer le score : le joueur qui ne l'a pas encode (ou un prof). Match libre : la validation d'un prof le rend officiel.
export async function validateMatchAction(matchId: string): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  if (st.status === "CANCELLED") return { error: "Ce match a été annulé." };
  if (st.status === "VALIDATED" && !(c.staff && m.sessionId === null && !isOfficial(m, st))) return { ok: true };
  if (st.status === "LIVE") {
    if (!c.staff) return { error: "Ce match est encore en direct : c'est l'arbitre qui le termine." };
    const sets = trimLiveSets(st.sets ?? [[0, 0]]);
    const bad = checkSets(sets);
    if (bad) return { error: `Score du direct incomplet : ${bad}` };
    await addEvent(m.id, m.sessionId, "SCORE", c.userId, "STAFF", sets);
    done(m.sessionId);
    return { ok: true };
  }
  if (!c.staff) {
    if (!mustSign(m, st, c.userId)) return { error: "C'est à ton adversaire de signer ce score, pas à toi." };
  }
  await addEvent(m.id, m.sessionId, "VALIDATE", c.userId, c.staff ? "STAFF" : "PLAYER", null);
  done(m.sessionId);
  return { ok: true };
}

// Corriger le score : un des deux joueurs, l'arbitre qui l'a encode, ou un prof. La nouvelle version devra etre signee par
// l'autre joueur (sauf si elle vient d'un arbitre ou d'un prof). Meme score que celui en vigueur : c'est une signature.
export async function correctMatchAction(matchId: string, rawSets: BmSet[]): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  const sets = readSets(rawSets);
  const bad = sets ? checkSets(sets) : "Score illisible.";
  if (bad || !sets) return { error: bad ?? "Score illisible." };
  const player = c.userId === m.playerAId || c.userId === m.playerBId;
  const referee = !player && c.userId === m.createdById;
  if (!c.staff && !player && !referee) return { error: "Ce n'est pas ton match." };
  if (!c.staff && st.status === "CANCELLED") return { error: "Ce match a été annulé : demande à ton prof." };
  if (!c.staff && st.status === "LIVE") return { error: "Ce match est encore arbitré en direct : attends la fin du match." };
  if (sameSets(st.sets, sets) && st.status !== "CANCELLED") {
    if (mustSign(m, st, c.userId) || c.staff) {
      await addEvent(m.id, m.sessionId, "VALIDATE", c.userId, c.staff ? "STAFF" : "PLAYER", null);
      done(m.sessionId);
      return { ok: true };
    }
    return { error: "C'est déjà le score enregistré." };
  }
  await addEvent(m.id, m.sessionId, "SCORE", c.userId, c.staff ? "STAFF" : player ? "PLAYER" : "REFEREE", sets);
  done(m.sessionId);
  return { ok: true };
}

// « Je n'ai pas joue ce match » : un des deux joueurs qui n'a pas encode la version en vigueur. Le prof tranche.
export async function disputeMatchAction(matchId: string): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  if (c.staff) return { error: "Un prof annule ou corrige directement." };
  if (c.userId !== m.playerAId && c.userId !== m.playerBId) return { error: "Ce n'est pas ton match." };
  if (st.status === "CANCELLED") return { error: "Ce match a déjà été annulé." };
  if (st.scoreBy?.id === c.userId) return { error: "Tu as encodé ce score toi-même : corrige-le ou annule-le." };
  await addEvent(m.id, m.sessionId, "DISPUTE", c.userId, "PLAYER", null);
  done(m.sessionId);
  return { ok: true };
}

// Annuler (encode par erreur) : celui qui l'a encode tant qu'il n'est pas valide, ou un prof. Le match reste dans
// l'historique, barre.
export async function cancelMatchAction(matchId: string): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  if (st.status === "CANCELLED") return { ok: true };
  if (!c.staff) {
    if (c.userId !== m.createdById) return { error: "Seul celui qui a encodé ce match peut l'annuler (ou ton prof)." };
    if (st.status === "VALIDATED") return { error: "Ce match est déjà signé : demande à ton prof de l'annuler." };
  }
  await addEvent(m.id, m.sessionId, "CANCEL", c.userId, c.staff ? "STAFF" : m.createdById === c.userId && c.userId !== m.playerAId && c.userId !== m.playerBId ? "REFEREE" : "PLAYER", null);
  done(m.sessionId);
  return { ok: true };
}

// ===== Matchs libres : temoins (03/11) =====
// Un joueur (ou l'arbitre qui l'a encode) demande a un autre eleve d'attester le match ; cet eleve atteste le score en
// vigueur ou dit ne pas avoir vu le match.
export async function askWitnessAction(matchId: string, witnessId: string): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  if (m.sessionId !== null) return { error: "Les témoins, c'est pour les matchs libres." };
  if (st.status === "CANCELLED") return { error: "Ce match a été annulé." };
  const player = c.userId === m.playerAId || c.userId === m.playerBId;
  if (!c.staff && !player && c.userId !== m.createdById) return { error: "Ce n'est pas ton match." };
  const w = String(witnessId ?? "");
  if (!w || w === m.playerAId || w === m.playerBId) return { error: "Un témoin ne joue pas le match." };
  if (w === c.userId) return { error: "Choisis un autre élève que toi." };
  if (st.asked.includes(w)) return { error: "Cet élève a déjà été sollicité pour ce match." };
  if (st.asked.length >= 6) return { error: "Assez de témoins demandés pour ce match." };
  if (!(await rosterIds(c)).has(w)) return { error: "Élève introuvable." };
  await addEvent(m.id, null, "WITNESS_ASK", c.userId, c.staff ? "STAFF" : player ? "PLAYER" : "REFEREE", null, w);
  done(null);
  return { ok: true };
}

// `saw` : true = « j'atteste ce score », false = « je n'ai pas vu ce match ».
export async function attestMatchAction(matchId: string, saw: boolean): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  if (m.sessionId !== null) return { error: "Les témoins, c'est pour les matchs libres." };
  if (c.staff) return { error: "Un prof valide le match directement." };
  if (!st.asked.includes(c.userId)) return { error: "On ne t'a pas demandé d'attester ce match." };
  if (st.status === "CANCELLED") return { error: "Ce match a été annulé." };
  if (st.status === "LIVE" || !st.sets) return { error: "Ce match n'a pas encore de score final." };
  await addEvent(m.id, null, saw ? "WITNESS" : "WITNESS_NO", c.userId, "WITNESS", null);
  done(null);
  return { ok: true };
}

// ===== Tournois (Sartay 09/11) : le prof lance un tournoi par poules dans sa seance, puis le clot (rien n'est efface) =====
// pools (20/11) : poules arrangees a la main par le prof (joueurs de chaque poule, dans l'ordre A, B, C…), au lieu des
// poules calculees par l'ELO. Poules et championnat seulement (pas le grand tableau).
// Tournoi par equipes (24/11) : `teams` = les joueurs de chaque equipe (dans l'ordre A, B…) tels que le prof les a vus ou
// modifies, `coaches` = le coach de chaque equipe (null : sa tete de serie), `team` = format, jeu au score ou au temps, etc.
export async function createTournamentAction(sessionId: string, input: { kind: string; playerIds: string[]; poolSize: number; poolCount?: number; sets: number; points: number; eloPerPoint?: number; deuce?: boolean; cap?: number; pools?: string[][]; teams?: string[][]; coaches?: (string | null)[]; team?: { count?: number; format?: string; groups?: number; mode?: string; minutes?: number; draw?: string } }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  if (!c.session) return { error: "Un tournoi se lance dans une séance." };
  if (activeTournament(await loadTournaments(sessionId))) return { error: "Un tournoi est déjà en cours dans cette séance : clos-le d'abord." };
  const kind = readTourKind(input.kind);
  // Eleves de la seance, et les profs (16/11 : le prof titulaire peut participer au tournoi de sa classe).
  const roster = new Set((await badmintonRoster(c.session)).map((p) => p.id));
  const ids = [...new Set((input.playerIds ?? []).map(String))].filter((id) => roster.has(id));
  if (ids.length < 2) return { error: "Choisis au moins 2 participants." };
  const board = await loadEloBoard();
  if (kind === "TEAMS") return createTeamTournament(c, sessionId, ids, input, (id) => board.entries.get(id)?.rating ?? ELO_START, (id) => board.entries.get(id)?.games ?? 0);
  // Championnat a handicap, bareme « automatique » (eloPerPoint absent ou 0) : calcule MAINTENANT sur les matchs joues.
  const auto = kind === "HANDICAP" && !(Number(input.eloPerPoint) > 0);
  const points = readTourSettings({ points: input.points }, kind).points;
  const cal = auto ? calibrateHandicap(handicapSamples(board), points) : null;
  const settings = readTourSettings({ sets: input.sets, points: input.points, poolSize: input.poolSize, poolCount: input.poolCount, eloPerPoint: auto ? cal?.eloPerPoint : input.eloPerPoint, deuce: input.deuce, cap: input.cap, calibration: cal }, kind);
  const eloOf = (id: string) => board.entries.get(id)?.rating ?? ELO_START;
  const manual = kind !== "BRACKET" && Array.isArray(input.pools) ? input.pools.map((p) => (Array.isArray(p) ? p.map(String) : [])) : null;
  if (manual) {
    const bad = checkManualPools(manual, ids);
    if (bad) return { error: bad };
  }
  const players = manual ? makeManualPools(manual, eloOf) : makePlayers(kind, ids.map((id) => ({ id, elo: eloOf(id) })), settings);
  const day = new Date().toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });
  const t = await db.transaction(async (tx) => {
    // launchGames (13/11) : matchs joues par chacun au lancement, pour le K de l'ELO du moment au championnat a handicap.
    const launchGames = Object.fromEntries(ids.map((id) => [id, board.entries.get(id)?.games ?? 0]));
    const t = await tx.orm.public.BadmintonTournament.create({ sessionId, kind, label: `${TOUR_KINDS.find((k) => k.id === kind)!.name} du ${day}`, settings: { ...settings, launchGames, ...(manual ? { manualPools: true } : {}) }, createdById: c.userId });
    for (const p of players) await tx.orm.public.BadmintonTournamentPlayer.create({ tournamentId: t.id, studentId: p.studentId, pool: p.pool, seed: p.seed, elo: p.elo });
    return t;
  });
  done(sessionId);
  return { ok: true, matchId: t.id };
}

async function createTeamTournament(c: Ctx, sessionId: string, ids: string[], input: Parameters<typeof createTournamentAction>[1], eloOf: (id: string) => number, gamesOf: (id: string) => number): Promise<BmResult> {
  const raw = input.team ?? {};
  const count = Math.round(Number(raw.count) || 4);
  if (count < 2) return { error: "Il faut au moins 2 équipes." };
  if (ids.length < count) return { error: `Pas assez de participants pour ${count} équipes.` };
  const groups = Array.isArray(input.teams) ? input.teams.map((t) => (Array.isArray(t) ? t.map(String) : [])).filter((t) => t.length) : makeTeams(ids.map((id) => ({ id, elo: eloOf(id) })), count);
  const bad = checkTeams(groups, ids);
  if (bad) return { error: bad };
  const players = teamPlayers(groups, eloOf);
  // Coach de chaque equipe : celui choisi par le prof (s'il est dans l'equipe), sinon la tete de serie.
  const draft = readTeamSettings({ ...raw, count: groups.length });
  const coaches = Object.fromEntries(groups.map((g, i) => {
    const letter = POOL_NAMES[i];
    const wanted = input.coaches?.[i];
    return [letter, wanted && g.includes(wanted) ? wanted : coachOf({ ...draft, coaches: {} }, letter, players.filter((p) => p.pool === letter))];
  }));
  // Points d'equipe (26/11) : les nouveaux tournois comptent les points marques (voir TeamScoring).
  const team = readTeamSettings({ ...raw, count: groups.length, coaches, scoring: "POINTS" });
  const settings = readTourSettings({ sets: input.sets, points: input.points, deuce: input.deuce, cap: input.cap, team }, "TEAMS");
  const day = new Date().toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });
  const t = await db.transaction(async (tx) => {
    const launchGames = Object.fromEntries(ids.map((id) => [id, gamesOf(id)]));
    const t = await tx.orm.public.BadmintonTournament.create({ sessionId, kind: "TEAMS", label: `Tournoi par équipes du ${day}`, settings: JSON.parse(JSON.stringify({ ...settings, launchGames })), createdById: c.userId });
    for (const p of players) await tx.orm.public.BadmintonTournamentPlayer.create({ tournamentId: t.id, studentId: p.studentId, pool: p.pool, seed: p.seed, elo: p.elo });
    return t;
  });
  done(sessionId);
  return { ok: true, matchId: t.id };
}

// Chrono du tournoi par equipes au temps (24/11, Sartay : « tous les matchs commencent en meme temps et finissent en meme
// temps ») : le prof lance le chrono de la ronde (vague 1 = matchs des tetes de serie, vague 2 = matchs en plus) ; tous
// les telephones l'affichent. `minutes` : la duree, modifiable a chaque lancement. stop : arreter le chrono.
export async function teamTimerAction(tournamentId: string, op: "start" | "stop", pick?: { round?: number; wave?: number; minutes?: number }): Promise<BmResult> {
  const row = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!row || !row.sessionId || row.cancelledAt) return { error: "Ce tournoi est introuvable ou clos." };
  const c = await context(row.sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  const t = (await loadTournaments(row.sessionId)).find((x) => x.id === row.id)!;
  if (t.kind !== "TEAMS" || !t.settings.team) return { error: "Ce tournoi n'est pas un tournoi par équipes." };
  const cur = (row.settings ?? {}) as Record<string, unknown>;
  const team = { ...((cur.team ?? {}) as Record<string, unknown>) };
  const now = Date.now();
  if (op === "stop") {
    const tm = t.settings.team.timer;
    if (!tm || tm.stoppedAt) return { ok: true };
    team.timer = { ...tm, stoppedAt: now };
  } else {
    const st = teamsOf(t.players, await loadTournamentMatches(t.id), t.settings);
    const round = Math.round(Number(pick?.round) || st.next?.round || 0);
    const wave = Number(pick?.wave) === 2 ? 2 : pick?.wave ? 1 : st.next?.wave ?? 1;
    if (!round || !st.rounds.some((r) => r.n === round)) return { error: "Plus aucune ronde à jouer." };
    const minutes = Number(pick?.minutes) >= 1 && Number(pick?.minutes) <= 30 ? Number(pick?.minutes) : t.settings.team.minutes;
    team.minutes = minutes;
    team.timer = { round, wave, startedAt: now, endsAt: now + minutes * 60_000, stoppedAt: null };
    const starts = { ...t.settings.team.roundStarts };
    if (!starts[String(round)]) starts[String(round)] = now; // la ronde commence au 1er coup de sifflet
    team.roundStarts = starts;
  }
  await db.orm.public.BadmintonTournament.where({ id: t.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, team })) });
  done(row.sessionId);
  return { ok: true };
}

// « Pret » (26/11, Sartay : « c'est moi qui lance, mais si tout le monde est pret alors ca lance ; quoi qu'il arrive, si je
// lance, ca lance ») : un joueur de la prochaine vague au temps dit « pret » (ou se retracte). Plusieurs telephones peuvent
// appuyer en meme temps : on relit apres chaque ecriture et on recommence si son « pret » a ete ecrase. Quand tous les
// joueurs attendus sont prets, le chrono part tout seul (comme le coup de sifflet du prof).
export async function teamReadyAction(tournamentId: string, ready: boolean): Promise<BmResult> {
  const first = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!first || !first.sessionId || first.cancelledAt) return { error: "Ce tournoi est introuvable ou clos." };
  const c = await context(first.sessionId);
  if ("error" in c) return c;
  const load = async () => {
    const t = (await loadTournaments(first.sessionId!)).find((x) => x.id === first.id);
    if (!t || t.kind !== "TEAMS" || !t.settings.team) return null;
    const st = teamsOf(t.players, await loadTournamentMatches(t.id), t.settings);
    return { t, rs: readyState(st, t.settings.team) };
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const x = await load();
    if (!x) return { error: "Ce tournoi n'est pas un tournoi par équipes au temps." };
    if (!x.rs) return { ok: true }; // le chrono tourne deja, ou plus rien a lancer
    if (!x.rs.expected.includes(c.userId)) return { error: "Tu ne joues pas dans la prochaine vague." };
    const has = x.rs.ready.includes(c.userId);
    if (has === ready) {
      // Tout le monde est pret : depart automatique (une seule fois : readyState devient null des que le chrono tourne).
      if (ready && x.rs.expected.every((id) => x.rs!.ready.includes(id))) await startTeamTimer(x.t.id, x.rs.round, x.rs.wave, x.t.settings.team!.minutes, first.sessionId);
      done(first.sessionId);
      return { ok: true };
    }
    const row = (await db.orm.public.BadmintonTournament.where({ id: first.id }).first())!;
    const cur = (row.settings ?? {}) as Record<string, unknown>;
    const team = { ...((cur.team ?? {}) as Record<string, unknown>) };
    const prev = readTeamSettings(team).ready;
    const ids = prev && prev.round === x.rs.round && prev.wave === x.rs.wave ? prev.ids : [];
    team.ready = { round: x.rs.round, wave: x.rs.wave, ids: ready ? [...new Set([...ids, c.userId])] : ids.filter((id) => id !== c.userId) };
    await db.orm.public.BadmintonTournament.where({ id: first.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, team })) });
    await new Promise((r) => setTimeout(r, 60 + Math.floor(Math.random() * 180)));
  }
  return { error: "Beaucoup de joueurs appuient en même temps : réessaie dans un instant." };
}

// Le coup de sifflet (prof, ou depart automatique quand tout le monde est pret).
async function startTeamTimer(tournamentId: string, round: number, wave: 1 | 2, minutes: number, sessionId: string) {
  const row = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!row) return;
  const cur = (row.settings ?? {}) as Record<string, unknown>;
  const team = { ...((cur.team ?? {}) as Record<string, unknown>) };
  const ts = readTeamSettings(team);
  const now = Date.now();
  const run = runningTimer(ts, now);
  if (run && run.round === round && run.wave === wave && now - run.startedAt < 15_000) return; // deja parti a l'instant
  team.timer = { round, wave, startedAt: now, endsAt: now + minutes * 60_000, stoppedAt: null };
  const starts = { ...ts.roundStarts };
  if (!starts[String(round)]) starts[String(round)] = now;
  team.roundStarts = starts;
  await db.orm.public.BadmintonTournament.where({ id: row.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, team })) });
  done(sessionId);
}

// Remplacant d'un joueur parti (26/11, regles dans subCandidates, badminton-teams.ts) : il joue a sa place a partir de la
// prochaine ronde de son equipe pas encore finie ; ses points vont a cette equipe. inId null = plus de remplacant.
export async function setTeamSubAction(tournamentId: string, outId: string, inId: string | null): Promise<BmResult> {
  const row = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!row || !row.sessionId || row.cancelledAt) return { error: "Ce tournoi est introuvable ou clos." };
  const c = await context(row.sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  const t = (await loadTournaments(row.sessionId)).find((x) => x.id === row.id)!;
  if (t.kind !== "TEAMS" || !t.settings.team) return { error: "Ce tournoi n'est pas un tournoi par équipes." };
  const out = t.players.find((p) => p.studentId === outId);
  if (!out || !out.gone) return { error: "Marquez d'abord ce joueur comme parti." };
  const st = teamsOf(t.players, await loadTournamentMatches(t.id), t.settings);
  const cand = subCandidates(st, t.players, t.settings.team.subs, outId);
  if (cand.round === null) return { error: "Son équipe n'a plus de rencontre à jouer." };
  if (inId && !cand.list.some((x) => x.id === inId)) return { error: "Ce joueur ne peut pas le remplacer (même équipe, équipe adverse, même partie du tableau ou déjà remplaçant)." };
  const cur = (row.settings ?? {}) as Record<string, unknown>;
  const team = { ...((cur.team ?? {}) as Record<string, unknown>) };
  team.subs = [...t.settings.team.subs, { out: outId, in: inId, round: cand.round, at: Date.now() }];
  await db.orm.public.BadmintonTournament.where({ id: t.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, team })) });
  done(row.sessionId);
  return { ok: true };
}

// ===== Scouting (24/11, regles dans src/lib/badminton-scout.ts) =====
// Un echange note par l'arbitre en direct : l'impact du volant (et, selon ses couches, le coup, le frappeur, gagnant ou faute).
export async function liveRallyAction(matchId: string, raw: unknown): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  if (!x.c.staff && !scoutUnlocked(readScoutConfig(x.c.session?.settings), x.c.userId)) return { error: "Le scouting n'est pas déverrouillé pour toi pendant ce cours." };
  const rally = readRally(raw);
  if (!rally) return { error: "Échange illisible." };
  const eventId = await addEventData(x.m.id, x.m.sessionId, "RALLY", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", rally);
  return { ok: true, eventId };
}
// Annuler un impact (26/11 : « un bouton clair pour annuler la derniere frappe ; appuyer longtemps sur un impact pour
// l'annuler ») : une ligne UNRALLY, rien n'est efface.
export async function undoRallyAction(matchId: string, rallyId: string): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  if (!x.m.events.some((e) => e.id === rallyId && (e.kind === "RALLY" || e.kind === "STROKE"))) return { error: "Impact introuvable." }; // aussi un coup (scouting des coups, 26/11 soir)
  if (undoneRallies(x.m.events).has(rallyId)) return { ok: true };
  await addEventData(x.m.id, x.m.sessionId, "UNRALLY", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", null, rallyId);
  return { ok: true };
}
// Preciser un impact (appui long : le coup, gagnant ou faute ; 26/11 soir : comment le point s'est fini, donc qui l'a
// marque) : l'ancien est annule, le nouveau le remplace (meme place).
export async function editRallyAction(matchId: string, rallyId: string, patch: { stroke?: string | null; end?: string | null; how?: string | null; w?: 0 | 1 }): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  const old = x.m.events.find((e) => e.id === rallyId && e.kind === "RALLY");
  const r = old ? readRally(old.data) : null;
  if (!old || !r || undoneRallies(x.m.events).has(rallyId)) return { error: "Impact introuvable." };
  const next = readRally({ ...r, ...(patch.stroke !== undefined ? { stroke: patch.stroke ?? undefined } : {}), ...(patch.end !== undefined ? { end: patch.end ?? undefined } : {}), ...(patch.how !== undefined ? { how: patch.how ?? undefined } : {}), ...(patch.w === 0 || patch.w === 1 ? { w: patch.w } : {}) });
  if (!next) return { error: "Impact illisible." };
  await addEventData(x.m.id, x.m.sessionId, "UNRALLY", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", null, rallyId);
  const eventId = await addEventData(x.m.id, x.m.sessionId, "RALLY", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", next);
  return { ok: true, eventId };
}
// Fiche technique d'un joueur (les 6 coups, 4 criteres chacun) remplie par un scout qui regarde son match.
export async function scoutStrokesAction(matchId: string, playerId: string, raw: unknown): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  if (playerId !== x.m.playerAId && playerId !== x.m.playerBId) return { error: "Ce joueur ne joue pas ce match." };
  if (!x.c.staff && playerId === x.c.userId) return { error: "On ne remplit pas sa propre fiche : c'est un autre élève qui t'observe." };
  if (!x.c.staff && !scoutUnlocked(readScoutConfig(x.c.session?.settings), x.c.userId)) return { error: "Le scouting n'est pas déverrouillé pour toi pendant ce cours." };
  if (x.st.status === "CANCELLED") return { error: "Ce match a été annulé." };
  const sheet = readStrokeSheet(raw);
  if (!sheet) return { error: "Coche au moins un coup observé." };
  await addEventData(x.m.id, x.m.sessionId, "SCOUT", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", { strokes: sheet }, playerId);
  done(x.m.sessionId);
  return { ok: true };
}
// Reglages du scouting de la seance : impacts notes ou pas, terrain dessine, couches par defaut.
export async function setScoutConfigAction(sessionId: string, patch: { on?: boolean; court?: string; level?: number }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff || !c.session) return { error: "Réservé aux profs." };
  const cur = (c.session.settings ?? {}) as Record<string, unknown>;
  const sc = readScoutConfig(cur);
  const next = { ...sc, ...(patch.on !== undefined ? { on: !!patch.on } : {}), ...(patch.court ? { court: readCourt(patch.court) } : {}), ...(patch.level ? { level: Math.max(1, Math.min(MAX_LAYER, Math.round(Number(patch.level)))) } : {}) };
  await db.orm.public.Session.where({ id: c.session.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, scout: next })) });
  done(c.session.id);
  return { ok: true };
}
// Deverrouiller (ou reverrouiller) le scouting d'UN eleve pour CE cours (Sartay 26/11 : « en cliquant sur leur profil »).
export async function setScoutUnlockAction(sessionId: string, studentId: string, unlock: boolean): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff || !c.session) return { error: "Réservé aux profs." };
  if (!(await db.orm.public.User.where({ id: studentId, role: "STUDENT" }).first())) return { error: "Élève introuvable." };
  const cur = (c.session.settings ?? {}) as Record<string, unknown>;
  const sc = readScoutConfig(cur);
  const unlocked = unlock ? [...new Set([...sc.unlocked, studentId])] : sc.unlocked.filter((id) => id !== studentId);
  await db.orm.public.Session.where({ id: c.session.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, scout: { ...sc, unlocked } })) });
  done(c.session.id);
  return { ok: true };
}
// Couches d'un eleve en particulier (level 0 = comme la seance) : le dernier reglage suit l'eleve dans ses seances suivantes.
export async function setScoutLevelAction(sessionId: string, studentId: string, level: number): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff || !c.session) return { error: "Réservé aux profs." };
  const l = Math.round(Number(level));
  if (!(l >= 0 && l <= MAX_LAYER)) return { error: "Couche inconnue." };
  const cur = (c.session.settings ?? {}) as Record<string, unknown>;
  const sc = readScoutConfig(cur);
  await db.orm.public.Session.where({ id: c.session.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, scout: { ...sc, students: { ...sc.students, [studentId]: { level: l, at: Date.now() } } } })) });
  done(c.session.id);
  return { ok: true };
}

// Theme des matchs de la seance (24/11) : choisi par le prof ; chaque match cree ensuite dans la seance le garde (les
// matchs deja crees ne changent pas). null = matchs classiques.
export async function setSessionThemeAction(sessionId: string, raw: unknown): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff || !c.session) return { error: "Réservé aux profs." };
  const theme = raw ? readTheme(raw) : null;
  const cur = (c.session.settings ?? {}) as Record<string, unknown>;
  await db.orm.public.Session.where({ id: c.session.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, bmTheme: theme })) });
  done(c.session.id);
  return { ok: true };
}

// Contraintes de la lecon (26/11 soir) : ⚖️ handicap (bareme calcule sur les matchs deja joues) et 🎯 mises, pour les
// matchs crees ensuite (ceux deja crees gardent leurs regles).
export async function setSessionConstraintsAction(sessionId: string, patch: { handicap?: boolean; bet?: boolean }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff || !c.session) return { error: "Réservé aux profs." };
  const cal = patch.handicap ? calibrateHandicap(handicapSamples(await loadEloBoard()), 15) : null;
  const row = await sessionOf(c.session.id);
  const next = { ...((row?.settings ?? {}) as Record<string, unknown>) };
  if (patch.handicap !== undefined) next.handicap = patch.handicap ? { on: true, eloPerPoint: cal?.eloPerPoint ?? HANDICAP_ELO_PER_POINT } : { on: false };
  if (patch.bet !== undefined) next.bet = patch.bet;
  await db.orm.public.Session.where({ id: c.session.id }).update({ settings: JSON.parse(JSON.stringify(next)) });
  done(c.session.id);
  return { ok: true };
}

// Mise de certitude d'un eleve contre un adversaire (26/11 soir) : secrete jusqu'a la creation du match. Plusieurs
// telephones peuvent miser en meme temps : on relit apres l'ecriture et on recommence si la mise a ete ecrasee.
export async function placeBetAction(sessionId: string, opponentId: string, raw: unknown): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (c.staff || !c.session) return { error: "Réservé aux élèves." };
  if (!readSessionConstraints(c.session.settings).bet) return { error: "Les mises ne sont pas ouvertes pendant ce cours." };
  const bet = readBet(raw);
  if (bet === null) return { error: "Une mise va de 0 à 5." };
  const opp = String(opponentId ?? "");
  if (!opp || opp === c.userId) return { error: "Choisis ton adversaire." };
  if (!(await rosterIds(c)).has(opp)) return { error: notFound(c) };
  const pair = betPair(c.userId, opp);
  if ((await loadMatches(c.session.id)).some((m) => betPair(m.playerAId, m.playerBId) === pair && matchState(m).status === "LIVE")) return { error: "Ce match a déjà commencé : la mise est fermée." };
  const at = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await sessionOf(c.session.id);
    const cur = (row?.settings ?? {}) as Record<string, unknown>;
    const list = readPendingBets(cur);
    if (list.some((x) => x.pair === pair && x.by === c.userId && x.at === at)) { done(c.session.id); return { ok: true }; }
    await db.orm.public.Session.where({ id: c.session.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, bets: [...list, { pair, by: c.userId, c: bet, at }] })) });
    await new Promise((r) => setTimeout(r, 60 + Math.floor(Math.random() * 180)));
  }
  return { error: "Beaucoup d'élèves misent en même temps : réessaie dans un instant." };
}

// Clore le tournoi : il reste consultable, ses matchs restent des matchs ordinaires ; un nouveau tournoi peut etre lance.
export async function closeTournamentAction(tournamentId: string): Promise<BmResult> {
  const t = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!t || !t.sessionId) return { error: "Tournoi introuvable." };
  const c = await context(t.sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  if (!t.cancelledAt) await db.orm.public.BadmintonTournament.where({ id: t.id }).update({ cancelledAt: Temporal.Now.instant(), cancelledBy: c.userId });
  done(t.sessionId);
  return { ok: true };
}

// Retardataire (10/11) : l'ajouter au tournoi en cours. Poules / handicap : la poule la plus proche de son ELO, matchs de
// rattrapage contre chacun ; grand tableau : la derniere tete de serie, a la place d'un exempt (voir badminton-tournament.ts).
export async function addLatePlayerAction(tournamentId: string, studentId: string): Promise<BmResult> {
  const row = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!row || !row.sessionId || row.cancelledAt) return { error: "Ce tournoi est introuvable ou clos." };
  const c = await context(row.sessionId);
  if ("error" in c) return c;
  if (!c.staff || !c.session) return { error: "Réservé aux profs." };
  const t = (await loadTournaments(row.sessionId)).find((x) => x.id === row.id)!;
  const id = String(studentId ?? "");
  if (t.players.some((p) => p.studentId === id)) return { error: "Ce joueur participe déjà au tournoi." };
  if (!(await badmintonRoster(c.session)).some((p) => p.id === id)) return { error: "Ce joueur n'est pas dans cette séance." }; // eleve ou prof (16/11)
  const entry = (await loadEloBoard()).entries.get(id);
  const elo = Math.round(entry?.rating ?? ELO_START);
  if (t.kind === "TEAMS") {
    // Tournoi par equipes (24/11) : l'equipe qui a le moins de joueurs presents (puis la plus faible) ; il joue a partir de
    // la prochaine rencontre de son equipe pas encore commencee.
    const st = teamsOf(t.players, await loadTournamentMatches(t.id), t.settings);
    const pick = [...st.teams].sort((x, y) => x.members.filter((m) => !m.away).length - y.members.filter((m) => !m.away).length || x.avg - y.avg || x.letter.localeCompare(y.letter))[0];
    if (!pick) return { error: "Aucune équipe." };
    const seed = Math.max(0, ...t.players.filter((p) => p.pool === pick.letter).map((p) => p.seed)) + 1;
    const cur = (row.settings ?? {}) as Record<string, unknown>;
    const team = { ...((cur.team ?? {}) as Record<string, unknown>) };
    team.lateAt = { ...t.settings.team!.lateAt, [id]: Date.now() };
    await db.transaction(async (tx) => {
      await tx.orm.public.BadmintonTournamentPlayer.create({ tournamentId: t.id, studentId: id, pool: pick.letter, seed, elo });
      await tx.orm.public.BadmintonTournament.where({ id: t.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, team, late: [...readLate(row.settings), id], launchGames: { ...t.settings.launchGames, [id]: entry?.games ?? 0 } })) });
    });
  } else if (t.kind === "BRACKET") {
    const seat = lateBracketSeat(t.players, await loadTournamentMatches(t.id));
    if (!seat.ok) return { error: seat.reason };
    await db.orm.public.BadmintonTournamentPlayer.create({ tournamentId: t.id, studentId: id, pool: "T", seed: seat.seed, elo });
  } else {
    const pool = latePool(t.players, elo);
    const seed = Math.max(0, ...t.players.filter((p) => p.pool === pool).map((p) => p.seed)) + 1;
    await db.transaction(async (tx) => {
      await tx.orm.public.BadmintonTournamentPlayer.create({ tournamentId: t.id, studentId: id, pool, seed, elo });
      await tx.orm.public.BadmintonTournament.where({ id: t.id }).update({ settings: { ...(row.settings as Record<string, unknown>), late: [...readLate(row.settings), id], launchGames: { ...t.settings.launchGames, [id]: entry?.games ?? 0 } } });
    });
  }
  done(row.sessionId);
  return { ok: true };
}

// Score final d'un tournoi en cours (12/11) : objectif par defaut, 2 points d'ecart et plafond ; objectif d'une poule ou
// d'un match (points null = revenir a l'objectif par defaut). Les matchs deja joues ne changent pas.
// eloPerPoint (13/11) : changer le bareme du championnat a handicap en cours (0 = le recalculer sur les matchs joues) ;
// handicap : imposer l'avance d'une rencontre (to = celui qui a l'avance, pts 0 = aucune ; to null = revenir au bareme).
// Les deux valent pour les matchs pas encore commences : un match en direct garde le score de depart de son ouverture.
// poolLegs (13/11) : matchs retour dans UNE poule (legs 2) ; revenir a 1 seul match n'est possible que si aucun retour n'a ete joue.
export async function setTournamentRuleAction(tournamentId: string, patch: { points?: number; deuce?: boolean; cap?: number; pool?: { name: string; points: number | null }; match?: { a: string; b: string; points: number | null }; eloPerPoint?: number; handicap?: { a: string; b: string; to: string | null; pts: number }; poolLegs?: { name: string; legs: number } }): Promise<BmResult> {
  const row = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!row || !row.sessionId || row.cancelledAt) return { error: "Ce tournoi est introuvable ou clos." };
  const c = await context(row.sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  const t = (await loadTournaments(row.sessionId)).find((x) => x.id === row.id)!;
  const cur = (row.settings ?? {}) as Record<string, unknown>;
  const s = t.settings;
  const poolPoints = { ...s.poolPoints };
  const matchPoints = { ...s.matchPoints };
  if (patch.pool) {
    if (!t.players.some((p) => p.pool === patch.pool!.name)) return { error: "Poule introuvable." };
    if (patch.pool.points) poolPoints[patch.pool.name] = patch.pool.points;
    else delete poolPoints[patch.pool.name];
  }
  if (patch.match) {
    const { a, b } = patch.match;
    if (!t.players.some((p) => p.studentId === a) || !t.players.some((p) => p.studentId === b)) return { error: "Ces joueurs ne sont pas dans le tournoi." };
    if (patch.match.points) matchPoints[pairKey(a, b)] = patch.match.points;
    else delete matchPoints[pairKey(a, b)];
  }
  const poolLegs = { ...s.poolLegs };
  if (patch.poolLegs) {
    const { name } = patch.poolLegs;
    const ids = t.players.filter((p) => p.pool === name).map((p) => p.studentId);
    if (!ids.length || t.kind === "BRACKET" || t.kind === "TEAMS") return { error: "Poule introuvable." };
    if (patch.poolLegs.legs === 2) poolLegs[name] = 2;
    else {
      const tm = await loadTournamentMatches(t.id);
      const n = (x: string, y: string) => tm.filter((m) => ((m.playerAId === x && m.playerBId === y) || (m.playerAId === y && m.playerBId === x)) && matchState(m).status !== "CANCELLED").length;
      if (ids.some((x) => ids.some((y) => x < y && n(x, y) >= 2))) return { error: "Des matchs retour ont déjà été joués dans cette poule : on les garde." };
      poolLegs[name] = 1; // un seul match, CHOISI : plus de revanche automatique dans cette poule (16/11)
    }
  }
  const matchHandicap = { ...s.matchHandicap };
  let eloPerPoint = s.eloPerPoint;
  let calibration = s.calibration;
  if (patch.handicap) {
    if (t.kind !== "HANDICAP") return { error: "Ce tournoi n'est pas un championnat à handicap." };
    const { a, b, to } = patch.handicap;
    if (!t.players.some((p) => p.studentId === a) || !t.players.some((p) => p.studentId === b)) return { error: "Ces joueurs ne sont pas dans le tournoi." };
    const pts = Math.round(Number(patch.handicap.pts));
    if (to === null) delete matchHandicap[pairKey(a, b)];
    else if ((to !== a && to !== b) || !(pts >= 0 && pts <= 30)) return { error: "Avance impossible." };
    else matchHandicap[pairKey(a, b)] = { id: to, pts };
  }
  if (patch.eloPerPoint !== undefined) {
    if (t.kind !== "HANDICAP") return { error: "Ce tournoi n'est pas un championnat à handicap." };
    if (Number(patch.eloPerPoint) > 0) {
      eloPerPoint = Math.round(Number(patch.eloPerPoint));
      calibration = null;
    } else {
      const cal = calibrateHandicap(handicapSamples(await loadEloBoard()), s.points);
      if (!cal) return { error: "Pas assez de matchs joués pour calculer le barème." };
      eloPerPoint = cal.eloPerPoint;
      calibration = cal;
    }
  }
  const norm = readTourSettings({ ...cur, points: patch.points ?? s.points, deuce: patch.deuce ?? s.deuce, cap: patch.cap ?? s.cap, poolPoints, matchPoints, eloPerPoint, calibration, matchHandicap, poolLegs }, t.kind);
  await db.orm.public.BadmintonTournament.where({ id: t.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, points: norm.points, deuce: norm.deuce, cap: norm.cap, poolPoints: norm.poolPoints, matchPoints: norm.matchPoints, eloPerPoint: norm.eloPerPoint, calibration: norm.calibration, matchHandicap: norm.matchHandicap, poolLegs: norm.poolLegs })) });
  done(row.sessionId);
  return { ok: true };
}

// Joueur parti avant la fin du tournoi (12/11) : `gone` true = le retirer (ses matchs non joues sortent de l'ordre),
// false = le remettre s'il revient. Rien n'est efface (settings.gone).
export async function setPlayerGoneAction(tournamentId: string, studentId: string, gone: boolean): Promise<BmResult> {
  return setPlayersGoneAction(tournamentId, [studentId], gone);
}
// Plusieurs joueurs d'un coup (16/11, Sartay : les 3GTe et 3GTf ne restent que les 50 premieres minutes, « il faudra que je
// puisse les bouger en milieu de tournoi ») : toute une classe part, ou revient.
export async function setPlayersGoneAction(tournamentId: string, studentIds: string[], gone: boolean): Promise<BmResult> {
  const row = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!row || !row.sessionId || row.cancelledAt) return { error: "Ce tournoi est introuvable ou clos." };
  const c = await context(row.sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  const t = (await loadTournaments(row.sessionId)).find((x) => x.id === row.id)!;
  const ids = [...new Set((studentIds ?? []).map(String))].filter((id) => t.players.some((p) => p.studentId === id));
  if (!ids.length) return { error: "Cet élève ne participe pas au tournoi." };
  const list = new Set(readGone(row.settings));
  for (const id of ids) {
    if (gone) list.add(id);
    else list.delete(id);
  }
  const cur = (row.settings ?? {}) as Record<string, unknown>;
  // Tournoi par equipes (24/11) : on garde aussi QUAND il part et revient (settings.team.away), pour ne pas changer les
  // rencontres deja commencees.
  let team = cur.team as Record<string, unknown> | undefined;
  if (t.kind === "TEAMS" && t.settings.team) {
    const now = Date.now();
    const away = { ...t.settings.team.away };
    for (const id of ids) {
      const iv = [...(away[id] ?? [])];
      const open = iv.findIndex(([, to]) => to === null);
      if (gone && open < 0) iv.push([now, null]);
      if (!gone && open >= 0) iv[open] = [iv[open][0], now];
      if (iv.length) away[id] = iv;
    }
    team = { ...(team ?? {}), away };
  }
  await db.orm.public.BadmintonTournament.where({ id: t.id }).update({ settings: JSON.parse(JSON.stringify({ ...cur, gone: [...list], ...(team ? { team } : {}) })) });
  done(row.sessionId);
  return { ok: true };
}

// Continuer dans cette seance un tournoi pas encore clos lance a un cours precedent (un seul tournoi en cours par seance).
export async function moveTournamentAction(tournamentId: string, sessionId: string): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  const t = await db.orm.public.BadmintonTournament.where({ id: tournamentId }).first();
  if (!t || t.cancelledAt) return { error: "Ce tournoi est clos." };
  if (activeTournament(await loadTournaments(sessionId))) return { error: "Un tournoi est déjà en cours dans cette séance." };
  await db.orm.public.BadmintonTournament.where({ id: t.id }).update({ sessionId });
  done(sessionId);
  return { ok: true };
}

// « Pouls » des ecrans badminton : le nombre de lignes du journal de la seance (une saisie, une signature… le change).
export async function badmintonPulseAction(sessionId: string): Promise<string> {
  const user = await getSession();
  if (!user) return "";
  try {
    if (sessionId === BM_FREE) return String((await db.orm.public.BadmintonEvent.where((e) => e.sessionId.isNull()).aggregate((a) => ({ n: a.count() }))).n);
    const n = (await db.orm.public.BadmintonEvent.where({ sessionId }).aggregate((a) => ({ n: a.count() }))).n;
    const s = await sessionOf(sessionId);
    const tours = await db.orm.public.BadmintonTournament.where({ sessionId }).all(); // lancer ou clore un tournoi rafraichit les ecrans
    // Chrono d'un tournoi par equipes (24/11) : le lancer ou l'arreter rafraichit aussi les telephones.
    const timers = tours.filter((t) => !t.cancelledAt).map((t) => { const tm = readTeamSettings((t.settings as { team?: unknown } | null)?.team).timer; return tm ? `${tm.startedAt}.${tm.stoppedAt ?? 0}` : ""; }).join(",");
    return `${n}|${s?.isActive ? 1 : 0}|${s?.closesAt ? toMs(s.closesAt) : 0}|${tours.length}.${tours.filter((t) => t.cancelledAt).length}|${timers}`;
  } catch {
    return "";
  }
}

// ===== Arbitrage en direct (Sartay 03/11 : « encoder les points au fur et a mesure avec un petit plus et un petit moins,
// pour ne pas devoir ecrire le chiffre a chaque fois tout en les poussant a suivre le match ») =====
// Un eleve qui NE JOUE PAS le match (ou un prof) l'ouvre ; chaque appui envoie la photo du score (ligne LIVE) ; « Fin du
// match » l'enregistre (ligne SCORE de l'arbitre, validee d'office).
// Ouvrir une OBSERVATION de scouting (26/11, Sartay : « le scouting n'est pas l'arbitrage ! il ne compte pas dans les points
// ELO, les points sont a titre indicatif ») : un « match » marque SCOUTING, jamais charge avec les vrais matchs (ni ELO, ni
// tournoi, ni liste, ni arbitrage) ; le tableau en direct y note le score indicatif et les impacts (RALLY).
export async function startScoutingAction(sessionId: string, input: { playerAId: string; playerBId: string }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (c.free || !c.session) return { error: "Le scouting se fait pendant un cours." };
  if (!c.staff && !scoutUnlocked(readScoutConfig(c.session.settings), c.userId)) return { error: "Le scouting n'est pas déverrouillé pour toi pendant ce cours." };
  const a = String(input.playerAId ?? ""), b = String(input.playerBId ?? "");
  if (!a || !b || a === b) return { error: "Choisis les deux joueurs observés." };
  if (!c.staff && (a === c.userId || b === c.userId)) return { error: "Tu joues ce match : un autre élève doit te scouter." };
  const roster = await rosterIds(c);
  if (!roster.has(a) || !roster.has(b)) return { error: notFound(c) };
  const role: BmRole = c.staff ? "STAFF" : "REFEREE";
  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId: c.session!.id, playerAId: a, playerBId: b, createdById: c.userId, tournamentId: null });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: c.session!.id, kind: "SCOUTING", authorId: c.userId, role, sets: null, at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: c.session!.id, kind: "LIVE", authorId: c.userId, role, sets: [[0, 0]], at: Temporal.Now.instant() });
    return m;
  });
  done(c.session.id);
  return { ok: true, matchId: match.id, sets: [[0, 0]] };
}

// ===== Scouting des COUPS (etape 2, 26/11 soir ; regles : src/lib/badminton-strokes.ts) =====
// Un scout suit UN joueur pendant son match (« un scout par joueur ») : une observation (ni ELO, ni tournoi) dont la ligne
// SCOUTING dit quel joueur. Deux scouts ne suivent jamais le meme joueur dans le meme match en meme temps.
export async function startStrokeScoutAction(sessionId: string, input: { playerAId: string; playerBId: string; playerId: string }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (c.free || !c.session) return { error: "Le scouting se fait pendant un cours." };
  if (!c.staff && !scoutUnlocked(readScoutConfig(c.session.settings), c.userId)) return { error: "Le scouting n'est pas déverrouillé pour toi pendant ce cours." };
  const a = String(input.playerAId ?? ""), b = String(input.playerBId ?? ""), p = String(input.playerId ?? "");
  if (!a || !b || a === b || (p !== a && p !== b)) return { error: "Choisis le match et le joueur à observer." };
  if (!c.staff && (a === c.userId || b === c.userId)) return { error: "Tu joues ce match : un autre élève doit te scouter." };
  const roster = await rosterIds(c);
  if (!roster.has(a) || !roster.has(b)) return { error: notFound(c) };
  const pair = [a, b].sort().join("|");
  const busy = (await loadScoutingMatches(c.session.id)).find((m) => matchState(m).status === "LIVE" && [m.playerAId, m.playerBId].sort().join("|") === pair && strokeScoutOf(m) === p && m.createdById !== c.userId);
  if (busy) return { error: "Un autre scout suit déjà ce joueur : prends l'autre joueur, ou un autre match." };
  const role: BmRole = c.staff ? "STAFF" : "REFEREE";
  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId: c.session!.id, playerAId: a, playerBId: b, createdById: c.userId, tournamentId: null });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: c.session!.id, kind: "SCOUTING", authorId: c.userId, role, sets: { mode: "STROKES", player: p }, at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: c.session!.id, kind: "LIVE", authorId: c.userId, role, sets: [[0, 0]], at: Temporal.Now.instant() });
    return m;
  });
  done(c.session.id);
  return { ok: true, matchId: match.id };
}
// Un coup vu : { stroke, out } ; il part tout de suite (l'eleve peut fermer et reprendre).
export async function strokeTapAction(matchId: string, raw: unknown): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  const p = strokeScoutOf(x.m);
  if (!p) return { error: "Ce n'est pas un scouting des coups." };
  const tap = readStrokeTap(raw);
  if (!tap) return { error: "Coup illisible." };
  const eventId = await addEventData(x.m.id, x.m.sessionId, "STROKE", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", tap, p);
  return { ok: true, eventId };
}
// Plusieurs coups d'un coup (26/11 soir : un echange va vite, les touchers s'enchainent) : le telephone envoie les coups
// pas encore partis et les annulations en UNE fois ; il recoit les lignes creees (dans l'ordre), pour les annuler ensuite.
export async function strokeBatchAction(matchId: string, input: { add: { k: number; stroke: string; out: number }[]; undo: string[] }): Promise<{ error: string } | { ok: true; ids: Record<number, string> }> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  const p = strokeScoutOf(x.m);
  if (!p) return { error: "Ce n'est pas un scouting des coups." };
  const role = x.c.staff ? "STAFF" : "REFEREE";
  const ids: Record<number, string> = {};
  for (const a of (input.add ?? []).slice(0, 200)) {
    const tap = readStrokeTap(a);
    if (tap && Number.isInteger(a.k)) ids[a.k] = await addEventData(x.m.id, x.m.sessionId, "STROKE", x.c.userId, role, tap, p);
  }
  const undone = undoneRallies(x.m.events);
  for (const id of [...new Set(input.undo ?? [])].slice(0, 200)) {
    if (x.m.events.some((e) => e.id === id && e.kind === "STROKE") && !undone.has(id)) await addEventData(x.m.id, x.m.sessionId, "UNRALLY", x.c.userId, role, null, id);
  }
  return { ok: true, ids };
}

// Fin du scouting des coups : l'observation n'est plus « en cours » (la fiche des coups les plus utilises est a part).
export async function endStrokeScoutAction(matchId: string): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  if (!strokeScoutOf(x.m)) return { error: "Ce n'est pas un scouting des coups." };
  await addEvent(x.m.id, x.m.sessionId, "SCORE", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", [[0, 0]]);
  done(x.m.sessionId);
  return { ok: true };
}

export async function startLiveMatchAction(sessionId: string, input: { playerAId: string; playerBId: string; force?: boolean; witnessIds?: string[] }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  const a = String(input.playerAId ?? "");
  const b = String(input.playerBId ?? "");
  if (!a || !b) return { error: "Choisis les deux joueurs." };
  if (a === b) return { error: "Un match se joue à deux : choisis deux élèves différents." };
  if (!c.staff && (a === c.userId || b === c.userId)) return { error: "Tu joues ce match : tu ne peux pas l'arbitrer." };
  const roster = await rosterIds(c);
  if (!roster.has(a) || !roster.has(b)) return { error: notFound(c) };
  const role: BmRole = c.staff ? "STAFF" : "REFEREE";
  const all = await loadMatches(sessionId);
  const repeat = role === "REFEREE" && !!recentDuel(all, a, b, Date.now());
  if (!input.force) {
    const twin = await twinOf(all, a, b, true, role === "REFEREE");
    if (twin) return { duplicate: twin };
  }
  const sid = dbSession(c);
  const tour = await tournamentFor(c, a, b);
  const k = await constraintsFor(c, a, b, tour, all); // handicap et mises (26/11 soir)
  const start: BmSet[] = [tour?.start ?? k.head ?? [0, 0]];
  const theme = c.session ? sessionTheme(c.session.settings) : null; // match a theme de la seance (24/11)
  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId: sid, playerAId: a, playerBId: b, createdById: c.userId, tournamentId: tour?.id ?? null });
    if (theme) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "THEME", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(theme)), at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    if (k.handicap) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "HANDICAP", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(k.handicap)), at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    if (k.bets) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "BET", authorId: c.userId, role, sets: { a: k.bets[0], b: k.bets[1] }, at: Temporal.Now.instant().subtract({ milliseconds: 1 }) });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "LIVE", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(start)), at: Temporal.Now.instant() });
    if (repeat) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "REMATCH", authorId: c.userId, role, sets: null, at: Temporal.Now.instant().add({ milliseconds: 1 }) });
    return m;
  });
  const err = await askWitnesses(c, match.id, a, b, role, input.witnessIds);
  done(sid);
  return err ? { error: `Match ouvert, mais : ${err}` } : { ok: true, matchId: match.id, sets: start, theme, ...(k.head ? { head: k.head } : {}), bets: k.bets, ...(tour ? { target: tour.points, rule: { deuce: tour.deuce, cap: tour.cap, sets: tour.sets, ...(tour.start ? { head: tour.start } : {}), ...(tour.endsAt ? { endsAt: tour.endsAt } : {}) } } : {}) };
}

async function liveCtx(matchId: string): Promise<{ error: string } | MatchCtx> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  if (x.st.status !== "LIVE") return { error: x.st.status === "CANCELLED" ? "Ce match a été annulé." : "Ce match n'est plus en direct : il est déjà terminé." };
  if (!x.c.staff && x.c.userId !== x.m.createdById) return { error: "Seul l'arbitre de ce match encode ses points." };
  return x;
}

// Un appui sur + ou − : la nouvelle photo du score (points de A puis de B, set par set).
export async function liveScoreAction(matchId: string, rawSets: BmSet[]): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  const sets = readSets(rawSets);
  const bad = sets ? checkLiveSets(sets) : "Score illisible.";
  if (bad || !sets) return { error: bad ?? "Score illisible." };
  if (sameSets(x.st.sets, sets)) return { ok: true };
  await addEvent(x.m.id, x.m.sessionId, "LIVE", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", sets);
  return { ok: true };
}

// « Fin du match » : le score final de l'arbitre (les sets restes a 0-0 sont retires), valide d'office.
export async function finishLiveMatchAction(matchId: string, rawSets: BmSet[]): Promise<BmResult> {
  const x = await liveCtx(matchId);
  if ("error" in x) return x;
  const raw = readSets(rawSets);
  if (!raw) return { error: "Score illisible." };
  const sets = trimLiveSets(raw);
  const bad = checkSets(sets);
  if (bad) return { error: bad };
  await addEvent(x.m.id, x.m.sessionId, "SCORE", x.c.userId, x.c.staff ? "STAFF" : "REFEREE", sets);
  done(x.m.sessionId);
  return { ok: true };
}
