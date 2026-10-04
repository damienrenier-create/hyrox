"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { openSession, parseHHMM, upcomingSessions, instantAtBrussels, isSessionOpen, slotSessionSettings, teamsNeeded, toMs } from "@/lib/scheduling";
import { MAX_CLASSES } from "@/lib/session-roles";
import { PROTECTED_MESSAGE, sessionsPlayedByRealStudents } from "@/lib/session-protect";
import { getWodEngine } from "@/lib/wod-engines";

// Les coachs (ADMIN) tiennent la console comme DAMZER : ouvrir, preparer, fermer une seance, gerer
// cycles, seances-types et creneaux. Ce qu'ils ne peuvent PAS faire, c'est supprimer : toute action
// destructrice garde `requireMaster`.
async function requireStaff() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  return user;
}

async function requireMaster() {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") throw new Error("Accès refusé (réservé à DAMZER).");
  return user;
}

function fail(msg: string): never {
  redirect(`/admin?msg=${encodeURIComponent(msg)}`);
}

function done(msg?: string): never {
  revalidatePath("/admin");
  redirect(msg ? `/admin?ok=${encodeURIComponent(msg)}` : "/admin");
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string, def: number) => {
  const n = parseInt(str(fd, k), 10);
  return Number.isFinite(n) ? n : def;
};
// Nombre d'equipes propose par le WOD (20 pour la Pyramide), sans jamais lever sur un type inconnu.
const defaultTeamsOf = (wodType: string) => {
  try {
    return getWodEngine(wodType).defaultTeams ?? 20;
  } catch {
    return 20;
  }
};

// ===== Cycles =====

// Classes cochees dans un formulaire (cases « classes ») ; vide = toutes les classes.
const classesOf = (fd: FormData) => [...new Set(fd.getAll("classes").map(String).map((c) => c.trim()).filter(Boolean))];

export async function createCycleAction(formData: FormData) {
  await requireStaff();
  const name = str(formData, "name");
  if (!name) fail("Nom du cycle requis.");
  const classes = classesOf(formData);
  const all = await db.orm.public.Cycle.where({}).all();
  const cycle = await db.orm.public.Cycle.create({ name, order: all.length + 1, isCurrent: all.length === 0, classes: classes.length ? classes : null });
  done(`Cycle « ${cycle.name} » créé${classes.length ? ` pour ${classes.length} classe(s)` : " pour toutes les classes"}.`);
}

// Classes concernees par un cycle : les creneaux des autres classes n'ouvrent rien dans ce cycle.
export async function setCycleClassesAction(formData: FormData) {
  await requireStaff();
  const id = str(formData, "id");
  const cycle = await db.orm.public.Cycle.where({ id }).first();
  if (!cycle) fail("Cycle introuvable.");
  const classes = classesOf(formData);
  await db.orm.public.Cycle.where({ id }).update({ classes: classes.length ? classes : null });
  done(`Cycle « ${cycle!.name} » : ${classes.length ? `${classes.length} classe(s)` : "toutes les classes"}.`);
}

export async function renameCycleAction(formData: FormData) {
  await requireStaff();
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!name) fail("Nom requis.");
  await db.orm.public.Cycle.where({ id }).update({ name });
  done();
}

export async function setCurrentCycleAction(formData: FormData) {
  await requireStaff();
  const id = str(formData, "id");
  const all = await db.orm.public.Cycle.where({}).all();
  for (const c of all) if (c.isCurrent) await db.orm.public.Cycle.where({ id: c.id }).update({ isCurrent: false });
  await db.orm.public.Cycle.where({ id }).update({ isCurrent: true });
  done();
}

export async function deleteCycleAction(formData: FormData) {
  await requireMaster();
  const id = str(formData, "id");
  if (await db.orm.public.Session.where({ cycleId: id }).first()) fail("Ce cycle a déjà des séances : il ne peut pas être supprimé.");
  await db.orm.public.Cycle.where({ id }).delete(); // cascade sur les seances-types
  done("Cycle supprimé.");
}

// ===== Seances-types d'un cycle =====

export async function addPlanAction(formData: FormData) {
  await requireStaff();
  const cycleId = str(formData, "cycleId");
  const wodType = str(formData, "wodType");
  const label = str(formData, "label");
  const numTeams = Math.min(50, Math.max(1, int(formData, "numTeams", defaultTeamsOf(wodType))));
  const refereeMode = formData.get("refereeMode") === "on";
  if (!label) fail("Nom de la séance requis.");
  try {
    getWodEngine(wodType);
  } catch {
    fail("Type de séance inconnu.");
  }
  const existing = await db.orm.public.CyclePlan.where({ cycleId }).all();
  await db.orm.public.CyclePlan.create({
    cycleId,
    wodType: wodType as "PYRAMIDE_CLASSIQUE",
    label,
    order: existing.length + 1,
    isCurrent: existing.length === 0,
    numTeams,
    refereeMode,
  });
  done(`Séance « ${label} » ajoutée au cycle.`);
}

export async function setCurrentPlanAction(formData: FormData) {
  await requireStaff();
  const id = str(formData, "id");
  const plan = await db.orm.public.CyclePlan.where({ id }).first();
  if (!plan) fail("Séance-type introuvable.");
  const siblings = await db.orm.public.CyclePlan.where({ cycleId: plan.cycleId }).all();
  for (const p of siblings) if (p.isCurrent) await db.orm.public.CyclePlan.where({ id: p.id }).update({ isCurrent: false });
  await db.orm.public.CyclePlan.where({ id }).update({ isCurrent: true });
  done(`« ${plan.label} » est maintenant la séance de la semaine.`);
}

export async function deletePlanAction(formData: FormData) {
  await requireMaster();
  const id = str(formData, "id");
  if (await db.orm.public.Session.where({ planId: id }).first()) fail("Cette séance-type a déjà été jouée : elle ne peut pas être supprimée.");
  await db.orm.public.CyclePlan.where({ id }).delete();
  done();
}

// ===== Ouverture / fermeture manuelle =====

export async function openSessionAction(formData: FormData) {
  const user = await requireStaff();
  const planId = str(formData, "planId");
  const classes = formData.getAll("classes").map(String).filter(Boolean);
  const hours = Math.min(12, Math.max(1, int(formData, "hours", 3)));
  if (classes.length > MAX_CLASSES) fail(`Maximum ${MAX_CLASSES} classes.`);

  // Calendrier : si une date est choisie, la seance est PROGRAMMEE (invisible des eleves jusqu'a l'heure)
  // au lieu d'etre ouverte tout de suite. Aucune repetition : une seule seance, a cette date-la.
  const day = str(formData, "day"); // AAAA-MM-JJ
  const from = parseHHMM(str(formData, "from") || "");
  const to = parseHHMM(str(formData, "to") || "");
  let opensAt: ReturnType<typeof instantAtBrussels> | null = null;
  let closesAtPlanned: ReturnType<typeof instantAtBrussels> | null = null;
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail("Date invalide.");
    if (from === null || to === null) fail("Indique l'heure de début et de fin pour programmer une séance.");
    if (to <= from) fail("L'heure de fin doit être après le début.");
    opensAt = instantAtBrussels(day, from);
    closesAtPlanned = instantAtBrussels(day, to);
    if (Date.parse(opensAt.toString()) < Date.now() - 60_000) fail("Cette date est déjà passée.");
  }

  let wodType = str(formData, "wodType") || "PYRAMIDE_CLASSIQUE";
  let label = str(formData, "label");
  // Nombre d'equipes : celui qui est tape ; champ vide = ce qu'il faut pour l'effectif des classes cochees (WOD a
  // equipes de taille fixe), sinon celui de la seance-type.
  const typedTeams = parseInt(str(formData, "numTeams"), 10);
  let fallbackTeams = defaultTeamsOf(wodType);
  let refereeMode = formData.get("refereeMode") === "on";
  let cycleId: string | null = null;

  if (planId) {
    const plan = await db.orm.public.CyclePlan.where({ id: planId }).first();
    if (!plan) fail("Séance-type introuvable.");
    wodType = plan.wodType;
    label = label || plan.label;
    fallbackTeams = plan.numTeams;
    refereeMode = formData.has("refereeModeSet") ? refereeMode : plan.refereeMode;
    cycleId = plan.cycleId;
  }
  if (!label) label = "WOD Pyramide";
  const numTeams = Number.isFinite(typedTeams) ? Math.min(50, Math.max(1, typedTeams)) : await teamsNeeded(wodType, classes, null, fallbackTeams);

  const session = await openSession({
    wodType,
    label,
    classes,
    numTeams,
    refereeMode,
    cycleId,
    planId: planId || null,
    teacherId: user.id, // celui qui ouvre la tient
    opensAt,
    closesAt: closesAtPlanned ?? Temporal.Now.instant().add({ hours }),
    autoOpened: false,
  });
  if (opensAt) {
    redirect(`/greffier?session=${session.id}`);
  }
  done(`Séance « ${session.label} » ouverte pour ${classes.length ? classes.join(", ") : "toutes les classes"} (${hours} h).`);
}

// Un prof (DAMZER ou coach) tranche une demande d'arbitrage depuis la console.
export async function decideRefereeFormAction(formData: FormData) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) throw new Error("Accès refusé.");
  const sessionId = str(formData, "sessionId");
  const userId = str(formData, "userId");
  const decision = str(formData, "decision") === "REFUSED" ? "REFUSED" : "APPROVED";
  const row = await db.orm.public.SessionReferee.where({ sessionId, userId }).first();
  if (!row) fail("Demande introuvable.");
  await db.orm.public.SessionReferee.where({ id: row.id }).update({ status: decision, decidedBy: user.name, decidedAt: Temporal.Now.instant() });
  done(decision === "APPROVED" ? "Arbitre autorisé." : "Demande refusée.");
}

// Prepare une seance programmee AVANT son creneau : elle est creee des maintenant (equipes vides, reglages
// modifiables dans le greffier) mais reste invisible des eleves jusqu'a `opensAt`. Le slotKey est le meme que
// celui de l'ouverture automatique : le creneau venu, aucune seance en double n'est creee.
export async function prepareSessionAction(formData: FormData) {
  await requireStaff();
  const slotKey = str(formData, "slotKey");
  const upcoming = await upcomingSessions(30);
  const slot = upcoming.find((u) => u.slotKey === slotKey);
  if (!slot) fail("Créneau introuvable (l'horaire ou la séance de la semaine a changé).");
  if (slot.sessionId) fail("Cette séance est déjà préparée.");

  const session = await openSession({
    wodType: slot.wodType,
    label: slot.planLabel,
    classes: slot.classes,
    numTeams: slot.numTeams,
    refereeMode: slot.refereeMode,
    cycleId: slot.cycleId,
    planId: slot.planId,
    teacherId: slot.teacherId,
    opensAt: instantAtBrussels(slot.dateKey, slot.startMin),
    closesAt: instantAtBrussels(slot.dateKey, slot.endMin),
    slotKey: slot.slotKey,
    autoOpened: true,
    settings: slotSessionSettings(slot.sex, slot.teacherIds),
  });
  redirect(`/greffier?session=${session.id}`);
}

// Annule une preparation : seulement si rien n'a encore ete fait dessus (aucun eleve, aucune evaluation).
export async function unprepareSessionAction(formData: FormData) {
  await requireMaster();
  const id = str(formData, "id");
  const session = await db.orm.public.Session.where({ id }).first();
  if (!session) fail("Séance introuvable.");
  if (!session.opensAt) fail("Cette séance est déjà ouverte : utilise « Fermer ».");
  if (await db.orm.public.Evaluation.where({ sessionId: id }).first()) fail("Cette séance a déjà des évaluations.");

  const teams = await db.orm.public.Team.where({ sessionId: id }).all();
  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teamIds)).all() : [];
  if (members.length) fail(`${members.length} élève(s) y sont déjà encodés : retire-les d'abord ou garde la séance.`);

  for (const f of await db.orm.public.RefereeFleet.where({ sessionId: id }).all()) await db.orm.public.RefereeFleet.where({ id: f.id }).delete();
  for (const p of await db.orm.public.BoatPlacement.where({ sessionId: id }).all()) await db.orm.public.BoatPlacement.where({ id: p.id }).delete();
  for (const r of await db.orm.public.SessionReferee.where({ sessionId: id }).all()) await db.orm.public.SessionReferee.where({ id: r.id }).delete();
  const rs = await db.orm.public.RaceState.where({ sessionId: id }).first();
  if (rs) {
    for (const p of await db.orm.public.RacePause.where({ raceStateId: rs.id }).all()) await db.orm.public.RacePause.where({ id: p.id }).delete();
    await db.orm.public.RaceState.where({ id: rs.id }).delete();
  }
  for (const t of teams) await db.orm.public.Team.where({ id: t.id }).delete();
  await db.orm.public.Session.where({ id }).delete();
  done("Préparation annulée.");
}

// Fermer coupe la seance pour tout le monde (greffier, arbitres, eleves) : reserve a DAMZER, un coach qui
// cherchait le bouton « Arbitrer » a deja ferme une seance en cours par erreur.
export async function closeSessionAction(formData: FormData) {
  await requireMaster();
  await db.orm.public.Session.where({ id: str(formData, "id") }).update({ isActive: false });
  done("Séance fermée.");
}

// QCM bonus du WOD Hyrox (Sartay 01/10) : ouvert par le prof, ferme a la main depuis la console. Les reponses deja
// donnees restent (regle d'or) ; ferme = plus personne ne peut repondre.
export async function setQuizOpenAction(formData: FormData) {
  await requireStaff();
  const s = await db.orm.public.Session.where({ id: str(formData, "id") }).first();
  if (!s) fail("Séance introuvable.");
  if (s.wodType !== "HYROX") fail("Le QCM n'existe que pour le WOD Hyrox.");
  const open = str(formData, "open") === "1";
  const prev = (s.settings as Record<string, unknown> | null) ?? {};
  const quiz: Record<string, string | boolean> = { ...((prev.quiz as Record<string, string | boolean> | undefined) ?? {}), open };
  quiz[open ? "openedAt" : "closedAt"] = new Date().toISOString();
  await db.orm.public.Session.where({ id: s.id }).update({ settings: { ...prev, quiz } });
  done(open ? "QCM ouvert : les élèves de cette séance le voient sur leur téléphone." : "QCM fermé : plus personne ne peut répondre.");
}

// ===== Suppression douce (Sartay 27/09 : « une tete de mort sur la fiche, une confirmation, un soft delete ») =====
// La seance disparait de partout mais reste en base : « Annuler » juste apres, ou Nettoyage > Corbeille pour la
// restaurer ou l'effacer pour de bon. L'echauffement et le finisher d'un WOD Level suivent leur WOD.
function childIdsOf(settings: unknown): string[] {
  const c = (settings as { children?: Record<string, unknown> } | null)?.children;
  return c && typeof c === "object" ? Object.values(c).filter((v): v is string => typeof v === "string") : [];
}
export async function softDeleteSessionAction(formData: FormData) {
  const user = await requireMaster();
  const s = await db.orm.public.Session.where({ id: str(formData, "id") }).first();
  if (!s) fail("Séance introuvable.");
  if (s.deletedAt) done("Cette séance est déjà supprimée.");
  if (isSessionOpen(s)) fail("Cette séance est ouverte aux élèves : ferme-la d'abord.");
  if ((await sessionsPlayedByRealStudents([s.id, ...childIdsOf(s.settings)])).size) fail(PROTECTED_MESSAGE);
  const at = Temporal.Now.instant();
  for (const id of [s.id, ...childIdsOf(s.settings)]) await db.orm.public.Session.where({ id }).update({ deletedAt: at, deletedBy: user.name, isActive: false });
  revalidatePath("/admin");
  // Depuis la liste de toutes les seances (29/09 nuit) : retour sur cette liste, meme bandeau d'annulation.
  const back = str(formData, "back").startsWith("/admin/seances") ? str(formData, "back") : "/admin";
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${encodeURIComponent(`💀 Séance « ${s.label ?? s.wodType} » supprimée.`)}&undo=${s.id}`);
}

// Menage des brouillons (Sartay 29/09 nuit : « beaucoup de brouillons qui trainent ») : suppression DOUCE, en une fois,
// des seances jamais lancees, ni ouvertes ni programmees (leurs echauffement et finisher suivent). Restaurables une par
// une dans Nettoyage > Corbeille.
export async function softDeleteDraftsAction(formData: FormData) {
  const user = await requireMaster();
  const ids = str(formData, "ids").split(",").filter(Boolean);
  const at = Temporal.Now.instant();
  let n = 0;
  for (const id of ids) {
    const s = await db.orm.public.Session.where({ id }).first();
    if (!s || s.deletedAt || isSessionOpen(s) || (s.isActive && s.opensAt && toMs(s.opensAt) > Date.now())) continue;
    const rs = await db.orm.public.RaceState.where({ sessionId: s.id }).first();
    if (rs?.startedAt) continue; // lancee : ce n'est pas un brouillon
    if ((await sessionsPlayedByRealStudents([s.id, ...childIdsOf(s.settings)])).size) continue; // historique protege
    for (const x of [s.id, ...childIdsOf(s.settings)]) await db.orm.public.Session.where({ id: x }).update({ deletedAt: at, deletedBy: user.name, isActive: false });
    n++;
  }
  revalidatePath("/admin");
  revalidatePath("/admin/seances");
  redirect(`/admin/seances?ok=${encodeURIComponent(`💀 ${n} brouillon${n > 1 ? "s" : ""} supprimé${n > 1 ? "s" : ""} (restaurables dans Nettoyage › Corbeille).`)}`);
}
export async function restoreSessionAction(formData: FormData) {
  await requireMaster();
  const b = str(formData, "back");
  const back = b === "/admin/nettoyage" || b === "/admin/seances" ? b : "/admin";
  const s = await db.orm.public.Session.where({ id: str(formData, "id") }).first();
  if (!s) redirect(`${back}?msg=${encodeURIComponent("Séance introuvable.")}`);
  for (const id of [s.id, ...childIdsOf(s.settings)]) await db.orm.public.Session.where({ id }).update({ deletedAt: null, deletedBy: null });
  revalidatePath("/admin");
  revalidatePath("/admin/nettoyage");
  redirect(`${back}?ok=${encodeURIComponent(`Séance « ${s.label ?? s.wodType} » restaurée.`)}`);
}

// Rouvrir une seance fermee trop tot : possible tant que sa fenetre n'est pas passee (ou sans fenetre).
export async function reopenSessionAction(formData: FormData) {
  await requireStaff();
  const s = await db.orm.public.Session.where({ id: str(formData, "id") }).first();
  if (!s) fail("Séance introuvable.");
  if (s.closesAt && new Date(String(s.closesAt)).getTime() <= Date.now()) fail("Le créneau de cette séance est passé : ouvre-en une nouvelle.");
  await db.orm.public.Session.where({ id: s.id }).update({ isActive: true });
  done("Séance rouverte.");
}
