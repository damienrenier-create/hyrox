import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { TopBar } from "../../_components/TopBar";
import { ImpersonateForm } from "./ImpersonateForm";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// « Se connecter en tant que » (Sartay 29/09 nuit) : l'admin choisit une classe puis un eleve, retape SON mot de
// passe, et voit l'espace de l'eleve exactement comme lui (lecture seule, bandeau de retour).
export default async function VoirElevePage({ searchParams }: { searchParams: Promise<{ classe?: string; eleve?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const sp = await searchParams;
  const students = await db.orm.public.User.where({ role: "STUDENT" }).all();
  const pre = sp.eleve ? students.find((s) => s.id === sp.eleve) ?? null : null;
  const classe = sp.classe || pre?.className || "";
  const classes = [...new Set(students.map((s) => s.className).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const inClass = students
    .filter((s) => s.className === classe)
    .map((s) => ({ id: s.id, name: `${s.lastName ?? ""} ${s.firstName ?? ""}`.trim() || s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return (
    <div className={ui.page}>
      <TopBar title="👁 Se connecter en tant que…" subtitle="Voir l'espace d'un élève exactement comme lui, en lecture seule" back={{ href: "/admin", label: "Console" }} />
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <section className={`${ui.cardPad} space-y-2`}>
          <h2 className={ui.eyebrow}>1 · Classe</h2>
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => (
              <Link key={c} href={`/admin/voir-eleve?classe=${encodeURIComponent(c)}`} className={cx(ui.pill, c === classe ? ui.pillOn : ui.pillOff)}>{c}</Link>
            ))}
          </div>
        </section>
        {classe && (
          <section className={`${ui.cardPad} space-y-3`}>
            <h2 className={ui.eyebrow}>2 · Élève de {classe} et ton mot de passe</h2>
            <ImpersonateForm students={inClass} preselected={pre?.id ?? null} />
            <p className={ui.hint}>Tu arrives sur son espace (ses WOD, ses auto-évaluations, ses records). Rien ne peut être envoyé à sa place ; le bandeau noir en haut te ramène à ton compte.</p>
          </section>
        )}
      </main>
    </div>
  );
}
