import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Annuaire des eleves (DAMZER + coachs) : par classe, ou par recherche de nom. Ouvre la fiche.
export default async function ElevesPage({ searchParams }: { searchParams: Promise<{ classe?: string; q?: string; msg?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { classe = "", q = "", msg } = await searchParams;

  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  const classes = [...new Set(students.map((s) => s.className).filter((c): c is string => !!c))].sort();
  const needle = q.trim().toLowerCase();
  const list = students
    .filter((s) => (!classe || s.className === classe) && (!needle || `${s.firstName ?? ""} ${s.lastName ?? ""}`.toLowerCase().includes(needle) || `${s.lastName ?? ""} ${s.firstName ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? ""));
  const shown = classe || needle ? list : [];

  return (
    <div className={ui.page}>
      <TopBar title="Élèves" subtitle={`${students.length} élèves · ${classes.length} classes`} back={user.role === "MASTER_ADMIN" ? { href: "/admin", label: "Console" } : undefined} />
      <main className={`${ui.container} py-6 space-y-4`}>
        {msg && <p className={ui.alertErr}>⚠️ {msg}</p>}
        <form className={`${ui.cardPad} grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end`}>
          <label className="text-xs">
            <span className={ui.label}>Classe</span>
            <select name="classe" defaultValue={classe} className={ui.input}>
              <option value="">Toutes</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className={ui.label}>Nom ou prénom</span>
            <input name="q" defaultValue={q} placeholder="ex. max" autoCapitalize="off" className={ui.input} />
          </label>
          <button type="submit" className={btn.primary}>Chercher</button>
        </form>

        {!classe && !needle ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Choisis une classe ou tape un nom pour afficher des élèves.</p>
        ) : (
          <div className={`${ui.card} overflow-x-auto`}>
            <p className={`${ui.hint} px-3 py-2 border-b border-line`}>{shown.length} élève{shown.length > 1 ? "s" : ""}</p>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={ui.th}>Nom</th><th className={ui.th}>Classe</th><th className={ui.th}>Sexe</th><th className={ui.th}>Naissance</th><th className={ui.th}>PIN</th><th className={ui.th}>Fiabilité</th><th className={ui.th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className={ui.tr}>
                    <td className="p-2 font-bold whitespace-nowrap">{s.lastName} {s.firstName}</td>
                    <td className="p-2 text-ink-2">{s.className ?? "—"}</td>
                    <td className="p-2 text-ink-2">{s.sex ?? "—"}</td>
                    <td className="p-2 text-ink-2 whitespace-nowrap">{s.dateOfBirth ? String(s.dateOfBirth).slice(0, 10).split("-").reverse().join("/") : "—"}</td>
                    <td className="p-2"><span className={cx(ui.chip, s.pinCode ? ui.chipOk : ui.chipMuted)}>{s.pinCode ? "créé" : "aucun"}</span></td>
                    <td className="p-2 tabular-nums text-ink-2">{s.reliability}</td>
                    <td className="p-2 text-right"><Link href={`/admin/eleves/${s.id}`} className={btn.smGhost}>Fiche</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
