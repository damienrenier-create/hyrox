import Link from "next/link";
import { getSession } from "@/lib/session-server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { generateGhostFleetsAction } from "../touche-coule/actions";
import { listWodEngines } from "@/lib/wod-engines";
import { ensureAutoSessions, listOpenSessions, upcomingSessions, isScheduled, fmtMin, WEEKDAYS, toMs, brusselsNow, TZ } from "@/lib/scheduling";
import { readSessionClasses, readCycleClasses, MAX_CLASSES } from "@/lib/session-roles";
import { SlotDeleteButton } from "./SlotDeleteButton";
import { wodLabel } from "@/lib/student-sessions";
import { groupLabel, groupSlots, weeklyMinutes, type SlotRow } from "@/lib/journal";
import { teacherNameById } from "@/lib/staff";
import {
  addPlanAction, closeSessionAction, createCycleAction, decideRefereeFormAction, deleteCycleAction, deletePlanAction,
  openSessionAction, prepareSessionAction, unprepareSessionAction, renameCycleAction, setCurrentCycleAction, setCurrentPlanAction, setCycleClassesAction,
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

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ ok?: string; msg?: string; w?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) {
    redirect("/");
  }
  // Un coach voit et pilote tout, mais aucune suppression ne lui est proposee.
  const canDelete = user.role === "MASTER_ADMIN";
  const { ok, msg, w } = await searchParams;

  await ensureAutoSessions();
  const open = await listOpenSessions();
  // Vue semaine du lundi au vendredi : cette semaine par defaut (la suivante des le samedi), ?w=1 pour la suivante.
  const wk = Math.min(4, Math.max(0, parseInt(w ?? "0", 10) || 0));
  const todayZ = Temporal.Now.zonedDateTimeISO(TZ);
  const monday = todayZ.subtract({ days: todayZ.dayOfWeek - 1 }).add({ weeks: (todayZ.dayOfWeek > 5 ? 1 : 0) + wk });
  const weekDays = [0, 1, 2, 3, 4].map((i) => monday.add({ days: i }).toPlainDate().toString());
  const todayKey = todayZ.toPlainDate().toString();
  const daysAhead = Math.max(1, Math.round((monday.add({ days: 5 }).epochMilliseconds - todayZ.epochMilliseconds) / 86_400_000) + 1);
  const upcoming = (await upcomingSessions(80, daysAhead)).filter((u) => weekDays.includes(u.dateKey));
  const byDay = weekDays.map((dk) => upcoming.filter((u) => u.dateKey === dk));
  const fmtWeekDay = (dk: string) => `${dk.slice(8)}/${dk.slice(5, 7)}`;
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
  // Journal de classe : les creneaux appartiennent a chaque prof ; la console n'en montre qu'un resume.
  const slots = (await db.orm.public.ClassSlot.where({}).all()) as SlotRow[];
  const myGroups = groupSlots(slots.filter((s) => s.teacherId === user.id));
  const teacherNames = await teacherNameById();
  const allClasses = [...new Set((await db.orm.public.User.where({ role: "STUDENT" }).all()).map((u) => u.className).filter((c): c is string => !!c))].sort();
  // Classes rangees par degre (1P2, 2Ca…, 3GTa…) pour les cases a cocher des cycles.
  const families = (() => {
    const m = new Map<string, string[]>();
    for (const c of allClasses) (m.get(c[0] ?? "?") ?? m.set(c[0] ?? "?", []).get(c[0] ?? "?")!).push(c);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "fr", { numeric: true }));
  })();
  const ClassPicker = ({ checked }: { checked: string[] }) => (
    <div className="space-y-1.5">
      {families.map(([fam, list]) => (
        <div key={fam} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-extrabold uppercase text-ink-3 w-6">{/^\d$/.test(fam) ? `${fam}e` : fam}</span>
          {list.map((c) => (
            <label key={c} className="inline-flex items-center gap-1 text-xs font-semibold bg-paper border border-line rounded-lg px-2 py-1 cursor-pointer hover:border-brand">
              <input type="checkbox" name="classes" value={c} defaultChecked={checked.includes(c)} className={ui.check} /> {c}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
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

  return (
    <div className={ui.page}>
      <TopBar
        title="Console"
        subtitle={<>Heure de Bruxelles : {WEEKDAYS[now.weekday] ?? ""} {fmtMin(now.minutes)} · cycle en cours : <b className="text-ink">{current?.name ?? "aucun"}</b>{current && <> · séance de la semaine : <b className="text-ink">{plans.find((p) => p.isCurrent)?.label ?? "aucune"}</b></>}</>}
        right={
          <nav className="flex flex-wrap gap-2">
            <Link href="/admin/journal" className={btn.smPrimary}>📅 Journal de classe</Link>
            <Link href="/admin/carnet" className={btn.smGhost}>📒 Carnet de cotes</Link>
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
                        {s.closesAt && <> → ferme à {fmtTime(s.closesAt)}</>} · {s.autoOpened ? "auto (journal de classe)" : "manuelle"}
                        {s.teacherId && teacherNames.get(s.teacherId) && <> · {teacherNames.get(s.teacherId)}</>}
                        {s.raceEndedAt && " · WOD terminé"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/greffier?session=${s.id}`} className={btn.smPrimary}>Greffier</Link>
                      {/* Un deuxieme prof arbitre pendant que le premier tient le greffier : chacun son ecran. */}
                      {s.refereeMode && <Link href={`/touche-coule?session=${s.id}`} className={btn.smSea}>🏴‍☠️ Arbitrer</Link>}
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

        {/* ===== Semaine du lundi au vendredi : les creneaux des journaux de classe, une colonne par jour ===== */}
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h2 className={ui.h2}>
              Semaine du {fmtWeekDay(weekDays[0])} au {fmtWeekDay(weekDays[4])}
              <span className="text-ink-3 text-sm font-sans font-normal"> ({upcoming.length} créneau{upcoming.length > 1 ? "x" : ""})</span>
            </h2>
            <div className={`${ui.segmented}`}>
              <Link href="/admin" className={cx("px-3 py-1 rounded-lg text-xs font-bold transition", wk === 0 ? ui.segOn : ui.segOff)}>Cette semaine</Link>
              <Link href="/admin?w=1" className={cx("px-3 py-1 rounded-lg text-xs font-bold transition", wk === 1 ? ui.segOn : ui.segOff)}>Semaine suivante</Link>
              {wk > 1 && <span className={cx("px-3 py-1 rounded-lg text-xs font-bold", ui.segOn)}>+{wk} semaines</span>}
              {wk >= 1 && wk < 4 && <Link href={`/admin?w=${wk + 1}`} className={cx("px-3 py-1 rounded-lg text-xs font-bold transition", ui.segOff)}>›</Link>}
            </div>
          </div>
          <p className={`${ui.hint} mb-3`}>
            Ce sont les créneaux des <b>journaux de classe</b>, qui reviennent chaque semaine : rien n&apos;est créé tant que tu n&apos;as pas appuyé sur
            « Préparer », et le jour venu la séance s&apos;ouvre de toute façon toute seule. La croix retire le créneau du journal, pour toutes les semaines.
          </p>
          {upcoming.length === 0 && (
            <p className={`${ui.muted} mb-3`}>
              Rien cette semaine. Il faut un cycle en cours avec ses classes, une séance de la semaine, et des classes posées dans un <Link href="/admin/journal" className="underline font-semibold">journal de classe</Link>.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {weekDays.map((dk, i) => {
              const past = dk < todayKey;
              return (
                <div key={dk} className={cx(ui.inset, "p-2 min-h-[110px]", dk === todayKey && "border-brand ring-1 ring-brand/30", past && "opacity-60")}>
                  <div className="text-[11px] font-extrabold uppercase text-ink-3">{WEEKDAYS[i + 1]}</div>
                  <div className="font-display font-extrabold text-lg leading-none mb-2">{fmtWeekDay(dk)}</div>
                  {byDay[i].length === 0 ? (
                    <p className={ui.hint}>{past ? "passé" : "—"}</p>
                  ) : (
                    byDay[i].map((u) => (
                      <div key={u.slotKey} className={cx("rounded-lg border bg-card p-2 mb-1.5 text-xs", u.sessionId ? "border-success/50" : "border-line")}>
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <div className="font-extrabold tabular-nums">{fmtMin(u.startMin)}–{fmtMin(u.endMin)}</div>
                            <div className="font-bold truncate">{u.planLabel}{u.refereeMode ? " 🏴‍☠️" : ""}</div>
                            <div className="text-ink-2 truncate">{u.classes.length ? u.classes.join(", ") : "aucune classe"}</div>
                            {u.teacherName && <div className={cx("truncate", u.teacherId === user.id ? "text-brand-ink font-semibold" : "text-ink-3")}>{u.teacherName}</div>}
                          </div>
                          {u.teacherId && (u.teacherId === user.id || canDelete) && (
                            <SlotDeleteButton teacherId={u.teacherId} weekday={u.weekday} startMin={u.startMin} endMin={u.endMin} classes={u.classes} />
                          )}
                        </div>
                        <div className="mt-1.5">
                          {u.sessionId ? (
                            <Link href={`/greffier?session=${u.sessionId}`} className={`${ui.chip} ${ui.chipOk}`}>✓ préparée · ouvrir</Link>
                          ) : (
                            <form action={prepareSessionAction}>
                              <input type="hidden" name="slotKey" value={u.slotKey} />
                              <button type="submit" className={btn.smGhost}>Préparer</button>
                            </form>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
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

        {/* ===== Journal de classe (resume) ===== */}
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h2 className={ui.h2}>Mon journal de classe</h2>
            <Link href="/admin/journal" className={btn.smPrimary}>Ouvrir le journal</Link>
          </div>
          <p className={`${ui.hint} mb-3`}>
            Chaque prof pose ses classes dans sa grille de la semaine (jusqu&apos;à {MAX_CLASSES} classes par créneau = une séance commune).
            Pendant ces créneaux, la séance de la semaine s&apos;ouvre toute seule et se ferme à la fin.
          </p>
          {myGroups.length === 0 ? (
            <p className={ui.muted}>Aucun créneau dans ton journal pour l&apos;instant.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {myGroups.map((g) => (
                <li key={g.key} className={`${ui.inset} p-2.5`}>
                  <div className="text-[11px] font-extrabold uppercase text-ink-3">{WEEKDAYS[g.weekday]} {fmtMin(g.startMin)}–{fmtMin(g.endMin)}</div>
                  <div className="font-bold text-sm">{groupLabel(g.classes.map((c) => c.className))}</div>
                </li>
              ))}
              <li className="text-xs text-ink-3 self-center px-1">{Math.floor(weeklyMinutes(myGroups) / 60)} h {String(weeklyMinutes(myGroups) % 60).padStart(2, "0")} par semaine</li>
            </ul>
          )}
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
                  {/* Classes concernees : les creneaux des autres classes n'ouvrent rien dans ce cycle. */}
                  {(() => {
                    const cls = readCycleClasses(c.classes);
                    return (
                      <details className="basis-full">
                        <summary className="text-xs cursor-pointer select-none">
                          <span className="font-bold text-ink-2">Classes : </span>
                          {cls ? <span className="font-semibold">{cls.join(", ")}</span> : <span className="text-ink-3">toutes (aucune restriction)</span>}
                          <span className="text-ink-3"> · modifier</span>
                        </summary>
                        <form action={setCycleClassesAction} className="mt-2 space-y-2">
                          <input type="hidden" name="id" value={c.id} />
                          <ClassPicker checked={cls ?? []} />
                          <div className="flex items-center gap-2">
                            <button type="submit" className={btn.smPrimary}>Enregistrer</button>
                            <span className={ui.hint}>Rien de coché = toutes les classes.</span>
                          </div>
                        </form>
                      </details>
                    );
                  })()}
                </li>
              ))}
            </ul>
          )}
          <form action={createCycleAction} className="space-y-2">
            <div className="flex gap-2">
              <input name="name" placeholder="Nouveau cycle (ex. Hyrox)" required className={`${input} flex-1`} />
              <button type="submit" className={btn.primary}>+ Créer</button>
            </div>
            <details>
              <summary className="text-xs font-bold text-ink-2 cursor-pointer select-none">Pour quelles classes ? <span className="font-normal text-ink-3">(rien de coché = toutes ; en Hyrox, pas de deuxièmes par exemple)</span></summary>
              <div className="mt-2"><ClassPicker checked={[]} /></div>
            </details>
          </form>
        </section>
      </main>
    </div>
  );
}
