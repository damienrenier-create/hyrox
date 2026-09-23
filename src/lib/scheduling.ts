import type { Temporal as TemporalNS } from "temporal-spec";
import { db } from "@/lib/db";
import { getWodEngine } from "@/lib/wod-engines";
import { readSessionClasses } from "@/lib/session-roles";
import { groupSlots, type SlotGroup, type SlotRow } from "@/lib/journal";
import { teacherNameById } from "@/lib/staff";

type Instant = TemporalNS.Instant;

export const TZ = "Europe/Brussels";
// Aides pures (jours, HH:MM) : elles vivent dans journal.ts pour etre importables cote client ; re-exportees ici.
export { WEEKDAYS, fmtMin, parseHHMM } from "@/lib/journal";

export function toMs(v: unknown): number {
  return new Date(String(v)).getTime();
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

type SessionRow = { id: string; isActive: boolean; opensAt?: unknown | null; closesAt: unknown | null };

// Une seance PREPAREE a l'avance (opensAt dans le futur) n'est pas encore ouverte : les eleves ne la voient
// pas, mais DAMZER et le greffier peuvent deja la configurer via /greffier?session=<id>.
export function isSessionOpen(s: SessionRow, nowMs = Date.now()): boolean {
  if (!s.isActive) return false;
  if (s.opensAt && nowMs < toMs(s.opensAt)) return false;
  return !s.closesAt || nowMs < toMs(s.closesAt);
}

export function isScheduled(s: SessionRow, nowMs = Date.now()): boolean {
  return s.isActive && !!s.opensAt && nowMs < toMs(s.opensAt);
}

// Seances ouvertes maintenant. Les seances dont la fenetre est depassee sont fermees (isActive=false) au passage :
// pas de cron necessaire, tout est calcule a la lecture.
export async function listOpenSessions() {
  const active = await db.orm.public.Session.where({ isActive: true }).orderBy((s) => s.createdAt.desc()).all();
  const now = Date.now();
  const open = [];
  for (const s of active) {
    if (isSessionOpen(s, now)) open.push(s);
    else if (!isScheduled(s, now)) await db.orm.public.Session.where({ id: s.id }).update({ isActive: false });
  }
  return open;
}

// Cle d'ouverture automatique : une seule seance par (date, prof, seance-type, debut, fin). Le prof en fait
// partie depuis le journal de classe : deux profs qui donnent cours a la meme heure ont chacun leur seance.
export function slotKeyFor(dateKey: string, teacherId: string | null, planId: string, startMin: number, endMin: number): string {
  return `${dateKey}_${teacherId ?? "global"}_${planId}_${startMin}_${endMin}`;
}

type PlanRow = { id: string; cycleId: string; label: string; wodType: string; numTeams: number; refereeMode: boolean };

// La seance-type d'un groupe : celle imposee sur le creneau si elle existe encore, sinon la seance de la semaine.
function planOf(g: SlotGroup, planById: Map<string, PlanRow>, weekly: PlanRow | null): PlanRow | null {
  return (g.planId && planById.get(g.planId)) || weekly;
}

async function allPlansById(): Promise<Map<string, PlanRow>> {
  const plans = await db.orm.public.CyclePlan.where({}).all();
  return new Map(plans.map((p) => [p.id, p as PlanRow]));
}

export type UpcomingSlot = {
  slotKey: string;
  dateKey: string; // AAAA-MM-JJ (Bruxelles)
  weekday: number;
  startMin: number;
  endMin: number;
  startsAtMs: number;
  classes: string[];
  teacherId: string | null;
  teacherName: string | null;
  cycleId: string;
  planId: string;
  planLabel: string;
  wodType: string;
  numTeams: number;
  refereeMode: boolean;
  sessionId: string | null; // deja preparee ?
};

// Les prochains creneaux (lundi-vendredi) de tous les journaux de classe — ou d'un seul prof — dans l'ordre
// chronologique. Meme regroupement que l'ouverture automatique : les classes d'un meme groupe = une seule
// seance. Sert a anticiper (preparer les equipes et les reglages avant l'heure).
export async function upcomingSessions(limit = 10, daysAhead = 21, teacherId?: string): Promise<UpcomingSlot[]> {
  const { plan: weekly } = await currentCycleAndPlan();
  const all = (await db.orm.public.ClassSlot.where({}).all()) as SlotRow[];
  const slots = teacherId ? all.filter((s) => s.teacherId === teacherId) : all;
  if (!slots.length) return [];
  const [planById, names] = await Promise.all([allPlansById(), teacherNameById()]);

  const now = brusselsNow();
  const today = Temporal.Now.zonedDateTimeISO(TZ);
  const out: UpcomingSlot[] = [];

  for (let d = 0; d < daysAhead && out.length < limit * 3; d++) {
    const day = today.add({ days: d });
    const weekday = day.dayOfWeek;
    if (weekday > 5) continue;
    const dateKey = day.toPlainDate().toString();
    const rows = slots.filter((s) => s.weekday === weekday && !(d === 0 && s.endMin <= now.minutes)); // creneau deja passe aujourd'hui

    for (const g of groupSlots(rows)) {
      const p = planOf(g, planById, weekly as PlanRow | null);
      if (!p) continue; // sans seance-type, rien ne peut s'ouvrir
      out.push({
        slotKey: slotKeyFor(dateKey, g.teacherId, p.id, g.startMin, g.endMin),
        dateKey,
        weekday,
        startMin: g.startMin,
        endMin: g.endMin,
        startsAtMs: toMs(instantAtBrussels(dateKey, g.startMin).toString()),
        classes: g.classes.map((c) => c.className).sort().slice(0, 5),
        teacherId: g.teacherId,
        teacherName: g.teacherId ? names.get(g.teacherId) ?? null : null,
        cycleId: p.cycleId,
        planId: p.id,
        planLabel: p.label,
        wodType: p.wodType,
        numTeams: p.numTeams,
        refereeMode: p.refereeMode,
        sessionId: null,
      });
    }
  }

  out.sort((a, b) => a.startsAtMs - b.startsAtMs);
  const top = out.slice(0, limit);
  for (const u of top) {
    const existing = await db.orm.public.Session.where({ slotKey: u.slotKey }).first();
    u.sessionId = existing?.id ?? null;
  }
  return top;
}

export type OpenSessionInput = {
  wodType: string;
  label: string;
  classes: string[];
  numTeams: number;
  refereeMode: boolean;
  cycleId?: string | null;
  planId?: string | null;
  teacherId?: string | null; // prof qui tient la seance (journal de classe, ou celui qui l'ouvre a la main)
  opensAt?: Instant | null; // seance preparee : pas visible des eleves avant cette heure
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
      teacherId: input.teacherId ?? null,
      label: input.label,
      slotKey: input.slotKey ?? null,
      opensAt: input.opensAt ?? null,
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

// Ouverture automatique : pour chaque groupe (prof, debut, fin) en creneau MAINTENANT, ouvre sa seance-type
// (celle du creneau, sinon la seance de la semaine) si ce n'est pas deja fait — slotKey unique = pas de doublon,
// meme si deux appareils arrivent en meme temps. `onlyClasses` limite la verification (ex : la classe de l'eleve),
// mais le groupe touche s'ouvre avec TOUTES ses classes.
export async function ensureAutoSessions(onlyClasses?: string[]) {
  const { weekday, minutes, dateKey } = brusselsNow();
  if (weekday > 5) return [];

  const today = (await db.orm.public.ClassSlot.where({ weekday }).all()) as SlotRow[];
  const active = today.filter((s) => s.startMin <= minutes && minutes < s.endMin);
  const wanted = onlyClasses ? active.filter((s) => onlyClasses.includes(s.className)) : active;
  if (wanted.length === 0) return [];
  const wantedIds = new Set(wanted.map((s) => s.id));
  const groups = groupSlots(active).filter((g) => g.classes.some((c) => wantedIds.has(c.id)));

  const { plan: weekly } = await currentCycleAndPlan();
  const planById = await allPlansById();

  const created = [];
  for (const g of groups) {
    const p = planOf(g, planById, weekly as PlanRow | null);
    if (!p) continue;
    const slotKey = slotKeyFor(dateKey, g.teacherId, p.id, g.startMin, g.endMin);
    const existing = await db.orm.public.Session.where({ slotKey }).first();
    if (existing) continue;
    try {
      const session = await openSession({
        wodType: p.wodType,
        label: p.label,
        classes: g.classes.map((c) => c.className).sort().slice(0, 5),
        numTeams: p.numTeams,
        refereeMode: p.refereeMode,
        cycleId: p.cycleId,
        planId: p.id,
        teacherId: g.teacherId,
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
