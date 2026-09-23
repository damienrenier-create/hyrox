import Link from "next/link";
import { getSession } from "@/lib/session-server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { generateGhostFleetsAction } from "../touche-coule/actions";
import { listWodEngines } from "@/lib/wod-engines";
import { ensureAutoSessions, listOpenSessions, upcomingSessions, isScheduled, fmtMin, WEEKDAYS, toMs, brusselsNow, TZ } from "@/lib/scheduling";
import { readSessionClasses, MAX_CLASSES } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import {
  addPlanAction, addSlotAction, closeSessionAction, createCycleAction, decideRefereeFormAction, deleteCycleAction, deletePlanAction,
  deleteSlotAction, openSessionAction, prepareSessionAction, unprepareSessionAction, renameCycleAction, setCurrentCycleAction, setCurrentPlanAction,
} from "./cycles-actions";
import { TopBar } from "../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

async function runGenerateGhostFleets(sessionId: string) {
  "use server";
  await generateGhostFleetsAction(sessionId, 2);
}

const fmtTime = (v: unknown) => new Date(toMs(v)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtDay = (v: unknown) => new Date(toMs(v)).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TZ });

const card = ui.cardPad;
const input = ui.input;
const fieldLabel = ui.label;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ ok?: string; msg?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) {
    redirect("/");
  }
  // Un coach voit et pilote tout, mais aucune suppression ne lui est proposee.
  const canDelete = user.role === "MASTER_ADMIN";
  const { ok, msg } = await searchParams;

  await ensureAutoSessions();
  const open = await listOpenSessions();
  const upcoming = await upcomingSessions(10);
  const allSessions = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all();
  // Seances DEJA creees en attente de leur heure (a distinguer des simples creneaux recurrents).
  const scheduled = allSessions.filter((s) => s.isActive && isScheduled(s)).sort((a, b) => toMs(a.opensAt) - toMs(b.opensAt));
  // Raccourci vers les 3 dernieres seances ecoulees (ni ouvertes, ni programmees) : relecture rapide.
  const openIds = new Set(open.map((s) => s.id));
  const scheduledIds = new Set(scheduled.map((s) => s.id));
  const past = allSessions.filter((s) => !openIds.has(s.id) && !scheduledIds.has(s.id)).slice(0, 3);
  const cycles = await db.orm.public.Cycle.where({}).orderBy((c) => c.order.asc()).all();
  const current = cycles.find((c) => c.isCurrent) ?? null;
  const plans = current ? await db.orm.public.CyclePlan.where({ cycleId: current.id }).orderBy((p) => p.order.asc()).all() : [];
  const slots = (await db.orm.public.ClassSlot.where({}).all()).sort(
    (a, b) => a.className.localeCompare(b.className) || a.weekday - b.weekday || a.startMin - b.startMin
  );
  const allClasses = [...new Set((await db.orm.public.User.where({ role: "STUDENT" }).all()).map((u) => u.className).filter((c): c is string => !!c))].sort();
  const engines = listWodEngines();
  const engineName = (id: string) => engines.find((e) => e.id === id)?.name ?? wodLabel(id);
  const now = brusselsNow();

  // Demandes d'arbitrage en attente sur les seances ouvertes (un prof peut trancher a la place du greffier).
  const pendingRequests: { sessionId: string; sessionLabel: string; userId: string; name: string; className: string | null; note: string | null }[] = [];
  for (const s of open) {
    const rows = await db.orm.public.SessionReferee.where({ sessionId: s.id, status: "PENDING" }).all();
    for (const r of rows) {
      const u = await db.orm.public.User.where({ id: r.userId }).first();
      if (u) pendingRequests.push({ sessionId: s.id, sessionLabel: s.label ?? wodLabel(s.wodType), userId: u.id, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(), className: u.className ?? null, note: r.note ?? null });
    }
  }

  const slotsByClass = new Map<string, typeof slots>();
  for (const s of slots) {
    if (!slotsByClass.has(s.className)) slotsByClass.set(s.className, []);
    slotsByClass.get(s.className)!.push(s);
  }

  return (
    <div className={ui.page}>
      <TopBar
        title="Console"
        subtitle={<>Heure de Bruxelles : {WEEKDAYS[now.weekday] ?? ""} {fmtMin(now.minutes)} · cycle en cours : <b className="text-ink">{current?.name ?? "aucun"}</b>{current && <> · séance de la semaine : <b className="text-ink">{plans.find((p) => p.isCurrent)?.label ?? "aucune"}</b></>}</>}
        right={
          <nav className="flex flex-wrap gap-2">
            <Link href="/admin/auto-evaluations" className={btn.smGhost}>Auto-évaluations</Link>
            <Link href="/admin/carte" className={btn.smGhost}>Carte 🏴‍☠️</Link>
            <Link href="/admin/resultats" className={btn.smGhost}>Résultats</Link>
            <Link href="/admin/eleves" className={btn.smGhost}>Élèves</Link>
            {canDelete && <Link href="/admin/nettoyage" className={btn.smGhost}>Nettoyage</Link>}
            <Link href="/greffier" className={btn.smGhost}>Greffier</Link>
            <Link href="/touche-coule" className={btn.smSea}>Touché-Coulé</Link>
          </nav>
        }
      />

      <main className={`${ui.container} py-6 space-y-5`}>
        {ok && <p className={ui.alertOk}>✅ {ok}</p>}
        {msg && <p className={ui.alertErr}>⚠️ {msg}</p>}

        {/* ===== Seances ouvertes ===== */}
        <section className={card}>
          <h2 className={`${ui.h2} mb-3`}>Séances ouvertes maintenant <span className="text-ink-3 text-sm font-sans font-normal">({open.length})</span></h2>
          {open.length === 0 ? (
            <p className={ui.muted}>Aucune. Une séance s&apos;ouvre automatiquement pendant le créneau d&apos;une classe (si un cycle et une séance de la semaine sont définis), ou manuellement ci-dessous.</p>
          ) : (
            <ul className="space-y-2">
              {open.map((s) => {
                const classes = readSessionClasses(s.settings);
                return (
                  <li key={s.id} className={`${ui.inset} p-3 flex flex-wrap items-center justify-between gap-3`}>
                    <div className="min-w-0">
                      <div className="font-bold">
                        {s.label ?? wodLabel(s.wodType)}
                        <span className="text-ink-3 font-normal"> · {engineName(s.wodType)}</span>
                        {s.refereeMode && <span className={`${ui.chip} ${ui.chipSea} ml-2`}>🏴‍☠️ Touché-Coulé</span>}
                      </div>
                      <div className="text-xs text-ink-2">
                        {classes.length ? classes.join(", ") : "toutes classes"} · ouverte {fmtDay(s.createdAt)} {fmtTime(s.createdAt)}
                        {s.closesAt && <> → ferme à {fmtTime(s.closesAt)}</>} · {s.autoOpened ? "auto (horaire)" : "manuelle"}
                        {s.raceEndedAt && " · WOD terminé"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/greffier?session=${s.id}`} className={btn.smPrimary}>Greffier</Link>
                      {s.refereeMode && (
                        <form action={runGenerateGhostFleets.bind(null, s.id)}>
                          <button type="submit" className={btn.smGhost} title="2 flottes verrouillées portées par Damien Renier">🏴‍☠️ Fantômes</button>
                        </form>
                      )}
                      <form action={closeSessionAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className={btn.smDanger}>Fermer</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ===== Raccourci : les 3 dernieres seances ecoulees ===== */}
        {past.length > 0 && (
          <section className={card}>
            <h2 className={`${ui.h2} mb-1`}>3 dernières séances</h2>
            <p className={`${ui.hint} mb-3`}>Relecture rapide : résultats du greffier, auto-évaluations, carte du Touché-Coulé.</p>
            <ul className="space-y-2">
              {past.map((s) => {
                const classes = readSessionClasses(s.settings);
                return (
                  <li key={s.id} className={`${ui.inset} p-3 flex flex-wrap items-center justify-between gap-3`}>
                    <div className="min-w-0">
                      <div className="font-bold">
                        {s.label ?? wodLabel(s.wodType)}
                        <span className="text-ink-3 font-normal"> · {fmtDay(s.createdAt)} {fmtTime(s.createdAt)}</span>
                        {s.raceEndedAt ? (
                          <span className={`${ui.chip} ${ui.chipOk} ml-2`}>WOD terminé</span>
                        ) : (
                          <span className={`${ui.chip} ${ui.chipMuted} ml-2`}>non terminé</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-2">{classes.length ? classes.join(", ") : "toutes classes"} · {engineName(s.wodType)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/greffier?session=${s.id}`} className={btn.smPrimary}>Résultats</Link>
                      <Link href={`/admin/resultats?session=${s.id}`} className={btn.smGhost}>Consultation</Link>
                      <Link href={`/admin/auto-evaluations?session=${s.id}`} className={btn.smGhost}>Auto-évals</Link>
                      {s.refereeMode && <Link href={`/admin/carte?session=${s.id}`} className={btn.smGhost}>Carte 🏴‍☠️</Link>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ===== Seances DEJA preparees (creees, en attente de leur heure) ===== */}
        {scheduled.length > 0 && (
          <section className={`${card} border-success/40`}>
            <h2 className={`${ui.h2} mb-1`}>Séances préparées <span className="text-ink-3 text-sm font-sans font-normal">({scheduled.length})</span></h2>
            <p className={`${ui.hint} mb-3`}>
              Déjà créées : tu peux y encoder les équipes et régler le WOD dès maintenant. Elles restent invisibles des
              élèves jusqu&apos;à leur heure d&apos;ouverture, puis s&apos;ouvrent toutes seules.
            </p>
            <ul className="space-y-2">
              {scheduled.map((s) => (
                <li key={s.id} className={`${ui.inset} p-3 flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0">
                    <div className="font-bold">
                      {s.label ?? wodLabel(s.wodType)}
                      <span className="text-ink-3 font-normal"> · ouvre {fmtDay(s.opensAt)} à {fmtTime(s.opensAt)}</span>
                      {s.refereeMode && <span className={`${ui.chip} ${ui.chipSea} ml-2`}>🏴‍☠️ Touché-Coulé</span>}
                    </div>
                    <div className="text-xs text-ink-2">
                      {readSessionClasses(s.settings).join(", ") || "toutes classes"}
                      {s.closesAt && <> · ferme à {fmtTime(s.closesAt)}</>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/greffier?session=${s.id}`} className={btn.smPrimary}>Préparer les équipes</Link>
                    {canDelete && (
                      <form action={unprepareSessionAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className={btn.smDanger}>Annuler</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ===== Creneaux RECURRENTS a venir : rien n'existe tant qu'on n'a pas appuye sur Preparer ===== */}
        <section className={card}>
          <h2 className={`${ui.h2} mb-1`}>Prochains créneaux <span className="text-ink-3 text-sm font-sans font-normal">({upcoming.length})</span></h2>
          <p className={`${ui.hint} mb-3`}>
            Ce ne sont pas des séances : c&apos;est ton horaire de classe, <b>qui revient chaque semaine</b>. Rien n&apos;est
            créé tant que tu n&apos;as pas appuyé sur « Préparer » — et « Préparer » ne crée <b>que cette date-là</b>.
            Le jour venu, une séance s&apos;ouvre de toute façon automatiquement, préparée ou non.
          </p>
          {upcoming.length === 0 ? (
            <p className={ui.muted}>
              Aucun créneau à venir. Il faut un cycle en cours, une séance de la semaine, et des créneaux horaires de classe (plus bas).
            </p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((u) => (
                <li key={u.slotKey} className={cx("bg-paper border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3", u.sessionId ? "border-success/50" : "border-line")}>
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="text-center flex-shrink-0 w-16">
                      <div className="text-[11px] font-extrabold uppercase text-ink-3">{WEEKDAYS[u.weekday]?.slice(0, 3)}</div>
                      <div className="font-display font-extrabold text-xl leading-none">{u.dateKey.slice(8)}/{u.dateKey.slice(5, 7)}</div>
                      <div className="text-[11px] text-ink-3 tabular-nums">{fmtMin(u.startMin)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold">
                        {u.planLabel}
                        <span className="text-ink-3 font-normal"> · {fmtMin(u.startMin)}–{fmtMin(u.endMin)}</span>
                        {u.refereeMode && <span className={`${ui.chip} ${ui.chipSea} ml-2`}>Touché-Coulé</span>}
                      </div>
                      <div className="text-xs text-ink-3">
                        {u.classes.length ? u.classes.join(", ") : "aucune classe"} · {u.numTeams} équipes
                      </div>
                    </div>
                  </div>
                  {u.sessionId ? (
                    <span className={`${ui.chip} ${ui.chipOk}`}>✓ déjà préparée</span>
                  ) : (
                    <form action={prepareSessionAction}>
                      <input type="hidden" name="slotKey" value={u.slotKey} />
                      <button type="submit" className={btn.smGhost}>Préparer cette date</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {pendingRequests.length > 0 && (
          <section className={`${card} border-accent/50 bg-accent-soft/40`}>
            <h2 className={`${ui.h2} mb-3`}>🏴‍☠️ Demandes d&apos;arbitrage en attente <span className="text-ink-3 text-sm font-sans font-normal">({pendingRequests.length})</span></h2>
            <ul className="space-y-2">
              {pendingRequests.map((r) => (
                <li key={`${r.sessionId}_${r.userId}`} className="bg-card border border-line rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-bold">{r.name}</span> <span className="text-ink-3">· {r.className ?? "?"} · {r.sessionLabel}</span>
                    <span className="block text-xs text-accent-ink font-semibold">Motif : {r.note ?? "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <form action={decideRefereeFormAction}>
                      <input type="hidden" name="sessionId" value={r.sessionId} />
                      <input type="hidden" name="userId" value={r.userId} />
                      <input type="hidden" name="decision" value="APPROVED" />
                      <button type="submit" className={btn.smSuccess}>Accepter</button>
                    </form>
                    <form action={decideRefereeFormAction}>
                      <input type="hidden" name="sessionId" value={r.sessionId} />
                      <input type="hidden" name="userId" value={r.userId} />
                      <input type="hidden" name="decision" value="REFUSED" />
                      <button type="submit" className={btn.smDanger}>Refuser</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ===== Ouverture manuelle ===== */}
        <section className={card}>
          <h2 className={`${ui.h2} mb-1`}>Ouvrir ou programmer une séance</h2>
          <p className={`${ui.hint} mb-4`}>Pour une ou plusieurs classes (max {MAX_CLASSES}). Le greffier peut encore ajuster les classes, les équipes et les arbitres avant le départ.</p>
          <form action={openSessionAction} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className={fieldLabel}>Séance-type du cycle</span>
              <select name="planId" defaultValue={plans.find((p) => p.isCurrent)?.id ?? ""} className={input}>
                <option value="">— séance libre (type ci-contre) —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}{p.isCurrent ? " (semaine)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className={fieldLabel}>Type (si séance libre)</span>
              <select name="wodType" className={input}>
                {engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className={fieldLabel}>Nom affiché (optionnel, sinon celui de la séance-type)</span>
              <input name="label" placeholder="ex. Pyramide" className={input} />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className={fieldLabel}>Classes</legend>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                {allClasses.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-xs font-semibold bg-paper border border-line rounded-lg px-2 py-1.5 cursor-pointer hover:border-brand">
                    <input type="checkbox" name="classes" value={c} className={ui.check} /> {c}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-sm">
              <span className={fieldLabel}>Nombre d&apos;équipes</span>
              <input type="number" name="numTeams" defaultValue={plans.find((p) => p.isCurrent)?.numTeams ?? 20} min={1} max={50} className={input} />
            </label>
            <label className="text-sm">
              <span className={fieldLabel}>Reste ouverte pendant</span>
              <select name="hours" defaultValue="3" className={input}>
                {[1, 2, 3, 4, 6, 8].map((h) => <option key={h} value={h}>{h} h</option>)}
              </select>
            </label>
            <label className="flex items-center gap-3 text-sm text-ink sm:col-span-2">
              <input type="hidden" name="refereeModeSet" value="1" />
              <input type="checkbox" name="refereeMode" defaultChecked className="w-5 h-5 accent-brand" />
              Activer le Touché-Coulé (arbitrage par les élèves)
            </label>

            {/* Calendrier : une date precise au lieu de « tout de suite ». UNE seule seance, pas de repetition. */}
            <fieldset className={`${ui.inset} p-3 sm:col-span-2`}>
              <legend className={fieldLabel}>Ou programmer pour une date précise (facultatif)</legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="text-xs">
                  <span className="block text-ink-2 mb-0.5">Jour</span>
                  <input type="date" name="day" min={new Date().toISOString().slice(0, 10)} className={input} />
                </label>
                <label className="text-xs">
                  <span className="block text-ink-2 mb-0.5">De</span>
                  <input type="time" name="from" defaultValue="08:00" className={input} />
                </label>
                <label className="text-xs">
                  <span className="block text-ink-2 mb-0.5">À</span>
                  <input type="time" name="to" defaultValue="09:40" className={input} />
                </label>
              </div>
              <p className={`${ui.hint} mt-2`}>
                Jour rempli = la séance est <b>créée maintenant mais invisible des élèves</b> jusqu&apos;à cette heure-là,
                et tu es envoyé au greffier pour préparer les équipes. Jour vide = elle s&apos;ouvre tout de suite.
              </p>
            </fieldset>

            <button type="submit" className={`${btn.lgPrimary} sm:col-span-2`}>Ouvrir ou programmer la séance</button>
          </form>
        </section>

        {/* ===== Cycle en cours ===== */}
        <section className={card}>
          <h2 className={`${ui.h2} mb-1`}>Séances du cycle en cours {current && <span className="text-brand">· {current.name}</span>}</h2>
          {!current ? (
            <p className={ui.muted}>Crée un cycle ci-dessous et active-le.</p>
          ) : (
            <>
              <p className={`${ui.hint} mb-3`}>La « séance de la semaine » est celle qui s&apos;ouvre automatiquement pour une classe pendant son créneau horaire.</p>
              {plans.length === 0 ? (
                <p className={`${ui.muted} mb-3`}>Aucune séance-type pour l&apos;instant.</p>
              ) : (
                <ul className="space-y-1.5 mb-4">
                  {plans.map((p) => (
                    <li key={p.id} className={cx("flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 border", p.isCurrent ? "bg-brand-soft border-brand/40" : "bg-paper border-line")}>
                      <div className="text-sm">
                        <span className="font-bold">{p.order}. {p.label}</span>
                        <span className="text-ink-3"> · {engineName(p.wodType)} · {p.numTeams} équipes{p.refereeMode ? " · Touché-Coulé" : ""}</span>
                        {p.isCurrent && <span className={`${ui.chip} bg-brand text-white ml-2`}>SEMAINE</span>}
                      </div>
                      <div className="flex gap-2">
                        {!p.isCurrent && (
                          <form action={setCurrentPlanAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className={btn.smGhost}>Séance de la semaine</button>
                          </form>
                        )}
                        {canDelete && (
                          <form action={deletePlanAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className={btn.smDanger}>✕</button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addPlanAction} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <input type="hidden" name="cycleId" value={current.id} />
                <label className="text-xs col-span-2">
                  <span className={fieldLabel}>Nom de la séance</span>
                  <input name="label" placeholder="ex. Pyramide, Fête Foraine…" required className={input} />
                </label>
                <label className="text-xs">
                  <span className={fieldLabel}>Type</span>
                  <select name="wodType" className={input}>
                    {engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
                <label className="text-xs">
                  <span className={fieldLabel}>Équipes</span>
                  <input type="number" name="numTeams" defaultValue={20} min={1} max={50} className={input} />
                </label>
                <label className="text-xs flex items-center gap-2 pb-2.5 font-semibold text-ink-2">
                  <input type="checkbox" name="refereeMode" defaultChecked className={ui.check} /> Touché-Coulé
                </label>
                <button type="submit" className={`${btn.primary} col-span-2 sm:col-span-5`}>+ Ajouter la séance au cycle</button>
              </form>
            </>
          )}
        </section>

        {/* ===== Horaires ===== */}
        <section className={card}>
          <h2 className={`${ui.h2} mb-1`}>Horaires des classes</h2>
          <p className={`${ui.hint} mb-4`}>
            Pendant ces créneaux (lundi→vendredi, heure de Bruxelles), la séance de la semaine s&apos;ouvre toute seule pour la classe et se ferme à la fin du créneau.
            Deux classes sur le même créneau partagent la même séance.
          </p>
          {slotsByClass.size === 0 ? (
            <p className={`${ui.muted} mb-3`}>Aucun créneau encodé.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {[...slotsByClass.entries()].map(([cls, list]) => (
                <div key={cls} className={`${ui.inset} p-2.5`}>
                  <div className="font-bold text-sm mb-1">{cls}</div>
                  <ul className="space-y-1">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs text-ink-2">
                        <span>{WEEKDAYS[s.weekday]} {fmtMin(s.startMin)}–{fmtMin(s.endMin)}</span>
                        {canDelete && (
                          <form action={deleteSlotAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <button type="submit" className="text-danger font-bold px-2 hover:bg-danger-soft rounded">✕</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <form action={addSlotAction} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <label className="text-xs">
              <span className={fieldLabel}>Classe</span>
              <select name="className" className={input}>
                {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className={fieldLabel}>Jour</span>
              <select name="weekday" className={input}>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className={fieldLabel}>Début</span>
              <input type="time" name="start" defaultValue="08:00" required className={input} />
            </label>
            <label className="text-xs">
              <span className={fieldLabel}>Fin</span>
              <input type="time" name="end" defaultValue="09:40" required className={input} />
            </label>
            <button type="submit" className={btn.primary}>+ Créneau</button>
          </form>
        </section>

        {/* ===== Cycles ===== */}
        <section className={card}>
          <h2 className={`${ui.h2} mb-3`}>Cycles</h2>
          {cycles.length === 0 ? (
            <p className={`${ui.muted} mb-3`}>Aucun cycle. Exemple : « Hyrox », « Volley », « Spikeball »…</p>
          ) : (
            <ul className="space-y-1.5 mb-4">
              {cycles.map((c) => (
                <li key={c.id} className={cx("flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 border", c.isCurrent ? "bg-brand-soft border-brand/40" : "bg-paper border-line")}>
                  <form action={renameCycleAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="name" defaultValue={c.name} className={`${input} w-40`} />
                    <button type="submit" className={btn.smGhost}>Renommer</button>
                    {c.isCurrent && <span className={`${ui.chip} bg-brand text-white`}>EN COURS</span>}
                  </form>
                  <div className="flex gap-2">
                    {!c.isCurrent && (
                      <form action={setCurrentCycleAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className={btn.smPrimary}>Activer</button>
                      </form>
                    )}
                    {canDelete && (
                      <form action={deleteCycleAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className={btn.smDanger}>✕</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={createCycleAction} className="flex gap-2">
            <input name="name" placeholder="Nouveau cycle (ex. Hyrox)" required className={`${input} flex-1`} />
            <button type="submit" className={btn.primary}>+ Créer</button>
          </form>
        </section>
      </main>
    </div>
  );
}
