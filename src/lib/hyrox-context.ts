import { db } from "@/lib/db";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { toMs } from "@/lib/scheduling";
import { memberNames } from "@/lib/staff-names";
import { isDeletedSession, isTestClass, readSessionClasses } from "@/lib/session-roles";
import { evalGroupOf } from "@/lib/eval-bareme";
import { CINDY_KEY, HX_DEFAULT_STARS, hxStationKey, parcoursTops, readHXSettings, readHXStars, teamState, type HXContext, type HXTeam } from "@/lib/wod-engines/templates/hyrox-engine";

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
  // Parcours de chaque equipe : celui qu'elle a choisi, sinon 3 etoiles (Sartay : « le niveau de base est a 3 etoiles
  // pour tout le monde »). Son groupe (annees, filles / garcons ou mixte), lu sur ses eleves, fixe ses points.
  const chosenStars = readHXStars(session.settings);
  const sessionClasses = readSessionClasses(session.settings);
  const groupOf = (teamId: string) =>
    evalGroupOf(members.filter((m) => m.teamId === teamId).flatMap((m) => { const u = userById.get(m.userId); return u && u.role === "STUDENT" ? [{ className: u.className ?? null, sex: u.sex ?? null }] : []; }), sessionClasses);
  const teams: HXTeam[] = rawTeams.map((t) => ({
    id: t.id,
    order: t.order ?? 0,
    name: t.name,
    startStationId: t.startExerciseId ?? null,
    group: groupOf(t.id),
    stars: chosenStars[t.id] ?? HX_DEFAULT_STARS,
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
  // Auteur de chaque carte (greffier, prof ou arbitre eleve) : « Léa M. · arbitre ».
  const giverIds = [...new Set(cardsRaw.map((c) => c.givenById).filter((id): id is string => !!id))];
  const givers = giverIds.length ? await db.orm.public.User.where((u) => u.id.in(giverIds)).all() : [];
  const giverName = new Map(givers.map((u) => {
    const n = memberNames(u);
    const who = `${n.firstName || u.name}${n.lastName ? ` ${n.lastName[0]}.` : ""}`;
    return [u.id, `${who} · ${u.role === "STUDENT" ? "arbitre" : u.role === "GREFFIER" ? "greffier" : "prof"}`];
  }));
  const cards = cardsRaw.map((c) => ({ id: c.id, teamId: c.teamId, at: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0, by: c.givenById ? giverName.get(c.givenById) ?? null : null, reason: c.reason ?? null }));

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

// Records des classes precedentes, par station et par parcours (Sartay 05/10 : « avant de commencer le cours, on
// affiche dans la colonne top les tops deja joues »). Seances Eval jouees AVEC les parcours, hors corbeille, hors classe
// de test, hors la seance elle-meme ; une station se reconnait a son libelle, son unite et sa quantite de base
// (hxStationKey : son emplacement peut changer). Requetes groupees ; la page ne l'appelle qu'avant le depart.
export type HXRecord = { ms: number; teamName: string; classes: string; dateMs: number };
export async function buildHXRecords(sessionId: string): Promise<Record<string, Record<number, HXRecord>>> {
  const sessions = (await db.orm.public.Session.where({ wodType: "HYROX" }).all()).filter((s) => {
    const h = (s.settings as { hyrox?: { levels?: unknown } } | null)?.hyrox;
    return s.id !== sessionId && !isDeletedSession(s) && h?.levels === true && !readSessionClasses(s.settings).some(isTestClass);
  });
  const out: Record<string, Record<number, HXRecord>> = {};
  if (!sessions.length) return out;
  const ids = sessions.map((s) => s.id);
  const [teams, events, states] = await Promise.all([
    db.orm.public.Team.where((t) => t.sessionId.in(ids)).all(),
    db.orm.public.StationEvent.where((e) => e.sessionId.in(ids)).all(),
    db.orm.public.RaceState.where((r) => r.sessionId.in(ids)).all(),
  ]);
  const pausesRaw = states.length ? await db.orm.public.RacePause.where((p) => p.raceStateId.in(states.map((r) => r.id))).all() : [];
  for (const s of sessions) {
    const rs = states.find((r) => r.sessionId === s.id);
    if (!rs?.startedAt) continue;
    const startedAtMs = toMs(rs.startedAt);
    const pauses = pausesRaw.filter((p) => p.raceStateId === rs.id).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
    const settings = readHXSettings(s.settings);
    const chosen = readHXStars(s.settings);
    const ctx: HXContext = {
      settings,
      teams: teams.filter((t) => t.sessionId === s.id).map((t) => ({ id: t.id, order: t.order ?? 0, name: t.name, startStationId: t.startExerciseId ?? null, members: [], stars: chosen[t.id] ?? HX_DEFAULT_STARS })),
      events: events.filter((e) => e.sessionId === s.id).map((e) => ({ id: e.id, teamId: e.teamId, key: e.stationId, at: elapsed(startedAtMs, pauses, toMs(e.at)) ?? 0, abs: toMs(e.at) })),
      cards: [],
    };
    const { tops } = parcoursTops(ctx);
    const classes = readSessionClasses(s.settings).join("+");
    for (const st of settings.stations) {
      const key = hxStationKey(st);
      for (const [stars, top] of Object.entries(tops[`st:${st.id}`] ?? {})) {
        const n = Number(stars);
        const cur = out[key]?.[n];
        if (!cur || top.ms < cur.ms) out[key] = { ...(out[key] ?? {}), [n]: { ms: top.ms, teamName: top.name, classes, dateMs: startedAtMs } };
      }
    }
  }
  return out;
}
