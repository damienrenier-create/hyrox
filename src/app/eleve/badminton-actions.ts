"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { inPreview, PREVIEW_READ_ONLY } from "@/lib/preview";
import { BM_DUPLICATE_MS, checkSets, matchState, readSets, sameSets, setsText, type BmKind, type BmRole, type BmSet } from "@/lib/badminton";
import { BM_STAFF_ROLES, badmintonRoster, loadMatches, peopleOf, pupilWindowOpen, studentInSession } from "@/lib/badminton-server";
import { toMs } from "@/lib/scheduling";

// Badminton (Sartay 20/10) : chaque action AJOUTE une ligne au journal du match (BadmintonEvent), rien n'est jamais
// efface ni reecrit ; l'etat du match se relit sur ce journal (src/lib/badminton.ts). Un eleve n'agit que sur ses matchs
// (ou ceux qu'il a arbitres), pendant la seance et jusqu'a 24 h apres ; un prof partout et tout le temps.

export type BmResult = { error: string } | { ok: true; matchId?: string } | { duplicate: { matchId: string; text: string } };
type Ctx = { userId: string; staff: boolean; session: NonNullable<Awaited<ReturnType<typeof sessionOf>>> };

const sessionOf = (id: string) => db.orm.public.Session.where({ id }).first();

async function context(sessionId: string): Promise<{ error: string } | Ctx> {
  const user = await getSession();
  if (!user) return { error: "Connecte-toi d'abord." };
  if (await inPreview()) return { error: PREVIEW_READ_ONLY };
  const session = await sessionOf(sessionId);
  if (!session || session.deletedAt || session.wodType !== "BADMINTON") return { error: "Séance introuvable." };
  const staff = BM_STAFF_ROLES.includes(user.role);
  if (!staff) {
    const me = await db.orm.public.User.where({ id: user.id }).first();
    if (!me || !(await studentInSession(session, me.id, me.className ?? null))) return { error: "Cette séance n'est pas celle de ta classe." };
    if (!pupilWindowOpen(session)) return { error: "La séance est terminée depuis plus de 24 h : demande à ton prof." };
  }
  return { userId: user.id, staff, session };
}

async function addEvent(matchId: string, sessionId: string, kind: BmKind, authorId: string, role: BmRole, sets: BmSet[] | null) {
  await db.orm.public.BadmintonEvent.create({ matchId, sessionId, kind, authorId, role, sets: sets ? JSON.parse(JSON.stringify(sets)) : null, at: Temporal.Now.instant() });
}

function done(sessionId: string) {
  revalidatePath(`/eleve/badminton/${sessionId}`);
  revalidatePath("/admin/badminton");
}

// Nouveau match. Un eleve qui l'a JOUE : playerAId absent (ou lui-meme), playerBId = son adversaire. Un eleve ARBITRE :
// les deux joueurs, aucun des deux n'est lui. Un prof : les deux joueurs. `sets` = points de A puis de B.
export async function recordMatchAction(sessionId: string, input: { playerAId?: string | null; playerBId: string; sets: BmSet[]; force?: boolean }): Promise<BmResult> {
  const c = await context(sessionId);
  if ("error" in c) return c;
  const asPlayer = !c.staff && (!input.playerAId || input.playerAId === c.userId);
  const role: BmRole = c.staff ? "STAFF" : asPlayer ? "PLAYER" : "REFEREE";
  const a = asPlayer ? c.userId : String(input.playerAId ?? "");
  const b = String(input.playerBId ?? "");
  if (!a || !b) return { error: role === "PLAYER" ? "Choisis ton adversaire." : "Choisis les deux joueurs." };
  if (a === b) return { error: "Un match se joue à deux : choisis deux élèves différents." };
  if (role === "REFEREE" && (a === c.userId || b === c.userId)) return { error: "Tu joues ce match : encode-le comme joueur, pas comme arbitre." };
  const roster = new Set((await badmintonRoster(c.session)).map((p) => p.id));
  if (!roster.has(b) || (role !== "PLAYER" && !roster.has(a))) return { error: "Cet élève n'est pas dans cette séance." };
  const sets = readSets(input.sets);
  const bad = sets ? checkSets(sets) : "Score illisible.";
  if (bad || !sets) return { error: bad ?? "Score illisible." };

  // Le meme duel encode il y a peu (par l'adversaire ou un arbitre) : on le signale plutot que d'en creer un deuxieme.
  if (!input.force) {
    const now = Date.now();
    const twin = (await loadMatches(sessionId)).find((m) => ((m.playerAId === a && m.playerBId === b) || (m.playerAId === b && m.playerBId === a)) && now - m.createdAt < BM_DUPLICATE_MS && matchState(m).status !== "CANCELLED");
    if (twin) {
      const st = matchState(twin);
      const people = await peopleOf([twin]);
      const nm = (id: string) => people.get(id)?.name ?? "?";
      const by = st.scoreBy ? nm(st.scoreBy.id) : nm(twin.createdById);
      const at = new Date(st.scoreBy?.at ?? twin.createdAt).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
      return { duplicate: { matchId: twin.id, text: `${by} a déjà encodé ce match à ${at} : ${nm(twin.playerAId)} ${setsText(st.sets)} ${nm(twin.playerBId)}.` } };
    }
  }

  const match = await db.transaction(async (tx) => {
    const m = await tx.orm.public.BadmintonMatch.create({ sessionId, playerAId: a, playerBId: b, createdById: c.userId });
    await tx.orm.public.BadmintonEvent.create({ matchId: m.id, sessionId, kind: "SCORE", authorId: c.userId, role, sets: JSON.parse(JSON.stringify(sets)), at: Temporal.Now.instant() });
    return m;
  });
  done(sessionId);
  return { ok: true, matchId: match.id };
}

type MatchCtx = { c: Ctx; m: Awaited<ReturnType<typeof loadMatches>>[number]; st: ReturnType<typeof matchState> };
async function matchCtx(matchId: string): Promise<{ error: string } | MatchCtx> {
  const row = await db.orm.public.BadmintonMatch.where({ id: matchId }).first();
  if (!row) return { error: "Ce match n'existe plus." };
  const c = await context(row.sessionId);
  if ("error" in c) return c;
  const m = (await loadMatches(row.sessionId)).find((x) => x.id === matchId);
  if (!m) return { error: "Ce match n'existe plus." };
  return { c, m, st: matchState(m) };
}

// Signer le score : le joueur qui ne l'a pas encode (ou un prof).
export async function validateMatchAction(matchId: string): Promise<BmResult> {
  const x = await matchCtx(matchId);
  if ("error" in x) return x;
  const { c, m, st } = x;
  if (st.status === "CANCELLED") return { error: "Ce match a été annulé." };
  if (st.status === "VALIDATED") return { ok: true };
  if (!c.staff) {
    if (st.status !== "PENDING" || st.waitingFor !== c.userId) return { error: "C'est à ton adversaire de signer ce score, pas à toi." };
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
  if (sameSets(st.sets, sets) && st.status !== "CANCELLED") {
    if (st.waitingFor === c.userId || c.staff) {
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

// « Pouls » des ecrans badminton : le nombre de lignes du journal de la seance (une saisie, une signature… le change).
export async function badmintonPulseAction(sessionId: string): Promise<string> {
  const user = await getSession();
  if (!user) return "";
  try {
    const n = (await db.orm.public.BadmintonEvent.where({ sessionId }).aggregate((a) => ({ n: a.count() }))).n;
    const s = await sessionOf(sessionId);
    return `${n}|${s?.isActive ? 1 : 0}|${s?.closesAt ? toMs(s.closesAt) : 0}`;
  } catch {
    return "";
  }
}
