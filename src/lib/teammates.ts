import { db } from "@/lib/db";
import { buildStandingsForSessions } from "@/lib/standings-batch";
import { gradeOfAnswers, fmtGrade } from "@/lib/carnet";
import { STAFF_CLASS_LABEL, STAFF_ROLES, memberNames } from "@/lib/staff-names";
import { toMs } from "@/lib/scheduling";

// Coequipiers habituels : pour chaque eleve, les 3 personnes avec qui il a le plus souvent joue. Quand le
// greffier encode un nom dans une equipe, ses anciens coequipiers sont proposes en premier.
// Un coequipier est marque « a l'oeil » (rouge) si, lors de leur derniere seance commune, leur equipe etait
// dans les 3 moins bons scores et/ou si son auto-evaluation y etait sous 3/5 : la suggestion existe mais
// avertit — les eleves lisent l'ecran projete.

export type PairHit = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  count: number; // nombre de WOD joues ensemble
  red: boolean;
  why: string; // explication du rouge (info-bulle), vide sinon
};

const BOTTOM = 3;
const LOW_GRADE = 3;
const TOP_PAIRS = 3;

export async function teammatePairs(studentIds: string[]): Promise<Record<string, PairHit[]>> {
  const out: Record<string, PairHit[]> = {};
  if (!studentIds.length) return out;
  const wanted = new Set(studentIds);

  const mine = await db.orm.public.TeamMember.where((m) => m.userId.in(studentIds)).all();
  const teamIds = [...new Set(mine.map((m) => m.teamId))];
  if (!teamIds.length) return out;
  const [teams, allMembers] = await Promise.all([
    db.orm.public.Team.where((t) => t.id.in(teamIds)).all(),
    db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all(),
  ]);
  const sessionIds = [...new Set(teams.map((t) => t.sessionId))];
  const sessions = await db.orm.public.Session.where((s) => s.id.in(sessionIds)).all();
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Toutes les personnes rencontrees (coequipiers hors roster compris), pour afficher leur nom.
  const otherIds = [...new Set(allMembers.map((m) => m.userId))];
  const users = otherIds.length ? await db.orm.public.User.where((u) => u.id.in(otherIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Classement de chaque seance (rang par equipe) et auto-evaluations, en requetes groupees.
  const [standings, selfEvals] = await Promise.all([
    buildStandingsForSessions(sessions),
    db.orm.public.SelfEvaluation.where((e) => e.sessionId.in(sessionIds)).all(),
  ]);
  const gradeOf = new Map(selfEvals.map((e) => [`${e.sessionId}_${e.studentId}`, gradeOfAnswers(e.answers as Record<string, unknown>)]));
  const bottomTeams = new Set<string>();
  for (const [, st] of standings) {
    const ranked = st.rows.filter((r) => r.rank > 0);
    const n = ranked.length;
    for (const r of ranked) if (n >= BOTTOM + 1 ? r.rank > n - BOTTOM : true) bottomTeams.add(r.teamId);
  }

  // Paires (a, b) avec le nombre de seances communes et la plus recente d'entre elles.
  const membersOfTeam = new Map<string, string[]>();
  for (const m of allMembers) (membersOfTeam.get(m.teamId) ?? membersOfTeam.set(m.teamId, []).get(m.teamId)!).push(m.userId);
  const pairs = new Map<string, Map<string, { count: number; lastAt: number; lastTeamId: string; lastSessionId: string }>>();
  for (const [teamId, ids] of membersOfTeam) {
    const t = teamById.get(teamId);
    const s = t ? sessionById.get(t.sessionId) : null;
    if (!t || !s) continue;
    const at = toMs(s.createdAt);
    for (const a of ids) {
      if (!wanted.has(a)) continue;
      for (const b of ids) {
        if (a === b) continue;
        const row = pairs.get(a) ?? pairs.set(a, new Map()).get(a)!;
        const cur = row.get(b) ?? { count: 0, lastAt: -1, lastTeamId: teamId, lastSessionId: s.id };
        cur.count++;
        if (at > cur.lastAt) { cur.lastAt = at; cur.lastTeamId = teamId; cur.lastSessionId = s.id; }
        row.set(b, cur);
      }
    }
  }

  const day = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });
  for (const [a, row] of pairs) {
    const list: PairHit[] = [];
    for (const [b, info] of row) {
      const u = userById.get(b);
      if (!u) continue;
      const n = memberNames(u);
      const reasons: string[] = [];
      if (bottomTeams.has(info.lastTeamId)) reasons.push(`équipe dans les ${BOTTOM} moins bons scores le ${day(info.lastAt)}`);
      const g = gradeOf.get(`${info.lastSessionId}_${b}`);
      if (g !== undefined && g !== null && g < LOW_GRADE) reasons.push(`auto-évaluation à ${fmtGrade(g)}/5 le ${day(info.lastAt)}`);
      list.push({
        id: b,
        firstName: n.firstName,
        lastName: n.lastName,
        className: u.role === "STUDENT" ? u.className ?? null : STAFF_ROLES.includes(u.role as string) ? STAFF_CLASS_LABEL : null,
        count: info.count,
        red: reasons.length > 0,
        why: reasons.join(" · "),
      });
    }
    list.sort((x, y) => y.count - x.count || (row.get(y.id)!.lastAt - row.get(x.id)!.lastAt) || x.lastName.localeCompare(y.lastName, "fr"));
    out[a] = list.slice(0, TOP_PAIRS);
  }
  return out;
}
