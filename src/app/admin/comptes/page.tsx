import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { ORIGIN_SCHOOL, schoolById } from "@/lib/school";
import { PASSWORD_MIN } from "@/lib/passwords";
import { displayName } from "@/lib/staff-names";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";
import { changeMyPasswordAction, createAccountAction, setAccountPasswordAction } from "./actions";

export const dynamic = "force-dynamic";

// Comptes & mots de passe d'une AUTRE ecole (Sartay 18/11 : « faut lui mettre ça en place, je ne peux pas m'occuper de
// ça en permanence »). Responsable de l'ecole : comptes des collegues et du greffier, nouveaux mots de passe. Tout prof
// de l'ecole : son propre mot de passe. Aucun compte n'est jamais supprime.
const ROLE_LABEL: Record<string, string> = { MASTER_ADMIN: "Responsable de l'école", ADMIN: "Collègue prof", GREFFIER: "Greffier" };
const day = (v: unknown) => String(v ?? "").slice(0, 10).split("-").reverse().join("/");

function PasswordFields({ autoFocus }: { autoFocus?: boolean }) {
  return (
    <>
      <label className="text-xs"><span className={ui.label}>Nouveau mot de passe</span><input type="password" name="password" required minLength={PASSWORD_MIN} autoComplete="new-password" autoFocus={autoFocus} className={ui.input} /></label>
      <label className="text-xs"><span className={ui.label}>Le retaper</span><input type="password" name="confirm" required minLength={PASSWORD_MIN} autoComplete="new-password" className={ui.input} /></label>
    </>
  );
}

export default async function ComptesPage({ searchParams }: { searchParams: Promise<{ ok?: string; msg?: string }> }) {
  const me = await getSession();
  if (!me || me.impersonatedBy || !["MASTER_ADMIN", "ADMIN"].includes(me.role)) redirect("/");
  const { ok, msg } = await searchParams;
  const school = schoolById(me.school ?? null);
  const origin = (me.school ?? null) === ORIGIN_SCHOOL;
  const boss = me.role === "MASTER_ADMIN";
  const staff = origin
    ? []
    : (await db.orm.public.User.where((u) => u.role.in(["MASTER_ADMIN", "ADMIN", "GREFFIER"])).all())
        .filter((u) => u.name !== "DAMZER") // la visite de D. Renier dans l'ecole : pas un compte de l'ecole
        .sort((a, b) => (a.role === "MASTER_ADMIN" ? 0 : a.role === "ADMIN" ? 1 : 2) - (b.role === "MASTER_ADMIN" ? 0 : b.role === "ADMIN" ? 1 : 2) || a.name.localeCompare(b.name));
  const mine = staff.find((u) => u.id === me.id);

  return (
    <div className={ui.page}>
      <TopBar title="Comptes & mots de passe" subtitle={school && !origin ? `🏫 ${school.label}` : undefined} back={{ href: "/admin", label: "Console" }} />
      <main className={`${ui.container} py-6 space-y-5`}>
        {ok && <p className={ui.alertOk}>✅ {ok}</p>}
        {msg && <p className={ui.alertErr}>⚠️ {msg}</p>}

        {origin ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Dans l&apos;école d&apos;origine, les comptes (DAMZER, coachs, greffier) et leurs mots de passe sont fixés dans le code : ils ne se gèrent pas ici.</p>
        ) : (
          <>
            {mine?.password && (
              <section className={ui.cardPad}>
                <h2 className={`${ui.h2} mb-1`}>🔑 Mon mot de passe</h2>
                <p className={`${ui.muted} mb-3`}>Votre pseudo reste <b className="text-ink">{mine.name}</b>. Au moins {PASSWORD_MIN} caractères ; majuscules et minuscules comptent.</p>
                <form action={changeMyPasswordAction} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
                  <label className="text-xs"><span className={ui.label}>Mot de passe actuel</span><input type="password" name="current" required autoComplete="current-password" className={ui.input} /></label>
                  <PasswordFields />
                  <button type="submit" className={btn.primary}>Changer</button>
                </form>
              </section>
            )}

            {boss && (
              <>
                <section className={ui.cardPad}>
                  <h2 className={`${ui.h2} mb-1`}>👥 Comptes de l&apos;école</h2>
                  <p className={`${ui.muted} mb-3`}>Un compte n&apos;est jamais supprimé. Un collègue a oublié son mot de passe, ou ne doit plus entrer : donnez-lui un nouveau mot de passe (l&apos;ancien cesse aussitôt de fonctionner).</p>
                  <div className={`${ui.inset} overflow-x-auto`}>
                    <table className="w-full text-sm">
                      <thead><tr><th className={ui.th}>Pseudo</th><th className={ui.th}>Nom vu par les élèves</th><th className={ui.th}>Rôle</th><th className={ui.th}>Créé le</th><th className={ui.th}></th></tr></thead>
                      <tbody>
                        {staff.map((u) => (
                          <tr key={u.id} className={cx(ui.tr, "align-top")}>
                            <td className="p-2 font-bold">{u.name}</td>
                            <td className="p-2 text-ink-2">{displayName(u)}</td>
                            <td className="p-2 text-ink-2">{ROLE_LABEL[u.role] ?? u.role}</td>
                            <td className="p-2 text-ink-2 whitespace-nowrap">{day(u.createdAt)}</td>
                            <td className="p-2 text-right">
                              {u.id === me.id ? (
                                <span className={ui.hint}>c&apos;est vous</span>
                              ) : (
                                <details className="text-left">
                                  <summary className={cx(btn.smGhost, "cursor-pointer list-none")}>🔑 Nouveau mot de passe</summary>
                                  <form action={setAccountPasswordAction} className="mt-2 grid gap-2 min-w-[14rem]">
                                    <input type="hidden" name="id" value={u.id} />
                                    <PasswordFields />
                                    <button type="submit" className={btn.smPrimary}>Enregistrer</button>
                                  </form>
                                </details>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className={ui.cardPad}>
                  <h2 className={`${ui.h2} mb-1`}>➕ Nouveau compte</h2>
                  <ul className={`${ui.muted} mb-3 list-disc pl-5 space-y-1`}>
                    <li><b className="text-ink">Collègue prof</b> : il voit et pilote toute la console (séances, journal, résultats, élèves), sans pouvoir supprimer de séance.</li>
                    <li><b className="text-ink">Greffier</b> : le compte de l&apos;écran du greffier (la tablette ou l&apos;ordinateur de la salle), qui arrive directement sur la page Greffier.</li>
                  </ul>
                  <form action={createAccountAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <label className="text-xs">
                      <span className={ui.label}>Type de compte</span>
                      <select name="role" defaultValue="ADMIN" className={ui.input}><option value="ADMIN">Collègue prof</option><option value="GREFFIER">Greffier</option></select>
                    </label>
                    <label className="text-xs"><span className={ui.label}>Prénom</span><input name="firstName" autoCapitalize="words" className={ui.input} /></label>
                    <label className="text-xs"><span className={ui.label}>Nom</span><input name="lastName" autoCapitalize="words" className={ui.input} /></label>
                    <label className="text-xs"><span className={ui.label}>Pseudo de connexion</span><input name="pseudo" required minLength={3} maxLength={16} pattern="[A-Za-z0-9]{3,16}" placeholder="ex. MARZER" autoCapitalize="characters" autoComplete="off" className={cx(ui.input, "uppercase")} /></label>
                    <PasswordFields />
                    <button type="submit" className={`${btn.primary} sm:col-span-3 justify-self-start`}>Créer le compte</button>
                  </form>
                  <p className={`${ui.hint} mt-2`}>Pseudo : 3 à 16 lettres ou chiffres, unique dans toute l&apos;app. Les élèves ne voient jamais le pseudo, seulement « initiale. Nom » (ex. « M. Dupont »). Le prénom et le nom sont facultatifs pour un greffier.</p>
                </section>
              </>
            )}

            <p className={`${ui.hint} px-1`}>Les élèves n&apos;ont pas de mot de passe : un élève qui a oublié son code PIN, remettez-le à zéro dans sa fiche (Élèves › Fiche) ; il en recrée un avec sa date de naissance.</p>
          </>
        )}
      </main>
    </div>
  );
}
