import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { buildConsultation, consultationCsv, readConsultationLevels, PAGE_SIZE, type ConsultationRole, type ConsultationSort } from "@/lib/consultation";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { ExportCsvButton } from "./ExportCsvButton";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Consultation des resultats (DAMZER + coachs). Meme grammaire que /admin/auto-evaluations :
// chronologique par defaut, filtres en parametres d'URL, 30 lignes par page.
// L'export CSV porte sur TOUT le resultat filtre, pas seulement sur la page affichee.
export default async function ResultatsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const sp = await searchParams;

  const cycleId = one(sp.cycle);
  const sessionId = one(sp.session);
  const className = one(sp.classe);
  const query = one(sp.eleve);
  const from = one(sp.from);
  const to = one(sp.to);
  const role = one(sp.role) as ConsultationRole | "";
  const sort = (one(sp.tri) || "recent") as ConsultationSort;
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);
  const levels = readConsultationLevels(sp);

  const [cycles, sessions, allClasses] = await Promise.all([
    db.orm.public.Cycle.where({}).orderBy((c) => c.order.asc()).all(),
    db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all(),
    db.orm.public.User.where({ role: "STUDENT" }).all().then((us) => [...new Set(us.map((u) => u.className).filter((c): c is string => !!c))].sort()),
  ]);

  const res = await buildConsultation({
    cycleId: cycleId || undefined,
    sessionId: sessionId || undefined,
    className: className || undefined,
    query: query || undefined,
    from: from || undefined,
    to: to || undefined,
    role: role || undefined,
    levels,
    sort,
    page,
  });
  const csv = consultationCsv(res.all);
  const colorOf = (code: string | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";

  // Conserve les filtres courants en changeant un seul parametre (pagination, tri).
  const linkWith = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = { cycle: cycleId, session: sessionId, classe: className, eleve: query, from, to, role, tri: sort, page: String(page) };
    for (const c of SELF_EVAL_CRITERIA) if (levels[c.id]) base[`c_${c.id}`] = levels[c.id]!;
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    return `/admin/resultats?${p.toString()}`;
  };
  const activeFilters = [
    className && `classe ${className}`,
    query && `« ${query} »`,
    role && (role === "arbitre" ? "arbitres seulement" : "participants seulement"),
    from && `depuis le ${from}`,
    to && `jusqu'au ${to}`,
    ...SELF_EVAL_CRITERIA.filter((c) => levels[c.id]).map((c) => `${c.label} = ${levels[c.id]}`),
  ].filter(Boolean) as string[];

  return (
    <div className={ui.page}>
      <TopBar
        title="Résultats"
        wide
        back={user.role === "MASTER_ADMIN" ? { href: "/admin", label: "Console" } : undefined}
        right={
          <nav className="flex flex-wrap items-center gap-2">
            {/* Sans ces liens, un coach qui arrive ici n'a aucun moyen d'aller ailleurs. */}
            <Link href="/admin/auto-evaluations" className={btn.smGhost}>Auto-évaluations</Link>
            <Link href="/admin/carte" className={btn.smGhost}>Carte 🏴‍☠️</Link>
            <ExportCsvButton csv={csv} filename={`reps-resultats-${new Date().toISOString().slice(0, 10)}.csv`} />
          </nav>
        }
      />

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* ===== Filtres (une seule soumission, tout en parametres d'URL) ===== */}
        <form className={`${ui.cardPad} space-y-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs">
              <span className={ui.label}>Cycle</span>
              <select name="cycle" defaultValue={cycleId} className={`${ui.input} w-full`}>
                <option value="">Tous</option>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className={ui.label}>Séance</span>
              <select name="session" defaultValue={sessionId} className={`${ui.input} w-full`}>
                <option value="">Toutes (15 dernières)</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className={ui.label}>Classe</span>
              <select name="classe" defaultValue={className} className={`${ui.input} w-full`}>
                <option value="">Toutes</option>
                {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className={ui.label}>Recherche (prénom ou nom)</span>
              <input name="eleve" defaultValue={query} placeholder="ex. max" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${ui.input} w-full`} />
            </label>
            <label className="text-xs">
              <span className={ui.label}>Rôle</span>
              <select name="role" defaultValue={role} className={`${ui.input} w-full`}>
                <option value="">Tous</option>
                <option value="participant">Participants 💪</option>
                <option value="arbitre">Arbitres 🏴‍☠️</option>
              </select>
            </label>
            <label className="text-xs">
              <span className={ui.label}>Du</span>
              <input type="date" name="from" defaultValue={from} className={`${ui.input} w-full`} />
            </label>
            <label className="text-xs">
              <span className={ui.label}>Au</span>
              <input type="date" name="to" defaultValue={to} className={`${ui.input} w-full`} />
            </label>
            <label className="text-xs">
              <span className={ui.label}>Trier par</span>
              <select name="tri" defaultValue={sort} className={`${ui.input} w-full`}>
                <option value="recent">Plus récentes d&apos;abord</option>
                <option value="ancien">Plus anciennes d&apos;abord</option>
                <option value="nom">Nom (A → Z)</option>
                <option value="prenom">Prénom (A → Z)</option>
                <option value="classe">Classe</option>
                <option value="rang">Rang dans le WOD</option>
              </select>
            </label>
          </div>

          <div>
            <span className={ui.label}>Niveau atteint en auto-évaluation, critère par critère</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 mt-1">
              {SELF_EVAL_CRITERIA.map((c) => (
                <label key={c.id} className="text-xs">
                  <span className="block text-ink-2 truncate mb-0.5" title={c.label}>{c.label}</span>
                  <select name={`c_${c.id}`} defaultValue={levels[c.id] ?? ""} className={`${ui.input} w-full`}>
                    <option value="">— indifférent —</option>
                    {QUALITY_LEVELS.map((l) => <option key={l.code} value={l.code}>{l.code} · {l.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={btn.primary}>Filtrer</button>
            <Link href="/admin/resultats" className={btn.ghost}>Réinitialiser</Link>
            {activeFilters.length > 0 && <span className={ui.hint}>Filtres actifs : {activeFilters.join(" · ")}</span>}
          </div>
        </form>

        {/* ===== Resultats ===== */}
        <p className={ui.muted}>
          <b className="text-ink">{res.total}</b> ligne{res.total > 1 ? "s" : ""}
          {res.total !== res.totalAll && <> sur {res.totalAll}</>}
          {" "}· {res.sessionsScanned} séance{res.sessionsScanned > 1 ? "s" : ""} parcourue{res.sessionsScanned > 1 ? "s" : ""}
          {res.pages > 1 && <> · page {res.page}/{res.pages}</>}
          . Une ligne = un élève × une séance. L&apos;export CSV reprend les {res.total} ligne{res.total > 1 ? "s" : ""}, pas seulement la page affichée.
        </p>

        <div className={`${ui.card} overflow-x-auto`}>
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr>
                <th className={ui.th}>Date</th><th className={ui.th}>Séance</th><th className={ui.th}>Classe</th><th className={ui.th}>Élève</th><th className={ui.th}>Rôle</th>
                <th className={ui.th}>Équipe</th><th className={ui.th}>Rang</th><th className={ui.th}>Tours</th><th className={ui.th}>Temps</th><th className={ui.th}>Reps</th><th className={ui.th}>🟨</th>
                <th className={ui.th}>Arbitrages</th><th className={ui.th}>💥</th>
                {SELF_EVAL_CRITERIA.map((c) => <th key={c.id} className={`${ui.th} text-center`} title={c.label}>AE{SELF_EVAL_CRITERIA.indexOf(c) + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {res.rows.length === 0 && <tr><td colSpan={13 + SELF_EVAL_CRITERIA.length} className="p-4 text-ink-3 italic">Aucune donnée pour ces filtres.</td></tr>}
              {res.rows.map((r) => (
                <tr key={`${r.sessionId}_${r.studentId}`} className={`${ui.tr} hover:bg-brand-soft/60`}>
                  <td className="p-2 text-ink-2">{new Date(r.sessionDate).toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels" })}</td>
                  <td className="p-2">{r.sessionLabel}{r.cycleName ? <span className="text-ink-3"> · {r.cycleName}</span> : null}</td>
                  <td className="p-2 text-ink-2">{r.className}</td>
                  <td className="p-2 font-bold">{r.lastName} {r.firstName}</td>
                  <td className="p-2">
                    {r.role === "participant" ? "💪" : r.role === "arbitre" ? "🏴‍☠️" : "💪🏴‍☠️"}
                    {r.refereeNote && <span className="text-ink-2"> {r.refereeNote}</span>}
                  </td>
                  <td className="p-2">{r.teamName ?? "—"}</td>
                  <td className="p-2 font-black">{r.rank ?? ""}</td>
                  <td className="p-2">{r.laps !== null ? `${r.laps}/${r.lapsTotal}` : ""}</td>
                  <td className="p-2">{r.time ?? ""}</td>
                  <td className="p-2">{r.reps ?? ""}</td>
                  <td className="p-2">{r.cards || ""}</td>
                  <td className="p-2">
                    {r.evalCount ? (
                      <>
                        <span className="text-ink-2">{r.evalCount}× · {r.evalMedianReps} reps · </span>
                        {r.evalQualities.split(",").filter(Boolean).map((c, i) => <span key={i} className={`font-black ${colorOf(c)}`}>{c} </span>)}
                      </>
                    ) : ""}
                  </td>
                  <td className="p-2">{r.pirateScore ?? ""}</td>
                  {SELF_EVAL_CRITERIA.map((c) => (
                    <td key={c.id} className={`p-2 text-center font-black ${colorOf(r.selfEval?.[c.id])}`}>{r.selfEval?.[c.id] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ===== Pagination : 30 par page ===== */}
        {res.pages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href={linkWith({ page: String(Math.max(1, res.page - 1)) })} className={cx(btn.smGhost, res.page === 1 && "pointer-events-none opacity-40")}>← Précédente</Link>
            {Array.from({ length: res.pages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === res.pages || Math.abs(n - res.page) <= 2)
              .map((n, i, arr) => (
                <span key={n} className="flex items-center gap-2">
                  {i > 0 && arr[i - 1] !== n - 1 && <span className="text-ink-3">…</span>}
                  <Link href={linkWith({ page: String(n) })} className={n === res.page ? btn.smPrimary : btn.smGhost}>{n}</Link>
                </span>
              ))}
            <Link href={linkWith({ page: String(Math.min(res.pages, res.page + 1)) })} className={cx(btn.smGhost, res.page === res.pages && "pointer-events-none opacity-40")}>Suivante →</Link>
            <span className={ui.hint}>{PAGE_SIZE} par page</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
          {SELF_EVAL_CRITERIA.map((c, i) => <span key={c.id}><b>AE{i + 1}</b> = {c.label}</span>)}
          <span>·</span>
          {QUALITY_LEVELS.map((l) => <span key={l.code}><b className={l.color}>{l.code}</b> {l.label}</span>)}
        </div>
      </main>
    </div>
  );
}
