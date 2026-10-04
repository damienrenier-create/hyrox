import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { STAFF_ROLES, memberNames } from "@/lib/staff-names";
import { teacherNameById } from "@/lib/staff";
import { exercisesFor } from "@/lib/session-exercises";
import { RUN_CRITERIA_KEY, evalCriteriaFor, readCriteria } from "@/lib/level-criteria";
import { qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { buildHXBundle } from "@/lib/hyrox-context";
import { clockText, fmt, readHXSettings, teamState } from "@/lib/wod-engines/templates/hyrox-engine";
import { OBS_MINUTES, OBS_RUN_ID, OBS_TOLERANCE_MS, type GreffierPass, type ObsApp, type ObsEntry, type ObsMode, type ObsParticipant, type ObsReport, type ObsStation, type ObsView, type ReportEntry, type ReportObs } from "@/lib/observation-types";

// Arbitrage du WOD Eval (Sartay 04/10).
// - Arbitre ELEVE : l'appli lui tire un eleve au sort, il le suit 5 minutes chrono, consigne chaque serie de reps
//   (« pompages : 5 - 10 - 3 », chaque ligne horodatee) et rend une appreciation sur 4 criteres par exercice observe.
// - Arbitre PROF : il evalue qui il veut, quand il veut ; 6 criteres ; l'appli lui dit qui a deja ete vu sur quoi
//   (objectif : chaque eleve sur 3 exercices differents au moins).
// - Compte rendu : chaque serie avec son heure, comparee aux clics du greffier (l'equipe etait-elle a cette station ?).

const TZ = "Europe/Brussels";
const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });

// Ce que l'arbitre peut observer, avec sa grille : 4 criteres (eleve) ou 6 (prof : les 4 de l'eleve puis 2 de plus).
// Les stations de la seance, puis le RUN (Sartay 04/10 : « les criteres de tous les exercices de l'eval, run compris ») :
// un seul exercice « run » pour tous les runs du parcours, ses series se comptent en allers-retours.
export function obsStations(session: { wodType: string; settings?: unknown }, mode: ObsMode): ObsStation[] {
  const grid = (label: string) => evalCriteriaFor(label, mode);
  const out = exercisesFor(session).map((e) => ({ id: e.id, label: e.label, criteria: grid(e.label) }));
  if (session.wodType === "HYROX") out.push({ id: OBS_RUN_ID, label: readHXSettings(session.settings).runLabel, criteria: grid(RUN_CRITERIA_KEY) });
  return out;
}

// Les eleves qui jouent : membres des equipes de la seance (identifiants permanents), tries par equipe puis nom.
export async function participantsOf(sessionId: string): Promise<ObsParticipant[]> {
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  if (!teams.length) return [];
  const members = await db.orm.public.TeamMember.where((m) => m.teamId.in(teams.map((t) => t.id))).all();
  const users = members.length ? await db.orm.public.User.where((u) => u.id.in([...new Set(members.map((m) => m.userId))])).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const out: ObsParticipant[] = [];
  for (const m of members) {
    const u = userById.get(m.userId);
    const t = teamById.get(m.teamId);
    if (!u || !t) continue;
    const n = memberNames(u);
    out.push({ userId: u.id, name: `${n.firstName} ${n.lastName}`.trim() || u.name, sortName: `${n.lastName} ${n.firstName}`.trim().toLowerCase(), className: u.role === "STUDENT" ? u.className ?? null : "prof", teamId: t.id, teamName: t.name, teamOrder: t.order ?? 0 });
  }
  return out.sort((a, b) => a.teamOrder - b.teamOrder || a.sortName.localeCompare(b.sortName, "fr"));
}

type ObsRow = { id: string; sessionId: string; evaluatorId: string; targetUserId: string; teamId: string; mode: string; startedAt: unknown; endsAt: unknown | null; endedAt: unknown | null };

// Observation en cours d'un arbitre eleve : la derniere non cloturee (il n'en a qu'une a la fois).
export async function activeStudentObservation(sessionId: string, evaluatorId: string): Promise<ObsRow | null> {
  const rows = (await db.orm.public.Observation.where({ sessionId, evaluatorId }).all()) as ObsRow[];
  return rows.filter((o) => o.mode === "STUDENT" && o.endedAt == null).sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt))[0] ?? null;
}
// Observation libre d'un prof sur un eleve : une seule par (prof, eleve, seance), rouverte a chaque passage.
export async function staffObservation(sessionId: string, evaluatorId: string, targetUserId: string): Promise<ObsRow | null> {
  const rows = (await db.orm.public.Observation.where({ sessionId, evaluatorId, targetUserId }).all()) as ObsRow[];
  return rows.filter((o) => o.mode === "STAFF").sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt))[0] ?? null;
}

export async function loadObsView(o: ObsRow, parts?: ObsParticipant[]): Promise<ObsView> {
  const [entries, evals, people] = await Promise.all([
    db.orm.public.RepEntry.where({ observationId: o.id }).orderBy((e) => e.at.asc()).all(),
    db.orm.public.Evaluation.where({ observationId: o.id }).all(),
    parts ? Promise.resolve(parts) : participantsOf(o.sessionId),
  ]);
  const p = people.find((x) => x.userId === o.targetUserId);
  const apps: ObsApp[] = evals.map((e) => {
    const c = readCriteria(e.criteria) ?? [];
    return { exerciseId: e.exerciseId, labels: c.map((x) => x.label), met: c.map((x) => x.met), note: e.note, code: qualityCodeFromValue(e.note) };
  });
  const view: ObsEntry[] = entries.map((e) => ({ id: e.id, exerciseId: e.exerciseId, reps: e.reps, atMs: toMs(e.at), voided: e.voidedAt != null }));
  return {
    id: o.id,
    mode: o.mode === "STAFF" ? "STAFF" : "STUDENT",
    targetId: o.targetUserId,
    targetName: p?.name ?? "?",
    className: p?.className ?? null,
    teamName: p?.teamName ?? "?",
    startedAtMs: toMs(o.startedAt),
    endsAtMs: o.endsAt ? toMs(o.endsAt) : null,
    endedAtMs: o.endedAt ? toMs(o.endedAt) : null,
    entries: view,
    apps,
  };
}

// Tirage au sort de l'eleve a suivre : jamais soi-meme ni sa propre equipe, jamais un eleve deja suivi en ce moment
// par un autre arbitre ; on prend parmi les MOINS observes de la seance (tout le monde doit etre vu), et si possible
// quelqu'un que cet arbitre n'a pas encore suivi.
export async function drawTarget(sessionId: string, evaluatorId: string, ownTeamId: string | null): Promise<{ error: string } | { ok: true; observationId: string }> {
  const parts = await participantsOf(sessionId);
  const candidates = parts.filter((p) => p.userId !== evaluatorId && p.teamId !== ownTeamId);
  if (!candidates.length) return { error: "Aucun élève à suivre : les équipes ne sont pas encore encodées." };
  const all = (await db.orm.public.Observation.where({ sessionId }).all()) as ObsRow[];
  const now = Date.now();
  const busy = new Set(all.filter((o) => o.evaluatorId !== evaluatorId && o.endedAt == null && (o.endsAt == null || toMs(o.endsAt) > now) && o.mode === "STUDENT").map((o) => o.targetUserId));
  const seen = new Map<string, number>();
  for (const o of all) seen.set(o.targetUserId, (seen.get(o.targetUserId) ?? 0) + 1);
  const mine = new Set(all.filter((o) => o.evaluatorId === evaluatorId).map((o) => o.targetUserId));
  let pool = candidates.filter((p) => !busy.has(p.userId));
  if (!pool.length) pool = candidates;
  const min = Math.min(...pool.map((p) => seen.get(p.userId) ?? 0));
  let least = pool.filter((p) => (seen.get(p.userId) ?? 0) === min);
  const fresh = least.filter((p) => !mine.has(p.userId));
  if (fresh.length) least = fresh;
  const pick = least[Math.floor(Math.random() * least.length)];
  const created = await db.orm.public.Observation.create({ sessionId, evaluatorId, targetUserId: pick.userId, teamId: pick.teamId, mode: "STUDENT", startedAt: Temporal.Instant.fromEpochMilliseconds(now), endsAt: Temporal.Instant.fromEpochMilliseconds(now + OBS_MINUTES * 60_000) });
  return { ok: true, observationId: created.id };
}

// Ce que les PROFS ont deja evalue : eleve -> exercice -> qui et quand. L'ecran du prof s'en sert pour dire « deja
// evalue sur cet exo » et compter les exercices differents (objectif : 3 par eleve).
export async function staffCoverage(sessionId: string): Promise<Record<string, Record<string, { by: string; atMs: number }>>> {
  const obs = ((await db.orm.public.Observation.where({ sessionId }).all()) as ObsRow[]).filter((o) => o.mode === "STAFF");
  if (!obs.length) return {};
  const obsById = new Map(obs.map((o) => [o.id, o]));
  const evals = (await db.orm.public.Evaluation.where({ sessionId }).all()).filter((e) => e.observationId && obsById.has(e.observationId));
  const nameOf = evals.length ? await teacherNameById() : new Map<string, string>();
  const out: Record<string, Record<string, { by: string; atMs: number }>> = {};
  for (const e of evals) {
    const target = e.targetUserId ?? obsById.get(e.observationId!)!.targetUserId;
    (out[target] ??= {})[e.exerciseId] = { by: nameOf.get(e.evaluatorId) ?? "prof", atMs: toMs(e.createdAt) };
  }
  return out;
}

// Compte rendu des arbitres : chaque observation, chaque serie avec son heure (horloge + temps de course) et, pour
// chacune, la CONCORDANCE avec les clics du greffier : a cette heure-la, l'equipe de l'eleve etait-elle a cette station
// (entre la validation precedente et celle de la station, a OBS_TOLERANCE_MS pres) ?
export async function buildObsReport(sessionId: string): Promise<ObsReport> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");
  const [obs, entries, evals, parts, b] = await Promise.all([
    db.orm.public.Observation.where({ sessionId }).all().then((rows) => rows as ObsRow[]),
    db.orm.public.RepEntry.where({ sessionId }).orderBy((e) => e.at.asc()).all(),
    db.orm.public.Evaluation.where({ sessionId }).all(),
    participantsOf(sessionId),
    buildHXBundle(sessionId),
  ]);
  const evaluators = obs.length ? await db.orm.public.User.where((u) => u.id.in([...new Set(obs.map((o) => o.evaluatorId))])).all() : [];
  const teacherName = obs.some((o) => o.mode === "STAFF") ? await teacherNameById() : new Map<string, string>();
  const evalById = new Map(evaluators.map((u) => [u.id, u]));
  const partById = new Map(parts.map((p) => [p.userId, p]));
  const labelOf = new Map(obsStations(session, "STUDENT").map((e) => [e.id, e.label]));
  const stateByTeam = new Map(b.ctx.teams.map((t) => [t.id, teamState(b.ctx, t)]));
  // Le segment du greffier qui correspond a l'exercice observe : la station, ou n'importe quel run pour « run ».
  const sameExercise = (seg: { kind: "station" | "run"; station: { id: string } | null }, exerciseId: string) => (exerciseId === OBS_RUN_ID ? seg.kind === "run" : seg.kind === "station" && seg.station?.id === exerciseId);

  const locate = (teamId: string, exerciseId: string, atAbs: number): { match: ReportEntry["match"]; where: string | null; raceAt: string | null } => {
    if (b.startedAtMs === null) return { match: "na", where: null, raceAt: null };
    const t = elapsed(b.startedAtMs, b.pauses, atAbs) ?? 0;
    const st = stateByTeam.get(teamId);
    if (!st) return { match: "na", where: null, raceAt: fmt(t) };
    // Intervalle de chaque segment atteint : de la validation precedente a la sienne ; le segment en cours reste ouvert.
    const ivs = st.segments.flatMap((seg, i) => {
      if (i > st.done) return [];
      return [{ seg, from: i ? st.times[i - 1] : 0, to: i < st.done ? st.times[i] : Infinity }];
    });
    const ok = ivs.some((v) => sameExercise(v.seg, exerciseId) && t >= v.from - OBS_TOLERANCE_MS && t <= v.to + OBS_TOLERANCE_MS);
    if (ok) return { match: "ok", where: null, raceAt: fmt(t) };
    const cur = ivs.find((v) => t >= v.from && t <= v.to);
    const where = t < 0 ? "avant le départ" : cur ? cur.seg.label : st.finishedMs !== null ? "arrivée (parcours terminé)" : null;
    return { match: "off", where, raceAt: fmt(t) };
  };

  // Passages de l'equipe a une station, en heures d'horloge : ce que le greffier a clique (a mettre en face des series).
  // Un parcours compte beaucoup de runs : pour « run », on ne garde que ceux qui encadrent une serie de l'arbitre.
  const passes = (teamId: string, exerciseId: string, entryAbs: number[]): GreffierPass[] => {
    const st = stateByTeam.get(teamId);
    const startAbs = b.startedAtMs;
    if (!st || startAbs === null) return [];
    const isRun = exerciseId === OBS_RUN_ID;
    return st.segments.flatMap((seg, i) => {
      if (i > st.done || !sameExercise(seg, exerciseId)) return [];
      const fromAbs = i ? st.clocks[i - 1] : startAbs;
      const toAbs = i < st.done ? st.clocks[i] : null;
      if (isRun && !entryAbs.some((t) => (fromAbs == null || t >= fromAbs - OBS_TOLERANCE_MS) && (toAbs == null || t <= toAbs + OBS_TOLERANCE_MS))) return [];
      return [{ lap: seg.lap, label: isRun ? seg.label : null, from: clockText(fromAbs) || null, to: clockText(toAbs) || null }];
    });
  };

  const observations: ReportObs[] = obs
    .map((o) => {
      const p = partById.get(o.targetUserId);
      const ev = evalById.get(o.evaluatorId);
      const mine = entries.filter((e) => e.observationId === o.id);
      const apps = evals.filter((e) => e.observationId === o.id);
      const exIds = [...new Set([...mine.map((e) => e.exerciseId), ...apps.map((e) => e.exerciseId)])];
      const groups = exIds.map((exerciseId) => {
        const list: ReportEntry[] = mine.filter((e) => e.exerciseId === exerciseId).map((e) => {
          const atMs = toMs(e.at);
          const loc = locate(o.teamId, exerciseId, atMs);
          return { id: e.id, reps: e.reps, atMs, clock: clock(atMs), raceAt: loc.raceAt, voided: e.voidedAt != null, match: e.voidedAt != null ? "na" : loc.match, where: loc.where };
        });
        const a = apps.find((x) => x.exerciseId === exerciseId);
        const c = a ? readCriteria(a.criteria) ?? [] : [];
        return {
          exerciseId,
          label: labelOf.get(exerciseId) ?? exerciseId,
          entries: list,
          total: list.filter((e) => !e.voided).reduce((n, e) => n + e.reps, 0),
          greffier: passes(o.teamId, exerciseId, list.filter((e) => !e.voided).map((e) => e.atMs)),
          app: a ? { code: qualityCodeFromValue(a.note), met: c.filter((x) => x.met).length, total: c.length, unmet: c.filter((x) => !x.met).map((x) => x.label) } : null,
        };
      });
      const startedAtMs = toMs(o.startedAt);
      return {
        id: o.id,
        mode: (o.mode === "STAFF" ? "STAFF" : "STUDENT") as ObsMode,
        evaluatorId: o.evaluatorId,
        evaluatorName: ev ? (STAFF_ROLES.includes(ev.role as string) ? teacherName.get(ev.id) ?? ev.name : `${ev.firstName ?? ""} ${ev.lastName ?? ""}`.trim() || ev.name) : "?",
        targetId: o.targetUserId,
        targetName: p?.name ?? "?",
        className: p?.className ?? null,
        teamName: p?.teamName ?? "?",
        teamOrder: p?.teamOrder ?? 0,
        startedAtMs,
        clock: clock(startedAtMs),
        groups,
      };
    })
    .sort((a, b2) => a.teamOrder - b2.teamOrder || a.targetName.localeCompare(b2.targetName, "fr") || a.startedAtMs - b2.startedAtMs);

  const refMap = new Map<string, ObsReport["referees"][number]>();
  for (const o of observations) {
    const r = refMap.get(o.evaluatorId) ?? { id: o.evaluatorId, name: o.evaluatorName, mode: o.mode, observations: 0, entries: 0, matched: 0, off: 0 };
    r.observations++;
    for (const g of o.groups) for (const e of g.entries) {
      if (e.voided) continue;
      r.entries++;
      if (e.match === "ok") r.matched++;
      if (e.match === "off") r.off++;
    }
    refMap.set(o.evaluatorId, r);
  }
  const students = parts.map((p) => {
    const obsOf = observations.filter((o) => o.targetId === p.userId);
    const staffEx = new Set(obsOf.filter((o) => o.mode === "STAFF").flatMap((o) => o.groups.filter((g) => g.app).map((g) => g.exerciseId)));
    return { userId: p.userId, name: p.name, className: p.className, teamName: p.teamName, staffExercises: staffEx.size, observations: obsOf.length };
  });
  return { observations, referees: [...refMap.values()].sort((a, b2) => a.name.localeCompare(b2.name, "fr")), students, toleranceS: OBS_TOLERANCE_MS / 1000, minutes: OBS_MINUTES };
}
