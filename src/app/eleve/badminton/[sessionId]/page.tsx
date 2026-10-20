import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { badmintonRoster, loadMatches, peopleOf, pupilWindowOpen, studentInSession, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { viewOf, type BmPersonRef } from "@/lib/badminton";
import { readSessionClasses } from "@/lib/session-roles";
import { toMs } from "@/lib/scheduling";
import { TopBar } from "../../../_components/TopBar";
import { BadmintonClient } from "./BadmintonClient";

export const dynamic = "force-dynamic";

// Badminton, cote eleve (Sartay 20/10) : encoder ses matchs (contre qui, le score), signer ou corriger ceux que
// l'adversaire a encodes, encoder comme arbitre le match de deux autres eleves. Tout ce qui a ete encode reste visible.
export default async function BadmintonPupilPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await getSession();
  if (!user) redirect("/");
  if (BM_STAFF_ROLES.includes(user.role)) redirect(`/admin/badminton?session=${sessionId}`);
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt || session.wodType !== "BADMINTON") redirect("/eleve");
  const me = await db.orm.public.User.where({ id: user.id }).first();
  if (!me || !(await studentInSession(session, me.id, me.className ?? null))) redirect("/eleve");

  const [matches, roster] = await Promise.all([loadMatches(sessionId), badmintonRoster(session)]);
  const people = await peopleOf(matches, roster.map((p) => p.id));
  const ref = (id: string): BmPersonRef => { const p = people.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
  const views = matches.map((m) => viewOf(m, me.id, false, ref));
  const involved = views.filter((v) => v.meSide !== null || v.createdBy.id === me.id);
  const toSign = involved.filter((v) => v.status === "PENDING" && v.waitingFor?.id === me.id);
  const mine = involved.filter((v) => v.meSide !== null && !toSign.includes(v));
  const refereed = involved.filter((v) => v.meSide === null);
  const closes = session.closesAt ? new Date(toMs(session.closesAt)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }) : null;

  return (
    <div className="min-h-dvh bg-paper">
      <TopBar title="🏸 Badminton" subtitle={`${readSessionClasses(session.settings).join(" + ")}${session.isActive && closes ? ` · jusqu'à ${closes}` : ""}`} back={{ href: "/eleve", label: "Mon espace" }} />
      <BadmintonClient
        sessionId={sessionId}
        meId={me.id}
        writable={pupilWindowOpen(session)}
        roster={roster.filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name, className: p.className }))}
        toSign={toSign}
        mine={mine}
        refereed={refereed}
      />
    </div>
  );
}
