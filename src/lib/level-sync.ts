import { db } from "@/lib/db";
import { toMs } from "@/lib/scheduling";
import { elapsed } from "@/lib/wod-engines/templates/pyramide-engine";
import { readLevelCap } from "@/lib/level-context";
import { teamLadder } from "@/lib/level-coins";
import { absoluteFromRace, applyZombieCatches } from "@/lib/zombies";
import { cardsForTeam, emomNextCard, emomWaveAt, readEmom, readPenalties } from "@/lib/wod-engines/templates/level-engine";

// Greffier « hors ligne » (Sartay 28/09) : l'ecran garde les coches sur le PC, avec l'heure exacte du clic (temps de
// course), et les envoie en lot toutes les minutes (ou plus tot : BOSS, zombie, autre bouton, fermeture de page).
// Ici, le lot est rejoue dans l'ordre des clics : pour chaque coche, les zombies de l'equipe sont d'abord constates
// jusqu'a l'heure du clic, puis la coche est verifiee (niveau en cours, vague du finisher) et enregistree a son
// heure reelle. Le resultat est celui qu'on aurait eu en direct, meme apres une coupure de reseau.

export type LevelOp = { id: string; kind: "tick" | "untick"; teamId: string; level: number; card: number; atMs: number };
export type LevelOpResult = { id: string; ok: boolean; error?: string };

export async function applyLevelOps(sessionId: string, by: string, ops: LevelOp[]): Promise<LevelOpResult[]> {
  const clean = (Array.isArray(ops) ? ops : []).filter((o) => o && typeof o.id === "string" && (o.kind === "tick" || o.kind === "untick") && typeof o.teamId === "string" && Number.isInteger(o.level) && Number.isInteger(o.card) && Number.isFinite(o.atMs)).slice(0, 500);
  if (!clean.length) return [];
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.wodType !== "LEVEL") return clean.map((o) => ({ id: o.id, ok: false, error: "Séance introuvable." }));
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  if (!rs?.startedAt) return clean.map((o) => ({ id: o.id, ok: false, error: "Lance d'abord la course." }));
  const startedAtMs = toMs(rs.startedAt);
  const pauses = (await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()).map((p) => ({ from: toMs(p.from), to: p.to ? toMs(p.to) : null }));
  const nowMs = Date.now();
  const endRace = rs.endedAt ? elapsed(startedAtMs, pauses, toMs(rs.endedAt)) ?? 0 : (elapsed(startedAtMs, pauses, nowMs) ?? 0);
  const cap = readLevelCap(session.settings);
  const capMs = cap !== null ? cap * 60_000 : null;
  const teamIds = new Set((await db.orm.public.Team.where({ sessionId }).all()).map((t) => t.id));
  const emom = readEmom(session.settings);
  const results: LevelOpResult[] = [];
  // Ordre des clics (a heure egale, ordre de la file).
  const sorted = clean.map((o, i) => ({ o, i })).sort((a, b) => a.o.atMs - b.o.atMs || a.i - b.i).map((x) => x.o);
  for (const op of sorted) {
    if (!teamIds.has(op.teamId)) { results.push({ id: op.id, ok: false, error: "Équipe introuvable." }); continue; }
    // Heure du clic : jamais dans le futur du serveur (horloge du PC en avance), jamais apres la fin ni le temps impose.
    let atMs = Math.max(0, Math.min(op.atMs, endRace));
    if (capMs !== null && atMs > capMs) { results.push({ id: op.id, ok: false, error: "Temps écoulé." }); continue; }
    if (op.kind === "untick") {
      const row = await db.orm.public.LevelTick.where({ sessionId, teamId: op.teamId, level: op.level, card: op.card }).first();
      if (row) await db.orm.public.LevelTick.where({ id: row.id }).delete();
      results.push({ id: op.id, ok: true });
      continue;
    }
    // Zombies de l'equipe constates jusqu'a l'heure du clic (une vie perdue avant le clic compte d'abord).
    await applyZombieCatches(sessionId, op.teamId, undefined, { untilRaceMs: atMs });
    const settings = (await db.orm.public.Session.where({ id: sessionId }).first())?.settings ?? session.settings;
    const levels = teamLadder(settings, op.teamId);
    const l = levels.find((x) => x.number === op.level);
    const penalties = readPenalties(settings);
    if (!l || !cardsForTeam(l, op.teamId, penalties).some((x) => x.index === op.card)) { results.push({ id: op.id, ok: false, error: "Cette fiche n'est plus en jeu." }); continue; }
    const ticks = await db.orm.public.LevelTick.where({ sessionId, teamId: op.teamId }).all();
    const done = new Set(ticks.map((t) => `${t.level}_${t.card}`));
    if (done.has(`${op.level}_${op.card}`)) { results.push({ id: op.id, ok: true }); continue; }
    let refused: string | null = null;
    if (emom) {
      const wave = emomWaveAt(emom.waveMinutes, atMs);
      if (!wave) refused = "L'EMOM est terminé.";
      else if (wave.wave !== op.level) refused = `La coche est arrivée pendant la vague ${wave.wave}, pas la ${op.level}.`;
      else {
        const next = emomNextCard(l, op.teamId, ticks.map((t) => ({ teamId: t.teamId, level: t.level, card: t.card, atMs: 0 })));
        if (next && next.index !== op.card) refused = "Les fiches se cochent dans l'ordre.";
      }
    } else {
      for (const prev of levels) {
        if (prev.number === op.level) break;
        if (cardsForTeam(prev, op.teamId, penalties).some(({ index }) => !done.has(`${prev.number}_${index}`))) { refused = `Le niveau ${prev.number} n'est pas terminé (le zombie a pu faire redescendre l'équipe).`; break; }
      }
    }
    if (refused) { results.push({ id: op.id, ok: false, error: refused }); continue; }
    atMs = Math.max(0, atMs);
    const abs = absoluteFromRace(startedAtMs, pauses, atMs, nowMs);
    try {
      await db.orm.public.LevelTick.create({ sessionId, teamId: op.teamId, level: op.level, card: op.card, by, at: Temporal.Instant.fromEpochMilliseconds(Math.round(abs)) });
    } catch {
      /* unicite : deja cochee par un autre appareil */
    }
    results.push({ id: op.id, ok: true });
  }
  return results;
}
