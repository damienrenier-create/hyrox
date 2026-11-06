import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { freeRoster, loadMatches, peopleOf, pickerRef, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { BM_FREE, viewOf, type BmPersonRef } from "@/lib/badminton";
import { isTestClass } from "@/lib/session-roles";
import { TopBar } from "../../../_components/TopBar";
import { BadmintonClient } from "../[sessionId]/BadmintonClient";

export const dynamic = "force-dynamic";

// Matchs libres (Sartay 03/11 : « il faut que les eleves puissent s'affronter en inter-classes en dehors de leurs heures
// officielles, en allant chercher dans une liste d'eleves » ; « pour devenir officiel, les matchs pourraient etre signes
// par 2 autres eleves ou par un prof ») : meme ecran que la seance, avec tous les eleves dans la liste et les temoins.
export default async function BadmintonFreePage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (BM_STAFF_ROLES.includes(user.role)) redirect(`/admin/badminton?session=${BM_FREE}`);
  const me = await db.orm.public.User.where({ id: user.id }).first();
  if (!me || me.role !== "STUDENT") redirect("/eleve");

  const [matches, roster] = await Promise.all([loadMatches(BM_FREE), freeRoster(isTestClass(me.className))]);
  const asked = (m: (typeof matches)[number]) => m.events.some((e) => e.kind === "WITNESS_ASK" && e.targetId === me.id);
  const involved = matches.filter((m) => m.playerAId === me.id || m.playerBId === me.id || m.createdById === me.id || asked(m));
  const people = await peopleOf(involved);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const ref = (id: string): BmPersonRef => { const p = people.get(id) ?? byId.get(id); return { id, name: p?.name ?? "?", className: p?.className ?? null }; };
  const views = involved.map((m) => viewOf(m, me.id, false, ref));
  const toSign = views.filter((v) => v.status === "PENDING" && v.can.validate);
  const toAttest = views.filter((v) => v.can.attest && v.can.decline);
  const mine = views.filter((v) => v.meSide !== null && !toSign.includes(v));
  const refereed = views.filter((v) => v.meSide === null && v.createdBy.id === me.id);
  const witnessed = views.filter((v) => v.meSide === null && v.createdBy.id !== me.id && !toAttest.includes(v));

  return (
    <div className="min-h-dvh bg-paper">
      <TopBar title="🏸 Matchs libres" subtitle="Entre toutes les classes, en dehors des cours" back={{ href: "/eleve", label: "Mon espace" }} />
      <BadmintonClient
        sessionId={BM_FREE}
        meId={me.id}
        writable
        free
        roster={roster.filter((p) => p.id !== me.id).map(pickerRef)}
        toSign={toSign}
        toAttest={toAttest}
        mine={mine}
        refereed={refereed}
        witnessed={witnessed}
      />
    </div>
  );
}
