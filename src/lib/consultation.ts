import { db } from "@/lib/db";
import { buildStandingsForSessions } from "@/lib/standings-batch";
import { isQualityCode, qualityCodeFromValue, type QualityCode } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { readSessionClasses } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import { toMs } from "@/lib/scheduling";

// Consultation des donnees evaluatives (admins) : une ligne = un eleve x une seance.
// Deux etages de filtrage. Les filtres de SEANCE (cycle, seance, periode) reduisent ce qu'on va
// chercher en base ; les filtres de LIGNE (classe, recherche, role, niveau d'auto-eval) s'appliquent
// ensuite en memoire, ce qui permet d'afficher « X lignes sur Y » sans requete supplementaire.
// Meme grammaire que /admin/auto-evaluations : chronologique par defaut, 30 par page.

export const PAGE_SIZE = 30;

export type ConsultationSort = "recent" | "ancien" | "nom" | "prenom" | "classe" | "rang";
export type ConsultationRole = "participant" | "arbitre";

export type ConsultationFilters = {
  cycleId?: string;
  sessionId?: string;
  className?: string;
  query?: string; // sous-chaine dans le prenom OU le nom (« max » -> Maxime ET Lemax)
  from?: string; // YYYY-MM-DD
  to?: string;
  role?: ConsultationRole;
  levels?: Partial<Record<string, QualityCode>>; // criterionId -> niveau exige en auto-evaluation
  sort?: ConsultationSort;
  page?: number;
};

export type ConsultationResult = {
  rows: ConsultationRow[]; // page courante
  all: ConsultationRow[]; // tout le resultat filtre (export CSV)
  total: number; // apres filtres de ligne
  totalAll: number; // avant filtres de ligne, sur les seances parcourues
  page: number;
  pages: number;
  sessionsScanned: number;
};

export type ConsultationRow = {
  studentId: string;
  lastName: string;
  firstName: string;
  className: string;
  sessionId: string;
  sessionLabel: string;
  sessionDate: string; // ISO
  cycleName: string;
  role: "participant" | "arbitre" | "participant+arbitre";
  refereeNote: string | null;
  teamName: string | null;
  rank: number | null;
  laps: number | null;
  lapsTotal: number | null;
  time: string | null;
  reps: number | null;
  cards: number | null;
  evalCount: number;
  evalMedianReps: number | null;
  evalQualities: string; // ex: "B,TB,S"
  selfEval: Record<string, string> | null;
  pirateScore: number | null;
};

export async function buildConsultation(f: ConsultationFilters): Promise<ConsultationResult> {
  let sessions = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all();
  if (f.sessionId) sessions = sessions.filter((s) => s.id === f.sessionId);
  if (f.cycleId) sessions = sessions.filter((s) => s.cycleId === f.cycleId);
  if (f.from) {
    const fromMs = new Date(`${f.from}T00:00:00+02:00`).getTime();
    sessions = sessions.filter((s) => toMs(s.createdAt) >= fromMs);
  }
  if (f.to) {
    const toMsV = new Date(`${f.to}T23:59:59+02:00`).getTime();
    sessions = sessions.filter((s) => toMs(s.createdAt) <= toMsV);
  }
  if (f.className) sessions = sessions.filter((s) => {
    const cls = readSessionClasses(s.settings);
    return cls.length === 0 || cls.includes(f.className!);
  });
  if (!f.sessionId && !f.from && !f.to && !f.cycleId) sessions = sessions.slice(0, 15); // garde-fou : 15 dernieres seances

  const q = (f.query ?? "").trim().toLowerCase();
  if (!sessions.length) return { rows: [], all: [], total: 0, totalAll: 0, page: 1, pages: 1, sessionsScanned: 0 };
  const ids = sessions.map((s) => s.id);

  // ===== Tout charge en requetes GROUPEES (.in) : avant, une cascade par seance / equipe / eleve
  // mettait ~14 s et ~520 allers-retours pour 13 seances. =====
  const [cycles, standingsBySession, allTeams, allEvals, allSelfEvals, allReferees, allFleets, allShots, allPlacements] = await Promise.all([
    db.orm.public.Cycle.where({}).all(),
    buildStandingsForSessions(sessions),
    db.orm.public.Team.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.Evaluation.where((e) => e.sessionId.in(ids)).all(),
    db.orm.public.SelfEvaluation.where((e) => e.sessionId.in(ids)).all(),
    db.orm.public.SessionReferee.where((r) => r.sessionId.in(ids)).all(),
    db.orm.public.RefereeFleet.where((fl) => fl.sessionId.in(ids)).all(),
    db.orm.public.Shot.where((sh) => sh.sessionId.in(ids)).all(),
    db.orm.public.BoatPlacement.where((p) => p.sessionId.in(ids)).all(),
  ]);
  const cycleName = new Map(cycles.map((c) => [c.id, c.name]));
  const allTeamIds = allTeams.map((t) => t.id);
  const allMembers = allTeamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(allTeamIds)).all() : [];
  const neededUserIds = [...new Set([...allMembers.map((m) => m.userId), ...allReferees.map((r) => r.userId)])];
  const users = neededUserIds.length ? await db.orm.public.User.where((u) => u.id.in(neededUserIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };
  const teamsBy = group(allTeams, (t) => t.sessionId);
  const evalsBy = group(allEvals, (e) => e.sessionId);
  const selfBy = group(allSelfEvals, (e) => e.sessionId);
  const refsBy = group(allReferees, (r) => r.sessionId);
  const fleetsBy = group(allFleets, (fl) => fl.sessionId);
  const shotsBy = group(allShots, (sh) => sh.sessionId);
  const placementsBy = group(allPlacements, (p) => p.sessionId);
  const membersByTeam = group(allMembers, (m) => m.teamId);

  const rows: ConsultationRow[] = [];
  for (const s of sessions) {
    const stand = standingsBySession.get(s.id);
    const rankOf = new Map((stand?.rows ?? []).map((r) => [r.teamId, r]));

    const teams = teamsBy.get(s.id) ?? [];
    const evals = evalsBy.get(s.id) ?? [];
    const selfEvals = selfBy.get(s.id) ?? [];
    const referees = refsBy.get(s.id) ?? [];
    const fleets = fleetsBy.get(s.id) ?? [];
    const shots = shotsBy.get(s.id) ?? [];
    const placements = placementsBy.get(s.id) ?? [];
    const occupied = new Set(placements.filter((p) => p.shipId).map((p) => `${p.teamId}_${p.exerciseId}`));
    const hitsBy = new Map<string, number>();
    for (const sh of shots) if (occupied.has(`${sh.targetTeamId}_${sh.targetExerciseId}`)) hitsBy.set(sh.refereeId, (hitsBy.get(sh.refereeId) ?? 0) + 1);

    const evalsByTeam = group(evals, (e) => e.teamId);

    // participants
    const participants = new Map<string, string>(); // userId -> teamId
    for (const t of teams) for (const m of membersByTeam.get(t.id) ?? []) participants.set(m.userId, t.id);
    const refereeById = new Map(referees.filter((r) => r.status === "APPROVED").map((r) => [r.userId, r]));
    const studentIds = new Set<string>([...participants.keys(), ...refereeById.keys()]);

    for (const studentId of studentIds) {
      const u = userById.get(studentId);
      if (!u) continue;
      const cls = u.className ?? "";
      const teamId = participants.get(studentId) ?? null;
      const ref = refereeById.get(studentId) ?? null;
      const team = teamId ? teams.find((t) => t.id === teamId) ?? null : null;
      const r = teamId ? rankOf.get(teamId) ?? null : null;
      const tevals = teamId ? evalsByTeam.get(teamId) ?? [] : [];
      const repsSorted = tevals.map((e) => e.repsObserved).sort((a, b) => a - b);
      const se = selfEvals.find((x) => x.studentId === studentId);
      const hasFleet = fleets.some((fl) => fl.refereeId === studentId && fl.slot === 0);

      rows.push({
        studentId,
        lastName: u.lastName ?? "",
        firstName: u.firstName ?? "",
        className: cls,
        sessionId: s.id,
        sessionLabel: s.label ?? wodLabel(s.wodType),
        sessionDate: String(s.createdAt),
        cycleName: (s.cycleId && cycleName.get(s.cycleId)) || "",
        role: teamId && ref ? "participant+arbitre" : ref ? "arbitre" : "participant",
        refereeNote: ref?.note ?? null,
        teamName: team?.name ?? null,
        rank: r ? r.rank : null,
        laps: r ? r.laps : null,
        lapsTotal: r ? r.lapsTotal : null,
        time: r && r.done ? r.time : null,
        reps: r ? r.reps : null,
        cards: r ? r.cards : null,
        evalCount: tevals.length,
        evalMedianReps: repsSorted.length ? repsSorted[Math.floor((repsSorted.length - 1) / 2)] : null,
        evalQualities: tevals.map((e) => qualityCodeFromValue(e.note) ?? "?").join(","),
        selfEval: se ? (se.answers as Record<string, string>) : null,
        pirateScore: hasFleet ? hitsBy.get(studentId) ?? 0 : null,
      });
    }
  }

  // ===== Filtres de ligne =====
  const levels = Object.entries(f.levels ?? {}).filter(([, v]) => v && isQualityCode(v)) as [string, QualityCode][];
  const all = rows.filter((r) => {
    if (f.className && r.className !== f.className) return false;
    // Recherche par sous-chaine (et non par prefixe) : « max » trouve Maxime ET Lemax.
    if (q && !`${r.firstName} ${r.lastName}`.toLowerCase().includes(q) && !`${r.lastName} ${r.firstName}`.toLowerCase().includes(q)) return false;
    if (f.role === "participant" && r.role === "arbitre") return false;
    if (f.role === "arbitre" && r.role === "participant") return false;
    for (const [criterionId, level] of levels) if (r.selfEval?.[criterionId] !== level) return false;
    return true;
  });

  const byName = (a: ConsultationRow, b: ConsultationRow) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  const byDateDesc = (a: ConsultationRow, b: ConsultationRow) => b.sessionDate.localeCompare(a.sessionDate);
  all.sort((a, b) => {
    switch (f.sort ?? "recent") {
      case "ancien":
        return a.sessionDate.localeCompare(b.sessionDate) || a.className.localeCompare(b.className) || byName(a, b);
      case "nom":
        return byName(a, b) || byDateDesc(a, b);
      case "prenom":
        return a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName) || byDateDesc(a, b);
      case "classe":
        return a.className.localeCompare(b.className) || byName(a, b) || byDateDesc(a, b);
      case "rang":
        // Les arbitres et les eleves sans classement passent en fin de liste, pas en tete.
        return (a.rank ?? Infinity) - (b.rank ?? Infinity) || byDateDesc(a, b) || byName(a, b);
      default:
        return byDateDesc(a, b) || a.className.localeCompare(b.className) || byName(a, b);
    }
  });

  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  return {
    rows: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    all,
    total: all.length,
    totalAll: rows.length,
    page,
    pages,
    sessionsScanned: sessions.length,
  };
}

// Lit les filtres de niveau depuis l'URL : ?c_engagement=TB&c_technique=B
export function readConsultationLevels(sp: Record<string, string | string[] | undefined>): Partial<Record<string, QualityCode>> {
  const out: Partial<Record<string, QualityCode>> = {};
  for (const c of SELF_EVAL_CRITERIA) {
    const v = sp[`c_${c.id}`];
    const s = Array.isArray(v) ? v[0] : v;
    if (s && isQualityCode(s)) out[c.id] = s;
  }
  return out;
}

export function consultationCsv(rows: ConsultationRow[]): string {
  const head = [
    "Date", "Cycle", "Séance", "Classe", "Nom", "Prénom", "Rôle", "Motif arbitre", "Équipe", "Rang", "Tours", "Tours total", "Temps", "Reps", "Cartons",
    "Nb évals arbitres", "Reps médianes (arbitres)", "Qualités (arbitres)", "Touchés (arbitre)",
    ...SELF_EVAL_CRITERIA.map((c) => `Auto-éval : ${c.label}`),
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(";")];
  for (const r of rows) {
    lines.push(
      [
        new Date(r.sessionDate).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" }), r.cycleName, r.sessionLabel, r.className, r.lastName, r.firstName, r.role, r.refereeNote,
        r.teamName, r.rank, r.laps, r.lapsTotal, r.time, r.reps, r.cards, r.evalCount, r.evalMedianReps, r.evalQualities, r.pirateScore,
        ...SELF_EVAL_CRITERIA.map((c) => r.selfEval?.[c.id] ?? ""),
      ].map(esc).join(";")
    );
  }
  return "﻿" + lines.join("\r\n");
}
