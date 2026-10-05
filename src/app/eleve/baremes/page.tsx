import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { loadSelfEvalHistory } from "@/lib/student-self-evals";
import { EVAL_DEFAULT_STARS, EVAL_GROUPS, EVAL_LEVELS, EVAL_WEIGHTS, evalLevelReps, evalYears } from "@/lib/eval-bareme";
import { HX_DEFAULTS } from "@/lib/wod-engines/templates/hyrox-engine";
import { TopBar } from "../../_components/TopBar";
import { LogoutButton } from "../../_components/LogoutButton";
import { EvalBaremeTable } from "../../_components/EvalBareme";
import { EleveTabs } from "../EleveTabs";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Onglet « Baremes » (Sartay 05/10 : « ajouter un onglet dans l'app pour expliquer les baremes », puis « parler de la
// repartition des points ») : la note du cycle, le parcours de l'equipe et les points de la perf pour les annees de
// l'eleve (5e – 6e, ou 3e – 4e), et S.O.R.O. Les chiffres viennent du bareme (eval-bareme.ts) et du parcours par defaut
// (hyrox-engine.ts) : cette page change avec eux.
export default async function BaremesPage() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");
  const { todo } = await loadSelfEvalHistory(user.id);
  const years = evalYears([user.className]);
  const groups = EVAL_GROUPS.filter((g) => g.key.startsWith(years));
  const { capMin, extraMin, laps } = HX_DEFAULTS;
  const W = EVAL_WEIGHTS;
  const first = EVAL_LEVELS[0];
  const last = EVAL_LEVELS[EVAL_LEVELS.length - 1];

  return (
    <div className={ui.page}>
      <TopBar title={user.name} subtitle={user.className ?? ""} right={<LogoutButton />} />
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <EleveTabs active="bareme" todo={todo.length} bareme />

        <section className={`${ui.cardPad} space-y-2`}>
          <h2 className={ui.h2}>📊 Ta note du cycle</h2>
          <ul className="space-y-1.5 text-sm text-ink-2">
            <li><b className="text-ink">{W.previous} %</b> : les cours précédents, avec les mêmes critères que ton auto-évaluation.</li>
            <li>
              <b className="text-ink">{W.today} %</b> : l&apos;éval du jour, qui se partage en
              <ul className="mt-1 space-y-1 list-disc pl-5">
                <li><b className="text-ink">{W.perf} %</b> la perf : ton parcours ⭐ et ton temps ;</li>
                <li><b className="text-ink">{W.personal} %</b> ta technique, vue par les arbitres ;</li>
                <li><b className="text-ink">{W.team} %</b> la technique de ton équipe ;</li>
                <li><b className="text-ink">{W.involvement} %</b> l&apos;implication de l&apos;équipe : transitions, suivi des coéquipiers, engagement dans et entre les stations.</li>
              </ul>
            </li>
          </ul>
          <p className={ui.muted}>🤝 <b>C&apos;est un sport d&apos;équipe.</b> Un coéquipier qui bâcle ses répétitions fait gagner du temps : c&apos;est de la triche. Tu dois être capable de voir qu&apos;un partenaire de TON équipe ne respecte pas les règles, et de le lui dire.</p>
        </section>

        <section className={`${ui.cardPad} space-y-2`}>
          <h2 className={ui.h2}>⭐ Le parcours de ton équipe</h2>
          <p className={ui.muted}>Tout le monde part au parcours <b>{EVAL_DEFAULT_STARS}★</b> : {evalLevelReps(EVAL_DEFAULT_STARS)} répétitions à chaque station. À la création des équipes, ton équipe peut demander de <b>monter ou de descendre</b>, de {first.stars}★ = {first.reps} à {last.stars}★ = {last.reps}. <b>Une fois partie, le parcours ne change plus.</b></p>
          <p className={ui.muted}>Le parcours est le même pour tout le monde, mais pas les points : ils dépendent de tes années et de ton équipe (filles, ou garçons / mixte). Les allers-retours (burpees, fentes, farmer carry) sont les mêmes pour tous.</p>
        </section>

        <section className="space-y-2">
          <h2 className={ui.h2}>🎯 Les points de la perf · {groups[0]?.years}</h2>
          <p className={ui.muted}>Si ton équipe <b>boucle le WOD</b> ({laps} tours complets) avant la fin officielle (<b>{capMin}:00</b>), elle obtient les points de son parcours :</p>
          <EvalBaremeTable groups={groups.map((g) => g.key)} />
          <ul className="space-y-1.5 text-sm text-ink-2 list-disc pl-5">
            <li><b>Filles</b> = une équipe de filles uniquement ; une équipe mixte lit la colonne « garçons ou mixte ».</li>
            <li>WOD pas bouclé à {capMin}:00 : la note part de ce maximum et baisse selon ce qu&apos;il restait à faire.</li>
            {extraMin > 0 && <li>De {capMin}:00 à {capMin + extraMin}:00, le chrono continue s&apos;il reste du temps : tu peux finir ton parcours, mais c&apos;est hors classement.</li>}
            <li>Triche ou répétitions bâclées : carte jaune, soit 1 minute de plus au temps de toute l&apos;équipe.</li>
          </ul>
        </section>

        <section className={`${ui.cardPad} space-y-1.5`}>
          <h2 className={ui.h3}>🔁 S.O.R.O. : Station → Ordi → Run → Ordi</h2>
          <p className={ui.muted}>Après <b>chaque station</b>, ton équipe vient valider à l&apos;ordi. Après <b>chaque run</b> aussi. C&apos;est l&apos;heure du clic qui fait votre temps : on vient quand c&apos;est fini.</p>
        </section>
      </main>
    </div>
  );
}
