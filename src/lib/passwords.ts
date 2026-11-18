import crypto from "crypto";

// Mots de passe des comptes d'une autre ecole (18/11) : stockes dans User.password sous la forme « sel:empreinte »
// (scrypt, comme les codes PIN des eleves). Jamais le mot de passe lui-meme. Module serveur.

export const PASSWORD_MIN = 8;

export function hashSecret(plain: string, salt = crypto.randomBytes(16).toString("hex")): string {
  return `${salt}:${crypto.scryptSync(plain, salt, 32).toString("hex")}`;
}

export function secretMatches(given: string, stored: string | null | undefined): boolean {
  const [salt, hash] = (stored ?? "").split(":");
  if (!salt || !hash || !given) return false;
  const a = Buffer.from(crypto.scryptSync(given, salt, 32).toString("hex"), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Nouveau mot de passe choisi dans la console : au moins 8 caracteres, tape deux fois a l'identique.
// La connexion retire les espaces au debut et a la fin : on les retire ici aussi.
export function newPasswordProblem(password: string, confirm: string): string | null {
  const p = password.trim();
  if (p.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`;
  if (p.length > 100) return "Mot de passe trop long (100 caractères maximum).";
  if (p !== confirm.trim()) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}
