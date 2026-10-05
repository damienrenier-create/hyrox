import { db } from "@/lib/db";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { toMs } from "@/lib/scheduling";
import { memberNames } from "@/lib/staff-names";
import { readSessionClasses } from "@/lib/session-roles";
import { evalDefaultStars, evalGroupOf } from "@/lib/eval-bareme";
import { CINDY_KEY, readHXSettings, readHXStarLog, readHXStars, teamState, type HXContext, type HXTeam } from "@/lib/wod-engines/templates/hyrox-engine";

export type HXBundle = {
  ctx: HXContext;
  startedAtMs: number | null;
  endedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  finishedAbsMs: Record<string, number>; // teamId -> heure absolue de la fin du parcours (fenetre d'auto-evaluation)
  locked: boolean; // des pointages existent : stations et runs ne se modifient plus
};

// Fige le parcours dans la seance a sa PREMIERE validation (stations, reps, runs, tours). Tant que rien n'est joue, une
// seance sans reglages suit le parcours par defaut du code ; une fois jouee, elle ne doit plus bouger quand ce parcours
// change (04/10 : le break dance a remplace le one rep). Regle d'or : garder la trace des WOD faits par de vrais eleves.
export async function freezeHXCourse(session: { id: string; settings: unknown }): Promise<boolean> {
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  if (prev.hyrox) return false; // deja fige (ou regle a la main dans les reglages)
  await db.orm.public.Session.where({ id: session.id }).update({ settings: { ...prev, hyrox: readHXSettings(prev) } });
  return true;
}

// Limite de temps du WOD (Sartay 05/10 : « le wod dure 50 minutes pour tout le monde », puis le soir : « fin du wod
// officiel a 55 min, mais le chrono va jusqu'a 60 si jamais on a le temps »). La limite DURE est la fin officielle plus
// la prolongation : a cet instant de course (pauses deduites), plus aucune validation n'est acceptee et la course se
// termine toute seule, comme avec « Fin de course », datee de l'instant exact de la limite. Une equipe arrivee avant
// n'arrete rien : les autres continuent jusqu'au bout. `capMin` = limite dure en minutes, `officialMin` = fin officielle.
export type HXCap = { started: boolean; ended: boolean; paused: boolean; elapsedMs: number; capMs: number; capMin: number; officialMin: number; reached: boolean; capAtMs: number | null };
export async function hxCapState(sessionId: string): Promise<HXCap | null> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "HYROX") return null;
  const settings = readHXSettings(session.settings);
  const officialMin = settings.capMin;
  const capMin = settings.capMin + settings.extraMin;
  const capMs = capMin * 60_000;
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt) return { started: false, ended: false, paused: false, elapsedMs: 0, capMs, capMin, officialMin, reached: false, capAtMs: null };
  const startedAtMs = toMs(rs.startedAt);
  const pauses = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const now = Date.now();
  const elapsedMs = elapsed(startedAtMs, pauses, rs.endedAt ? toMs(rs.endedAt) : now) ?? 0;
  const reached = elapsedMs >= capMs;
  // Instant ou le chrono de course a atteint la limite (le chrono ne tourne pas pendant une pause).
  return { started: true, ended: !!rs.endedAt, paused: pauses.some((p) => p.to === null), elapsedMs, capMs, capMin, officialMin, reached, capAtMs: reached && !rs.endedAt ? now - (elapsedMs - capMs) : null };
}

// Contexte pur du moteur Hyrox a partir de Postgres : equipes + membres (identifiants permanents), pointages et cartes
// jaunes en ms ecoulees (pauses deduites via RaceState/RacePause), reglages de la seance. Requetes groupees : la page
// greffier est re-rendue a chaque rafraichissement.
export async function buildHXBundle(sessionId: string): Promise<HXBundle> {
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const rawTeams = (await db.orm.public.Team.where({ sessionId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  const teamIds = rawTeams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const users = members.length ? await db.orm.public.User.where((u) => u.id.in([...new Set(members.map((m) => m.userId))])).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  // QCM bonus : score de chaque eleve ayant repondu.
  const quizBy = new Map((await db.orm.public.QuizAnswer.where({ sessionId }).all()).map((q) => [q.studentId, q.score]));
  // Niveau « etoiles » de chaque equipe : celui qu'elle a choisi, sinon celui de son groupe (5 etoiles en 5e-6e,
  // 3 etoiles en 3e-4e). Le groupe (annees, filles / garcons ou mixte) se lit sur ses eleves ; il fixe son bareme.
  const chosenStars = readHXStars(session.settings);
  const starLog = readHXStarLog(session.settings);
  const sessionClasses = readSessionClasses(session.settings);
  const groupOf = (teamId: string) =>
    evalGroupOf(members.filter((m) => m.teamId === teamId).flatMap((m) => { const u = userById.get(m.userId); return u && u.role === "STUDENT" ? [{ className: u.className ?? null, sex: u.sex ?? null }] : []; }), sessionClasses);
  const teams: HXTeam[] = rawTeams.map((t) => ({
    id: t.id,
    order: t.order ?? 0,
    name: t.name,
    startStationId: t.startExerciseId ?? null,
    group: groupOf(t.id),
    stars: chosenStars[t.id] ?? evalDefaultStars(groupOf(t.id)),
    starLog: starLog.filter((c) => c.teamId === t.id),
    members: members
      .filter((m) => m.teamId === t.id)
      .flatMap((m) => {
        const u = userById.get(m.userId);
        return u ? [{ memberId: m.id, userId: u.id, name: memberNames(u).firstName || u.name, quiz: quizBy.get(u.id) ?? null }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  }));

  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs?.endedAt ? toMs(rs.endedAt) : null;
  const [pausesRaw, cardsRaw, rawEvents] = await Promise.all([
    rs ? db.orm.public.RacePause.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    rs ? db.orm.public.YellowCard.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    db.orm.public.StationEvent.where({ sessionId }).orderBy((e) => e.at.asc()).all(),
  ]);
  const pauses = pausesRaw.map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const events = rawEvents.map((e) => ({ id: e.id, teamId: e.teamId, key: e.stationId, at: elapsed(startedAtMs, pauses, toMs(e.at)) ?? 0, abs: toMs(e.at) }));
  const cards = cardsRaw.map((c) => ({ id: c.id, teamId: c.teamId, at: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 }));

  const ctx: HXContext = { teams, settings: readHXSettings(session.settings), events, cards };
  const finishedAbsMs: Record<string, number> = {};
  for (const t of teams) {
    const st = teamState(ctx, t);
    if (st.finishedMs === null) continue;
    const last = rawEvents.filter((e) => e.teamId === t.id && e.stationId !== CINDY_KEY)[st.segments.length - 1];
    if (last) finishedAbsMs[t.id] = toMs(last.at);
  }
  return { ctx, startedAtMs, endedAtMs, pauses, finishedAbsMs, locked: rawEvents.length > 0 };
}
