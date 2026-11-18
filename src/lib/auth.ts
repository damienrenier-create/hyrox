import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secretKey = process.env.SESSION_SECRET || "hyrox-default-dev-secret-key";
const key = new TextEncoder().encode(secretKey);

export type SessionPayload = {
  id: string;
  role: "MASTER_ADMIN" | "ADMIN" | "STUDENT" | "GREFFIER";
  name: string;
  className?: string;
  // Ecole de la session (18/11, voir lib/school.ts) : absente ou null = l'ecole d'origine (tous les jetons d'avant).
  school?: string | null;
  // « Se connecter en tant que » : l'admin qui regarde ce compte d'eleve (lecture seule, bandeau de retour).
  impersonatedBy?: { id: string; name: string; role: "MASTER_ADMIN" | "ADMIN"; school?: string | null };
};

const SHORT_SESSION = "24h";
const LONG_SESSION = "30d";
const LONG_SESSION_SECONDS = 30 * 24 * 60 * 60;

export async function encrypt(payload: SessionPayload, remember = false) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(remember ? LONG_SESSION : SHORT_SESSION)
    .sign(key);
}

// Comptes EN ATTENTE (Sartay 18/11) : J. Piret (JUSZER, ex-PIRZER) est une amie d'une AUTRE ECOLE. Tant que son
// espace d'ecole n'est pas ouvert, la connexion de ces pseudos est refusee.
export const ON_HOLD_PSEUDOS = ["JUSZER", "PIRZER"];
// Comptes VERROUILLES sur une ecole : son compte (garde en base, rien d'efface) n'est valable QU'AVEC un jeton de son
// ecole. Tout jeton emis avant (sans ecole -> il ouvrirait l'ecole d'origine), pour elle ou pour un eleve qu'elle
// regarderait, est traite comme un jeton invalide.
export const ACCOUNT_SCHOOL_LOCK: Record<string, string> = { "38f5f615-f120-4293-90cb-999f256f3ef6": "e2" };
export const ON_HOLD_ACCOUNT_IDS = new Set(Object.keys(ACCOUNT_SCHOOL_LOCK));
const lockedOut = (id: string | undefined, school: string | null | undefined) =>
  !!id && id in ACCOUNT_SCHOOL_LOCK && ACCOUNT_SCHOOL_LOCK[id] !== (school ?? null);

export async function decrypt(input: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  const p = payload as SessionPayload;
  if (lockedOut(p.id, p.school) || (p.impersonatedBy && lockedOut(p.impersonatedBy.id, p.impersonatedBy.school))) {
    throw new Error("compte verrouille sur une autre ecole");
  }
  return p;
}

// remember = "se souvenir de moi" : cookie persistant 30 jours au lieu d'une session de 24h
export async function login(payload: SessionPayload, remember = false) {
  const session = await encrypt(payload, remember);
  (await cookies()).set("session", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: LONG_SESSION_SECONDS } : {}),
  });
}

export async function logout() {
  (await cookies()).delete("session");
}

export async function getSession() {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  try {
    return await decrypt(session);
  } catch (e) {
    return null;
  }
}
