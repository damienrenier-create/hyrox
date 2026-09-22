import { db } from "@/lib/db";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { isQualityCode, type QualityCode } from "@/lib/wod-engines/core/quality";
import { wodLabel } from "@/lib/student-sessions";

// Consultation des auto-evaluations : chronologique par defaut (la plus recente en haut), avec filtres
// (seance, classe, mot-cle, niveau atteint par critere), tris et pagination.

export const PAGE_SIZE = 30;

export type SelfEvalRow = {
  key: string;
  studentId: string;
  firstName: string;
  lastName: string;
  className: string;
  teamName: string;
  sessionId: string;
  sessionLabel: string;
  sessionDate: string;
  answers: Record<string, string>;
  submittedAt: string;
  submittedAtMs: number;
};

export type SelfEvalSort = "recent" | "ancien" | "prenom" | "nom" | "classe";

export type SelfEvalFilters = {
  sessionId?: string; // vide = toutes les seances
  className?: string;
  query?: string; // sous-chaine dans le prenom OU le nom (« max » -> Maxime, Lemax…)
  levels?: Partial<Record<string, QualityCode>>; // criterionId -> niveau exige
  sort?: SelfEvalSort;
  page?: number;
};

export type SelfEvalResult = {
  rows: SelfEvalRow[]; // page courante uniquement
  total: number; // apres filtrage
  totalAll: number; // toutes auto-evaluations confondues
  page: number;
  pages: number;
  participants: number | null; // participants encodes (seulement quand une seance est choisie)
};

export async function querySelfEvaluations(f: SelfEvalFilters): Promise<SelfEvalResult> {
  const evals = f.sessionId
    ? await db.orm.public.SelfEvaluation.where({ sessionId: f.sessionId }).all()
    : await db.orm.public.SelfEvaluation.where({}).all();

  // Contexte (eleves, seances, equipes) charge une fois, pas une requete par ligne.
  const [students, sessions] = await Promise.all([
    db.orm.public.User.where({ role: "STUDENT" }).all(),
    db.orm.public.Session.where({}).all(),
  ]);
  const studentById = new Map(students.map((u) => [u.id, u]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const sessionIds = [...new Set(evals.map((e) => e.sessionId))];
  const teamNameOf = new Map<string, string>(); // `${sessionId}_${studentId}` -> nom d'equipe
  let participants: number | null = null;
  for (const sid of sessionIds) {
    const teams = await db.orm.public.Team.where({ sessionId: sid }).all();
    const members = await Promise.all(teams.map((t) => db.orm.public.TeamMember.where({ teamId: t.id }).all()));
    teams.forEach((t, i) => members[i].forEach((m) => teamNameOf.set(`${sid}_${m.userId}`, t.name)));
    if (f.sessionId === sid) participants = members.reduce((n, list) => n + list.length, 0);
  }

  const all: SelfEvalRow[] = evals.map((e) => {
    const u = studentById.get(e.studentId);
    const s = sessionById.get(e.sessionId);
    const at = String(e.submittedAt);
    return {
      key: `${e.sessionId}_${e.studentId}`,
      studentId: e.studentId,
      firstName: u?.firstName ?? "",
      lastName: u?.lastName ?? "",
      className: u?.className ?? "",
      teamName: teamNameOf.get(`${e.sessionId}_${e.studentId}`) ?? "—",
      sessionId: e.sessionId,
      sessionLabel: s ? s.label ?? wodLabel(s.wodType) : "—",
      sessionDate: s ? String(s.createdAt) : at,
      answers: (e.answers as Record<string, string>) ?? {},
      submittedAt: at,
      submittedAtMs: new Date(at).getTime(),
    };
  });

  const q = (f.query ?? "").trim().toLowerCase();
  const levels = Object.entries(f.levels ?? {}).filter(([, v]) => v && isQualityCode(v)) as [string, QualityCode][];

  const filtered = all.filter((r) => {
    if (f.className && r.className !== f.className) return false;
    // Recherche par sous-chaine (et non par prefixe) : « max » trouve Maxime ET Lemax.
    if (q && !`${r.firstName} ${r.lastName}`.toLowerCase().includes(q) && !`${r.lastName} ${r.firstName}`.toLowerCase().includes(q)) return false;
    for (const [criterionId, level] of levels) if (r.answers[criterionId] !== level) return false;
    return true;
  });

  const sort = f.sort ?? "recent";
  const byName = (a: SelfEvalRow, b: SelfEvalRow) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  filtered.sort((a, b) => {
    switch (sort) {
      case "ancien":
        return a.submittedAtMs - b.submittedAtMs;
      case "prenom":
        return a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
      case "nom":
        return byName(a, b);
      case "classe":
        return a.className.localeCompare(b.className) || byName(a, b);
      default:
        return b.submittedAtMs - a.submittedAtMs; // la plus recente en haut
    }
  });

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  return {
    rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: filtered.length,
    totalAll: all.length,
    page,
    pages,
    participants,
  };
}

// Lit les filtres de niveau depuis l'URL : ?c_engagement=TB&c_technique=B
export function readLevelParams(sp: Record<string, string | string[] | undefined>): Partial<Record<string, QualityCode>> {
  const out: Partial<Record<string, QualityCode>> = {};
  for (const c of SELF_EVAL_CRITERIA) {
    const v = sp[`c_${c.id}`];
    const s = Array.isArray(v) ? v[0] : v;
    if (s && isQualityCode(s)) out[c.id] = s;
  }
  return out;
}
