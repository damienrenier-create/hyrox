import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessionsForStudent, wodLabel, fmtDate } from "@/lib/student-sessions";
import { LogoutButton } from "./LogoutButton";

export default async function ElevePage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect(user.role === "GREFFIER" ? "/greffier" : user.role === "MASTER_ADMIN" ? "/admin" : "/touche-coule");

  const [current, mine] = await Promise.all([
    db.orm.public.Session.where({ isActive: true }).orderBy((s) => s.createdAt.desc()).first(),
    sessionsForStudent(user.id),
  ]);
  const currentMembership = current ? mine.find((r) => r.sessionId === current.id) ?? null : null;
  const history = mine.filter((r) => !current || r.sessionId !== current.id);
  const refereeRow = current ? await db.orm.public.SessionReferee.where({ sessionId: current.id, userId: user.id }).first() : null;
  // Participant non inscrit arbitre par le greffier -> pas d'arbitrage (DNF/blessure = demander au greffier).
  const canReferee = !!current?.refereeMode && (!currentMembership || !!refereeRow);

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b-4 border-slate-900 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-black leading-tight truncate">{user.name}</h1>
          <p className="text-xs text-slate-500">{user.className ?? ""}</p>
        </div>
        <LogoutButton />
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-6">
        <section>
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">WOD en cours</h2>
          {!current ? (
            <p className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-500">Aucune séance ouverte pour le moment.</p>
          ) : (
            <div className="bg-white border-2 border-slate-900 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <div className="font-black text-lg">{wodLabel(current.wodType)}</div>
                  <div className="text-xs text-slate-500">{fmtDate(current.createdAt)}{current.raceEndedAt ? " · terminé" : " · ouvert"}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {currentMembership && (
                    <span className="text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full">{currentMembership.teamName}</span>
                  )}
                  {refereeRow && (
                    <span className="text-[11px] font-bold bg-[#062230] text-amber-300 px-2 py-1 rounded-full">🏴‍☠️ arbitre{refereeRow.note && refereeRow.note !== "Arbitre" ? ` · ${refereeRow.note}` : ""}</span>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-3">
                {refereeRow
                  ? "Le greffier t'a inscrit comme arbitre sur ce WOD."
                  : currentMembership
                    ? "Tu es participant sur ce WOD."
                    : "Quel est ton rôle sur ce WOD ?"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {!current.refereeMode ? (
                  <div className="bg-slate-100 text-slate-400 font-bold text-center rounded-xl py-4 px-2 text-sm">Pas d'arbitrage sur ce WOD</div>
                ) : canReferee ? (
                  <Link href="/touche-coule" className="bg-[#062230] text-amber-300 font-black text-center rounded-xl py-4 px-2 leading-tight">
                    🏴‍☠️ Arbitre
                    <span className="block text-[11px] font-normal text-amber-100/70 mt-1">Touché-Coulé</span>
                  </Link>
                ) : (
                  <div className="bg-slate-100 text-slate-500 rounded-xl py-3 px-3 text-xs leading-snug">
                    <span className="font-black text-slate-700 block mb-1">🏴‍☠️ Arbitre</span>
                    Tu participes dans {currentMembership?.teamName}. Si tu arrêtes (DNF, blessure…), demande au greffier de t'inscrire comme arbitre.
                  </div>
                )}
                {currentMembership ? (
                  <Link href={`/eleve/${current.id}`} className="bg-emerald-600 text-white font-black text-center rounded-xl py-4 px-2 leading-tight">
                    💪 Participant
                    <span className="block text-[11px] font-normal text-emerald-100 mt-1">Résultats · arbitrages · auto-éval</span>
                  </Link>
                ) : (
                  <div className="bg-slate-100 text-slate-500 rounded-xl py-3 px-3 text-xs leading-snug">
                    <span className="font-black text-slate-700 block mb-1">💪 Participant</span>
                    Le greffier doit d'abord t'encoder dans une équipe. Reviens ici ensuite : tes résultats et ton auto-évaluation apparaîtront.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Mes WOD</h2>
          {history.length === 0 ? (
            <p className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-500">
              Ton nom n'est encore apparu dans aucun WOD précédent.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((r) => (
                <li key={r.sessionId}>
                  <Link href={`/eleve/${r.sessionId}`} className="block bg-white border border-slate-200 hover:border-slate-900 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-black">{r.label}</div>
                        <div className="text-xs text-slate-500">{fmtDate(r.createdAt)} · {r.teamName}</div>
                      </div>
                      <span className="text-slate-400 font-black">›</span>
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
