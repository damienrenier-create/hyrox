// Badminton (Sartay 20/10) : lecture des matchs d'une seance et regles d'acces, cote serveur. Voir src/lib/badminton.ts.
import { db } from "@/lib/db";
import { memberNames } from "@/lib/staff-names";
import { teacherNameById } from "@/lib/staff";
import { isTestClass, notDeleted, readSessionClasses, readSessionSex } from "@/lib/session-roles";
import { isSessionOpen, toMs } from "@/lib/scheduling";
import { BM_FREE, isOfficial, matchState, readKind, readRole, readSets, type BmMatch } from "@/lib/badminton";
import { computeElo, type EloEntry, type EloGame } from "@/lib/badminton-elo";

export const BM_STAFF_ROLES = ["MASTER_ADMIN", "ADMIN", "GREFFIER"];
// Apres la fin de la seance, un eleve peut encore signer ou corriger ses matchs pendant ce delai.
export const BM_AFTER_MS = 24 * 3600_000;

export type BmPerson = { id: string; name: string; firstName: string; lastName: string; className: string | null; sex: string | null; staff: boolean };
type SessionLike = { id: string; wodType: string; settings?: unknown; isActive: boolean; opensAt?: unknown | null; closesAt?: unknown | null; raceEndedAt?: unknown | null; createdAt: unknown; deletedAt?: unknown | null };

// Les matchs d'une seance, ou tous les matchs libres (sessionId = BM_FREE).
export async function loadMatches(sessionId: string): Promise<BmMatch[]> {
  const free = sessionId === BM_FREE;
  const [rows, events] = await Promise.all([
    free ? db.orm.public.BadmintonMatch.where((m) => m.sessionId.isNull()).all() : db.orm.public.BadmintonMatch.where({ sessionId }).all(),
    free ? db.orm.public.BadmintonEvent.where((e) => e.sessionId.isNull()).all() : db.orm.public.BadmintonEvent.where({ sessionId }).all(),
  ]);
  return toMatches(rows, events);
}
// Un seul match et son journal.
export async function loadMatch(matchId: string): Promise<BmMatch | null> {
  const [rows, events] = await Promise.all([db.orm.public.BadmintonMatch.where({ id: matchId }).all(), db.orm.public.BadmintonEvent.where({ matchId }).all()]);
  return toMatches(rows, events)[0] ?? null;
}

type MatchRow = { id: string; sessionId: string | null; playerAId: string; playerBId: string; createdById: string; createdAt: unknown };
type EventRow = { id: string; matchId: string; kind: string; sets: unknown; authorId: string; role: string; at: unknown; targetId?: string | null };
function toMatches(rows: MatchRow[], events: EventRow[]): BmMatch[] {
  return rows
    .map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      playerAId: m.playerAId,
      playerBId: m.playerBId,
      createdById: m.createdById,
      createdAt: toMs(m.createdAt),
      events: events
        .filter((e) => e.matchId === m.id)
        .flatMap((e) => {
          const kind = readKind(e.kind);
          return kind ? [{ id: e.id, kind, sets: readSets(e.sets), authorId: e.authorId, role: readRole(e.role), at: toMs(e.at), targetId: e.targetId ?? null }] : [];
        }),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ===== Classement ELO (Sartay 03/11, regles dans src/lib/badminton-elo.ts) =====
// Tous les matchs de toutes les seances de badminton et les matchs libres officiels (inter-classes), recalcules a chaque
// affichage. La classe de test
// (7A) n'entre jamais dans les statistiques des vraies classes : ses eleves ont leur classement a part (pour les tests).
export type EloBoard = { entries: Map<string, EloEntry>; people: Map<string, BmPerson>; test: Set<string> };
export async function loadEloBoard(): Promise<EloBoard> {
  const sessions = (await db.orm.public.Session.where({ wodType: "BADMINTON" }).all()).filter(notDeleted);
  const ids = sessions.map((s) => s.id);
  const [rows, events, free] = await Promise.all([
    ids.length ? db.orm.public.BadmintonMatch.where((m) => m.sessionId.in(ids)).all() : Promise.resolve([]),
    ids.length ? db.orm.public.BadmintonEvent.where((e) => e.sessionId.in(ids)).all() : Promise.resolve([]),
    loadMatches(BM_FREE),
  ]);
  const matches = [...toMatches(rows, events), ...free];
  if (!matches.length) return { entries: new Map(), people: new Map(), test: new Set() };
  const people = await peopleOf(matches);
  const test = new Set([...people.values()].filter((p) => isTestClass(p.className)).map((p) => p.id));
  const games: EloGame[] = [];
  for (const m of matches) {
    const st = matchState(m);
    if (!isOfficial(m, st) || test.has(m.playerAId) !== test.has(m.playerBId)) continue;
    games.push({ matchId: m.id, at: m.createdAt, a: m.playerAId, b: m.playerBId, sets: st.sets!, result: st.result! });
  }
  return { entries: computeElo(games), people, test };
}

// Groupe de cours d'un eleve pour le classement : les classes (et le sexe, si la seance est garcons / filles) de sa
// derniere seance de badminton ; sinon sa classe seule.
export async function badmintonGroupOf(className: string | null): Promise<{ classes: string[]; sex: string | null }> {
  if (!className) return { classes: [], sex: null };
  const sessions = (await db.orm.public.Session.where({ wodType: "BADMINTON" }).all())
    .filter((s) => notDeleted(s) && readSessionClasses(s.settings).includes(className))
    .sort((a, b) => toMs(b.opensAt ?? b.createdAt) - toMs(a.opensAt ?? a.createdAt));
  return sessions[0] ? { classes: readSessionClasses(sessions[0].settings), sex: readSessionSex(sessions[0].settings) } : { classes: [className], sex: null };
}

// Matchs libres (03/11) : n'importe quel eleve, toutes classes ; les eleves de test (7A) entre eux seulement.
export async function freeRoster(test: boolean): Promise<BmPerson[]> {
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  return students
    .filter((u) => u.className && isTestClass(u.className) === test)
    .map((u) => person(u, null))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"));
}

// Onglet « Classement » de l'espace eleve : des que sa classe a eu une seance de badminton, ou qu'il a joue un match.
export async function badmintonTabVisible(userId: string, className: string | null): Promise<boolean> {
  const sessions = (await db.orm.public.Session.where({ wodType: "BADMINTON" }).all()).filter(notDeleted);
  if (!sessions.length) return false;
  if (className && sessions.some((s) => readSessionClasses(s.settings).includes(className))) return true;
  return !!(await db.orm.public.BadmintonMatch.where({ playerAId: userId }).first()) || !!(await db.orm.public.BadmintonMatch.where({ playerBId: userId }).first());
}

// Eleves de la seance : ceux de ses classes (et les 1P, souvent integres a d'autres classes, comme au greffier), du sexe
// de la seance si elle est garcons / filles (sexe inconnu : propose quand meme).
export async function badmintonRoster(session: SessionLike): Promise<BmPerson[]> {
  const classes = readSessionClasses(session.settings);
  const sex = readSessionSex(session.settings);
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  return students
    .filter((u) => u.className && (classes.includes(u.className) || /^1p/i.test(u.className)) && (!sex || !u.sex || u.sex === sex))
    .map((u) => person(u, null))
    .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "", "fr", { numeric: true }) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"));
}

type UserRow = { id: string; role: string; name: string; firstName?: string | null; lastName?: string | null; className?: string | null; sex?: string | null };
function person(u: UserRow, staffName: string | null): BmPerson {
  const n = memberNames(u as Parameters<typeof memberNames>[0]);
  const staff = u.role !== "STUDENT";
  return { id: u.id, name: staff ? staffName ?? u.name : `${n.firstName} ${n.lastName}`.trim() || u.name, firstName: n.firstName || u.name, lastName: n.lastName, className: staff ? null : u.className ?? null, sex: u.sex ?? null, staff };
}

// Noms de tous ceux qui apparaissent dans les matchs (joueurs, arbitres, profs).
export async function peopleOf(matches: BmMatch[], extra: string[] = []): Promise<Map<string, BmPerson>> {
  const ids = [...new Set([...extra, ...matches.flatMap((m) => [m.playerAId, m.playerBId, m.createdById, ...m.events.map((e) => e.authorId)])])];
  if (!ids.length) return new Map();
  const [users, teachers] = await Promise.all([db.orm.public.User.where((u) => u.id.in(ids)).all(), teacherNameById()]);
  return new Map(users.map((u) => [u.id, person(u, teachers.get(u.id) ?? null)]));
}

// Un eleve encode dans une seance de SA classe (ou il a deja un match) ; un prof partout.
export async function studentInSession(session: SessionLike, userId: string, className: string | null): Promise<boolean> {
  const classes = readSessionClasses(session.settings);
  if (className && (classes.includes(className) || /^1p/i.test(className))) return true;
  const mine = await db.orm.public.BadmintonMatch.where({ sessionId: session.id }).all();
  return mine.some((m) => m.playerAId === userId || m.playerBId === userId || m.createdById === userId);
}

// Fenetre d'ecriture d'un eleve : seance ouverte, ou terminee depuis moins de 24 h (signer apres la sonnerie).
export function pupilWindowOpen(session: SessionLike, nowMs = Date.now()): boolean {
  if (session.deletedAt) return false;
  if (isSessionOpen(session as Parameters<typeof isSessionOpen>[0], nowMs)) return true;
  if (session.opensAt && nowMs < toMs(session.opensAt)) return false;
  return nowMs < pupilWindowEnd(session);
}
// Fin de cette fenetre : 24 h apres la fin de la seance (aussi la fin de l'auto-evaluation badminton).
export function pupilWindowEnd(session: SessionLike): number {
  const end = session.closesAt ? toMs(session.closesAt) : session.raceEndedAt ? toMs(session.raceEndedAt) : toMs(session.createdAt) + 12 * 3600_000;
  return end + BM_AFTER_MS;
}
