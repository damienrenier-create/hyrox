import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secretKey = process.env.SESSION_SECRET || "hyrox-default-dev-secret-key";
const key = new TextEncoder().encode(secretKey);

export type SessionPayload = {
  id: string;
  role: "MASTER_ADMIN" | "ADMIN" | "STUDENT" | "GREFFIER";
  name: string;
  className?: string;
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

export async function decrypt(input: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  return payload as SessionPayload;
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
