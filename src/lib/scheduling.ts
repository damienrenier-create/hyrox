import type { Temporal as TemporalNS } from "temporal-spec";
import { db } from "@/lib/db";
import { getWodEngine } from "@/lib/wod-engines";
import { MAX_CLASSES, notDeleted, readSessionClasses, readSessionSex, readCycleClasses } from "@/lib/session-roles";
import { groupSlots, mergeCoTaught, slotsInForceAt, versionStart, type SlotGroup, type SlotRow } from "@/lib/journal";
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
  const active = (await db.orm.public.Session.where({ isActive: true }).orderBy((s) => s.createdAt.desc()).all()).filter(notDeleted);
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

// ===== Nombre d'equipes selon l'effectif (Sartay 04/10 : « encode par defaut le nombre d'equipes necessaire a la
// taille des groupes ») =====
// Pour un WOD a equipes de taille fixe (Eval par 3, Pyramide par 2), une seance s'ouvre avec autant d'equipes qu'il en
// faut pour TOUS les eleves inscrits dans ses classes (du sexe de la seance si elle est garcons / filles ; un eleve
// sans sexe renseigne compte dans les deux). Sinon — taille d'equipe libre, aucune classe, classe vide — on garde le
// nombre de la seance-type. Le greffier peut toujours l'ajuster avant le depart.
type ClassCount = { n: number; m: number; f: number };
const teamSizeOf = (wodType: string): number | null => {
  try {
    return getWodEngine(wodType).teamSize ?? null;
  } catch {
    return null;
  }
};
async function studentCounts(classes: string[]): Promise<Map<string, ClassCount>> {
  const out = new Map<string, ClassCount>();
  if (!classes.length) return out;
  for (const u of await db.orm.public.User.where((x) => x.className.in(classes)).all()) {
    if (u.role !== "STUDENT" || !u.className) continue;
    const c = out.get(u.className) ?? { n: 0, m: 0, f: 0 };
    c.n++;
    if (u.sex === "M") c.m++;
    else if (u.sex === "F") c.f++;
    out.set(u.className, c);
  }
  return out;
}
function teamsFor(wodType: string, classes: string[], sex: string | null, counts: Map<string, ClassCount>, fallback: number): number {
  const size = teamSizeOf(wodType);
  if (!size) return fallback;
  const n = classes.reduce((sum, c) => {
    const k = counts.get(c);
    return sum + (!k ? 0 : sex === "M" ? k.n - k.f : sex === "F" ? k.n - k.m : k.n);
  }, 0);
  return n ? Math.min(50, Math.max(1, Math.ceil(n / size))) : fallback;
}
export async function teamsNeeded(wodType: string, classes: string[], sex: string | null, fallback: number): Promise<number> {
  if (!teamSizeOf(wodType) || !classes.length) return fallback;
  return teamsFor(wodType, classes, sex, await studentCounts(classes), fallback);
}

// La seance-type d'un groupe : celle imposee sur le creneau si elle existe encore, sinon la seance de la semaine.
function planOf(g: SlotGroup, planById: Map<string, PlanRow>, weekly: PlanRow | null): PlanRow | null {
  return (g.planId && planById.get(g.planId)) || weekly;
}

// Classes autorisees par cycle (null = toutes). Un groupe dont aucune classe n'est dans le cycle de sa
// seance-type n'ouvre rien : le cycle Hyrox ne concerne pas les deuxiemes, leurs creneaux restent muets.
async function cycleClassesById(): Promise<Map<string, string[] | null>> {
  const cycles = await db.orm.public.Cycle.where({}).all();
  return new Map(cycles.map((c) => [c.id, readCycleClasses(c.classes)]));
}
function classesInCycle(g: SlotGroup, allowed: string[] | null | undefined): string[] {
  const names = g.classes.map((c) => c.className);
  return allowed ? names.filter((n) => allowed.includes(n)) : names;
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
  teacherId: string | null; // prof principal
  teacherIds: string[]; // tous les profs du creneau (co-enseignement)
  teacherName: string | null; // « D. Renier + G. Tasquin »
  cycleId: string;
  planId: string;
  planLabel: string;
  wodType: string;
  numTeams: number; // selon l'effectif des classes quand le WOD a des equipes de taille fixe, sinon celui de la seance-type
  refereeMode: boolean;
  sessionId: string | null; // deja preparee ?
  sex: string | null; // seance garcons (M) / filles (F) / mixte (null), heritee du creneau
  editable: boolean; // creneau de la version d'horaire la plus recente du prof (un ancien horaire encore en vigueur ne se retouche pas d'ici)
};

// Les prochains creneaux (lundi-vendredi) de tous les journaux de classe — ou d'un seul prof — dans l'ordre
// chronologique. Meme regroupement que l'ouverture automatique : les classes d'un meme groupe = une seule
// seance. Sert a anticiper (preparer les equipes et les reglages avant l'heure).
export async function upcomingSessions(limit = 10, daysAhead = 21, teacherId?: string): Promise<UpcomingSlot[]> {
  const { plan: weekly } = await currentCycleAndPlan();
  const all = (await db.orm.public.ClassSlot.where({}).all()) as SlotRow[];
  const slots = teacherId ? all.filter((s) => s.teacherId === teacherId) : all;
  if (!slots.length) return [];
  const [planById, names, cycleClasses] = await Promise.all([allPlansById(), teacherNameById(), cycleClassesById()]);

  const now = brusselsNow();
  const today = Temporal.Now.zonedDateTimeISO(TZ);
  const out: UpcomingSlot[] = [];

  for (let d = 0; d < daysAhead && out.length < limit * 3; d++) {
    const day = today.add({ days: d });
    const weekday = day.dayOfWeek;
    if (weekday > 5) continue;
    const dateKey = day.toPlainDate().toString();
    // Version d'horaire en vigueur ce jour-la (l'ancien horaire jusqu'a la veille du nouveau), creneaux deja passes aujourd'hui exclus.
    const rows = slotsInForceAt(slots, dateKey).filter((s) => s.weekday === weekday && !(d === 0 && s.endMin <= now.minutes));

    // Co-enseignement : deux profs avec les memes classes aux memes heures = un seul creneau, une seule seance.
    for (const g of mergeCoTaught(groupSlots(rows))) {
      const p = planOf(g, planById, weekly as PlanRow | null);
      if (!p) continue; // sans seance-type, rien ne peut s'ouvrir
      const inCycle = classesInCycle(g, cycleClasses.get(p.cycleId));
      if (!inCycle.length) continue; // aucune classe du groupe n'est dans ce cycle
      out.push({
        slotKey: slotKeyFor(dateKey, g.teacherId, p.id, g.startMin, g.endMin),
        dateKey,
        weekday,
        startMin: g.startMin,
        endMin: g.endMin,
        startsAtMs: toMs(instantAtBrussels(dateKey, g.startMin).toString()),
        classes: inCycle.sort().slice(0, MAX_CLASSES),
        teacherId: g.teacherId,
        teacherIds: g.teacherIds,
        teacherName: g.teacherIds.map((id) => names.get(id)).filter((n): n is string => !!n).join(" + ") || null,
        cycleId: p.cycleId,
        planId: p.id,
        planLabel: p.label,
        wodType: p.wodType,
        numTeams: p.numTeams,
        refereeMode: p.refereeMode,
        sessionId: null,
        sex: g.sex,
        editable: (g.validFrom ?? null) === versionStart(slots, g.teacherId),
      });
    }
  }

  out.sort((a, b) => a.startsAtMs - b.startsAtMs);
  const top = out.slice(0, limit);
  // Seances deja preparees : UNE requete groupee, pas une par creneau.
  const keys = top.map((u) => u.slotKey);
  const prepared = keys.length ? (await db.orm.public.Session.where((x) => x.slotKey.in(keys)).all()).filter(notDeleted) : [];
  const byKey = new Map(prepared.map((x) => [x.slotKey, x.id]));
  for (const u of top) u.sessionId = byKey.get(u.slotKey) ?? null;
  // Nombre d'equipes selon l'effectif des classes : UNE requete pour tous les creneaux affiches.
  const sized = top.filter((u) => teamSizeOf(u.wodType));
  if (sized.length) {
    const counts = await studentCounts([...new Set(sized.flatMap((u) => u.classes))]);
    for (const u of sized) u.numTeams = teamsFor(u.wodType, u.classes, u.sex, counts, u.numTeams);
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
  teamNumbers?: number[]; // seance jumelle (30/09) : numeros d'equipe qui suivent ceux de l'autre ecran
  settings?: Record<string, unknown>; // reglages en plus (seance jumelle : twinOf, temps impose, zombies)
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
      settings: { numTeams, classes: input.classes, ...(input.settings ?? {}) },
      cycleId: input.cycleId ?? null,
      planId: input.planId ?? null,
      teacherId: input.teacherId ?? null,
      label: input.label,
      slotKey: input.slotKey ?? null,
      opensAt: input.opensAt ?? null,
      closesAt: input.closesAt ?? null,
      autoOpened: input.autoOpened ?? false,
    });
    const numbers = input.teamNumbers?.length ? input.teamNumbers : Array.from({ length: numTeams }, (_, i) => i + 1);
    for (const n of numbers) {
      await tx.orm.public.Team.create({ name: `Équipe ${n}`, order: n, sessionId: session.id });
    }
    return session;
  });
}

// Reglages herites du creneau par la seance : garcons / filles (settings.sex) et co-profs (settings.coTeachers,
// quand plusieurs profs tiennent le creneau ensemble).
export function slotSessionSettings(sex: string | null, teacherIds: string[]): Record<string, unknown> {
  return { ...(sex ? { sex } : {}), ...(teacherIds.length > 1 ? { coTeachers: teacherIds } : {}) };
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

  // Tous les creneaux (la version en vigueur d'un prof se decide sur l'ensemble de ses creneaux, pas sur un seul jour).
  const all = (await db.orm.public.ClassSlot.where({}).all()) as SlotRow[];
  const today = slotsInForceAt(all, dateKey).filter((s) => s.weekday === weekday);
  const active = today.filter((s) => s.startMin <= minutes && minutes < s.endMin);
  const wanted = onlyClasses ? active.filter((s) => onlyClasses.includes(s.className)) : active;
  if (wanted.length === 0) return [];
  const wantedNames = new Set(wanted.map((s) => s.className));
  // Co-enseignement : les creneaux identiques de deux profs ne font qu'une seance.
  const groups = mergeCoTaught(groupSlots(active)).filter((g) => g.classes.some((c) => wantedNames.has(c.className)));

  const { plan: weekly } = await currentCycleAndPlan();
  const [planById, cycleClasses] = await Promise.all([allPlansById(), cycleClassesById()]);

  const created = [];
  for (const g of groups) {
    const p = planOf(g, planById, weekly as PlanRow | null);
    if (!p) continue;
    const inCycle = classesInCycle(g, cycleClasses.get(p.cycleId));
    if (!inCycle.length) continue; // creneau d'une classe hors cycle : rien ne s'ouvre
    const slotKey = slotKeyFor(dateKey, g.teacherId, p.id, g.startMin, g.endMin);
    const existing = await db.orm.public.Session.where({ slotKey }).first();
    if (existing) continue;
    try {
      const classes = inCycle.sort().slice(0, MAX_CLASSES);
      const session = await openSession({
        wodType: p.wodType,
        label: p.label,
        classes,
        numTeams: await teamsNeeded(p.wodType, classes, g.sex, p.numTeams),
        refereeMode: p.refereeMode,
        cycleId: p.cycleId,
        planId: p.id,
        teacherId: g.teacherId,
        closesAt: instantAtBrussels(dateKey, g.endMin),
        slotKey,
        autoOpened: true,
        settings: slotSessionSettings(g.sex, g.teacherIds),
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
  // Seance garcons / filles (01/10) : par sa classe, un eleve ne voit que la seance de son sexe (sexe inconnu : les deux).
  const me = open.some((s) => readSessionSex(s.settings)) ? await db.orm.public.User.where({ id: userId }).first() : null;
  const out = [];
  for (const s of open) {
    const classes = readSessionClasses(s.settings);
    const sex = readSessionSex(s.settings);
    if (className && classes.includes(className) && (!sex || !me?.sex || me.sex === sex)) {
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
