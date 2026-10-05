import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { sessionsForStudent, wodLabel, fmtDate, type StudentSessionRow } from "@/lib/student-sessions";
import { openSessionsForStudent, toMs } from "@/lib/scheduling";
import { refereeAccess } from "@/lib/referee-access";
import { LogoutButton } from "../_components/LogoutButton";
import { RefereeRequest } from "./RefereeRequest";
import { EleveTabs } from "./EleveTabs";
import { loadSelfEvalHistory } from "@/lib/student-self-evals";
import { evalBaremeVisible } from "@/lib/eval-bareme-server";
import { TopBar } from "../_components/TopBar";
import { cx, ui } from "@/lib/ui";
import { isBirthdayToday } from "@/lib/birthday";
import { isWinterArc } from "@/lib/winter-arc";
import { readQuizOpen, readSessionSex } from "@/lib/session-roles";
import { sexLabel } from "@/lib/journal";

export default async function ElevePage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect(user.role === "GREFFIER" ? "/greffier" : user.role === "MASTER_ADMIN" ? "/admin" : "/touche-coule");

  // Les seances de ma classe s'ouvrent automatiquement pendant mon creneau (voir scheduling.ts).
  const me = await db.orm.public.User.where({ id: user.id }).first();
  const birthday = isBirthdayToday(me?.dateOfBirth);
  const winterArc = isWinterArc(me?.winterArcUntil); // oui a l'interrupteur du greffier (Sartay 01/10)
  const openSessions = await openSessionsForStudent(user.id, user.className ?? null);
  const mine = await sessionsForStudent(user.id);
  const openIds = new Set(openSessions.map((s) => s.id));
  // Sartay 29/09 nuit : l'eleve ne voit que les WOD qu'il a vraiment faits (equipe avec au moins un resultat),
  // ranges par cycle puis par type de WOD ; rien d'autre.
  const history = mine.filter((r) => !openIds.has(r.sessionId) && r.recorded);
  const byCycle = groupHistory(history);
  const { todo } = await loadSelfEvalHistory(user.id, mine);
  // Onglet « Baremes » : pour les classes qui font le WOD Eval (05/10).
  const bareme = await evalBaremeVisible(user.className, [...openSessions, ...mine].some((s) => s.wodType === "HYROX"));
  // QCM bonus du Hyrox (01/10) : ouvert par le prof, une reponse par eleve.
  const quizDone = new Set((await db.orm.public.QuizAnswer.where({ studentId: user.id }).all()).map((a) => a.sessionId));
  const hyroxIds = [...new Set([...openSessions, ...history.map((r) => ({ id: r.sessionId, wodType: r.wodType }))].filter((s) => s.wodType === "HYROX").map((s) => s.id))];
  const quizOpenIds = new Set(hyroxIds.length ? (await db.orm.public.Session.where((s) => s.id.in(hyroxIds)).all()).filter((s) => readQuizOpen(s.settings)).map((s) => s.id) : []);
  const quizLink = (id: string) => (quizOpenIds.has(id) || quizDone.has(id) ? { href: `/eleve/${id}/qcm`, label: quizDone.has(id) ? "📝 QCM répondu" : "📝 QCM bonus ouvert" } : null);

  const cards = [];
  for (const s of openSessions) {
    const membership = mine.find((r) => r.sessionId === s.id) ?? null;
    // Arbitrage uniquement si autorise (encode par le greffier, ou demande acceptee) : voir referee-access.ts
    const access = await refereeAccess(s.id, user);
    cards.push({ s, membership, access });
  }

  return (
    <div className={ui.page}>
      <TopBar title={birthday ? `${user.name} 🎂` : user.name} subtitle={`${birthday ? `${user.className ?? ""} · joyeux anniversaire !` : (user.className ?? "")}${winterArc ? " · ❄️ winter arc jusqu'au 30 décembre" : ""}`} right={<LogoutButton />} />

      <main className="max-w-2xl mx-auto p-4 space-y-6">
        <EleveTabs active="wods" todo={todo.length} bareme={bareme} />

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
                      <div className="font-display font-extrabold text-lg">{wodLabel(s.wodType)}</div>
                      <div className="text-xs text-ink-2">
                        {fmtDate(s.createdAt)}
                        {s.raceEndedAt ? " · terminé" : " · ouvert"}
                        {s.closesAt ? ` jusqu'à ${new Date(toMs(s.closesAt)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })}` : ""}
                        {readSessionSex(s.settings) ? ` · ${sexLabel(readSessionSex(s.settings))}` : ""}
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
                        {s.wodType === "HYROX" ? "👁 Arbitre" : "🏴‍☠️ Arbitre"}
                        <span className="block text-[11px] font-normal text-white/80 mt-1">{s.wodType === "HYROX" ? "Suivre un élève 5 min" : "Touché-Coulé"}</span>
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
                  {membership && quizLink(s.id) && (
                    <Link href={quizLink(s.id)!.href} className={cx("block mt-2 rounded-xl border px-3 py-2 text-sm font-bold text-center transition", quizDone.has(s.id) ? "border-line bg-paper text-ink-2" : "border-brand bg-brand-soft text-brand-ink")}>{quizLink(s.id)!.label} ›</Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {byCycle.map((c) => (
          <section key={c.key} className="space-y-3">
            <h2 className={`${ui.eyebrow}`}>{c.name ? `Cycle ${c.name}` : "Mes WOD"} · {c.count} WOD fait{c.count > 1 ? "s" : ""}</h2>
            {c.types.map((t) => (
              <div key={t.wodType} className={`${ui.card} p-3 space-y-2`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display font-extrabold text-ink">{t.name} <span className="text-ink-3 font-sans text-sm font-semibold">· {t.rows.length} séance{t.rows.length > 1 ? "s" : ""}</span></h3>
                  {RECORDS_WOD[t.wodType] && <Link href={`/eleve/records?wod=${RECORDS_WOD[t.wodType]}`} className="text-xs font-bold text-accent-ink hover:underline whitespace-nowrap">🏆 Records</Link>}
                </div>
                <ul className="space-y-1.5">
                  {t.rows.map((r) => (
                    <li key={r.sessionId}>
                      <Link href={`/eleve/${r.sessionId}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper hover:border-brand px-3 py-2 transition">
                        <span>
                          <span className="block font-bold text-sm capitalize">{fmtDate(new Date(r.dateMs).toISOString())}</span>
                          <span className="block text-xs text-ink-2">{r.teamName} · résultats, arbitrages, auto-éval</span>
                          {quizLink(r.sessionId) && <span className={cx(ui.chip, quizDone.has(r.sessionId) ? ui.chipMuted : ui.chipBrand, "mt-1")}>{quizLink(r.sessionId)!.label}</span>}
                        </span>
                        <span className="text-ink-3 font-black">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}

// Records existants par type de WOD (lien depuis un WOD fait par l'eleve).
const RECORDS_WOD: Record<string, string> = { PYRAMIDE_CLASSIQUE: "pyramide", LEVEL: "level" };
const WOD_ORDER = ["LEVEL", "PYRAMIDE_CLASSIQUE", "FETE_FORAINE"];

// Historique de l'eleve : un bloc par cycle (le plus recent d'abord), puis un par type de WOD.
function groupHistory(rows: StudentSessionRow[]) {
  const cycles: { key: string; name: string | null; count: number; last: number; types: { wodType: string; name: string; rows: StudentSessionRow[] }[] }[] = [];
  for (const r of rows) {
    const key = r.cycleId ?? "none";
    let c = cycles.find((x) => x.key === key);
    if (!c) { c = { key, name: r.cycleName, count: 0, last: r.dateMs, types: [] }; cycles.push(c); }
    c.count++;
    c.last = Math.max(c.last, r.dateMs);
    let t = c.types.find((x) => x.wodType === r.wodType);
    if (!t) { t = { wodType: r.wodType, name: r.wodName, rows: [] }; c.types.push(t); }
    t.rows.push(r);
  }
  const rank = (w: string) => { const i = WOD_ORDER.indexOf(w); return i < 0 ? WOD_ORDER.length : i; };
  for (const c of cycles) c.types.sort((a, b) => rank(a.wodType) - rank(b.wodType) || a.name.localeCompare(b.name, "fr"));
  return cycles.sort((a, b) => b.last - a.last);
}
