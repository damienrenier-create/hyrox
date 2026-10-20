// Badminton (Sartay 20/10) : lecture des matchs d'une seance et regles d'acces, cote serveur. Voir src/lib/badminton.ts.
import { db } from "@/lib/db";
import { memberNames } from "@/lib/staff-names";
import { teacherNameById } from "@/lib/staff";
import { readSessionClasses, readSessionSex } from "@/lib/session-roles";
import { isSessionOpen, toMs } from "@/lib/scheduling";
import { readKind, readRole, readSets, type BmMatch } from "@/lib/badminton";

export const BM_STAFF_ROLES = ["MASTER_ADMIN", "ADMIN", "GREFFIER"];
// Apres la fin de la seance, un eleve peut encore signer ou corriger ses matchs pendant ce delai.
export const BM_AFTER_MS = 24 * 3600_000;

export type BmPerson = { id: string; name: string; firstName: string; lastName: string; className: string | null; sex: string | null; staff: boolean };
type SessionLike = { id: string; wodType: string; settings?: unknown; isActive: boolean; opensAt?: unknown | null; closesAt?: unknown | null; raceEndedAt?: unknown | null; createdAt: unknown; deletedAt?: unknown | null };

export async function loadMatches(sessionId: string): Promise<BmMatch[]> {
  const [rows, events] = await Promise.all([
    db.orm.public.BadmintonMatch.where({ sessionId }).all(),
    db.orm.public.BadmintonEvent.where({ sessionId }).all(),
  ]);
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
          return kind ? [{ id: e.id, kind, sets: readSets(e.sets), authorId: e.authorId, role: readRole(e.role), at: toMs(e.at) }] : [];
        }),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
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
  const end = session.closesAt ? toMs(session.closesAt) : session.raceEndedAt ? toMs(session.raceEndedAt) : toMs(session.createdAt) + 12 * 3600_000;
  return nowMs < end + BM_AFTER_MS;
}
