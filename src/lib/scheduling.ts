import type { Temporal as TemporalNS } from "temporal-spec";
import { db } from "@/lib/db";
import { getWodEngine } from "@/lib/wod-engines";
import { readSessionClasses } from "@/lib/session-roles";

type Instant = TemporalNS.Instant;

export const TZ = "Europe/Brussels";
export const WEEKDAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function toMs(v: unknown): number {
  return new Date(String(v)).getTime();
}

export function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// Heure de Bruxelles (Vercel tourne en UTC) : jour de semaine 1=lundi..7=dimanche, minutes depuis minuit, date ISO.
export function brusselsNow() {
  const z = Temporal.Now.zonedDateTimeISO(TZ);
  return { weekday: z.dayOfWeek, minutes: z.hour * 60 + z.minute, dateKey: z.toPlainDate().toString() };
}

export function instantAtBrussels(dateKey: string, minutes: number): Instant {
  return Temporal.PlainDate.from(dateKey)
    .toZonedDateTime({ timeZone: TZ, plainTime: Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 }) })
    .toInstant();
}

type SessionRow = { id: string; isActive: boolean; closesAt: unknown | null };

export function isSessionOpen(s: SessionRow, nowMs = Date.now()): boolean {
  return s.isActive && (!s.closesAt || nowMs < toMs(s.closesAt));
}

// Seances ouvertes maintenant. Les seances dont la fenetre est depassee sont fermees (isActive=false) au passage :
// pas de cron necessaire, tout est calcule a la lecture.
export async function listOpenSessions() {
  const active = await db.orm.public.Session.where({ isActive: true }).orderBy((s) => s.createdAt.desc()).all();
  const now = Date.now();
  const open = [];
  for (const s of active) {
    if (isSessionOpen(s, now)) open.push(s);
    else await db.orm.public.Session.where({ id: s.id }).update({ isActive: false });
  }
  return open;
}

export type OpenSessionInput = {
  wodType: string;
  label: string;
  classes: string[];
  numTeams: number;
  refereeMode: boolean;
  cycleId?: string | null;
  planId?: string | null;
  closesAt?: Instant | null;
  slotKey?: string | null;
  autoOpened?: boolean;
};

// Creation d'une seance + ses equipes vides. Ne ferme PAS les autres seances ouvertes (deux profs peuvent
// tourner en parallele) : la fermeture vient de closesAt, de FIN DE COURSE ou du bouton Fermer de la console.
export async function openSession(input: OpenSessionInput) {
  getWodEngine(input.wodType); // moteur connu, sinon throw
  const numTeams = Math.min(50, Math.max(1, Math.floor(input.numTeams)));
  return db.transaction(async (tx) => {
    const session = await tx.orm.public.Session.create({
      wodType: input.wodType as "PYRAMIDE_CLASSIQUE",
      isActive: true,
      refereeMode: input.refereeMode,
      settings: { numTeams, classes: input.classes },
      cycleId: input.cycleId ?? null,
      planId: input.planId ?? null,
      label: input.label,
      slotKey: input.slotKey ?? null,
      closesAt: input.closesAt ?? null,
      autoOpened: input.autoOpened ?? false,
    });
    for (let i = 1; i <= numTeams; i++) {
      await tx.orm.public.Team.create({ name: `Équipe ${i}`, order: i, sessionId: session.id });
    }
    return session;
  });
}

export async function currentCycleAndPlan() {
  const cycle = await db.orm.public.Cycle.where({ isCurrent: true }).first();
  if (!cycle) return { cycle: null, plan: null };
  const plan = await db.orm.public.CyclePlan.where({ cycleId: cycle.id, isCurrent: true }).first();
  return { cycle, plan };
}

// Ouverture automatique : pour chaque groupe de classes en creneau MAINTENANT (meme debut/fin = seance commune),
// ouvre la seance de la semaine du cycle en cours si ce n'est pas deja fait (slotKey unique = pas de doublon,
// meme si deux appareils arrivent en meme temps). `onlyClasses` limite la verification (ex : la classe de l'eleve).
export async function ensureAutoSessions(onlyClasses?: string[]) {
  const { cycle, plan } = await currentCycleAndPlan();
  if (!cycle || !plan) return [];
  const { weekday, minutes, dateKey } = brusselsNow();
  if (weekday > 5) return [];

  const slots = (await db.orm.public.ClassSlot.where({ weekday }).all()).filter(
    (s) => s.startMin <= minutes && minutes < s.endMin && (!onlyClasses || onlyClasses.includes(s.className))
  );
  if (slots.length === 0) return [];

  // Toutes les classes du meme creneau (pas seulement celles demandees) partagent la seance.
  const allToday = onlyClasses ? await db.orm.public.ClassSlot.where({ weekday }).all() : slots;
  const groups = new Map<string, { startMin: number; endMin: number; classes: Set<string> }>();
  for (const s of slots) {
    const key = `${s.startMin}_${s.endMin}`;
    if (!groups.has(key)) groups.set(key, { startMin: s.startMin, endMin: s.endMin, classes: new Set() });
    for (const t of allToday) if (t.startMin === s.startMin && t.endMin === s.endMin) groups.get(key)!.classes.add(t.className);
  }

  const created = [];
  for (const g of groups.values()) {
    const slotKey = `${dateKey}_${plan.id}_${g.startMin}_${g.endMin}`;
    const existing = await db.orm.public.Session.where({ slotKey }).first();
    if (existing) continue;
    try {
      const session = await openSession({
        wodType: plan.wodType,
        label: plan.label,
        classes: [...g.classes].sort().slice(0, 5),
        numTeams: plan.numTeams,
        refereeMode: plan.refereeMode,
        cycleId: cycle.id,
        planId: plan.id,
        closesAt: instantAtBrussels(dateKey, g.endMin),
        slotKey,
        autoOpened: true,
      });
      created.push(session);
    } catch {
      // Course entre deux appareils : la contrainte unique sur slotKey a gagne, la seance existe deja.
    }
  }
  return created;
}

// Seances ouvertes visibles pour un eleve : sa classe est dans la seance, ou il y est membre/arbitre.
export async function openSessionsForStudent(userId: string, className: string | null) {
  if (className) await ensureAutoSessions([className]);
  const open = await listOpenSessions();
  const out = [];
  for (const s of open) {
    const classes = readSessionClasses(s.settings);
    if (className && classes.includes(className)) {
      out.push(s);
      continue;
    }
    const teams = await db.orm.public.Team.where({ sessionId: s.id }).all();
    const memberships = await db.orm.public.TeamMember.where({ userId }).all();
    if (teams.some((t) => memberships.some((m) => m.teamId === t.id))) {
      out.push(s);
      continue;
    }
    if (await db.orm.public.SessionReferee.where({ sessionId: s.id, userId }).first()) out.push(s);
  }
  return out;
}
