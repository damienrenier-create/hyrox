"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { exercisesFor } from "@/lib/session-exercises";
import { FF_COLORS, FF_UNITS } from "@/lib/wod-engines/templates/fete-foraine-engine";

type Result = { error: string } | { ok: true };

async function requireGreffier() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}

// Pointage possible seulement course lancee, pas en pause, pas terminee (comme le fichier d'origine).
async function requireRunning(sessionId: string): Promise<{ error: string } | { ok: true }> {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "Lance d'abord la course avec « Début de course »." };
  if (rs.endedAt) return { error: "La course est terminée." };
  const pauses = await db.orm.public.RacePause.where({ raceStateId: rs.id }).all();
  if (pauses.some((p) => p.to === null)) return { error: "La course est en pause. Appuie sur « Reprendre » d'abord." };
  return { ok: true };
}

// corde = un pointage de plus ; atelier / fin = bascule (un appui sur un atelier deja valide l'efface).
export async function ffTapAction(sessionId: string, teamId: string, stationId: string): Promise<{ error: string } | { ok: true; removed: boolean }> {
  await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const valid = new Set(["corde", "fin", ...exercisesFor(session).map((e) => e.id)]);
  if (!valid.has(stationId)) return { error: "Atelier inconnu." };
  const run = await requireRunning(sessionId);
  if ("error" in run) return run;

  if (stationId === "corde") {
    await db.orm.public.StationEvent.create({ sessionId, teamId, stationId, at: Temporal.Now.instant() });
    return { ok: true, removed: false };
  }
  const existing = await db.orm.public.StationEvent.where({ sessionId, teamId, stationId }).all();
  if (existing.length) {
    for (const e of existing) await db.orm.public.StationEvent.where({ id: e.id }).delete();
    return { ok: true, removed: true };
  }
  await db.orm.public.StationEvent.create({ sessionId, teamId, stationId, at: Temporal.Now.instant() });
  return { ok: true, removed: false };
}

export async function ffUndoAction(sessionId: string): Promise<Result> {
  await requireGreffier();
  const last = await db.orm.public.StationEvent.where({ sessionId }).orderBy((e) => e.at.desc()).first();
  if (!last) return { error: "Rien à annuler." };
  await db.orm.public.StationEvent.where({ id: last.id }).delete();
  return { ok: true };
}

export async function ffPenaltyAction(teamId: string, delta: number): Promise<Result> {
  await requireGreffier();
  const team = await db.orm.public.Team.where({ id: teamId }).first();
  if (!team) return { error: "Équipe introuvable." };
  await db.orm.public.Team.where({ id: teamId }).update({ penalties: Math.max(0, (team.penalties ?? 0) + (delta > 0 ? 1 : -1)) });
  return { ok: true };
}

export async function ffColorAction(teamId: string, color: string | null): Promise<Result> {
  await requireGreffier();
  if (color !== null && !(FF_COLORS as readonly string[]).includes(color)) return { error: "Couleur inconnue." };
  await db.orm.public.Team.where({ id: teamId }).update({ color });
  return { ok: true };
}

// Reattribue les couleurs par defaut (jaune, vert, bleu, rouge dans l'ordre des equipes).
export async function ffResetColorsAction(sessionId: string): Promise<Result> {
  await requireGreffier();
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  for (const t of teams) if (t.color) await db.orm.public.Team.where({ id: t.id }).update({ color: null });
  return { ok: true };
}

export async function ffFinisherAction(memberId: string, points: number): Promise<Result> {
  await requireGreffier();
  const m = await db.orm.public.TeamMember.where({ id: memberId }).first();
  if (!m) return { error: "Coureur introuvable." };
  await db.orm.public.TeamMember.where({ id: memberId }).update({ finisherPoints: Math.max(0, Math.floor(Number.isFinite(points) ? points : 0)) });
  return { ok: true };
}

export async function ffSettingsAction(sessionId: string, unit: number, mode: "avg" | "sum"): Promise<Result> {
  await requireGreffier();
  if (!FF_UNITS.includes(unit)) return { error: "Unité inconnue." };
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, ff: { unit, mode: mode === "sum" ? "sum" : "avg" } } });
  return { ok: true };
}
