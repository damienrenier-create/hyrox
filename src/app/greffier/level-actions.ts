"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { freezeLevels, listExercises, readFrozenFromSettings } from "@/lib/level";
import { activeCards, isBoss, readFrozenLevels, MAX_CARDS, type FrozenLevel } from "@/lib/wod-engines/templates/level-engine";
import { readLevelCap } from "@/lib/level-context";
import { resetRace } from "@/lib/cleanup";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";

// Actions du WOD Level. Profs, coachs ET greffier cochent (les BOSS se valident a plusieurs sur la meme
// seance) ; l'unicite en base rend le double-tap et deux appareils sur la meme fiche inoffensifs.
type Res = { error: string } | { ok: true };
const STAFF = ["MASTER_ADMIN", "ADMIN", "GREFFIER"];

async function requireLevelStaff(sessionId: string) {
  const user = await getSession();
  if (!user || !STAFF.includes(user.role)) throw new Error("Accès refusé.");
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) throw new Error("Séance introuvable.");
  if (session.wodType !== "LEVEL") throw new Error("Cette séance n'est pas un WOD Level.");
  return { user, session };
}

async function count(fn: () => Promise<{ n: number }>): Promise<number> {
  try {
    return (await fn()).n;
  } catch {
    return -1;
  }
}

// Pouls de l'ecran greffier Level : coches, cartes, membres, equipes, etat de course, version de l'echelle.
export async function levelPulseAction(sessionId: string): Promise<string> {
  const user = await getSession();
  if (!user || !STAFF.includes(user.role)) return "";
  const [rs, teams, session] = await Promise.all([
    db.orm.public.RaceState.where({ sessionId }).first(),
    db.orm.public.Team.where({ sessionId }).all(),
    db.orm.public.Session.where({ id: sessionId }).first(),
  ]);
  const teamIds = teams.map((t) => t.id);
  const [ticks, cards, members, pauses] = await Promise.all([
    count(() => db.orm.public.LevelTick.where({ sessionId }).aggregate((a) => ({ n: a.count() }))),
    rs ? count(() => db.orm.public.YellowCard.where({ raceStateId: rs.id }).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
    teamIds.length ? count(() => db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
    rs ? count(() => db.orm.public.RacePause.where({ raceStateId: rs.id }).aggregate((a) => ({ n: a.count() }))) : Promise.resolve(0),
  ]);
  const version = JSON.stringify((session?.settings as { levels?: unknown } | null)?.levels ?? "").length;
  return `${ticks}|${cards}|${members}|${teams.length}|${pauses}|${rs?.startedAt ? 1 : 0}|${rs?.endedAt ? 1 : 0}|${version}|${readLevelCap(session?.settings) ?? 0}`;
}

// Coup d'envoi : l'echelle est FIGEE dans la seance (copie des fiches avec libelle et ponderation), puis le
// chrono part. Une echelle vide ne se lance pas.
export async function startLevelAction(sessionId: string): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  let levels = readFrozenFromSettings(session.settings);
  if (!levels.length) {
    levels = await freezeLevels();
    if (!levels.some((l) => activeCards(l).length > 0)) return { error: "L'échelle est vide : compose les niveaux dans l'atelier Level avant de lancer." };
    const prev = (session.settings as Record<string, unknown> | null) ?? {};
    await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, levels } });
  }
  let rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) rs = await db.orm.public.RaceState.create({ sessionId, noStartExerciseIds: [] });
  if (rs.startedAt) return { ok: true };
  await db.orm.public.RaceState.where({ id: rs.id }).update({ startedAt: Temporal.Now.instant() });
  return { ok: true };
}

export async function levelPauseAction(sessionId: string): Promise<Res> {
  await requireLevelStaff(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt || rs.endedAt) return { error: "Course non démarrée ou déjà terminée." };
  const open = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).find((p) => p.to === null);
  if (open) await db.orm.public.RacePause.where({ id: open.id }).update({ to: Temporal.Now.instant() });
  else await db.orm.public.RacePause.create({ raceStateId: rs.id, from: Temporal.Now.instant() });
  return { ok: true };
}

// Fin du WOD : chrono arrete, classement fige (les coches suivantes sont refusees). La seance reste
// consultable ; elle se ferme d'elle-meme a la fin de son creneau.
export async function endLevelAction(sessionId: string): Promise<Res> {
  await requireLevelStaff(sessionId);
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "La course n'a pas démarré." };
  if (rs.endedAt) return { ok: true };
  const open = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).find((p) => p.to === null);
  await db.transaction(async (tx) => {
    const now = Temporal.Now.instant();
    if (open) await tx.orm.public.RacePause.where({ id: open.id }).update({ to: now });
    await tx.orm.public.RaceState.where({ id: rs.id }).update({ endedAt: now });
    await tx.orm.public.Session.where({ id: sessionId }).update({ raceEndedAt: now });
  });
  return { ok: true };
}

async function raceOpen(sessionId: string): Promise<{ error: string } | { rsId: string }> {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "Lance d'abord la course." };
  if (rs.endedAt) return { error: "La course est terminée." };
  const pauses = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: new Date(String(p.from)).getTime(), to: p.to ? new Date(String(p.to)).getTime() : null }));
  if (pauses.some((p) => p.to === null)) return { error: "Chrono en pause : reprends la course avant de cocher." };
  // Temps impose : une fois le chrono au bout, plus aucune coche ni carte (le greffier declare la fin du WOD).
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  const cap = readLevelCap(session?.settings);
  if (cap !== null && (elapsed(new Date(String(rs.startedAt)).getTime(), pauses, Date.now()) ?? 0) >= cap * 60_000) return { error: "Temps écoulé : déclare la fin du WOD." };
  return { rsId: rs.id };
}

// Remise a zero du WOD (apres confirmation cote client) : chrono, fiches cochees, cartes jaunes, demineur et
// evaluations sont effaces ; equipes, arbitres et reglages restent ; l'echelle est re-figee au prochain depart.
export async function resetLevelAction(sessionId: string): Promise<Res> {
  await requireLevelStaff(sessionId);
  const r = await resetRace(sessionId, { clearReferees: true });
  return "error" in r ? r : { ok: true };
}

// Activite des dispenses (demineur) pour cette seance, modifiable a tout moment.
export async function setLevelRefereeModeAction(sessionId: string, on: boolean): Promise<Res> {
  await requireLevelStaff(sessionId);
  await db.orm.public.Session.where({ id: sessionId }).update({ refereeMode: on });
  return { ok: true };
}

// Temps impose (minutes de chrono), modifiable avant ou pendant le WOD ; null = temps libre.
export async function setLevelCapAction(sessionId: string, minutes: number | null): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 180)) return { error: "Entre 1 et 180 minutes, ou vide pour un temps libre." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  const settings = { ...prev };
  if (minutes === null) delete settings.levelCapMin;
  else settings.levelCapMin = Math.round(minutes);
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify(settings)) });
  return { ok: true };
}

// Cocher une fiche : uniquement une fiche en jeu du niveau EN COURS de l'equipe (pas d'avance sur les niveaux
// suivants). Deja cochee = rien a faire (deux profs sur le meme BOSS, double-tap).
export async function tickCardAction(sessionId: string, teamId: string, level: number, card: number): Promise<Res> {
  const { user, session } = await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const levels = readFrozenFromSettings(session.settings);
  const l = levels.find((x) => x.number === level);
  if (!l || !l.cards[card] || l.cards[card].off) return { error: "Cette fiche n'est plus en jeu." };
  // Le niveau doit etre le niveau en cours : toutes les fiches en jeu des niveaux precedents sont cochees.
  const ticks = await db.orm.public.LevelTick.where({ sessionId, teamId }).all();
  const done = new Set(ticks.map((t) => `${t.level}_${t.card}`));
  for (const prev of levels) {
    if (prev.number >= level) break;
    if (activeCards(prev).some(({ index }) => !done.has(`${prev.number}_${index}`))) return { error: `Le niveau ${prev.number} n'est pas terminé.` };
  }
  if (done.has(`${level}_${card}`)) return { ok: true };
  try {
    await db.orm.public.LevelTick.create({ sessionId, teamId, level, card, by: user.name });
  } catch {
    /* unicite : deja cochee par un autre appareil */
  }
  return { ok: true };
}

export async function untickCardAction(sessionId: string, teamId: string, level: number, card: number): Promise<Res> {
  await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  const row = await db.orm.public.LevelTick.where({ sessionId, teamId, level, card }).first();
  if (row) await db.orm.public.LevelTick.where({ id: row.id }).delete();
  return { ok: true };
}

export async function levelYellowCardAction(sessionId: string, teamId: string, delta: 1 | -1): Promise<Res> {
  await requireLevelStaff(sessionId);
  const gate = await raceOpen(sessionId);
  if ("error" in gate) return gate;
  if (delta > 0) {
    await db.orm.public.YellowCard.create({ raceStateId: gate.rsId, teamId });
  } else {
    const last = await db.orm.public.YellowCard.where({ raceStateId: gate.rsId, teamId }).orderBy((c) => c.at.desc()).first();
    if (last) await db.orm.public.YellowCard.where({ id: last.id }).delete();
  }
  return { ok: true };
}

// Modifier l'echelle FIGEE de la seance pendant qu'elle tourne (greffier, profs) : reps ou exercice d'une
// fiche, fiche ajoutee, fiche retiree (`off`, jamais supprimee : les coches referencent l'index), niveau
// ajoute en fin d'echelle. L'echelle commune de l'atelier n'est pas touchee.
export async function updateSessionLevelsAction(sessionId: string, input: FrozenLevel[]): Promise<Res> {
  const { session } = await requireLevelStaff(sessionId);
  const current = readFrozenFromSettings(session.settings);
  if (!current.length) return { error: "L'échelle n'est pas encore figée : modifie-la dans l'atelier Level." };
  const catalog = new Map((await listExercises()).map((e) => [e.id, e]));
  const parsed = readFrozenLevels(input);
  if (!parsed.length) return { error: "Échelle vide." };
  const numbers = parsed.map((l) => l.number);
  if (new Set(numbers).size !== numbers.length || numbers.some((n, i) => n !== i + 1)) return { error: "Les niveaux doivent être numérotés 1, 2, 3… sans trou." };
  if (parsed.length < current.length) return { error: "On ne supprime pas un niveau en cours de WOD : retire ses fiches à la place." };
  const levels: FrozenLevel[] = parsed.map((l) => ({
    number: l.number,
    name: l.name ? l.name.slice(0, 40) : null,
    boss: isBoss(l.number),
    cards: l.cards.slice(0, MAX_CARDS).map((c) => {
      const e = catalog.get(c.exerciseId);
      const reps = Math.max(1, Math.min(10000, Math.round(c.reps)));
      return { exerciseId: c.exerciseId, reps, label: e?.label ?? c.label, weight: e?.weight ?? c.weight, ...(c.off ? { off: true } : {}) };
    }),
  }));
  for (const [i, prev] of current.entries()) {
    const next = levels[i];
    if (next.cards.length < prev.cards.length) return { error: `Niveau ${prev.number} : une fiche a disparu. Retire-la plutôt que de la supprimer.` };
  }
  for (const l of levels) {
    if (l.boss && activeCards(l).length > 1) return { error: `Le niveau ${l.number} est un BOSS : une seule fiche en jeu.` };
  }
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, levels } });
  return { ok: true };
}
