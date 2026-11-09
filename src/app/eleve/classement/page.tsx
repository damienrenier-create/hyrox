import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { loadSelfEvalHistory } from "@/lib/student-self-evals";
import { evalBaremeVisible } from "@/lib/eval-bareme-server";
import { sessionsForStudent } from "@/lib/student-sessions";
import { badmintonGroupOf, badmintonTabVisible, loadEloBoard } from "@/lib/badminton-server";
import { ELO_PROVISIONAL_GAMES, ELO_START, fmtDelta, fmtElo, rankElo } from "@/lib/badminton-elo";
import { setsText } from "@/lib/badminton";
import { TopBar } from "../../_components/TopBar";
import { LogoutButton } from "../../_components/LogoutButton";
import { EleveTabs } from "../EleveTabs";
import { cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });

// Onglet « Classement » (Sartay 03/11 : « le classement ELO ne s'affiche pas dans chaque match mais plutôt dans un onglet
// de leur profil ») : mon ELO, mes derniers matchs (+/−), le classement de mon groupe de cours, ou de toutes les classes.
export default async function ClassementPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");
  const { vue } = await searchParams;
  const all = vue === "tout";
  const mine = await sessionsForStudent(user.id);
  const [{ todo }, bareme, visible, board, group] = await Promise.all([
    loadSelfEvalHistory(user.id, mine),
    evalBaremeVisible(user.className, mine.some((s) => s.wodType === "HYROX")),
    badmintonTabVisible(user.id, user.className ?? null),
    loadEloBoard(),
    badmintonGroupOf(user.className ?? null),
  ]);
  if (!visible) redirect("/eleve");

  // Les eleves de test (7A) ne se melangent jamais aux vraies classes : chacun ne voit que son propre monde.
  const iAmTest = board.test.has(user.id) || /^7/.test(user.className ?? "");
  const me = board.entries.get(user.id) ?? null;
  const pool = [...board.entries.values()].filter((e) => board.test.has(e.id) === iAmTest);
  const inGroup = (id: string) => {
    const p = board.people.get(id);
    return !!p && !!p.className && group.classes.includes(p.className) && (!group.sex || !p.sex || p.sex === group.sex);
  };
  const ranking = rankElo(all ? pool : pool.filter((e) => inGroup(e.id)));
  const myRank = me ? ranking.findIndex((e) => e.id === me.id) + 1 : 0;
  const nameOf = (id: string) => board.people.get(id)?.name ?? "?";
  const classOf = (id: string) => board.people.get(id)?.className ?? "";
  const groupLabel = group.classes.length ? group.classes.join(" + ") : "ma classe";
  const steps = me ? [...me.steps].reverse().slice(0, 10) : [];

  return (
    <div className={ui.page}>
      <TopBar title={user.name} subtitle={user.className ?? ""} right={<LogoutButton />} />
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        <EleveTabs active="classement" todo={todo.length} bareme={bareme} classement />

        <section className={`${ui.card} p-4`}>
          <p className={ui.eyebrow}>🏸 Mon classement ELO</p>
          {me ? (
            <>
              <div className="flex items-end justify-between gap-3 mt-1">
                <div className="font-display text-5xl font-extrabold tabular-nums text-ink">{fmtElo(me.rating)}</div>
                <div className="text-right text-sm text-ink-2">
                  {myRank > 0 && <div className="font-bold text-ink">{myRank}<sup>{myRank === 1 ? "er" : "e"}</sup> sur {ranking.length} {all ? "(toutes classes)" : `(${groupLabel})`}</div>}
                  <div>{me.games} match{me.games > 1 ? "s" : ""} · {me.won} V · {me.draws} N · {me.lost} D</div>
                </div>
              </div>
              {me.provisional && <p className={`${ui.hint} mt-2`}>Classement provisoire : il se stabilise après {ELO_PROVISIONAL_GAMES} matchs (encore {ELO_PROVISIONAL_GAMES - me.games}).</p>}
            </>
          ) : (
            <p className="text-sm text-ink-2 mt-1">Tu n&apos;as pas encore de match qui compte. Tout le monde part à {ELO_START} : joue ton premier match pour entrer dans le classement.</p>
          )}
        </section>

        <Link href="/eleve/badminton/libre" className={`flex items-center justify-between gap-3 ${ui.card} hover:border-brand p-3 transition`}>
          <span>
            <span className="block font-display font-extrabold text-ink">🏸 Matchs libres</span>
            <span className="block text-xs text-ink-2">Défie un élève de n&apos;importe quelle classe, en dehors des cours.</span>
          </span>
          <span className="text-ink-3 font-black">›</span>
        </Link>

        {steps.length > 0 && (
          <section className={`${ui.card} p-3`}>
            <h2 className={`${ui.eyebrow} mb-2`}>Mes derniers matchs</h2>
            <ul className="divide-y divide-line">
              {steps.map((s) => (
                <li key={s.matchId} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className={cx("font-black mr-1.5", s.outcome === "W" ? "text-success-ink" : s.outcome === "L" ? "text-danger-ink" : "text-ink-2")}>{s.outcome === "W" ? "V" : s.outcome === "L" ? "D" : "N"}</span>
                    <span className="font-bold">{nameOf(s.opponentId)}</span> <span className="text-ink-3 text-xs">{classOf(s.opponentId)}</span>
                    <span className="block text-xs text-ink-2 tabular-nums">{shortDate(s.at)} · {setsText(s.sets)}</span>
                  </span>
                  <span className={cx("font-display font-extrabold tabular-nums whitespace-nowrap", s.after >= s.before ? "text-success-ink" : "text-danger-ink")}>{fmtDelta(s.before, s.after)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={`${ui.card} p-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className={ui.eyebrow}>Classement {all ? "toutes classes" : groupLabel}</h2>
            <div className={ui.segmented}>
              <Link href="/eleve/classement" className={cx("text-xs font-bold px-2.5 py-1 rounded-lg", !all ? ui.segOn : ui.segOff)}>Mon groupe</Link>
              <Link href="/eleve/classement?vue=tout" className={cx("text-xs font-bold px-2.5 py-1 rounded-lg", all ? ui.segOn : ui.segOff)}>Toutes classes</Link>
            </div>
          </div>
          {ranking.length === 0 ? (
            <p className={ui.muted}>Personne n&apos;a encore de match qui compte.</p>
          ) : (
            <ol className="text-sm">
              {ranking.map((e, i) => (
                <li key={e.id} className={cx("flex items-center gap-2 rounded-lg px-2 py-1", e.id === user.id && "bg-brand-soft font-bold")}>
                  <span className="w-7 text-right tabular-nums text-ink-3">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate">{nameOf(e.id)} <span className="text-xs text-ink-3 font-normal">{classOf(e.id)}</span></span>
                  <span className="text-xs text-ink-3 tabular-nums whitespace-nowrap">{e.games} m.{e.provisional ? " · prov." : ""}</span>
                  <span className="w-12 text-right font-display font-extrabold tabular-nums">{fmtElo(e.rating)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <details className={`${ui.card} p-3 text-sm text-ink-2`}>
          <summary className="cursor-pointer font-bold text-ink">Comment ça marche ?</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Tout le monde commence à {ELO_START} points.</li>
            <li>Un match de cours compte dès qu&apos;il a un score et que personne ne l&apos;a contesté (pas besoin qu&apos;il soit signé).</li>
            <li>Un <Link href="/eleve/badminton/libre" className="underline">match libre</Link> (contre n&apos;importe quelle classe, en dehors des cours) compte quand il est officiel : 2 autres élèves l&apos;ont attesté (l&apos;arbitre en est un), ou ton prof l&apos;a validé.</li>
            <li>Gagner contre plus fort que toi rapporte beaucoup ; perdre contre plus fort coûte peu. Une égalité compte pour un demi-match gagné.</li>
            <li>Un match d&apos;un championnat à handicap compte comme entre deux joueurs de même niveau : le handicap a déjà égalisé vos chances.</li>
            <li>Un large écart au score (par exemple 21-5) compte jusqu&apos;à une fois et demie plus qu&apos;un match serré.</li>
            <li>Sur tes 10 premiers matchs, ton classement bouge plus vite, pour trouver ta place. Avant {ELO_PROVISIONAL_GAMES} matchs, il est « provisoire ».</li>
          </ul>
        </details>
      </main>
    </div>
  );
}
