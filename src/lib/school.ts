import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { decrypt } from "@/lib/auth";

// ===== Plusieurs ecoles dans la meme app (Sartay 18/11) =====
// J. Piret (JUSZER), une amie d'une autre ecole, utilise REPS : « elle doit arriver dans une sorte d'autre dimension :
// mêmes leçons, même structure, mais pas les mêmes élèves ni les mêmes collègues ». Choix de Sartay : la MEME app,
// la MEME adresse, la MEME base ; chaque ligne porte une etiquette `schoolId` (null = l'ecole d'origine, celle de
// D. Renier : aucune ligne existante n'a ete reecrite).
// La couche lib/db.ts ajoute toute seule le filtre de l'ecole courante a CHAQUE requete et l'etiquette a CHAQUE
// creation : une page ou une action n'a rien a faire pour rester dans son ecole, et une requete oubliee ne peut pas
// montrer les eleves d'une autre ecole. Partages entre ecoles (sans etiquette) : l'echelle des niveaux et le catalogue
// d'exercices du WOD Level (Level, LevelExercise), modifiables seulement depuis l'ecole d'origine.

export type SchoolId = string | null;
export const ORIGIN_SCHOOL: SchoolId = null;

export type School = {
  id: SchoolId;
  label: string; // nom montre a DAMZER (choix de l'ecole) et aux eleves de l'ecole sur la page de connexion
  link: string | null; // code du lien d'ecole : https://hyrox-delta.vercel.app/e/<link> (null = ecole d'origine)
  pseudos: string[]; // pseudos de connexion des profs de cette ecole (mot de passe : User.password, propre a l'ecole)
};

export const SCHOOLS: School[] = [
  { id: ORIGIN_SCHOOL, label: "Cours de D. Renier", link: null, pseudos: [] },
  { id: "e2", label: "Cours de J. Piret", link: "vj6wzg", pseudos: ["JUSZER"] },
];

export const SCHOOL_COOKIE = "ecole"; // lien d'ecole retenu par le telephone (page de connexion des eleves)

export function schoolById(id: SchoolId | undefined): School | null {
  return SCHOOLS.find((s) => s.id === (id ?? ORIGIN_SCHOOL)) ?? null;
}
export function schoolByLink(code: string | null | undefined): School | null {
  const c = (code ?? "").trim().toLowerCase();
  return c ? SCHOOLS.find((s) => s.link === c) ?? null : null;
}
// Ecole d'un pseudo de prof : JUSZER -> e2 ; tous les autres (DAMZER, coachs, greffier) -> ecole d'origine.
export function schoolOfPseudo(pseudo: string): SchoolId {
  return SCHOOLS.find((s) => s.pseudos.includes(pseudo))?.id ?? ORIGIN_SCHOOL;
}

// Ecole imposee pour un bout de code (connexion d'un prof d'une autre ecole, DAMZER qui change d'ecole, scripts).
// Le resultat est ATTENDU a l'interieur : une requete de lib/db ne part qu'au moment ou on l'attend, et elle doit
// partir pendant que l'ecole imposee est encore active (sinon elle retomberait sur l'ecole du jeton).
const forced = new AsyncLocalStorage<{ school: SchoolId }>();
export function withSchool<T>(school: SchoolId, fn: () => PromiseLike<T> | T): Promise<T> {
  return forced.run({ school }, async () => await fn());
}

// Ecole de la requete en cours, dans cet ordre :
// 1) withSchool(...) ; 2) le jeton de session (signe : son ecole ne se falsifie pas) ; 3) le lien d'ecole retenu par
// le telephone (cookie « ecole », pour la page de connexion des eleves) ; 4) l'ecole d'origine.
// Un script lance hors de Next (npx tsx scripts/...) travaille dans l'ecole d'origine, sauf withSchool.
// cookies() n'est volontairement PAS dans un try : pendant le rendu, Next s'en sert pour savoir qu'une page est dynamique.
const tokenSchool = new Map<string, SchoolId>();
export async function currentSchool(): Promise<SchoolId> {
  const f = forced.getStore();
  if (f) return f.school;
  if (!process.env.NEXT_RUNTIME) return ORIGIN_SCHOOL;
  const jar = await cookies();
  const token = jar.get("session")?.value;
  if (token) {
    const known = tokenSchool.get(token);
    if (known !== undefined) return known;
    let school: SchoolId | undefined;
    try {
      const p = await decrypt(token);
      school = schoolById(p.school)?.id ?? ORIGIN_SCHOOL;
    } catch {
      school = undefined; // jeton invalide, expire ou en attente : comme sans session
    }
    if (school !== undefined) {
      if (tokenSchool.size > 5000) tokenSchool.clear();
      tokenSchool.set(token, school);
      return school;
    }
  }
  return schoolByLink(jar.get(SCHOOL_COOKIE)?.value)?.id ?? ORIGIN_SCHOOL;
}

export const isOriginSchool = (s: SchoolId) => s === ORIGIN_SCHOOL;

// Ecole de la PAGE DE CONNEXION des eleves : le lien d'ecole retenu par le telephone, sinon l'ecole d'origine — jamais
// le jeton d'un compte deja connecte sur l'appareil (« changer d'utilisateur » sur un telephone prete).
export async function loginPageSchool(): Promise<SchoolId> {
  const jar = await cookies();
  return schoolByLink(jar.get(SCHOOL_COOKIE)?.value)?.id ?? ORIGIN_SCHOOL;
}
