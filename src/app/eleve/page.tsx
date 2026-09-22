import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessionsForStudent, wodLabel, fmtDate } from "@/lib/student-sessions";
import { openSessionsForStudent, toMs } from "@/lib/scheduling";
import { refereeAccess } from "@/lib/referee-access";
import { LogoutButton } from "./LogoutButton";
import { RefereeRequest } from "./RefereeRequest";
import { TopBar } from "../_components/TopBar";
import { ui } from "@/lib/ui";

export default async function ElevePage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect(user.role === "GREFFIER" ? "/greffier" : user.role === "MASTER_ADMIN" ? "/admin" : "/touche-coule");

  // Les seances de ma classe s'ouvrent automatiquement pendant mon creneau (voir scheduling.ts).
  const openSessions = await openSessionsForStudent(user.id, user.className ?? null);
  const mine = await sessionsForStudent(user.id);
  const openIds = new Set(openSessions.map((s) => s.id));
  const history = mine.filter((r) => !openIds.has(r.sessionId));

  const cards = [];
  for (const s of openSessions) {
    const membership = mine.find((r) => r.sessionId === s.id) ?? null;
    // Arbitrage uniquement si autorise (encode par le greffier, ou demande acceptee) : voir referee-access.ts
    const access = await refereeAccess(s.id, user);
    cards.push({ s, membership, access });
  }

  return (
    <div className={ui.page}>
      <TopBar title={user.name} subtitle={user.className ?? ""} right={<LogoutButton />} />

      <main className="max-w-2xl mx-auto p-4 space-y-6">
        <section>
          <h2 className={`${ui.eyebrow} mb-2`}>WOD en cours</h2>
          {cards.length === 0 ? (
            <p className={`${ui.cardPad} ${ui.muted}`}>
              Aucune séance ouverte pour ta classe en ce moment. Elle s&apos;ouvrira automatiquement pendant ton cours d&apos;EP (ou quand le prof l&apos;ouvrira).
            </p>
          ) : (
            <div className="space-y-3">
              {cards.map(({ s, membership, access }) => (
                <div key={s.id} className={`${ui.card} border-brand/40 p-4`}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <div className="font-display font-extrabold text-lg">{s.label ?? wodLabel(s.wodType)}</div>
                      <div className="text-xs text-ink-2">
                        {fmtDate(s.createdAt)}
                        {s.raceEndedAt ? " · terminé" : " · ouvert"}
                        {s.closesAt ? ` jusqu'à ${new Date(toMs(s.closesAt)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {membership && (
                        <span className={`${ui.chip} ${ui.chipOk}`}>{membership.teamName}</span>
                      )}
                      {access.status === "APPROVED" && (
                        <span className={`${ui.chip} ${ui.chipSea}`}>🏴‍☠️ arbitre{access.note ? ` · ${access.note}` : ""}</span>
                      )}
                    </div>
                  </div>
                  <p className={`${ui.muted} mb-3`}>
                    {access.status === "APPROVED"
                      ? "Tu es autorisé à arbitrer sur ce WOD."
                      : membership
                        ? "Tu es participant sur ce WOD."
                        : "Quel est ton rôle sur ce WOD ?"}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {!s.refereeMode ? (
                      <div className="bg-paper text-ink-3 font-bold text-center rounded-xl py-4 px-2 text-sm">Pas d&apos;arbitrage sur ce WOD</div>
                    ) : access.allowed ? (
                      <Link href={`/touche-coule?session=${s.id}`} className="bg-sea hover:bg-sea-hover text-white font-extrabold text-center rounded-xl py-4 px-2 leading-tight shadow-sm transition">
                        🏴‍☠️ Arbitre
                        <span className="block text-[11px] font-normal text-white/80 mt-1">Touché-Coulé</span>
                      </Link>
                    ) : (
                      <RefereeRequest
                        sessionId={s.id}
                        status={access.status === "PENDING" || access.status === "REFUSED" ? access.status : null}
                        note={access.note}
                        inTeam={membership?.teamName ?? null}
                      />
                    )}
                    {membership ? (
                      <Link href={`/eleve/${s.id}`} className="bg-success hover:bg-success/90 text-white font-extrabold text-center rounded-xl py-4 px-2 leading-tight shadow-sm transition">
                        💪 Participant
                        <span className="block text-[11px] font-normal text-white/85 mt-1">Résultats · arbitrages · auto-éval</span>
                      </Link>
                    ) : (
                      <div className="bg-paper text-ink-2 rounded-xl py-3 px-3 text-xs leading-snug">
                        <span className="font-extrabold text-ink block mb-1">💪 Participant</span>
                        Le greffier doit d&apos;abord t&apos;encoder dans une équipe. Reviens ici ensuite : tes résultats et ton auto-évaluation apparaîtront.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className={`${ui.eyebrow} mb-2`}>Mes WOD</h2>
          {history.length === 0 ? (
            <p className={`${ui.cardPad} ${ui.muted}`}>
              Ton nom n&apos;est encore apparu dans aucun WOD précédent.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((r) => (
                <li key={r.sessionId}>
                  <Link href={`/eleve/${r.sessionId}`} className={`block ${ui.card} hover:border-brand p-4 transition`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-display font-bold">{r.label}</div>
                        <div className="text-xs text-ink-2">{fmtDate(r.createdAt)} · {r.teamName}</div>
                      </div>
                      <span className="text-ink-3 font-black">›</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
