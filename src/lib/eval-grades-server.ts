// Notes /20 d'une seance Eval S.O.R.O, lues en base (formule : eval-grades.ts). Lecture seule.
import { db } from "./db";
import { buildHXBundle } from "./hyrox-context";
import { evalGradeRows, type EvalGradeRow, type GradeEval, type GradePupil } from "./eval-grades";
import { readCriteria } from "./level-criteria";
import { memberNames } from "./staff-names";
import { teamState, type HXSettings } from "./wod-engines/templates/hyrox-engine";

export type EvalGradesData = { settings: HXSettings; startedAtMs: number | null; endedAtMs: number | null; rows: EvalGradeRow[] };

export async function loadEvalGrades(sessionId: string): Promise<EvalGradesData> {
  const b = await buildHXBundle(sessionId);
  const teamIds = b.ctx.teams.map((t) => t.id);
  const [members, evalsRaw, obs] = await Promise.all([
    teamIds.length ? db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : Promise.resolve([]),
    db.orm.public.Evaluation.where({ sessionId }).all(),
    db.orm.public.Observation.where({ sessionId }).all(),
  ]);
  const userIds = [...new Set([...members.map((m) => m.userId), ...evalsRaw.map((e) => e.evaluatorId)])];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const modeOf = new Map(obs.map((o) => [o.id, o.mode]));

  const pupils: GradePupil[] = members.flatMap((m) => {
    const u = userById.get(m.userId);
    if (!u || u.role !== "STUDENT") return [];
    const n = memberNames(u);
    return [{ userId: u.id, teamId: m.teamId, name: `${n.firstName} ${n.lastName}`.trim() || u.name, className: u.className ?? null, sex: u.sex ?? null }];
  });
  const evals: GradeEval[] = evalsRaw.flatMap((e) => {
    if (!e.targetUserId) return [];
    const mode = e.observationId ? modeOf.get(e.observationId) : undefined;
    const staff = mode ? mode === "STAFF" : userById.get(e.evaluatorId)?.role !== "STUDENT";
    return [{ targetUserId: e.targetUserId, teamId: e.teamId, exerciseId: e.exerciseId, value: e.note, staff, checks: readCriteria(e.criteria) ?? [] }];
  });
  const states = b.ctx.teams.map((t) => teamState(b.ctx, t));
  const rows = evalGradeRows(b.ctx.settings, states, pupils, evals).sort((a, x) => a.team.order - x.team.order || a.pupil.name.localeCompare(x.pupil.name, "fr"));
  return { settings: b.ctx.settings, startedAtMs: b.startedAtMs, endedAtMs: b.endedAtMs, rows };
}
