import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { buildPyramideRecords, type RecordPeriod, type TeamSex } from "@/lib/pyramide-records";
import { buildLevelRecords } from "@/lib/level-records";
import { TopBar } from "../../_components/TopBar";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const SEXES: { v: TeamSex | ""; label: string }[] = [
  { v: "", label: "Toutes" },
  { v: "F", label: "Filles" },
  { v: "M", label: "Gars" },
  { v: "OPEN", label: "Mixtes" },
];
// Periode lue dans l'URL (« periode=jour|semaine »), sans valeur = depuis toujours.
const PERIODS: { v: RecordPeriod; q: string; label: string }[] = [
  { v: "day", q: "jour", label: "Aujourd'hui" },
  { v: "week", q: "semaine", label: "Cette semaine" },
  { v: "all", q: "", label: "Depuis toujours" },
];
const day = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "2-digit" });

// Records du WOD Pyramide vus par les eleves : le meme palmares que le greffier, en lecture seule,
// avec les memes filtres (composition de l'equipe, degre). Tout passe par l'URL, donc partageable.
export default async function EleveRecordsPage({ searchParams }: { searchParams: Promise<{ sexe?: string; degre?: string; periode?: string; wod?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/");
  const sp = await searchParams;
  const sex = (["F", "M", "OPEN"].includes(sp.sexe ?? "") ? sp.sexe : "") as TeamSex | "";
  const grade = sp.degre && /^\d$/.test(sp.degre) ? Number(sp.degre) : null;
  const periodQ = PERIODS.find((p) => p.q && p.q === sp.periode)?.q ?? "";
  const period = PERIODS.find((p) => p.q === periodQ)?.v ?? "all";
  const wod = sp.wod === "level" ? "level" : "pyramide";
  const data = wod === "level" ? await buildLevelRecords({ sex, grade, period }) : await buildPyramideRecords({ sex, grade, period });
  const href = (patch: { sexe?: string; degre?: string; periode?: string; wod?: string }) => {
    const p = new URLSearchParams();
    const v = { sexe: sex, degre: grade ? String(grade) : "", periode: periodQ, wod: wod === "level" ? "level" : "", ...patch };
    if (v.wod) p.set("wod", v.wod);
    if (v.sexe) p.set("sexe", v.sexe);
    if (v.degre) p.set("degre", v.degre);
    if (v.periode) p.set("periode", v.periode);
    const q = p.toString();
    return `/eleve/records${q ? `?${q}` : ""}`;
  };

  return (
    <div className={ui.page}>
      <TopBar brand={false} back={{ href: user.role === "STUDENT" ? "/eleve" : "/admin", label: "Retour" }} title="🏆 Records" subtitle={`WOD ${wod === "level" ? "Level" : "Pyramide"} · toutes classes confondues`} />

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <div className={`${ui.cardPad} space-y-2`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={ui.eyebrow}>WOD</span>
            <Link href={href({ wod: "" })} className={cx(ui.pill, wod === "pyramide" ? ui.pillOn : ui.pillOff)}>Pyramide</Link>
            <Link href={href({ wod: "level" })} className={cx(ui.pill, wod === "level" ? ui.pillOn : ui.pillOff)}>Level</Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={ui.eyebrow}>Période</span>
            {PERIODS.map((p) => (
              <Link key={p.v} href={href({ periode: p.q })} className={cx(ui.pill, period === p.v ? ui.pillOn : ui.pillOff)}>
                {p.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={ui.eyebrow}>Équipes</span>
            {SEXES.map((s) => (
              <Link key={s.v || "all"} href={href({ sexe: s.v })} className={cx(ui.pill, sex === s.v ? ui.pillOn : ui.pillOff)}>
                {s.label}
              </Link>
            ))}
          </div>
          {data.grades.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={ui.eyebrow}>Année</span>
              <Link href={href({ degre: "" })} className={cx(ui.pill, grade === null ? ui.pillOn : ui.pillOff)}>Toutes</Link>
              {data.grades.map((g) => (
                <Link key={g} href={href({ degre: String(g) })} className={cx(ui.pill, grade === g ? ui.pillOn : ui.pillOff)}>
                  {g === 1 ? "1res" : `${g}es`}
                </Link>
              ))}
            </div>
          )}
          <p className={ui.hint}>{data.teamsScanned} équipe(s) sur {data.sessionsScanned} séance(s). Le palmarès change à chaque WOD : à toi de jouer. <b>BK</b> = une pause du chrono est tombée en plein WOD.</p>
        </div>

        {data.teamsScanned === 0 ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Pas encore de record avec ces filtres.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.boards.map((b) => (
              <section key={b.id} className={`${ui.card} p-3`}>
                <h3 className="font-display font-extrabold text-sm text-ink leading-tight">{b.title}</h3>
                <p className={`${ui.hint} mb-2`}>{b.hint}</p>
                {b.rows.length === 0 ? (
                  <p className={ui.hint}>Pas encore de record.</p>
                ) : (
                  <ol className="space-y-1">
                    {b.rows.map((r, i) => {
                      const mine = user.role === "STUDENT" && r.members.length > 0 && r.classes.split(", ").includes(user.className ?? "—");
                      return (
                        <li
                          key={r.key}
                          className={cx(
                            "flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-xs",
                            i === 0 ? "bg-accent-soft border border-accent/50" : "bg-paper border border-line",
                            mine && "ring-1 ring-brand/40"
                          )}
                        >
                          <span className={cx("font-display font-extrabold w-4 text-center", i === 0 ? "text-accent-ink" : "text-ink-3")}>{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold text-ink truncate">{r.members.join(", ") || r.teamName}</span>
                            <span className="block text-ink-3 text-[10px] truncate">{r.classes || "sans classe"} · {day(r.dateMs)}</span>
                          </span>
                          {r.bk && <span className="inline-flex items-center rounded px-1 text-[9px] font-black leading-4 bg-ink text-white" title="BK · une pause du chrono est tombée entre 20 et 80 % du WOD de cette équipe">BK</span>}
                          <span className="font-display font-extrabold text-ink tabular-nums whitespace-nowrap">{r.display}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
