import { db } from "@/lib/db";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { gradeOfCode, isQualityCode } from "@/lib/wod-engines/core/quality";
import { readSessionClasses } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";

// Carnet de cotes : pour un groupe de classes, la note que chaque eleve s'est donnee a chaque WOD via son
// auto-evaluation. Une appreciation vaut une note sur 5 (bareme dans core/quality.ts), la note du WOD est la
// moyenne des criteres de la grille officielle. « Ma forme du jour » n'est pas comptee : elle contextualise,
// elle ne juge pas (voir core/self-eval.ts) ; elle reste consultable en info-bulle.

export const UNGRADED_CRITERIA = new Set(["forme"]);
export const GRADED_CRITERIA = SELF_EVAL_CRITERIA.filter((c) => !UNGRADED_CRITERIA.has(c.id));

export function gradeOfAnswers(answers: Record<string, unknown> | null | undefined): number | null {
  if (!answers) return null;
  const vals: number[] = [];
  for (const c of GRADED_CRITERIA) {
    const code = answers[c.id];
    if (!isQualityCode(code)) continue;
    const g = gradeOfCode(code);
    if (g !== null) vals.push(g);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// « 3,5 » — virgule decimale, une decimale, tiret si pas de note.
export function fmtGrade(g: number | null): string {
  return g === null ? "—" : (Math.round(g * 10) / 10).toFixed(1).replace(".", ",");
}

// Couleur d'une note, calee sur les couleurs de l'echelle (rouge → bleu).
export function gradeTone(g: number | null): string {
  if (g === null) return "text-ink-3";
  if (g < 1.5) return "text-red-600";
  if (g < 3) return "text-orange-600";
  if (g < 3.5) return "text-amber-600";
  if (g < 4) return "text-lime-700";
  if (g < 4.5) return "text-emerald-600";
  return "text-sky-600";
}

export type CarnetColumn = { sessionId: string; label: string; dateMs: number; classes: string[] };
export type CarnetCell = {
  participated: boolean; // encode dans une equipe de la seance
  submitted: boolean; // auto-evaluation rendue
  grade: number | null;
  codes: Record<string, string>; // criterionId -> code, pour l'info-bulle
  forme: string | null;
  reviewGrade: number | null; // note calculee de la meme facon sur la grille du prof, si elle existe
};
export type CarnetRow = {
  studentId: string;
  firstName: string;
  lastName: string;
  className: string;
  cells: Record<string, CarnetCell>;
  mean: number | null;
  graded: number; // nombre de WOD notes
};
export type Carnet = {
  classes: string[];
  columns: CarnetColumn[];
  rows: CarnetRow[];
  columnMeans: Record<string, number | null>;
  overallMean: number | null;
};

export async function buildCarnet(classes: string[]): Promise<Carnet> {
  const empty: Carnet = { classes, columns: [], rows: [], columnMeans: {}, overallMean: null };
  if (!classes.length) return empty;
  const wanted = new Set(classes);

  const students = (await db.orm.public.User.where({ role: "STUDENT" }).all()).filter((u) => u.className && wanted.has(u.className));
  if (!students.length) return empty;
  const ids = students.map((s) => s.id);

  const [evals, memberships, reviews, sessions] = await Promise.all([
    db.orm.public.SelfEvaluation.where((e) => e.studentId.in(ids)).all(),
    db.orm.public.TeamMember.where((m) => m.userId.in(ids)).all(),
    db.orm.public.SelfEvalReview.where((r) => r.studentId.in(ids)).all(),
    db.orm.public.Session.where({}).all(),
  ]);
  const teamIds = [...new Set(memberships.map((m) => m.teamId))];
  const teams = teamIds.length ? await db.orm.public.Team.where((t) => t.id.in(teamIds)).all() : [];
  const sessionOfTeam = new Map(teams.map((t) => [t.id, t.sessionId]));

  // Colonnes = les seances ou ces classes etaient annoncees, ou ou un de leurs eleves a joue / s'est evalue.
  const candidate = new Set<string>();
  for (const s of sessions) if (readSessionClasses(s.settings).some((c) => wanted.has(c))) candidate.add(s.id);
  for (const e of evals) candidate.add(e.sessionId);
  for (const m of memberships) {
    const sid = sessionOfTeam.get(m.teamId);
    if (sid) candidate.add(sid);
  }
  const columns: CarnetColumn[] = sessions
    .filter((s) => candidate.has(s.id))
    .map((s) => ({ sessionId: s.id, label: s.label ?? wodLabel(s.wodType), dateMs: new Date(String(s.createdAt)).getTime(), classes: readSessionClasses(s.settings) }))
    .sort((a, b) => a.dateMs - b.dateMs);

  const participated = new Set<string>();
  for (const m of memberships) {
    const sid = sessionOfTeam.get(m.teamId);
    if (sid) participated.add(`${sid}_${m.userId}`);
  }
  const evalOf = new Map(evals.map((e) => [`${e.sessionId}_${e.studentId}`, e]));
  const reviewOf = new Map(reviews.map((r) => [`${r.sessionId}_${r.studentId}`, r]));

  const rows: CarnetRow[] = students
    .map((u) => {
      const cells: Record<string, CarnetCell> = {};
      for (const col of columns) {
        const key = `${col.sessionId}_${u.id}`;
        const e = evalOf.get(key);
        const answers = (e?.answers as Record<string, unknown> | undefined) ?? undefined;
        const r = reviewOf.get(key);
        const codes: Record<string, string> = {};
        if (answers) for (const [k, v] of Object.entries(answers)) if (typeof v === "string") codes[k] = v;
        cells[col.sessionId] = {
          participated: participated.has(key),
          submitted: !!e,
          grade: gradeOfAnswers(answers),
          codes,
          forme: typeof answers?.forme === "string" ? (answers.forme as string) : null,
          reviewGrade: r ? gradeOfAnswers(r.answers as Record<string, unknown>) : null,
        };
      }
      const grades = columns.map((c) => cells[c.sessionId].grade);
      return {
        studentId: u.id,
        firstName: u.firstName ?? "",
        lastName: u.lastName ?? "",
        className: u.className ?? "",
        cells,
        mean: mean(grades),
        graded: grades.filter((g) => g !== null).length,
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className, "fr", { numeric: true }) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"));

  const columnMeans: Record<string, number | null> = {};
  for (const c of columns) columnMeans[c.sessionId] = mean(rows.map((r) => r.cells[c.sessionId].grade));
  const overallMean = mean(rows.map((r) => r.mean));
  return { classes, columns, rows, columnMeans, overallMean };
}

// Export tableur (separateur « ; », virgule decimale : s'ouvre proprement dans Excel en francais).
export function carnetCsv(carnet: Carnet): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const date = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
  const head = ["Classe", "Nom", "Prénom", ...carnet.columns.map((c) => `${c.label} ${date(c.dateMs)}`), "Moyenne", "WOD notés"];
  const lines = [head.map(esc).join(";")];
  for (const r of carnet.rows) {
    const cells = carnet.columns.map((c) => {
      const cell = r.cells[c.sessionId];
      return cell.grade !== null ? fmtGrade(cell.grade) : cell.participated ? "sans auto-éval" : "";
    });
    lines.push([r.className, r.lastName, r.firstName, ...cells, r.mean !== null ? fmtGrade(r.mean) : "", String(r.graded)].map(esc).join(";"));
  }
  lines.push(["", "Moyenne de la classe", "", ...carnet.columns.map((c) => fmtGrade(carnet.columnMeans[c.sessionId])), fmtGrade(carnet.overallMean), ""].map(esc).join(";"));
  return "﻿" + lines.join("\r\n");
}
