import { db } from "@/lib/db";
import { buildSessionStandings } from "@/lib/session-standings";
import { qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { readSessionClasses } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import { toMs } from "@/lib/scheduling";

// Consultation des donnees evaluatives (admins) : une ligne = un eleve x une seance.
// Filtres : cycle, seance, classe, eleve (prefixe), periode. Tout est relie par identifiant permanent.

export type ConsultationFilters = {
  cycleId?: string;
  sessionId?: string;
  className?: string;
  query?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
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

export async function buildConsultation(f: ConsultationFilters): Promise<{ rows: ConsultationRow[]; sessionsScanned: number }> {
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

  const cycles = await db.orm.public.Cycle.where({}).all();
  const cycleName = new Map(cycles.map((c) => [c.id, c.name]));
  const q = (f.query ?? "").trim().toLowerCase();

  const rows: ConsultationRow[] = [];
  for (const s of sessions) {
    const stand = await buildSessionStandings(s);
    const rankOf = new Map(stand.rows.map((r) => [r.teamId, r]));

    const teams = await db.orm.public.Team.where({ sessionId: s.id }).all();
    const evals = await db.orm.public.Evaluation.where({ sessionId: s.id }).all();
    const selfEvals = await db.orm.public.SelfEvaluation.where({ sessionId: s.id }).all();
    const referees = await db.orm.public.SessionReferee.where({ sessionId: s.id }).all();
    const fleets = await db.orm.public.RefereeFleet.where({ sessionId: s.id }).all();
    const shots = await db.orm.public.Shot.where({ sessionId: s.id }).all();
    const placements = await db.orm.public.BoatPlacement.where({ sessionId: s.id }).all();
    const occupied = new Set(placements.filter((p) => p.shipId).map((p) => `${p.teamId}_${p.exerciseId}`));
    const hitsBy = new Map<string, number>();
    for (const sh of shots) if (occupied.has(`${sh.targetTeamId}_${sh.targetExerciseId}`)) hitsBy.set(sh.refereeId, (hitsBy.get(sh.refereeId) ?? 0) + 1);

    const evalsByTeam = new Map<string, typeof evals>();
    for (const e of evals) {
      if (!evalsByTeam.has(e.teamId)) evalsByTeam.set(e.teamId, []);
      evalsByTeam.get(e.teamId)!.push(e);
    }

    // participants
    const participants = new Map<string, string>(); // userId -> teamId
    for (const t of teams) {
      const members = await db.orm.public.TeamMember.where({ teamId: t.id }).all();
      for (const m of members) participants.set(m.userId, t.id);
    }
    const refereeById = new Map(referees.filter((r) => r.status === "APPROVED").map((r) => [r.userId, r]));
    const studentIds = new Set<string>([...participants.keys(), ...refereeById.keys()]);

    for (const studentId of studentIds) {
      const u = await db.orm.public.User.where({ id: studentId }).first();
      if (!u) continue;
      const cls = u.className ?? "";
      if (f.className && cls !== f.className) continue;
      const full = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      const fullR = `${u.lastName ?? ""} ${u.firstName ?? ""}`.toLowerCase();
      if (q && !(full.startsWith(q) || fullR.startsWith(q) || (u.lastName ?? "").toLowerCase().startsWith(q) || (u.firstName ?? "").toLowerCase().startsWith(q))) continue;

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

  rows.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || a.className.localeCompare(b.className) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return { rows, sessionsScanned: sessions.length };
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
