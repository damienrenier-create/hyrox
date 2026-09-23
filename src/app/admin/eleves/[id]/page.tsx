import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { sessionsForStudent, fmtDate } from "@/lib/student-sessions";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { TopBar } from "../../../_components/TopBar";
import { resetStudentPinAction, updateStudentAction } from "../actions";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Fiche d'un eleve : identite corrigeable, code PIN, fiabilite d'arbitre, et son parcours (WOD,
// auto-evaluations, avis des profs). Rien ne se supprime ici.
export default async function EleveFichePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; msg?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { id } = await params;
  const { ok, msg } = await searchParams;
  const s = await db.orm.public.User.where({ id, role: "STUDENT" }).first();
  if (!s) redirect("/admin/eleves?msg=" + encodeURIComponent("Élève introuvable."));

  const [history, selfEvals, reviews, refereeRows, evalsGiven] = await Promise.all([
    sessionsForStudent(s.id),
    db.orm.public.SelfEvaluation.where({ studentId: s.id }).all(),
    db.orm.public.SelfEvalReview.where({ studentId: s.id }).all(),
    db.orm.public.SessionReferee.where({ userId: s.id }).all(),
    db.orm.public.Evaluation.where({ evaluatorId: s.id }).aggregate((a) => ({ n: a.count() })),
  ]);
  const selfBy = new Map(selfEvals.map((e) => [e.sessionId, e]));
  const reviewBy = new Map(reviews.map((r) => [r.sessionId, r]));
  const refBy = new Map(refereeRows.map((r) => [r.sessionId, r]));
  const colorOf = (code: string | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";
  const dob = s.dateOfBirth ? String(s.dateOfBirth).slice(0, 10) : "";

  return (
    <div className={ui.page}>
      <TopBar
        title={`${s.firstName ?? ""} ${s.lastName ?? ""}`.trim()}
        subtitle={s.className ?? "sans classe"}
        back={{ href: "/admin/eleves", label: "Élèves" }}
        right={<Link href={`/admin/resultats?eleve=${encodeURIComponent(s.lastName ?? "")}`} className={btn.smGhost}>Ses résultats</Link>}
      />
      <main className={`${ui.container} py-6 space-y-5`}>
        {ok && <p className={ui.alertOk}>✅ {ok}</p>}
        {msg && <p className={ui.alertErr}>⚠️ {msg}</p>}

        <section className={ui.cardPad}>
          <h2 className={`${ui.h2} mb-3`}>Identité</h2>
          <form action={updateStudentAction} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <input type="hidden" name="id" value={s.id} />
            <label className="text-xs"><span className={ui.label}>Prénom</span><input name="firstName" defaultValue={s.firstName ?? ""} required className={ui.input} /></label>
            <label className="text-xs"><span className={ui.label}>Nom</span><input name="lastName" defaultValue={s.lastName ?? ""} required className={ui.input} /></label>
            <label className="text-xs"><span className={ui.label}>Classe</span><input name="className" defaultValue={s.className ?? ""} placeholder="ex. 5GTb" className={ui.input} /></label>
            <label className="text-xs">
              <span className={ui.label}>Sexe</span>
              <select name="sex" defaultValue={s.sex ?? ""} className={ui.input}>
                <option value="">—</option><option value="F">F</option><option value="M">M</option>
              </select>
            </label>
            <label className="text-xs"><span className={ui.label}>Date de naissance</span><input type="date" name="dateOfBirth" defaultValue={dob} className={ui.input} /></label>
            <button type="submit" className={`${btn.primary} lg:col-span-5 justify-self-start`}>Enregistrer</button>
          </form>
          <p className={`${ui.hint} mt-2`}>La date de naissance sert à la première connexion : l&apos;élève doit la saisir avant de créer son code PIN.</p>
        </section>

        <section className={`${ui.cardPad} grid sm:grid-cols-2 gap-4`}>
          <div>
            <h3 className={`${ui.h3} mb-1`}>Code PIN</h3>
            <p className={`${ui.muted} mb-2`}>
              {s.pinCode ? "Un code existe. Le remettre à zéro oblige l'élève à repasser par sa date de naissance et son engagement." : "Aucun code : l'élève ne s'est pas encore connecté."}
            </p>
            {s.pinCode && (
              <form action={resetStudentPinAction}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className={btn.danger}>Remettre le code PIN à zéro</button>
              </form>
            )}
          </div>
          <div>
            <h3 className={`${ui.h3} mb-1`}>Arbitrage</h3>
            <p className={ui.muted}>
              Fiabilité <b className="text-ink tabular-nums">{s.reliability}</b> · <b className="text-ink tabular-nums">{evalsGiven.n}</b> évaluation(s) données · arbitre sur <b className="text-ink tabular-nums">{refereeRows.filter((r) => r.status === "APPROVED").length}</b> séance(s)
            </p>
          </div>
        </section>

        <section className={ui.cardPad}>
          <h2 className={`${ui.h2} mb-3`}>Parcours <span className="text-ink-3 text-sm font-sans font-normal">({history.length} WOD)</span></h2>
          {history.length === 0 ? (
            <p className={ui.muted}>Aucune séance encore.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className={ui.th}>Séance</th><th className={ui.th}>Équipe</th><th className={ui.th}>Arbitre</th>
                    {SELF_EVAL_CRITERIA.map((c, i) => <th key={c.id} className={`${ui.th} text-center`} title={c.label}>AE{i + 1}</th>)}
                    <th className={ui.th}>Avis du prof</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const se = selfBy.get(h.sessionId);
                    const rv = reviewBy.get(h.sessionId);
                    const rf = refBy.get(h.sessionId);
                    const ans = (se?.answers as Record<string, string> | undefined) ?? {};
                    return (
                      <tr key={h.sessionId} className={ui.tr}>
                        <td className="p-2 whitespace-nowrap"><Link href={`/greffier?session=${h.sessionId}`} className="underline text-brand">{h.label}</Link> <span className="text-ink-3">{fmtDate(h.createdAt)}</span></td>
                        <td className="p-2">{h.teamName}</td>
                        <td className="p-2">{rf ? <span className={cx(ui.chip, rf.status === "APPROVED" ? ui.chipSea : ui.chipMuted)}>{rf.status === "APPROVED" ? `🏴‍☠️ ${rf.note ?? ""}` : rf.status}</span> : ""}</td>
                        {SELF_EVAL_CRITERIA.map((c) => (
                          <td key={c.id} className={cx("p-2 text-center font-black", colorOf(ans[c.id]))}>
                            {ans[c.id] ?? "—"}
                            {rv?.answers && (rv.answers as Record<string, string>)[c.id] && <span className="block text-[9px] text-ink-3 font-bold">prof {(rv.answers as Record<string, string>)[c.id]}</span>}
                          </td>
                        ))}
                        <td className="p-2 text-ink-2">
                          {rv ? <>{rv.reviewerName}{rv.visible ? " · grille visible" : ""}{rv.comment ? ` · « ${rv.comment.slice(0, 60)}${rv.comment.length > 60 ? "…" : ""} »` : ""}</> : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={`${ui.hint} mt-2`}>Les avis se donnent depuis <Link href="/admin/auto-evaluations" className="underline">Auto-évaluations</Link>.</p>
        </section>
      </main>
    </div>
  );
}
