"use server";

import { getSession as readSessionCookie, login, ON_HOLD_PSEUDOS, SessionPayload } from "@/lib/auth";
import { loginPageSchool, ORIGIN_SCHOOL, schoolById, schoolOfPseudo, withSchool } from "@/lib/school";
import { getSession } from "@/lib/session-server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import crypto from "crypto";

export type LoginState = { error: string } | undefined;

// Mot de passe d'un compte pseudo : connexion, et confirmation de « se connecter en tant que » (29/09 nuit).
// (J. Piret, JUSZER / PIRZER : plus un coach d'ici depuis le 18/11 — prof de SON ecole, voir loginAction.)
const COACHES = ["AXEZER", "GUIZER", "SIMZER", "RACZER"];
function expectedPassword(pseudo: string): string | null {
  if (pseudo === "DAMZER") return "boss";
  if (COACHES.includes(pseudo)) return "coach";
  if (pseudo === "GREFFIER") return "greffe";
  return null;
}

// Le prof importe depuis la liste des eleves (ligne PROF) : c'est cette ligne qui porte les flottes fantomes.
const PROF_USER_NAME = "Damien Renier";

// Les comptes pseudo + mot de passe doivent pointer sur une VRAIE ligne User : flottes, tirs et evaluations
// portent tous une cle etrangere vers User.id. Un identifiant invente faisait echouer toute ecriture
// (erreur serveur au placement d'un bateau) et changeait a chaque connexion.
// Un compte, plusieurs pseudos : la ligne User existante est retrouvee quel que soit le pseudo tape (dans cet ordre).
// DAMZER pointe sur la ligne PROF importee. (JUSZER / PIRZER, J. Piret : depuis le 18/11, compte de SON ecole, voir
// loginAction ; il ne se resout plus jamais ici.)
const SAME_ACCOUNT: Record<string, string[]> = {
  DAMZER: [PROF_USER_NAME, "DAMZER"],
};

// Mot de passe d'un compte d'une autre ecole (User.password, meme forme que les codes PIN : « sel:empreinte »).
function secretMatches(given: string, stored: string | null | undefined): boolean {
  const [salt, hash] = (stored ?? "").split(":");
  if (!salt || !hash || !given) return false;
  const a = Buffer.from(hashPin(given, salt), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function resolveStaffUser(pseudo: string, role: SessionPayload["role"]): Promise<string> {
  const names = SAME_ACCOUNT[pseudo] ?? [pseudo];
  for (const name of names) {
    const found = await db.orm.public.User.where({ name }).first();
    if (found) return found.id;
  }
  const created = await db.orm.public.User.create({ name: pseudo, role: role === "STUDENT" ? "ADMIN" : role });
  return created.id;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const rawName = formData.get("name") as string;
  const password = ((formData.get("password") as string) || "").trim();
  const remember = formData.get("remember") === "on";

  if (!rawName) return { error: "Le nom est requis." };
  const name = rawName.trim().toUpperCase();
  // 18/11 : J. Piret (JUSZER / PIRZER) vient d'une autre ecole ; son compte attend son propre espace d'ecole.
  if (ON_HOLD_PSEUDOS.includes(name)) return { error: "Ce compte n'est pas encore ouvert : son espace d'école est en préparation." };

  // Prof d'une AUTRE ecole (18/11, lib/school.ts) : son compte n'existe que dans son ecole, avec SON mot de passe
  // (jamais celui des coachs d'ici), et son jeton porte son ecole : tout ce qu'il ouvre ensuite reste dans son ecole.
  const school = schoolOfPseudo(name);
  if (school !== ORIGIN_SCHOOL) {
    const account = await withSchool(school, () => db.orm.public.User.where({ name }).first());
    if (!account || account.role === "STUDENT" || !secretMatches(password, account.password)) return { error: "Mot de passe incorrect." };
    await login({ id: account.id, role: account.role, name, school }, remember);
    redirect(account.role === "GREFFIER" ? "/greffier" : "/admin");
  }

  let role: SessionPayload["role"] = "STUDENT";

  // Auto-détection du rôle en fonction du Pseudo
  if (name === "DAMZER") {
    role = "MASTER_ADMIN";
    if (password !== expectedPassword(name)) return { error: "Mot de passe incorrect pour DAMZER." };
  } else if (COACHES.includes(name)) {
    role = "ADMIN";
    if (password !== expectedPassword(name)) return { error: "Mot de passe incorrect." };
  } else if (name === "GREFFIER") {
    role = "GREFFIER";
    if (password !== expectedPassword(name)) return { error: "Mot de passe incorrect." };
  } else {
    // Ce formulaire est reserve aux comptes pseudo + mot de passe. Un eleve passe par
    // classe -> recherche -> PIN (studentLoginAction), seul chemin qui donne son vrai identifiant.
    return { error: "Pseudo inconnu. Les élèves se connectent avec leur classe et leur code PIN." };
  }

  // Créer la session JWT sur le VRAI identifiant en base (stable d'une connexion a l'autre). Toujours dans l'ecole
  // d'origine, meme si le telephone a retenu le lien d'une autre ecole (cookie « ecole »).
  await login({ id: await withSchool(ORIGIN_SCHOOL, () => resolveStaffUser(name, role)), role, name }, remember);

  // Redirection selon le rôle. Les coachs (ADMIN) tombaient dans le `redirect` final et atterrissaient
  // sur le Touché-Coulé, qui leur generait aussitot une flotte : ils entraient dans le jeu en se
  // connectant. Leur ecran, c'est la consultation.
  if (role === "MASTER_ADMIN" || role === "ADMIN") redirect("/admin");
  if (role === "GREFFIER") redirect("/greffier");
  redirect("/touche-coule");
}

// ===== Login élève : classe -> recherche -> PIN, avec le vrai identifiant permanent =====

// Tout le parcours de connexion des eleves (classes, recherche, date de naissance, code PIN) se fait dans l'ecole du
// lien d'ecole retenu par le telephone (18/11), sinon dans l'ecole d'origine : jamais dans celle d'un compte deja connecte.
async function inLoginSchool<T>(fn: () => Promise<T>): Promise<T> {
  return withSchool(await loginPageSchool(), fn);
}

export async function listClassesAction(): Promise<string[]> {
  return inLoginSchool(async () => {
    const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
    const classes = new Set<string>();
    students.forEach((s) => { if (s.className) classes.add(s.className); });
    return Array.from(classes).sort();
  });
}

export type StudentMatch = { id: string; firstName: string; lastName: string; hasPin: boolean };

export async function searchStudentsAction(className: string, query: string): Promise<StudentMatch[]> {
  const q = query.trim().toLowerCase();
  if (!className || q.length < 1) return [];
  return inLoginSchool(async () => {
    const students = await db.orm.public.User.where({ role: "STUDENT", className }).all();
    return students
      .filter((s) =>
        (s.firstName ?? "").toLowerCase().startsWith(q) || (s.lastName ?? "").toLowerCase().startsWith(q)
      )
      .slice(0, 8)
      .map((s) => ({ id: s.id, firstName: s.firstName ?? "", lastName: s.lastName ?? "", hasPin: !!s.pinCode }));
  });
}

function hashPin(pin: string, salt: string) {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

// La date est stockee a minuit UTC : comparer les dix premiers caracteres evite tout decalage de fuseau.
function birthMatches(stored: unknown, given: string): boolean {
  if (!stored || !/^\d{4}-\d{2}-\d{2}$/.test(given)) return false;
  return String(stored).slice(0, 10) === given;
}

// Premiere connexion, etape 1 : l'eleve prouve que c'est bien lui en donnant sa date de naissance.
// Rien n'est cree ici, et la verification est refaite a l'ecriture du code PIN : le client n'est
// jamais cru sur parole.
export async function verifyBirthDateAction(studentId: string, birthDate: string): Promise<{ error: string } | { ok: true }> {
  const user = await inLoginSchool(() => db.orm.public.User.where({ id: studentId, role: "STUDENT" }).first());
  if (!user) return { error: "Élève introuvable." };
  if (user.pinCode) return { error: "Tu as déjà un code PIN : entre-le pour te connecter." };
  if (!user.dateOfBirth) return { error: "Ta date de naissance n'est pas enregistrée. Préviens ton professeur." };
  if (!birthMatches(user.dateOfBirth, birthDate)) {
    return { error: "Cette date de naissance ne correspond pas à ce nom. Vérifie, ou préviens ton professeur." };
  }
  return { ok: true };
}

// Premiere connexion, etape finale : date de naissance + case cochee + code PIN choisi.
export async function firstLoginAction(
  studentId: string,
  birthDate: string,
  confirmed: boolean,
  pin: string,
  remember = false
): Promise<{ error: string } | void> {
  if (!confirmed) return { error: "Tu dois cocher la case pour confirmer que c'est bien toi." };
  if (!/^\d{4,8}$/.test(pin)) return { error: "Le code PIN doit contenir 4 à 8 chiffres." };

  const user = await inLoginSchool(() => db.orm.public.User.where({ id: studentId, role: "STUDENT" }).first());
  if (!user) return { error: "Élève introuvable." };
  if (user.pinCode) return { error: "Tu as déjà un code PIN : entre-le pour te connecter." };
  if (!birthMatches(user.dateOfBirth, birthDate)) {
    return { error: "Cette date de naissance ne correspond pas à ce nom." };
  }

  const salt = crypto.randomBytes(16).toString("hex");
  await withSchool(user.schoolId ?? null, () => db.orm.public.User.where({ id: user.id }).update({ pinCode: `${salt}:${hashPin(pin, salt)}` }));
  await login({ id: user.id, role: "STUDENT", name: user.name, className: user.className ?? undefined, school: user.schoolId ?? null }, remember);
  redirect("/eleve");
}

// Connexions suivantes : le code PIN seul. Ne cree PLUS de code au vol — un premier acces passe
// obligatoirement par la date de naissance et l'engagement sur l'honneur.
export async function studentLoginAction(
  studentId: string,
  pin: string,
  remember = false
): Promise<{ error: string } | void> {
  if (!/^\d{4,8}$/.test(pin)) {
    return { error: "Le code PIN doit contenir 4 à 8 chiffres." };
  }

  const user = await inLoginSchool(() => db.orm.public.User.where({ id: studentId, role: "STUDENT" }).first());
  if (!user) return { error: "Élève introuvable." };
  if (!user.pinCode) return { error: "Première connexion : passe par ta date de naissance." };

  const [salt, hash] = user.pinCode.split(":");
  if (hashPin(pin, salt) !== hash) return { error: "Code PIN incorrect." };

  await login(
    {
      id: user.id,
      role: "STUDENT",
      name: user.name,
      className: user.className ?? undefined,
      school: user.schoolId ?? null, // ecole de l'eleve (18/11) : tout ce qu'il ouvre ensuite reste dans son ecole
    },
    remember
  );
  redirect("/eleve");
}

// ===== « Se connecter en tant que » (Sartay 29/09 nuit) =====
// Un admin (DAMZER ou coach), apres avoir retape SON mot de passe, ouvre l'espace d'un eleve exactement comme l'eleve
// le voit. Le cookie porte l'eleve ET l'admin d'origine (impersonatedBy, jeton signe) : un bandeau permet de revenir,
// et toutes les actions d'ecriture de l'eleve sont refusees (lecture seule, voir lib/preview.ts).
export async function impersonateStudentAction(studentId: string, password: string): Promise<{ error: string } | void> {
  const me = await getSession();
  if (!me || (me.role !== "MASTER_ADMIN" && me.role !== "ADMIN")) return { error: "Réservé aux admins." };
  if (me.impersonatedBy) return { error: "Tu regardes déjà le compte d'un élève : reviens d'abord à ton compte." };
  // Pseudo d'ici (DAMZER, coachs, meme quand DAMZER visite une autre ecole) : son mot de passe habituel ; prof d'une
  // autre ecole : le mot de passe de son compte (User.password).
  const expected = expectedPassword(me.name);
  const okPassword = expected
    ? password.trim() === expected
    : secretMatches(password.trim(), (await db.orm.public.User.where({ id: me.id }).first())?.password);
  if (!okPassword) return { error: "Mot de passe incorrect." };
  // L'eleve est cherche dans l'ecole de l'admin (filtre automatique) ; le jeton garde cette ecole des deux cotes.
  const student = await db.orm.public.User.where({ id: studentId, role: "STUDENT" }).first();
  if (!student) return { error: "Élève introuvable." };
  const school = me.school ?? null;
  await login({ id: student.id, role: "STUDENT", name: student.name, className: student.className ?? undefined, school, impersonatedBy: { id: me.id, name: me.name, role: me.role, school } }, false);
  redirect("/eleve");
}

export async function stopImpersonatingAction(): Promise<void> {
  const s = await readSessionCookie();
  if (!s?.impersonatedBy) redirect("/");
  const back = s.impersonatedBy;
  await login({ id: back.id, role: back.role, name: back.name, school: back.school ?? null }, false);
  redirect(`/admin/voir-eleve?classe=${encodeURIComponent(s.className ?? "")}`);
}

// ===== DAMZER change d'ecole (Sartay 18/11 : « Oui, DAMZER y entre aussi ») =====
// Seul DAMZER (le boss de l'ecole d'origine) passe d'une ecole a l'autre ; dans chaque ecole il a SA ligne User (creee
// a sa premiere visite, comme a une premiere connexion), et son jeton porte l'ecole visitee : la console, les eleves,
// les seances, tout ce qu'il voit et fait ensuite est celui de cette ecole.
export async function switchSchoolAction(formData: FormData): Promise<void> {
  const me = await getSession();
  if (!me || me.name !== "DAMZER" || me.role !== "MASTER_ADMIN" || me.impersonatedBy) redirect("/admin");
  const wanted = String(formData.get("school") ?? "");
  const target = schoolById(wanted === "origine" ? ORIGIN_SCHOOL : wanted);
  if (!target) redirect("/admin");
  const id = await withSchool(target.id, () => resolveStaffUser("DAMZER", "MASTER_ADMIN"));
  await login({ id, role: "MASTER_ADMIN", name: "DAMZER", school: target.id }, false);
  redirect("/admin");
}
