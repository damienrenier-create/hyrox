import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { freeRoster, loadMatches, peopleOf, pickerRef, preferTournamentSessions, BM_STAFF_ROLES } from "@/lib/badminton-server";
import { BM_FREE, viewOf, type BmPersonRef } from "@/lib/badminton";
import { openSessionsForStudent } from "@/lib/scheduling";
import { isTestClass } from "@/lib/session-roles";
import { btn, cx, ui } from "@/lib/ui";
import { TopBar } from "../../../_components/TopBar";
import { BadmintonClient } from "../[sessionId]/BadmintonClient";

export const dynamic = "force-dynamic";

// L'ecran « tu es en cours » avant les matchs libres (voir plus bas).
function FreeMatchGate({ back, tourLabel, badminton }: { back: string; tourLabel: string | null; badminton: boolean }) {
  return (
    <div className="min-h-dvh bg-paper">
      <TopBar title="🏸 Matchs libres" subtitle="Entre toutes les classes, en dehors des cours" back={{ href: back, label: "Mon cours" }} />
      <main className="max-w-lg mx-auto p-4 space-y-3">
        <section className={cx(ui.cardPad, "space-y-3 border-warn")}>
          <h1 className="font-display font-extrabold text-xl text-ink">✋ Attends : tu es en cours !</h1>
          {tourLabel ? (
            <p className={ui.alertWarn}>🏆 Tu joues le tournoi « {tourLabel} ». Un match libre <b>ne fait pas partie du tournoi</b> : il ne rapporte rien à ta poule ni à ton équipe, et ton adversaire du tournoi t&apos;attend peut-être.</p>
          ) : badminton ? (
            <p className={ui.alertWarn}>Les matchs de ton cours s&apos;encodent sur la page de ton cours : c&apos;est là qu&apos;ils comptent pour le cours.</p>
          ) : null}
          <p className="text-sm text-ink-2">Un match libre, c&apos;est pour affronter un élève <b>d&apos;un autre cours</b> : à la récré, sur le temps de midi, après les cours…</p>
          <Link href={back} className={cx(btn.primary, "w-full justify-center")}>← {tourLabel ? "Retour au tournoi" : "Retour à mon cours"}</Link>
          <Link href="/eleve/badminton/libre?ok=1" className={cx(btn.ghost, "w-full justify-center")}>C&apos;est bien un match libre : continuer</Link>
          <p className={ui.hint}>Tu viens seulement signer ou attester un match libre ? Tu peux continuer.</p>
        </section>
      </main>
    </div>
  );
}

// Matchs libres (Sartay 03/11 : « il faut que les eleves puissent s'affronter en inter-classes en dehors de leurs heures
// officielles, en allant chercher dans une liste d'eleves » ; « pour devenir officiel, les matchs pourraient etre signes
// par 2 autres eleves ou par un prof ») : meme ecran que la seance, avec tous les eleves dans la liste et les temoins.
export default async function BadmintonFreePage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const user = await getSession();
  if (!user) redirect("/");
  if (BM_STAFF_ROLES.includes(user.role)) redirect(`/admin/badminton?session=${BM_FREE}`);
  const me = await db.orm.public.User.where({ id: user.id }).first();
  if (!me || me.role !== "STUDENT") redirect("/eleve");

  // Eleve EN COURS (Sartay 26/11 : « trop souvent les eleves veulent encoder des matchs libres alors qu'ils sont en
  // tournoi ; s'ils sont en cours, il faut les dissuader avec une confirmation ») : avant la page, un ecran « tu es en
  // cours » qui renvoie vers le cours (et son tournoi) ; « continuer » reste possible (signer, attester, vrai match libre).
  if (ok !== "1") {
    const { sessions: open, tour } = await preferTournamentSessions(await openSessionsForStudent(me.id, me.className ?? null), me.id);
    const course = open.find((s) => s.wodType === "BADMINTON") ?? open[0];
    if (course) {
      const badminton = course.wodType === "BADMINTON";
      const t = tour.get(course.id);
      return <FreeMatchGate back={badminton ? `/eleve/badminton/${course.id}` : "/eleve"} tourLabel={t?.inTour ? t.label : null} badminton={badminton} />;
    }
  }

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
