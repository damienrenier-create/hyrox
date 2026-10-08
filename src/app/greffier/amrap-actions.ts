"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { amrapCapState } from "@/lib/amrap-context";
import { AMRAP_MAX_CAP, AMRAP_MAX_EXERCISES, AMRAP_MIN_CAP, AMRAP_MIN_EXERCISES, AMRAP_MIN_LAP_MS, AMRAP_UNITS, readAmrapSettings } from "@/lib/wod-engines/templates/amrap-engine";
import { finishRaceAction } from "./actions";

// Actions du greffier AMRAP (Sartay 08/10) : un clic = un tour de l'equipe ; fin automatique au bout du temps.
type Result = { error: string } | { ok: true };

async function requireGreffier() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}
const toMs = (v: unknown) => new Date(String(v)).getTime();

// Un tour de plus pour cette equipe : course lancee, pas en pause, avant la fin du temps, pas un double clic.
export async function amrapLapAction(sessionId: string, teamId: string): Promise<Result> {
  await requireGreffier();
  const cap = await amrapCapState(sessionId);
  if (!cap) return { error: "Séance introuvable." };
  if (!cap.started) return { error: "Lance d'abord la course avec « Début de course »." };
  if (cap.ended) return { error: "La course est terminée." };
  if (cap.paused) return { error: "La course est en pause. Appuie sur « Reprendre » d'abord." };
  if (cap.reached) return { error: "Le temps est écoulé : le tour en cours ne compte pas." };
  const team = await db.orm.public.Team.where({ id: teamId, sessionId }).first();
  if (!team) return { error: "Équipe introuvable." };
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs) return { error: "État de course manquant." };
  const last = await db.orm.public.Lap.where({ raceStateId: rs.id, teamId }).orderBy((l) => l.at.desc()).first();
  if (last && Date.now() - toMs(last.at) < AMRAP_MIN_LAP_MS) {
    return { error: `Tour refusé : ${team.name} vient d'en valider un il y a ${Math.round((Date.now() - toMs(last.at)) / 1000)} s (double clic ?).` };
  }
  await db.orm.public.Lap.create({ raceStateId: rs.id, teamId, at: Temporal.Now.instant() });
  return { ok: true };
}

// Fin du temps : la course se termine, datee de l'instant exact de la fin (pas de l'instant ou l'ecran l'a vu).
export async function amrapCapFinishAction(sessionId: string): Promise<{ error: string } | { ok: true; ended: boolean }> {
  await requireGreffier();
  const cap = await amrapCapState(sessionId);
  if (!cap) return { error: "Séance introuvable." };
  if (cap.ended) return { ok: true, ended: true };
  if (!cap.started || !cap.reached || cap.capAtMs === null) return { ok: true, ended: false };
  await finishRaceAction(sessionId);
  const at = Temporal.Instant.fromEpochMilliseconds(Math.round(cap.capAtMs));
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs) await db.orm.public.RaceState.where({ id: rs.id }).update({ endedAt: at });
  await db.orm.public.Session.where({ id: sessionId }).update({ raceEndedAt: at });
  return { ok: true, ended: true };
}

// Reglages (avant le depart) : duree, depart decale, exercices et quantites. Les exercices sont une info pour les eleves.
export type AmrapSettingsInput = { capMin: number; staggered: boolean; exercises: { label: string; reps: number; unit: string }[] };
export async function amrapSettingsAction(sessionId: string, input: AmrapSettingsInput): Promise<Result> {
  await requireGreffier();
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "AMRAP") return { error: "Séance introuvable." };
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (rs?.startedAt) return { error: "La course est lancée : les réglages sont verrouillés." };
  const exercises = input.exercises.map((e) => ({ label: String(e.label ?? "").trim().slice(0, 40), reps: Math.round(Number(e.reps)), unit: String(e.unit) })).filter((e) => e.label);
  if (exercises.length < AMRAP_MIN_EXERCISES || exercises.length > AMRAP_MAX_EXERCISES) return { error: `De ${AMRAP_MIN_EXERCISES} à ${AMRAP_MAX_EXERCISES} exercices.` };
  if (exercises.some((e) => !Number.isFinite(e.reps) || e.reps < 1 || e.reps > 999)) return { error: "Quantité invalide (de 1 à 999)." };
  if (exercises.some((e) => !(AMRAP_UNITS as readonly string[]).includes(e.unit))) return { error: "Unité inconnue." };
  const capMin = Math.round(Number(input.capMin));
  if (!Number.isFinite(capMin) || capMin < AMRAP_MIN_CAP || capMin > AMRAP_MAX_CAP) return { error: `Durée : de ${AMRAP_MIN_CAP} à ${AMRAP_MAX_CAP} minutes.` };
  const amrap = readAmrapSettings({ amrap: { capMin, staggered: !!input.staggered, exercises } });
  const prev = (session.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: sessionId }).update({ settings: JSON.parse(JSON.stringify({ ...prev, amrap })) });
  return { ok: true };
}
