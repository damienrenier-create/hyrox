import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { freezeLadders, listExercises, readFrozenFromSettings } from "@/lib/level";
import { memberNames } from "@/lib/staff-names";
import { ladderFor, orderedLevels, progressOf, rankTeams, readEmom, readEmomScores, readFixedZombie, readLadders, readLevelOrder, readPenalties, readTeamStars, teamStarsOf, type EmomSettings, type FrozenLevel, type LevelOrder, type Loss, type Stars, type TeamPenalty, type TeamProgress, type Tick } from "@/lib/wod-engines/templates/level-engine";
import { applyZombieCatches, readZombies } from "@/lib/zombies";

// Etat complet d'une seance Level a partir de Postgres, pour l'ecran greffier, l'espace eleve et les
// classements. Module serveur sans "use server" : importe par les pages et les actions, jamais expose.

export type LevelTeam = { id: string; name: string; order: number; members: { id: string; name: string }[] };
export type LevelTickRow = { id: string; teamId: string; level: number; card: number; atMs: number; absMs: number; by: string };
export type LevelEval = { id: string; targetUserId: string; targetName: string; teamId: string; teamName: string; exerciseId: string; exerciseLabel: string; reps: number; note: number; refereeName: string; atMs: number };
export type LevelBundle = {
  levels: FrozenLevel[]; // parcours 2 etoiles (echelle par defaut)
  ladders: Partial<Record<Stars, FrozenLevel[]>>; // parcours 1 et 3 etoiles s'ils existent
  teamStars: Record<string, Stars>; // parcours choisi par equipe (2 par defaut)
  frozen: boolean; // true = echelle figee dans la seance (course lancee) ; false = echelle vive de l'atelier
  teams: LevelTeam[];
  ticks: LevelTickRow[];
  yellowCards: { id: string; teamId: string; atMs: number }[];
  startedAtMs: number | null;
  endedAtMs: number | null;
  raceEndedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  catalog: { id: string; label: string; weight: number; active: boolean }[];
  evaluations: LevelEval[]; // demineur : une par case jouee (eleve x exercice)
  capMin: number | null; // temps impose (minutes de chrono), null = libre
  refereeMode: boolean; // activite des dispenses (demineur)
  zombies: boolean; // mode zombies (vies, retour au niveau precedent)
  losses: (Loss & { id: string })[];
  levelOrder: LevelOrder | null; // echauffement en differe : ordre des niveaux par equipe
  zombieSpeed: number | null; // palier de zombie impose (echauffement : 1), null = regle normale
  child: { kind: "warmup" | "finisher"; parentId: string; parentLabel: string } | null; // seance enfant d'un WOD
  penalties: TeamPenalty[]; // fiches de penalite (cartes jaunes), par equipe et niveau
  emom: EmomSettings | null; // finisher : vagues cadencees
  emomScores: Record<string, number>;
  phases: PhaseTotals[]; // echauffement et finisher de ce WOD (vide pour une seance enfant) : totaux par equipe
};

// Totaux d'une seance enfant (echauffement ou finisher), par NUMERO d'equipe (les enfants copient les
// equipes du parent avec de nouveaux identifiants mais le meme numero).
export type PhaseTeamTotals = { reps: number; work: number; repsByExercise: Record<string, number>; losses: number; cards: number; score: number | null; levels: number };
export type PhaseTotals = { kind: "warmup" | "finisher"; sessionId: string; label: string; startedAtMs: number | null; byOrder: Record<number, PhaseTeamTotals> };
export const PHASE_LABEL: Record<PhaseTotals["kind"], string> = { warmup: "Échauffement", finisher: "Finisher" };

export function readChildren(settings: unknown): { warmup?: string; finisher?: string } {
  const c = (settings as { children?: { warmup?: unknown; finisher?: unknown } } | null)?.children;
  return { ...(typeof c?.warmup === "string" ? { warmup: c.warmup } : {}), ...(typeof c?.finisher === "string" ? { finisher: c.finisher } : {}) };
}

async function phaseTotals(kind: PhaseTotals["kind"], sessionId: string): Promise<PhaseTotals | null> {
  const s = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!s) return null;
  const levels = readFrozenFromSettings(s.settings);
  const [teams, rs, rawTicks, rawLosses] = await Promise.all([
    db.orm.public.Team.where({ sessionId }).all(),
    db.orm.public.RaceState.where({ sessionId }).first(),
    db.orm.public.LevelTick.where({ sessionId }).all(),
    db.orm.public.LevelLoss.where({ sessionId }).all(),
  ]);
  const [pausesRaw, cards] = await Promise.all([
    rs ? db.orm.public.RacePause.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    rs ? db.orm.public.YellowCard.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
  ]);
  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const pauses = pausesRaw.map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const ticks: Tick[] = rawTicks.map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, toMs(t.at)) ?? 0 }));
  const losses: Loss[] = rawLosses.map((l) => ({ teamId: l.teamId, level: l.level, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  const order = readLevelOrder(s.settings);
  const penalties = readPenalties(s.settings);
  const scores = readEmomScores(s.settings);
  const byOrder: Record<number, PhaseTeamTotals> = {};
  for (const t of teams) {
    const p = progressOf(orderedLevels(levels, order?.[t.id]), t.id, ticks, losses, penalties);
    byOrder[t.order ?? 0] = { reps: p.reps, work: p.weighted, repsByExercise: p.repsByExercise, losses: p.losses, cards: cards.filter((c) => c.teamId === t.id).length, score: scores[t.id] ?? null, levels: p.completedLevels };
  }
  return { kind, sessionId, label: s.label ?? PHASE_LABEL[kind], startedAtMs, byOrder };
}

export function readChild(settings: unknown): { kind: "warmup" | "finisher"; parentId: string } | null {
  const s = settings as { child?: { kind?: unknown; parentId?: unknown } } | null;
  const c = s?.child;
  if (!c || (c.kind !== "warmup" && c.kind !== "finisher") || typeof c.parentId !== "string") return null;
  return { kind: c.kind, parentId: c.parentId };
}

export function readLevelCap(settings: unknown): number | null {
  const v = (settings as { levelCapMin?: unknown } | null)?.levelCapMin;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

export async function buildLevelBundle(sessionId: string): Promise<LevelBundle> {
  await applyZombieCatches(sessionId);
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");

  const frozenLevels = readFrozenFromSettings(session.settings);
  const frozen = frozenLevels.length > 0;
  const childRef = readChild(session.settings);
  const parent = childRef ? await db.orm.public.Session.where({ id: childRef.parentId }).first() : null;
  const children = childRef ? {} : readChildren(session.settings);
  const phases = (await Promise.all([children.warmup ? phaseTotals("warmup", children.warmup) : null, children.finisher ? phaseTotals("finisher", children.finisher) : null])).filter((p): p is PhaseTotals => !!p);
  const live = frozen ? null : await freezeLadders();
  const [catalog, rawTeams, rs] = await Promise.all([
    listExercises(),
    db.orm.public.Team.where({ sessionId }).all(),
    db.orm.public.RaceState.where({ sessionId }).first(),
  ]);
  const levels = frozen ? frozenLevels : live![2];
  const ladders: Partial<Record<Stars, FrozenLevel[]>> = frozen ? readLadders(session.settings) : { ...(live![1].length ? { 1: live![1] } : {}), ...(live![3].length ? { 3: live![3] } : {}) };

  const teamIds = rawTeams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length ? await db.orm.public.User.where((u) => u.id.in(userIds)).all() : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const teams: LevelTeam[] = rawTeams
    .map((t) => ({
      id: t.id,
      name: t.name,
      order: t.order ?? 0,
      members: members
        .filter((m) => m.teamId === t.id)
        .map((m) => userById.get(m.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ id: u.id, name: memberNames(u).firstName || u.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    }))
    .sort((a, b) => a.order - b.order);

  const startedAtMs = rs?.startedAt ? toMs(rs.startedAt) : null;
  const endedAtMs = rs?.endedAt ? toMs(rs.endedAt) : null;
  const pauses = rs ? (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null })) : [];
  const [rawTicks, rawCards, rawLosses] = await Promise.all([
    db.orm.public.LevelTick.where({ sessionId }).orderBy((t) => t.at.asc()).all(),
    rs ? db.orm.public.YellowCard.where({ raceStateId: rs.id }).all() : Promise.resolve([]),
    db.orm.public.LevelLoss.where({ sessionId }).all(),
  ]);
  const losses = rawLosses.map((l) => ({ id: l.id, teamId: l.teamId, level: l.level, atMs: elapsed(startedAtMs, pauses, toMs(l.at)) ?? 0 }));
  const ticks: LevelTickRow[] = rawTicks.map((t) => {
    const abs = toMs(t.at);
    return { id: t.id, teamId: t.teamId, level: t.level, card: t.card, atMs: elapsed(startedAtMs, pauses, abs) ?? 0, absMs: abs, by: t.by };
  });
  const yellowCards = rawCards.map((c) => ({ id: c.id, teamId: c.teamId, atMs: elapsed(startedAtMs, pauses, toMs(c.at)) ?? 0 }));

  // Evaluations individuelles (demineur) : noms des arbitres et des eleves cibles en une requete de plus.
  const rawEvals = (await db.orm.public.Evaluation.where({ sessionId }).all()).filter((e) => !!e.targetUserId);
  const extraIds = [...new Set(rawEvals.flatMap((e) => [e.evaluatorId, e.targetUserId as string]).filter((id) => !userById.has(id)))];
  for (const u of extraIds.length ? await db.orm.public.User.where((x) => x.id.in(extraIds)).all() : []) userById.set(u.id, u);
  const labelOf = new Map<string, string>(catalog.map((e) => [e.id, e.label]));
  for (const l of levels) for (const c of l.cards) labelOf.set(c.exerciseId, c.label);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const nameOf = (id: string) => { const u = userById.get(id); return u ? memberNames(u).firstName + (memberNames(u).lastName ? " " + memberNames(u).lastName.charAt(0) + "." : "") : "?"; };
  const evaluations: LevelEval[] = rawEvals
    .map((e) => ({
      id: e.id, targetUserId: e.targetUserId as string, targetName: nameOf(e.targetUserId as string), teamId: e.teamId, teamName: teamName.get(e.teamId) ?? "?",
      exerciseId: e.exerciseId, exerciseLabel: labelOf.get(e.exerciseId) ?? e.exerciseId, reps: e.repsObserved, note: e.note,
      refereeName: nameOf(e.evaluatorId), atMs: elapsed(startedAtMs, pauses, toMs(e.createdAt)) ?? 0,
    }))
    .sort((a, b) => a.atMs - b.atMs);

  return {
    levels,
    ladders,
    teamStars: readTeamStars(session.settings),
    frozen,
    teams,
    ticks,
    yellowCards,
    startedAtMs,
    endedAtMs,
    raceEndedAtMs: session.raceEndedAt ? toMs(session.raceEndedAt) : null,
    pauses,
    catalog: catalog.map((e) => ({ id: e.id, label: e.label, weight: e.weight, active: e.active })),
    evaluations,
    capMin: readLevelCap(session.settings),
    refereeMode: session.refereeMode,
    zombies: readZombies(session.settings),
    losses,
    levelOrder: readLevelOrder(session.settings),
    zombieSpeed: readFixedZombie(session.settings),
    child: childRef ? { ...childRef, parentLabel: parent?.label ?? "WOD" } : null,
    penalties: readPenalties(session.settings).map((p) => ({ ...p, atMs: typeof p.at === "number" ? elapsed(startedAtMs, pauses, p.at) ?? undefined : undefined })),
    emom: readEmom(session.settings),
    emomScores: readEmomScores(session.settings),
    phases,
  };
}

// Totaux d'une equipe sur les phases (echauffement + finisher), par numero d'equipe.
export function phaseExtras(bundle: LevelBundle, order: number): PhaseTeamTotals {
  const agg: PhaseTeamTotals = { reps: 0, work: 0, repsByExercise: {}, losses: 0, cards: 0, score: null, levels: 0 };
  for (const ph of bundle.phases) {
    const x = ph.byOrder[order];
    if (!x) continue;
    agg.reps += x.reps; agg.work += x.work; agg.losses += x.losses; agg.cards += x.cards; agg.levels += x.levels;
    for (const [k, v] of Object.entries(x.repsByExercise)) agg.repsByExercise[k] = (agg.repsByExercise[k] ?? 0) + v;
    if (ph.kind === "finisher") agg.score = x.score;
  }
  return agg;
}

// Echelle d'une equipe : son parcours (etoiles), dans son ordre (echauffement en differe).
export function levelsForTeam(bundle: Pick<LevelBundle, "levels" | "ladders" | "teamStars" | "levelOrder">, teamId: string): FrozenLevel[] {
  return orderedLevels(ladderFor(bundle.levels, bundle.ladders, teamStarsOf(bundle.teamStars, teamId)), bundle.levelOrder?.[teamId]);
}
// Progression de chaque equipe, classee. Meme calcul pour le greffier, l'espace eleve et les records.
export function levelStandings(bundle: LevelBundle): TeamProgress[] {
  return rankTeams(bundle.teams.map((t) => progressOf(levelsForTeam(bundle, t.id), t.id, bundle.ticks, bundle.losses, bundle.penalties)));
}

// Heure absolue a laquelle une equipe a boucle l'echelle (fenetre d'auto-evaluation), sinon null.
export function teamFinishedAbsMs(bundle: LevelBundle, p: TeamProgress): number | null {
  if (p.finishedMs === null) return null;
  const last = bundle.ticks.filter((t) => t.teamId === p.teamId).sort((a, b) => b.absMs - a.absMs)[0];
  return last ? last.absMs : null;
}
