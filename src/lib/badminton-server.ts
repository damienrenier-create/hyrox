// Badminton (Sartay 20/10) : lecture des matchs d'une seance et regles d'acces, cote serveur. Voir src/lib/badminton.ts.
import { db } from "@/lib/db";
import { memberNames } from "@/lib/staff-names";
import { teacherNameById } from "@/lib/staff";
import { isTestClass, notDeleted, readSessionClasses, readSessionSex } from "@/lib/session-roles";
import { isSessionOpen, toMs } from "@/lib/scheduling";
import { BM_FREE, isOfficial, matchState, readKind, readRole, readSets, type BmMatch } from "@/lib/badminton";
import { computeElo, type EloEntry, type EloGame } from "@/lib/badminton-elo";
import { readGone, readLate, readTourKind, readTourSettings, type HandicapSample, type TourKind, type TourPlayer, type TourSettings } from "@/lib/badminton-tournament";

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

type MatchRow = { id: string; sessionId: string | null; playerAId: string; playerBId: string; createdById: string; createdAt: unknown; tournamentId?: string | null };
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
      tournamentId: m.tournamentId ?? null,
      events: events
        .filter((e) => e.matchId === m.id)
        .flatMap((e) => {
          const kind = readKind(e.kind);
          return kind ? [{ id: e.id, kind, sets: readSets(e.sets), authorId: e.authorId, role: readRole(e.role), at: toMs(e.at), targetId: e.targetId ?? null }] : [];
        }),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ===== Tournois (Sartay 09/11, regles dans src/lib/badminton-tournament.ts) =====
export type BmTournament = { id: string; sessionId: string | null; kind: TourKind; label: string; settings: TourSettings; createdAt: number; closedAt: number | null; players: TourPlayer[] };
// Les tournois d'une seance (`sessionId`), ou tous ceux qui ne sont pas clos (`null`, pour les continuer ailleurs).
export async function loadTournaments(sessionId: string | null): Promise<BmTournament[]> {
  const rows = sessionId ? await db.orm.public.BadmintonTournament.where({ sessionId }).all() : await db.orm.public.BadmintonTournament.where((t) => t.cancelledAt.isNull()).all();
  if (!rows.length) return [];
  const players = await db.orm.public.BadmintonTournamentPlayer.where((p) => p.tournamentId.in(rows.map((r) => r.id))).all();
  return rows
    .map((r) => ({
      id: r.id,
      sessionId: r.sessionId ?? null,
      kind: readTourKind(r.kind),
      label: r.label,
      settings: readTourSettings(r.settings, readTourKind(r.kind)),
      createdAt: toMs(r.createdAt),
      closedAt: r.cancelledAt ? toMs(r.cancelledAt) : null,
      players: players.filter((p) => p.tournamentId === r.id).map((p) => ({ studentId: p.studentId, pool: p.pool, seed: p.seed, elo: p.elo, ...(readLate(r.settings).includes(p.studentId) ? { late: true } : {}), ...(readGone(r.settings).includes(p.studentId) ? { gone: true } : {}) })),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
// Les matchs d'un tournoi, toutes seances confondues (un tournoi peut se continuer au cours suivant).
export async function loadTournamentMatches(tournamentId: string): Promise<BmMatch[]> {
  const rows = await db.orm.public.BadmintonMatch.where({ tournamentId }).all();
  if (!rows.length) return [];
  const events = await db.orm.public.BadmintonEvent.where((e) => e.matchId.in(rows.map((r) => r.id))).all();
  return toMatches(rows, events);
}
// Le tournoi en cours d'une seance (un seul a la fois) : le plus recent qui n'a pas ete clos.
export const activeTournament = (list: BmTournament[]): BmTournament | null => list.find((t) => !t.closedAt) ?? null;

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
  // Matchs d'un championnat a handicap : esperance ½ (voir badminton-elo.ts).
  const even = new Set((await db.orm.public.BadmintonTournament.where({ kind: "HANDICAP" }).all()).map((t) => t.id));
  const games: EloGame[] = [];
  for (const m of matches) {
    const st = matchState(m);
    if (!isOfficial(m, st) || test.has(m.playerAId) !== test.has(m.playerBId)) continue;
    games.push({ matchId: m.id, at: m.createdAt, a: m.playerAId, b: m.playerBId, sets: st.sets!, result: st.result!, even: !!m.tournamentId && even.has(m.tournamentId) });
  }
  return { entries: computeElo(games), people, test };
}

// Les sets joues (vraies classes) pour calculer le bareme du handicap : ecart d'ELO avant le match, ecart de points, longueur.
export function handicapSamples(board: EloBoard): HandicapSample[] {
  const seen = new Set<string>();
  const out: HandicapSample[] = [];
  for (const e of board.entries.values()) {
    if (board.test.has(e.id)) continue;
    for (const s of e.steps) {
      if (seen.has(s.matchId) || s.even) continue; // un set de championnat a handicap est fait pour finir a egalite : hors calcul
      seen.add(s.matchId);
      const os = board.entries.get(s.opponentId)?.steps.find((x) => x.matchId === s.matchId);
      if (!os) continue;
      for (const [x, y] of s.sets) out.push({ gap: s.before - os.before, margin: x - y, len: Math.max(x, y) });
    }
  }
  return out;
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
  return [
    ...students
      .filter((u) => u.className && isTestClass(u.className) === test)
      .map((u) => person(u, null))
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr")),
    ...(await teachersAsPlayers()),
  ];
}

// Les profs jouent aussi (Sartay 06/11 : « les profs doivent etre joignables et jouables dans n'importe quel match ») :
// ils sont dans toutes les listes de joueurs, seance ou match libre.
async function teachersAsPlayers(): Promise<BmPerson[]> {
  const [users, names] = await Promise.all([db.orm.public.User.where({}).all(), teacherNameById()]);
  return users.filter((u) => BM_TEACHER_ROLES.includes(u.role)).map((u) => person(u, names.get(u.id) ?? null)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
const BM_TEACHER_ROLES = ["MASTER_ADMIN", "ADMIN"];
// Une personne telle que les listes de choix l'affichent : un prof porte « prof » a la place d'une classe.
export const pickerRef = (p: BmPerson) => ({ id: p.id, name: p.name, className: p.staff ? "prof" : p.className });

// Onglet « Classement » de l'espace eleve : des que sa classe a eu une seance de badminton, ou qu'il a joue un match.
export async function badmintonTabVisible(userId: string, className: string | null): Promise<boolean> {
  const sessions = (await db.orm.public.Session.where({ wodType: "BADMINTON" }).all()).filter(notDeleted);
  if (!sessions.length) return false;
  if (className && sessions.some((s) => readSessionClasses(s.settings).includes(className))) return true;
  return !!(await db.orm.public.BadmintonMatch.where({ playerAId: userId }).first()) || !!(await db.orm.public.BadmintonMatch.where({ playerBId: userId }).first());
}

// Eleves de la seance : ceux de ses classes (et les 1P, souvent integres a d'autres classes, comme au greffier), du sexe
// de la seance si elle est garcons / filles (sexe inconnu : propose quand meme) ; puis les profs (06/11).
export async function badmintonRoster(session: SessionLike): Promise<BmPerson[]> {
  const classes = readSessionClasses(session.settings);
  const sex = readSessionSex(session.settings);
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  return [
    ...students
      .filter((u) => u.className && (classes.includes(u.className) || /^1p/i.test(u.className)) && (!sex || !u.sex || u.sex === sex))
      .map((u) => person(u, null))
      .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "", "fr", { numeric: true }) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr")),
    ...(await teachersAsPlayers()),
  ];
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
