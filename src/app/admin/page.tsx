import Link from "next/link";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { generateGhostFleetsAction } from "../touche-coule/actions";
import { listWodEngines } from "@/lib/wod-engines";
import { ensureAutoSessions, listOpenSessions, fmtMin, WEEKDAYS, toMs, brusselsNow, TZ } from "@/lib/scheduling";
import { readSessionClasses, MAX_CLASSES } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import {
  addPlanAction, addSlotAction, closeSessionAction, createCycleAction, deleteCycleAction, deletePlanAction,
  deleteSlotAction, openSessionAction, renameCycleAction, setCurrentCycleAction, setCurrentPlanAction,
} from "./cycles-actions";

async function runGenerateGhostFleets(sessionId: string) {
  "use server";
  await generateGhostFleetsAction(sessionId, 2);
}

const fmtTime = (v: unknown) => new Date(toMs(v)).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtDay = (v: unknown) => new Date(toMs(v)).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TZ });

const card = "bg-slate-900 border border-cyan-900 rounded-xl p-4 sm:p-6 shadow-xl";
const input = "bg-slate-950 border border-cyan-800 rounded-lg p-2.5 text-white focus:border-cyan-400 outline-none text-sm";
const btn = "font-black tracking-wider px-4 py-2.5 rounded text-sm transition-transform active:scale-95";
const btnPrimary = `${btn} bg-cyan-600 hover:bg-cyan-500 text-slate-950`;
const btnGhost = `${btn} bg-slate-800 hover:bg-slate-700 text-cyan-100 border border-cyan-900`;
const btnDanger = `${btn} bg-red-900/40 hover:bg-red-900/70 text-red-200 border border-red-900`;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ ok?: string; msg?: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") {
    redirect("/");
  }
  const { ok, msg } = await searchParams;

  await ensureAutoSessions();
  const open = await listOpenSessions();
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

  const slotsByClass = new Map<string, typeof slots>();
  for (const s of slots) {
    if (!slotsByClass.has(s.className)) slotsByClass.set(s.className, []);
    slotsByClass.get(s.className)!.push(s);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-cyan-50 font-mono p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-black text-cyan-400 uppercase tracking-widest">Console DAMZER</h1>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link href="/admin/auto-evaluations" className={btnGhost}>Auto-évaluations</Link>
            <Link href="/greffier" className={btnGhost}>Greffier</Link>
            <Link href="/touche-coule" className={btnGhost}>Touché-Coulé</Link>
          </nav>
        </div>
        <p className="text-xs text-slate-500">
          Heure de Bruxelles : {WEEKDAYS[now.weekday] ?? ""} {fmtMin(now.minutes)} · cycle en cours : <span className="text-cyan-300">{current?.name ?? "aucun"}</span>
          {current && <> · séance de la semaine : <span className="text-cyan-300">{plans.find((p) => p.isCurrent)?.label ?? "aucune"}</span></>}
        </p>

        {ok && <p className="bg-emerald-900/40 border border-emerald-700 text-emerald-200 p-3 rounded text-sm">✅ {ok}</p>}
        {msg && <p className="bg-red-900/40 border border-red-700 text-red-200 p-3 rounded text-sm">⚠️ {msg}</p>}

        {/* ===== Seances ouvertes ===== */}
        <section className={card}>
          <h2 className="text-lg font-bold mb-3">Séances ouvertes maintenant <span className="text-slate-500 text-sm">({open.length})</span></h2>
          {open.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune. Une séance s'ouvre automatiquement pendant le créneau d'une classe (si un cycle et une séance de la semaine sont définis), ou manuellement ci-dessous.</p>
          ) : (
            <ul className="space-y-2">
              {open.map((s) => {
                const classes = readSessionClasses(s.settings);
                return (
                  <li key={s.id} className="bg-slate-950 border border-cyan-950 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold">
                        {s.label ?? wodLabel(s.wodType)}
                        <span className="text-slate-500 font-normal"> · {engineName(s.wodType)}</span>
                        {s.refereeMode && <span className="ml-2 text-[10px] bg-amber-900/50 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded">Touché-Coulé</span>}
                      </div>
                      <div className="text-xs text-slate-400">
                        {classes.length ? classes.join(", ") : "toutes classes"} · ouverte {fmtDay(s.createdAt)} {fmtTime(s.createdAt)}
                        {s.closesAt && <> → ferme à {fmtTime(s.closesAt)}</>} · {s.autoOpened ? "auto (horaire)" : "manuelle"}
                        {s.raceEndedAt && " · WOD terminé"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/greffier?session=${s.id}`} className={btnPrimary}>Greffier</Link>
                      {s.refereeMode && (
                        <form action={runGenerateGhostFleets.bind(null, s.id)}>
                          <button type="submit" className={btnGhost} title="2 flottes verrouillées portées par Damien Renier">🏴‍☠️ Fantômes</button>
                        </form>
                      )}
                      <form action={closeSessionAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className={btnDanger}>Fermer</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ===== Ouverture manuelle ===== */}
        <section className={card}>
          <h2 className="text-lg font-bold mb-1">Ouvrir une séance maintenant</h2>
          <p className="text-xs text-slate-400 mb-4">Pour une ou plusieurs classes (max {MAX_CLASSES}). Le greffier peut encore ajuster les classes, les équipes et les arbitres avant le départ.</p>
          <form action={openSessionAction} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-cyan-300 mb-1">Séance-type du cycle</span>
              <select name="planId" defaultValue={plans.find((p) => p.isCurrent)?.id ?? ""} className={`${input} w-full`}>
                <option value="">— séance libre (type ci-contre) —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}{p.isCurrent ? " (semaine)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-cyan-300 mb-1">Type (si séance libre)</span>
              <select name="wodType" className={`${input} w-full`}>
                {engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-cyan-300 mb-1">Nom affiché (optionnel, sinon celui de la séance-type)</span>
              <input name="label" placeholder="ex. Pyramide" className={`${input} w-full`} />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm text-cyan-300 mb-1">Classes</legend>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                {allClasses.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-xs bg-slate-950 border border-cyan-950 rounded px-2 py-1.5 cursor-pointer">
                    <input type="checkbox" name="classes" value={c} className="accent-cyan-500" /> {c}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-sm">
              <span className="block text-cyan-300 mb-1">Nombre d'équipes</span>
              <input type="number" name="numTeams" defaultValue={plans.find((p) => p.isCurrent)?.numTeams ?? 24} min={1} max={50} className={`${input} w-full`} />
            </label>
            <label className="text-sm">
              <span className="block text-cyan-300 mb-1">Reste ouverte pendant</span>
              <select name="hours" defaultValue="3" className={`${input} w-full`}>
                {[1, 2, 3, 4, 6, 8].map((h) => <option key={h} value={h}>{h} h</option>)}
              </select>
            </label>
            <label className="flex items-center gap-3 text-sm text-cyan-200 sm:col-span-2">
              <input type="hidden" name="refereeModeSet" value="1" />
              <input type="checkbox" name="refereeMode" defaultChecked className="w-5 h-5 accent-cyan-500" />
              Activer le Touché-Coulé (arbitrage par les élèves)
            </label>
            <button type="submit" className={`${btnPrimary} sm:col-span-2 py-4 text-base shadow-[0_0_15px_rgba(8,145,178,0.5)]`}>OUVRIR LA SÉANCE</button>
          </form>
        </section>

        {/* ===== Cycle en cours ===== */}
        <section className={card}>
          <h2 className="text-lg font-bold mb-1">Séances du cycle en cours {current && <span className="text-cyan-300">· {current.name}</span>}</h2>
          {!current ? (
            <p className="text-sm text-slate-400">Crée un cycle ci-dessous et active-le.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-3">La « séance de la semaine » est celle qui s'ouvre automatiquement pour une classe pendant son créneau horaire.</p>
              {plans.length === 0 ? (
                <p className="text-sm text-slate-400 mb-3">Aucune séance-type pour l'instant.</p>
              ) : (
                <ul className="space-y-1.5 mb-4">
                  {plans.map((p) => (
                    <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 border ${p.isCurrent ? "bg-cyan-950/40 border-cyan-600" : "bg-slate-950 border-cyan-950"}`}>
                      <div className="text-sm">
                        <span className="font-bold">{p.order}. {p.label}</span>
                        <span className="text-slate-500"> · {engineName(p.wodType)} · {p.numTeams} équipes{p.refereeMode ? " · Touché-Coulé" : ""}</span>
                        {p.isCurrent && <span className="ml-2 text-[10px] bg-cyan-600 text-slate-950 font-black px-1.5 py-0.5 rounded">SEMAINE</span>}
                      </div>
                      <div className="flex gap-2">
                        {!p.isCurrent && (
                          <form action={setCurrentPlanAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className={btnGhost}>Séance de la semaine</button>
                          </form>
                        )}
                        <form action={deletePlanAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className={btnDanger}>✕</button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addPlanAction} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <input type="hidden" name="cycleId" value={current.id} />
                <label className="text-xs col-span-2">
                  <span className="block text-cyan-300 mb-1">Nom de la séance</span>
                  <input name="label" placeholder="ex. Pyramide, Fête Foraine…" required className={`${input} w-full`} />
                </label>
                <label className="text-xs">
                  <span className="block text-cyan-300 mb-1">Type</span>
                  <select name="wodType" className={`${input} w-full`}>
                    {engines.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block text-cyan-300 mb-1">Équipes</span>
                  <input type="number" name="numTeams" defaultValue={24} min={1} max={50} className={`${input} w-full`} />
                </label>
                <label className="text-xs flex items-center gap-2 pb-2.5">
                  <input type="checkbox" name="refereeMode" defaultChecked className="accent-cyan-500 w-4 h-4" /> Touché-Coulé
                </label>
                <button type="submit" className={`${btnPrimary} col-span-2 sm:col-span-5`}>+ Ajouter la séance au cycle</button>
              </form>
            </>
          )}
        </section>

        {/* ===== Horaires ===== */}
        <section className={card}>
          <h2 className="text-lg font-bold mb-1">Horaires des classes</h2>
          <p className="text-xs text-slate-400 mb-4">
            Pendant ces créneaux (lundi→vendredi, heure de Bruxelles), la séance de la semaine s'ouvre toute seule pour la classe et se ferme à la fin du créneau.
            Deux classes sur le même créneau partagent la même séance.
          </p>
          {slotsByClass.size === 0 ? (
            <p className="text-sm text-slate-400 mb-3">Aucun créneau encodé.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {[...slotsByClass.entries()].map(([cls, list]) => (
                <div key={cls} className="bg-slate-950 border border-cyan-950 rounded-lg p-2">
                  <div className="font-bold text-sm mb-1">{cls}</div>
                  <ul className="space-y-1">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs">
                        <span>{WEEKDAYS[s.weekday]} {fmtMin(s.startMin)}–{fmtMin(s.endMin)}</span>
                        <form action={deleteSlotAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <button type="submit" className="text-red-400 font-bold px-2">✕</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <form action={addSlotAction} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <label className="text-xs">
              <span className="block text-cyan-300 mb-1">Classe</span>
              <select name="className" className={`${input} w-full`}>
                {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-cyan-300 mb-1">Jour</span>
              <select name="weekday" className={`${input} w-full`}>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-cyan-300 mb-1">Début</span>
              <input type="time" name="start" defaultValue="08:00" required className={`${input} w-full`} />
            </label>
            <label className="text-xs">
              <span className="block text-cyan-300 mb-1">Fin</span>
              <input type="time" name="end" defaultValue="09:40" required className={`${input} w-full`} />
            </label>
            <button type="submit" className={btnPrimary}>+ Créneau</button>
          </form>
        </section>

        {/* ===== Cycles ===== */}
        <section className={card}>
          <h2 className="text-lg font-bold mb-3">Cycles</h2>
          {cycles.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">Aucun cycle. Exemple : « Hyrox », « Volley », « Spikeball »…</p>
          ) : (
            <ul className="space-y-1.5 mb-4">
              {cycles.map((c) => (
                <li key={c.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 border ${c.isCurrent ? "bg-cyan-950/40 border-cyan-600" : "bg-slate-950 border-cyan-950"}`}>
                  <form action={renameCycleAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="name" defaultValue={c.name} className={`${input} w-40`} />
                    <button type="submit" className={btnGhost}>Renommer</button>
                    {c.isCurrent && <span className="text-[10px] bg-cyan-600 text-slate-950 font-black px-1.5 py-0.5 rounded">EN COURS</span>}
                  </form>
                  <div className="flex gap-2">
                    {!c.isCurrent && (
                      <form action={setCurrentCycleAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className={btnPrimary}>Activer</button>
                      </form>
                    )}
                    <form action={deleteCycleAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className={btnDanger}>✕</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={createCycleAction} className="flex gap-2">
            <input name="name" placeholder="Nouveau cycle (ex. Hyrox)" required className={`${input} flex-1`} />
            <button type="submit" className={btnPrimary}>+ Créer</button>
          </form>
        </section>
      </div>
    </div>
  );
}
