import { db } from "@/lib/db";
import { openSession } from "@/lib/scheduling";
import { notDeleted, readSessionClasses } from "@/lib/session-roles";

// Seances jumelles (Sartay 30/09 : « deux greffiers qui projettent sur deux ecrans, 5 ou 6 equipes chacun ; deux
// seances a part qui ne discutent pas entre elles »). Un meme creneau (memes classes, memes horaires) se dedouble :
// chaque ecran a sa seance, ses equipes, son classement, ses fusees, son echauffement et son finisher. Seuls liens :
// - les numeros d'equipe ne se repetent jamais d'un ecran a l'autre (1-6 chez l'un, 7-12 chez l'autre) ;
// - un eleve deja dans une equipe d'un ecran ne peut pas etre ajoute sur l'autre.
// La seance d'origine liste ses jumelles (`settings.twins`), chaque jumelle pointe vers elle (`settings.twinOf`).

type SessionLike = { id: string; settings: unknown };
export const readTwinOf = (settings: unknown): string | null => {
  const v = (settings as { twinOf?: unknown } | null)?.twinOf;
  return typeof v === "string" ? v : null;
};
export const readTwins = (settings: unknown): string[] => {
  const v = (settings as { twins?: unknown } | null)?.twins;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

// Toutes les seances du groupe (origine + jumelles, supprimees exclues), dans l'ordre des ecrans.
export async function twinGroup(session: SessionLike): Promise<{ id: string; label: string | null; settings: unknown }[]> {
  const rootId = readTwinOf(session.settings) ?? session.id;
  const root = rootId === session.id ? await db.orm.public.Session.where({ id: session.id }).first() : await db.orm.public.Session.where({ id: rootId }).first();
  if (!root) return [];
  const ids = [root.id, ...readTwins(root.settings)];
  const rows = ids.length > 1 ? await db.orm.public.Session.where((s) => s.id.in(ids)).all() : [root];
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r && notDeleted(r));
}

// Numeros d'equipe deja pris par les AUTRES ecrans du groupe (une equipe provisoire, >= 1000, n'a pas de numero).
export async function numbersTakenElsewhere(sessionId: string): Promise<Set<number>> {
  const s = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!s) return new Set();
  const others = (await twinGroup(s)).filter((x) => x.id !== sessionId).map((x) => x.id);
  if (!others.length) return new Set();
  const teams = await db.orm.public.Team.where((t) => t.sessionId.in(others)).all();
  return new Set(teams.map((t) => t.order ?? 0).filter((o) => o >= 1 && o < 1000));
}

// Eleves deja places dans une equipe d'un AUTRE ecran : id -> « Lvls · écran 2 · Équipe 8 ».
export async function membersElsewhere(sessionId: string): Promise<Record<string, string>> {
  const s = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!s) return {};
  const others = (await twinGroup(s)).filter((x) => x.id !== sessionId);
  if (!others.length) return {};
  const teams = await db.orm.public.Team.where((t) => t.sessionId.in(others.map((o) => o.id))).all();
  if (!teams.length) return {};
  const members = await db.orm.public.TeamMember.where((m) => m.teamId.in(teams.map((t) => t.id))).all();
  const out: Record<string, string> = {};
  for (const m of members) {
    const t = teams.find((x) => x.id === m.teamId)!;
    out[m.userId] = `${others.find((o) => o.id === t.sessionId)?.label ?? "autre écran"} · ${t.name}`;
  }
  return out;
}

// Plus petits numeros libres, en sautant ceux des autres ecrans et ceux deja pris ici.
export function freeNumbers(count: number, taken: Set<number>): number[] {
  const out: number[] = [];
  for (let n = 1; out.length < count; n++) if (!taken.has(n)) out.push(n);
  return out;
}

// Ouvre l'ecran suivant du groupe : memes classes, memes horaires, meme seance-type, reglages de course repris
// (temps impose, zombies, demineur) ; equipes vides numerotees apres celles des autres ecrans.
export async function createTwinSession(sessionId: string, teams = 6): Promise<{ error: string } | { ok: true; id: string; label: string }> {
  const s = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!s || !notDeleted(s)) return { error: "Séance introuvable." };
  if ((s.settings as { child?: unknown } | null)?.child) return { error: "Un échauffement ou un finisher ne se dédouble pas : dédouble le WOD principal." };
  const group = await twinGroup(s);
  const root = await db.orm.public.Session.where({ id: group[0]?.id ?? s.id }).first();
  if (!root) return { error: "Séance introuvable." };
  if (group.length >= 4) return { error: "Quatre écrans au maximum." };
  const rootSettings = (root.settings as Record<string, unknown> | null) ?? {};
  const allTeams = await db.orm.public.Team.where((t) => t.sessionId.in(group.map((g) => g.id))).all();
  const taken = new Set(allTeams.map((t) => t.order ?? 0).filter((o) => o >= 1 && o < 1000));
  const numbers = freeNumbers(Math.max(1, Math.min(20, teams)), taken);
  const base = (root.label ?? "WOD").replace(/ · écran \d+$/, "");
  const label = `${base} · écran ${group.length + 1}`;
  const twin = await openSession({
    wodType: root.wodType,
    label,
    classes: readSessionClasses(root.settings),
    numTeams: numbers.length,
    teamNumbers: numbers,
    refereeMode: root.refereeMode,
    cycleId: root.cycleId ?? null,
    planId: root.planId ?? null,
    teacherId: root.teacherId ?? null,
    opensAt: root.opensAt ?? null,
    closesAt: root.closesAt ?? Temporal.Now.instant().add({ hours: 3 }),
    autoOpened: false,
    settings: {
      twinOf: root.id,
      ...(rootSettings.levelCapMin !== undefined ? { levelCapMin: rootSettings.levelCapMin } : {}),
      ...(rootSettings.zombies !== undefined ? { zombies: rootSettings.zombies } : {}),
    },
  });
  // L'origine devient « écran 1 » et liste sa jumelle (reglages relus juste avant d'ecrire).
  const fresh = ((await db.orm.public.Session.where({ id: root.id }).first())?.settings as Record<string, unknown> | null) ?? {};
  await db.orm.public.Session.where({ id: root.id }).update({
    settings: JSON.parse(JSON.stringify({ ...fresh, twins: [...readTwins(fresh), twin.id] })),
    ...(/ · écran \d+$/.test(root.label ?? "") ? {} : { label: `${base} · écran 1` }),
  });
  return { ok: true, id: twin.id, label };
}
