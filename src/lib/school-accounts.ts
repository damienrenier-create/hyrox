import { db } from "@/lib/db";
import { ORIGIN_SCHOOL, SCHOOLS, withSchool, type SchoolId } from "@/lib/school";

// Comptes pseudo + mot de passe des AUTRES ecoles (Sartay 18/11 : « faut lui mettre ça en place, je ne peux pas m'occuper
// de ça en permanence »). La responsable d'une ecole (MASTER_ADMIN, ex. JUSZER) cree elle-meme les comptes de ses
// collegues et du greffier, depuis la console (/admin/comptes) : une ligne User de SON ecole, nom = pseudo en
// MAJUSCULES, mot de passe dans User.password (lib/passwords.ts). La connexion retrouve le pseudo dans les ecoles
// (findSchoolAccount) : rien a coder pour un nouveau collegue.
// Les comptes de l'ecole d'origine (DAMZER, coachs, greffier) ne passent pas par ici : leurs mots de passe sont dans le code.

// Coachs de l'ecole d'origine (connexion : app/actions.ts).
export const ORIGIN_COACHES = ["AXEZER", "GUIZER", "SIMZER", "RACZER"];
// Pseudos qu'aucune autre ecole ne peut prendre : ceux de l'ecole d'origine, et les anciens pseudos.
const RESERVED = new Set(["DAMZER", "GREFFIER", "PIRZER", "PROF", "ADMIN", ...ORIGIN_COACHES]);

export const isOriginPseudo = (pseudo: string) => pseudo === "DAMZER" || pseudo === "GREFFIER" || ORIGIN_COACHES.includes(pseudo);

// Lettres et chiffres, 3 a 16 caracteres, en majuscules (la connexion met le pseudo tape en majuscules).
export function pseudoProblem(raw: string): string | null {
  const p = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,16}$/.test(p)) return "Le pseudo : 3 à 16 lettres ou chiffres, sans espace ni accent (ex. MARZER).";
  if (RESERVED.has(p)) return "Ce pseudo est réservé : choisissez-en un autre.";
  return null;
}

const otherSchools = () => SCHOOLS.filter((s) => s.id !== ORIGIN_SCHOOL);

// Compte de prof ou de greffier d'une autre ecole, pour la connexion par pseudo.
export async function findSchoolAccount(pseudo: string) {
  for (const s of otherSchools()) {
    const row = await withSchool(s.id, () => db.orm.public.User.where({ name: pseudo }).first());
    if (row && row.role !== "STUDENT") return { school: s.id as SchoolId, user: row };
  }
  return null;
}

// Un pseudo est unique dans TOUTE l'app (toutes ecoles) : la connexion le cherche partout.
export async function pseudoTaken(pseudo: string): Promise<boolean> {
  if (RESERVED.has(pseudo)) return true;
  for (const s of SCHOOLS) {
    const row = await withSchool(s.id, () => db.orm.public.User.where({ name: pseudo }).first());
    if (row) return true;
  }
  return false;
}
