"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session-server";
import { CLEANUP_PHRASE } from "@/lib/session-roles";
import { purge, resetRace } from "@/lib/cleanup";

// Toutes ces operations sont definitives : elles sont reservees a DAMZER (MASTER_ADMIN), et le grand
// menage exige en plus la phrase de confirmation tapee en toutes lettres.
async function requireMaster() {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") throw new Error("Accès refusé.");
  return user;
}

function fail(msg: string): never {
  redirect(`/admin/nettoyage?msg=${encodeURIComponent(msg)}`);
}
function done(msg: string): never {
  revalidatePath("/admin/nettoyage");
  revalidatePath("/admin");
  redirect(`/admin/nettoyage?ok=${encodeURIComponent(msg)}`);
}

// ===== Remettre une seance a zero (elle redevient « pas commencee », equipes conservees) =====
export async function resetRaceAction(fd: FormData) {
  await requireMaster();
  const sessionId = String(fd.get("sessionId") ?? "");
  if (!sessionId) fail("Séance manquante.");
  const res = await resetRace(sessionId, {
    clearReferees: fd.get("clearReferees") === "on",
    clearMembers: fd.get("clearMembers") === "on",
  });
  if ("error" in res) fail(res.error);
  const d = res.deleted;
  const bits = [
    d.laps ? `${d.laps} tours` : "",
    d.cards ? `${d.cards} cartes jaunes` : "",
    d.pauses ? `${d.pauses} pauses` : "",
    d.stations ? `${d.stations} pointages` : "",
    d.shots ? `${d.shots} tirs` : "",
    d.evaluations ? `${d.evaluations} évaluations` : "",
    d.fleets ? `${d.fleets} flottes` : "",
    d.members ? `${d.members} participants` : "",
  ].filter(Boolean);
  done(`Course remise à zéro${bits.length ? ` : ${bits.join(", ")} effacés.` : " (rien à effacer)."} La séance est de nouveau prête à démarrer.`);
}

// ===== Grand menage : suppression definitive des seances cochees =====
export async function purgeAction(fd: FormData) {
  await requireMaster();

  if (String(fd.get("phrase") ?? "").trim().toUpperCase() !== CLEANUP_PHRASE) {
    fail(`Rien n'a été supprimé : il faut taper exactement « ${CLEANUP_PHRASE} » pour confirmer.`);
  }
  const sessionIds = fd.getAll("session").map(String).filter(Boolean);
  const resetPins = fd.get("resetPins") === "on";
  const resetReliability = fd.get("resetReliability") === "on";
  if (!sessionIds.length && !resetPins && !resetReliability) fail("Rien n'était coché : rien n'a été supprimé.");

  const res = await purge({ sessionIds, resetPins, resetReliability });
  const bits = [
    res.sessions ? `${res.sessions} séance${res.sessions > 1 ? "s" : ""} supprimée${res.sessions > 1 ? "s" : ""} (${res.rows} lignes)` : "",
    res.pins ? `${res.pins} code${res.pins > 1 ? "s" : ""} PIN remis à zéro` : "",
    res.reliability ? `fiabilité remise à zéro pour ${res.reliability} élève${res.reliability > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  done(`${bits.join(" · ")}. Cycles, séances-types, créneaux horaires et liste des élèves intacts.`);
}
