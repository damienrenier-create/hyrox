"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { CINDY_KEY, HX_MAX_STATIONS, HX_MIN_STATIONS, readHXSettings, segmentsFor, startIndexOf, type HXSettings } from "@/lib/wod-engines/templates/hyrox-engine";

// Actions du greffier Hyrox (Sartay 01/10). Les profs (ADMIN) tiennent aussi ce greffier : leurs seances s'ouvrent
// desormais depuis leur propre journal de classe.

type Result = { error: string } | { ok: true };

async function requireGreffier() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}

// Pointage possible seulement course lancee, pas en pause, pas terminee.
async function requireRunning(sessionId: string): Promise<{ error: string } | { ok: true }> {
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "Lance d'abord la course avec « Début de course »." };
  if (rs.endedAt) return { error: "La course est terminée." };
  const pauses = await db.orm.public.RacePause.where({ raceStateId: rs.id }).all();
  if (pauses.some((p) => p.to === null)) return { error: "La course est en pause. Appuie sur « Reprendre » d'abord." };
  return { ok: true };
}

const toMs = (v: unknown) => new Date(String(v)).getTime();
// Deux validations de la meme equipe a moins de 5 s : un double clic, jamais un vrai segment.
const MIN_GAP_MS = 5_000;

// Valide le segment en cours de l'equipe (station ou run, dans l'ordre de son parcours). Parcours fini : plus rien a valider.
export async function hxTapAction(sessionId: string, teamId: string): Promise<{ error: string } | { ok: true; key: string }> {
  await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const run = await requireRunning(sessionId);
  if ("error" in run) return run;

  const settings = readHXSettings(session.settings);
  // Meme regle que l'ecran (station choisie, sinon round-robin sur le numero d'equipe) : la cle enregistree doit etre
  // celle que le greffier a vue.
  const startIndex = startIndexOf({ settings, teams: [], events: [], cards: [] }, { id: team.id, order: team.order ?? 0, name: team.name, startStationId: team.startExerciseId ?? null, members: [] });
  const segments = segmentsFor(settings, startIndex);
  const events = await db.orm.public.StationEvent.where({ sessionId, teamId }).orderBy((e) => e.at.asc()).all();
  const last = events[events.length - 1];
  if (last && Date.now() - toMs(last.at) < MIN_GAP_MS) return { error: `Validation refusée : ${team.name} vient d'en recevoir une il y a ${Math.round((Date.now() - toMs(last.at)) / 1000)} s (double clic ?).` };
  const done = events.filter((e) => e.stationId !== CINDY_KEY).length;
  if (done >= segments.length) return { error: `${team.name} a terminé son parcours : il n'y a plus rien à valider.` };
  const key = segments[done].key;
  await db.orm.public.StationEvent.create({ sessionId, teamId, stationId: key, at: Temporal.Now.instant() });
  return { ok: true, key };
}

// Annule la derniere validation de CETTE equipe (station ou run).
export async function hxUndoTeamAction(sessionId: string, teamId: string): Promise<Result> {
  await requireGreffier();
  const last = await db.orm.public.StationEvent.where({ sessionId, teamId }).orderBy((e) => e.at.desc()).first();
  if (!last) return { error: "Rien à annuler pour cette équipe." };
  await db.orm.public.StationEvent.where({ id: last.id }).delete();
  return { ok: true };
}

// Annule la toute derniere validation de la seance, quelle que soit l'equipe.
export async function hxUndoAction(sessionId: string): Promise<Result> {
  await requireGreffier();
  const last = await db.orm.public.StationEvent.where({ sessionId }).orderBy((e) => e.at.desc()).first();
  if (!last) return { error: "Rien à annuler." };
  await db.orm.public.StationEvent.where({ id: last.id }).delete();
  return { ok: true };
}

// Carte jaune : +1 (course lancee ou terminee), -1 retire la derniere de l'equipe.
export async function hxCardAction(sessionId: string, teamId: string, delta: 1 | -1): Promise<Result> {
  await requireGreffier();
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs || !rs.startedAt) return { error: "Lance d'abord la course." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  if (delta > 0) {
    await db.orm.public.YellowCard.create({ raceStateId: rs.id, teamId, at: Temporal.Now.instant() });
    return { ok: true };
  }
  const last = await db.orm.public.YellowCard.where({ raceStateId: rs.id, teamId }).orderBy((c) => c.at.desc()).first();
  if (!last) return { error: "Cette équipe n'a pas de carte jaune." };
  await db.orm.public.YellowCard.where({ id: last.id }).delete();
  return { ok: true };
}

// Station de depart d'une equipe (null = round-robin sur son numero). Figee des sa premiere validation.
export async function hxSetStartAction(sessionId: string, teamId: string, stationId: string | null): Promise<Result> {
  await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  if (stationId !== null && !readHXSettings(session.settings).stations.some((s) => s.id === stationId)) return { error: "Station inconnue." };
  if (await db.orm.public.StationEvent.where({ sessionId, teamId }).first()) return { error: `${team.name} a déjà validé un segment : sa station de départ ne change plus.` };
  await db.orm.public.Team.where({ id: teamId }).update({ startExerciseId: stationId });
  return { ok: true };
}

export type HXSettingsInput = {
  stations: { label: string; reps: number; unit: string }[];
  runLabel: string;
  runParts: string[];
  runAfterLast: boolean;
  laps: number;
  capMin: number;
  penSec: number;
};

// Reglages de la seance (Session.settings.hyrox). Des qu'un pointage existe, stations et runs sont figes (le parcours
// de chaque equipe en depend) ; temps limite et penalite restent modifiables.
export async function hxSettingsAction(sessionId: string, input: HXSettingsInput): Promise<Result> {
  await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session) return { error: "Séance introuvable." };
  if (input.stations.length < HX_MIN_STATIONS || input.stations.length > HX_MAX_STATIONS) return { error: `Il faut entre ${HX_MIN_STATIONS} et ${HX_MAX_STATIONS} stations.` };
  const current = readHXSettings(session.settings);
  const next: HXSettings = readHXSettings({ hyrox: { ...input, stations: input.stations.map((s, i) => ({ id: `st${i + 1}`, ...s })) } });
  const locked = !!(await db.orm.public.StationEvent.where({ sessionId }).first());
  const courseChanged =
    next.runAfterLast !== current.runAfterLast ||
    next.laps !== current.laps ||
    next.runParts.join("|") !== current.runParts.join("|") ||
    next.stations.length !== current.stations.length ||
    next.stations.some((s, i) => s.label !== current.stations[i].label || s.reps !== current.stations[i].reps || s.unit !== current.stations[i].unit);
  if (locked && courseChanged) return { error: "Des validations existent déjà : les stations, les runs et les tours ne se modifient plus (« Remettre à zéro » pour repartir)." };
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  // Une station de depart qui n'existe plus (moins de stations) retombe sur le round-robin.
  if (next.stations.length < current.stations.length) {
    const ids = new Set(next.stations.map((s) => s.id));
    for (const t of await db.orm.public.Team.where({ sessionId }).all()) if (t.startExerciseId && !ids.has(t.startExerciseId)) await db.orm.public.Team.where({ id: t.id }).update({ startExerciseId: null });
  }
  // Les colonnes du Touche-Coule lisent directement ces stations (session-exercises.ts).
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: { ...prev, hyrox: next } });
  return { ok: true };
}
