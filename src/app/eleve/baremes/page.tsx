import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { loadSelfEvalHistory } from "@/lib/student-self-evals";
import { EVAL_GROUPS, evalYears } from "@/lib/eval-bareme";
import { HX_DEFAULTS, HX_LEVELS, starsText } from "@/lib/wod-engines/templates/hyrox-engine";
import { TopBar } from "../../_components/TopBar";
import { LogoutButton } from "../../_components/LogoutButton";
import { EvalBaremeTable } from "../../_components/EvalBareme";
import { EleveTabs } from "../EleveTabs";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Onglet « Baremes » (Sartay 05/10 : « ajouter un onglet dans l'app pour expliquer les baremes ») : les niveaux du WOD
// Eval et la note d'intensite qui va avec, pour les annees de l'eleve (5e – 6e, ou 3e – 4e). Les chiffres viennent du
// parcours par defaut (hyrox-engine.ts) et du bareme (eval-bareme.ts) : cette page change avec eux.
export default async function BaremesPage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");
  const { todo } = await loadSelfEvalHistory(user.id);
  const years = evalYears([user.className]);
  const groups = EVAL_GROUPS.filter((g) => g.key.startsWith(years));
  const { capMin, extraMin, laps } = HX_DEFAULTS;
  const top = (team: string) => groups.find((g) => g.team === team)?.top;

  return (
    <div className={ui.page}>
      <TopBar title={user.name} subtitle={user.className ?? ""} right={<LogoutButton />} />
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <EleveTabs active="bareme" todo={todo.length} bareme />

        <section className={`${ui.cardPad} space-y-2`}>
          <h2 className={ui.h2}>⭐ WOD Eval : ton équipe choisit son niveau</h2>
          <p className={ui.muted}>Avant le départ, ton équipe annonce son niveau au greffier. Le niveau fixe le nombre de <b>répétitions à chaque station</b> ; les allers-retours (burpees, fentes, farmer carry) sont les mêmes pour tout le monde.</p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {HX_LEVELS.map((l) => (
              <li key={l.stars} className={`${ui.inset} px-3 py-2`}>
                <span className="block text-accent-ink font-bold leading-tight">{starsText(l.stars)}</span>
                <span className="font-display font-extrabold text-lg text-ink">{l.reps}</span> <span className="text-xs text-ink-2">répétitions</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className={ui.h2}>🎯 La note d&apos;intensité · {groups[0]?.years}</h2>
          <p className={ui.muted}>Si ton équipe <b>boucle le WOD</b> ({laps} tours complets) avant la fin officielle (<b>{capMin}:00</b>), elle obtient la note de son niveau :</p>
          <EvalBaremeTable groups={groups.map((g) => g.key)} />
          <ul className="space-y-1.5 text-sm text-ink-2 list-disc pl-5">
            <li>Un niveau de plus = 5 répétitions de plus à chaque station = <b>1 point de plus</b>.</li>
            <li><b>Garçons ou mixte</b> : 20/20 à {top("garçons ou mixte")} répétitions. <b>Filles</b> (une équipe de filles uniquement) : 20/20 à {top("filles")} répétitions.</li>
            <li>WOD pas bouclé à {capMin}:00 : la note part de ce maximum et baisse selon ce qu&apos;il restait à faire. Mieux vaut un niveau que ton équipe peut finir.</li>
            {extraMin > 0 && <li>De {capMin}:00 à {capMin + extraMin}:00, le chrono continue s&apos;il reste du temps : tu peux finir ton parcours, mais c&apos;est hors classement.</li>}
          </ul>
        </section>

        <section className={`${ui.cardPad} space-y-1.5`}>
          <h2 className={ui.h3}>👁 Et la technique ?</h2>
          <p className={ui.muted}>Elle est notée à part : des arbitres (élèves dispensés et profs) te suivent pendant le WOD, comptent tes répétitions et cochent les critères de chaque exercice. Triche ou répétitions bâclées : carte jaune, soit 1 minute de plus au temps de toute l&apos;équipe.</p>
        </section>
      </main>
    </div>
  );
}
