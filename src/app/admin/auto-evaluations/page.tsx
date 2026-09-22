import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { SELF_EVAL_CRITERIA } from "@/lib/wod-engines/core/self-eval";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { querySelfEvaluations, readLevelParams, PAGE_SIZE, type SelfEvalSort } from "@/lib/self-eval-query";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Consultation des auto-evaluations (DAMZER + coachs) : chronologique par defaut, filtrable et paginee.
export default async function AutoEvaluationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const sp = await searchParams;

  const sessionId = one(sp.session);
  const className = one(sp.classe);
  const query = one(sp.q);
  const sort = (one(sp.tri) || "recent") as SelfEvalSort;
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);
  const levels = readLevelParams(sp);

  const [sessions, allClasses] = await Promise.all([
    db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all(),
    db.orm.public.User.where({ role: "STUDENT" }).all().then((us) => [...new Set(us.map((u) => u.className).filter((c): c is string => !!c))].sort()),
  ]);

  const res = await querySelfEvaluations({ sessionId: sessionId || undefined, className: className || undefined, query, levels, sort, page });
  const colorOf = (code: string | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";

  // Conserve les filtres courants en changeant un seul parametre (pagination, tri).
  const linkWith = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = { session: sessionId, classe: className, q: query, tri: sort, page: String(page) };
    for (const c of SELF_EVAL_CRITERIA) if (levels[c.id]) base[`c_${c.id}`] = levels[c.id]!;
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    return `/admin/auto-evaluations?${p.toString()}`;
  };
  const activeFilters = [className && `classe ${className}`, query && `« ${query} »`, ...SELF_EVAL_CRITERIA.filter((c) => levels[c.id]).map((c) => `${c.label} = ${levels[c.id]}`)].filter(Boolean) as string[];

  return (
    <div className={ui.page}>
      <TopBar
        title="Auto-évaluations"
        back={user.role === "MASTER_ADMIN" ? { href: "/admin", label: "Console" } : undefined}
        right={
          <nav className="flex flex-wrap items-center gap-2">
            <Link href="/admin/resultats" className={btn.smGhost}>Résultats</Link>
            <Link href="/admin/carte" className={btn.smGhost}>Carte 🏴‍☠️</Link>
          </nav>
        }
      />

      <main className={`${ui.container} py-6 space-y-4`}>
        {/* ===== Filtres (une seule soumission, tout en parametres d'URL) ===== */}
        <form className={`${ui.cardPad} space-y-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs">
              <span className={ui.label}>Séance</span>
              <select name="session" defaultValue={sessionId} className={`${ui.input} w-full`}>
                <option value="">Toutes les séances</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label ?? wodLabel(s.wodType)} · {fmtDate(s.createdAt)}
                  </option>
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
              <input name="q" defaultValue={query} placeholder="ex. max" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${ui.input} w-full`} />
            </label>
            <label className="text-xs">
              <span className={ui.label}>Trier par</span>
              <select name="tri" defaultValue={sort} className={`${ui.input} w-full`}>
                <option value="recent">Plus récentes d&apos;abord</option>
                <option value="ancien">Plus anciennes d&apos;abord</option>
                <option value="nom">Nom (A → Z)</option>
                <option value="prenom">Prénom (A → Z)</option>
                <option value="classe">Classe</option>
              </select>
            </label>
          </div>

          <div>
            <span className={ui.label}>Niveau atteint, critère par critère</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-1">
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
            <Link href="/admin/auto-evaluations" className={btn.ghost}>Réinitialiser</Link>
            {activeFilters.length > 0 && <span className={ui.hint}>Filtres actifs : {activeFilters.join(" · ")}</span>}
          </div>
        </form>

        {/* ===== Resultats ===== */}
        <p className={ui.muted}>
          <b className="text-ink">{res.total}</b> auto-évaluation{res.total > 1 ? "s" : ""}
          {res.total !== res.totalAll && <> sur {res.totalAll} au total</>}
          {res.participants !== null && <> · <b className="text-ink">{res.participants}</b> participant(s) encodé(s) sur cette séance</>}
          {res.pages > 1 && <> · page {res.page}/{res.pages}</>}
        </p>

        <div className={`${ui.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={ui.th}>Envoyé</th>
                <th className={ui.th}>Élève</th>
                <th className={ui.th}>Classe</th>
                <th className={ui.th}>Séance</th>
                <th className={ui.th}>Équipe</th>
                {SELF_EVAL_CRITERIA.map((c) => (
                  <th key={c.id} className={`${ui.th} text-center`} title={c.label}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {res.rows.length === 0 && (
                <tr><td colSpan={5 + SELF_EVAL_CRITERIA.length} className="p-4 text-ink-3 italic">Aucune auto-évaluation pour ces filtres.</td></tr>
              )}
              {res.rows.map((r) => (
                <tr key={r.key} className={ui.tr}>
                  <td className="p-2 text-xs text-ink-3 whitespace-nowrap">{new Date(r.submittedAt).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="p-2 font-bold whitespace-nowrap">{r.lastName} {r.firstName}</td>
                  <td className="p-2 text-ink-2">{r.className}</td>
                  <td className="p-2 text-ink-2 whitespace-nowrap">{r.sessionLabel}</td>
                  <td className="p-2 text-ink-2">{r.teamName}</td>
                  {SELF_EVAL_CRITERIA.map((c) => (
                    <td key={c.id} className={cx("p-2 text-center font-black", colorOf(r.answers[c.id]))}>{r.answers[c.id] ?? "—"}</td>
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
          {QUALITY_LEVELS.map((l) => (
            <span key={l.code}><b className={l.color}>{l.code}</b> = {l.label}</span>
          ))}
        </div>
      </main>
    </div>
  );
}
