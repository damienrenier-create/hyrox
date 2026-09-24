import { db } from "@/lib/db";
import { listExercises, seedDefaultExercises } from "@/lib/level";
import { readSessionClasses } from "@/lib/session-roles";
import { readChild } from "@/lib/level-context";
import { FINISHER_EMOM, FINISHER_SERIES, WARMUP_SERIES, childLabel, staggeredOrder, type ChildKind } from "@/lib/level-warmup";
import { isBoss, type FrozenLevel } from "@/lib/wod-engines/templates/level-engine";
import { wodLabel } from "@/lib/student-sessions";

// Seance ENFANT d'un WOD Level (echauffement ou finisher) : memes equipes et membres copies, echelle figee
// des series, depart en differe (echauffement), zombie du palier 1 impose (echauffement), chrono lance
// tout de suite. Elle vit a cote du WOD principal, avec son propre chrono et ses propres coches.
export async function createChildSession(parentId: string, kind: ChildKind, by: string): Promise<{ error: string } | { ok: true; id: string }> {
  const parent = await db.orm.public.Session.where({ id: parentId }).first();
  if (!parent || parent.wodType !== "LEVEL") return { error: "Séance introuvable." };
  if (readChild(parent.settings)) return { error: "Déjà dans un échauffement ou un finisher : reviens d'abord au WOD principal." };
  const teams = (await db.orm.public.Team.where({ sessionId: parentId }).all()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!teams.length) return { error: "Compose d'abord les équipes." };
  const members = await db.orm.public.TeamMember.where((m) => m.teamId.in(teams.map((t) => t.id))).all();

  // Echelle figee : libelles resolus contre le catalogue (importe si besoin), ponderations copiees.
  await seedDefaultExercises(by);
  const catalog = new Map((await listExercises()).map((e) => [e.label.trim().toUpperCase(), e]));
  const series = kind === "warmup" ? WARMUP_SERIES : FINISHER_SERIES;
  const levels: FrozenLevel[] = series.map((s, i) => ({
    number: i + 1,
    name: s.name,
    boss: !!s.boss,
    cards: s.cards.map(([label, reps]) => {
      const e = catalog.get(label);
      if (!e) throw new Error(`Exercice inconnu dans les séries : ${label}`);
      return { exerciseId: e.id, reps, label: e.label, weight: e.weight };
    }),
  }));
  // Le BOSS des series est reconnu par son drapeau, pas par « tous les 5 » : il porte le numero qui le rend
  // BOSS pour le moteur (multiple de 5), les autres series gardent 1..n.
  const bossIdx = levels.findIndex((l) => l.boss);
  if (bossIdx >= 0 && !isBoss(levels[bossIdx].number)) levels[bossIdx].number = Math.max(5, Math.ceil(levels.length / 5) * 5);
  levels.sort((a, b) => a.number - b.number);

  const prev = (parent.settings as Record<string, unknown> | null) ?? {};
  const order = kind === "warmup" ? staggeredOrder(teams.map((t) => t.id), levels.map((l) => l.number), levels.filter((l) => l.boss).map((l) => l.number)) : undefined;
  const closesAt = parent.closesAt ?? Temporal.Instant.fromEpochMilliseconds(Date.now() + 3 * 3600_000);
  const child = await db.orm.public.Session.create({
    wodType: "LEVEL",
    label: childLabel(kind, parent.label ?? wodLabel(parent.wodType)),
    isActive: true,
    refereeMode: false,
    closesAt,
    teacherId: parent.teacherId ?? null,
    cycleId: parent.cycleId ?? null,
    planId: parent.planId ?? null,
    settings: JSON.parse(JSON.stringify({
      numTeams: teams.length,
      classes: readSessionClasses(prev),
      levels,
      ...(order ? { levelOrder: order } : {}),
      ...(kind === "warmup" ? { zombieSpeed: 1 } : {}),
      ...(kind === "finisher" ? { emom: { waveMinutes: FINISHER_EMOM.map((w) => w.minutes) }, zombies: false } : { zombies: true }),
      child: { kind, parentId },
    })),
  });
  // Equipes copiees : l'ordre des identifiants d'origine est conserve dans levelOrder via les NOUVEAUX ids.
  const idMap = new Map<string, string>();
  for (const t of teams) {
    const c = await db.orm.public.Team.create({ sessionId: child.id, name: t.name, order: t.order ?? 0 });
    idMap.set(t.id, c.id);
  }
  for (const m of members) {
    const teamId = idMap.get(m.teamId);
    if (teamId) await db.orm.public.TeamMember.create({ teamId, userId: m.userId });
  }
  if (order) {
    const remapped: Record<string, number[]> = {};
    for (const [oldId, seq] of Object.entries(order)) { const n = idMap.get(oldId); if (n) remapped[n] = seq; }
    const s = (child.settings as Record<string, unknown> | null) ?? {};
    await db.orm.public.Session.where({ id: child.id }).update({ settings: JSON.parse(JSON.stringify({ ...s, levelOrder: remapped })) });
  }
  await db.orm.public.RaceState.create({ sessionId: child.id, noStartExerciseIds: [], startedAt: Temporal.Now.instant() });
  return { ok: true, id: child.id };
}
