"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { BM_FREE, BM_WITNESSES_NEEDED, mustSign, recentDuel, recentTwin, checkLiveSets, checkSets, isOfficial, matchState, readSets, sameSets, setsText, trimLiveSets, type BmKind, type BmRole, type BmSet } from "@/lib/badminton";
import { BM_STAFF_ROLES, activeTournament, loadTournamentMatches, badmintonRoster, freeRoster, loadEloBoard, loadMatch, loadMatches, loadTournaments, peopleOf, pupilWindowOpen, studentInSession } from "@/lib/badminton-server";
import { TOUR_KINDS, handicapOf, makePlayers, pendingPairing, readTourKind, readTourSettings } from "@/lib/badminton-tournament";
import { ELO_START } from "@/lib/badminton-elo";
import { isTestClass } from "@/lib/session-roles";
import { toMs } from "@/lib/scheduling";

// Badminton (Sartay 20/10) : chaque action AJOUTE une ligne au journal du match (BadmintonEvent), rien n'est jamais
// efface ni reecrit ; l'etat du match se relit sur ce journal (src/lib/badminton.ts). Un eleve n'agit que sur ses matchs
// (ou ceux qu'il a arbitres), pendant la seance et jusqu'a 24 h apres ; un prof partout et tout le temps.
// Matchs LIBRES (03/11) : sessionId = BM_FREE dans les actions, null en base ; a toute heure, entre toutes les classes ;
// officiels une fois attestes par 2 autres eleves (ou valides par un prof).

// `sets` (arbitrage en direct d'un match a handicap) : le score de depart, avec les points d'avance.
export type BmResult = { error: string } | { ok: true; matchId?: string; sets?: BmSet[] } | { duplicate: { matchId: string; text: string } };
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

function done(sessionId: string | null) {
  revalidatePath(`/eleve/badminton/${sessionId ?? BM_FREE}`);
  revalidatePath("/admin/badminton");
}

// Tournoi en cours de la seance (09/11) : un match entre deux joueurs qui doivent s'y affronter lui est rattache.
// Championnat a handicap : le match part avec les points d'avance du moins bien classe ([a, b]).
async function tournamentFor(c: Ctx, a: string, b: string): Promise<{ id: string; start: BmSet | null } | null> {
  if (!c.session) return null;
  const t = activeTournament(await loadTournaments(c.session.id));
  if (!t || !pendingPairing(t.kind, t.players, await loadTournamentMatches(t.id), a, b)) return null;
  if (t.kind !== "HANDICAP") return { id: t.id, start: null };
  const elo = (id: string) => t.players.find((p) => p.studentId === id)?.elo ?? 0;
  return { id: t.id, start: handicapOf(elo(a), elo(b), t.settings) };
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
  const tournamentId = (await tournamentFor(c, a, b))?.id ?? null;
  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId: sid, playerAId: a, playerBId: b, createdById: c.userId, tournamentId });
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
export async function createTournamentAction(sessionId: string, input: { kind: string; playerIds: string[]; poolSize: number; sets: number; points: number; eloPerPoint?: number }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  if (!c.staff) return { error: "Réservé aux profs." };
  if (!c.session) return { error: "Un tournoi se lance dans une séance." };
  if (activeTournament(await loadTournaments(sessionId))) return { error: "Un tournoi est déjà en cours dans cette séance : clos-le d'abord." };
  const kind = readTourKind(input.kind);
  const settings = readTourSettings({ sets: input.sets, points: input.points, poolSize: input.poolSize, eloPerPoint: input.eloPerPoint }, kind);
  const roster = new Set((await badmintonRoster(c.session)).filter((p) => !p.staff).map((p) => p.id));
  const ids = [...new Set((input.playerIds ?? []).map(String))].filter((id) => roster.has(id));
  if (ids.length < 2) return { error: "Choisis au moins 2 participants." };
  const board = await loadEloBoard();
  const players = makePlayers(kind, ids.map((id) => ({ id, elo: board.entries.get(id)?.rating ?? ELO_START })), settings);
  const day = new Date().toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });
  const t = await db.transaction(async (tx) => {
    const t = await tx.orm.public.BadmintonTournament.create({ sessionId, kind, label: `${TOUR_KINDS.find((k) => k.id === kind)!.name} du ${day}`, settings, createdById: c.userId });
    for (const p of players) await tx.orm.public.BadmintonTournamentPlayer.create({ tournamentId: t.id, studentId: p.studentId, pool: p.pool, seed: p.seed, elo: p.elo });
    return t;
  });
  done(sessionId);
  return { ok: true, matchId: t.id };
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
    return `${n}|${s?.isActive ? 1 : 0}|${s?.closesAt ? toMs(s.closesAt) : 0}|${tours.length}.${tours.filter((t) => t.cancelledAt).length}`;
  } catch {
    return "";
  }
}

// ===== Arbitrage en direct (Sartay 03/11 : « encoder les points au fur et a mesure avec un petit plus et un petit moins,
// pour ne pas devoir ecrire le chiffre a chaque fois tout en les poussant a suivre le match ») =====
// Un eleve qui NE JOUE PAS le match (ou un prof) l'ouvre ; chaque appui envoie la photo du score (ligne LIVE) ; « Fin du
// match » l'enregistre (ligne SCORE de l'arbitre, validee d'office).
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
  const start: BmSet[] = [tour?.start ?? [0, 0]];
  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId: sid, playerAId: a, playerBId: b, createdById: c.userId, tournamentId: tour?.id ?? null });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "LIVE", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(start)), at: Temporal.Now.instant() });
    if (repeat) await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId: sid, kind: "REMATCH", authorId: c.userId, role, sets: null, at: Temporal.Now.instant().add({ milliseconds: 1 }) });
    return m;
  });
  const err = await askWitnesses(c, match.id, a, b, role, input.witnessIds);
  done(sid);
  return err ? { error: `Match ouvert, mais : ${err}` } : { ok: true, matchId: match.id, sets: start };
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
