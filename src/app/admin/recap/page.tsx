import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { buildSessionRecap, fmtDuration as fmt, type RecapFact, type TeamSheet } from "@/lib/session-recap";
import { PACE_FAST, PACE_SLOW } from "@/lib/level-pace";
import { starsLabel } from "@/lib/wod-engines/templates/level-engine";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const FORMAT_LABEL = { big: "5 et +", mid: "4", small: "1 à 3" } as const;
const pct = (ratio: number) => (ratio < 1 ? `${Math.round((1 - ratio) * 100)} % plus rapide` : `${Math.round((ratio - 1) * 100)} % plus lente`);

// Fiche d'une equipe : noms, parcours, temps niveau par niveau (rouge = anormalement vite, orange = tres lent).
function TeamCard({ s }: { s: TeamSheet }) {
  const lostHard = s.losses.filter((l) => !l.soft).length;
  return (
    <div className={cx("rounded-xl border p-3 space-y-2 bg-paper", s.suspicious.length ? "border-danger/60" : "border-line")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display font-extrabold text-lg">{s.name}</span>
        <span className="text-warn-ink font-bold">{starsLabel(s.stars)}</span>
        {s.rankOf > 0 && <span className={cx(ui.chip, s.rank === 1 ? ui.chipOk : ui.chipMuted)}>{s.rank}{s.rank === 1 ? "re" : "e"}/{s.rankOf} du parcours</span>}
        <span className={ui.hint}>équipe de {FORMAT_LABEL[s.format]}</span>
        {s.suspicious.length > 0 && <span className={cx(ui.chip, ui.chipErr, "ml-auto")}>🕵️ louche</span>}
      </div>
      <ul className="text-sm leading-snug">
        {s.members.map((m) => (
          <li key={m.id} className="flex gap-2">
            <Link href={`/admin/eleves/${m.id}`} className="font-bold hover:underline">{m.name}</Link>
            <span className="text-ink-3">{m.className}</span>
            {m.evals > 0 && <span className="ml-auto text-ink-3 tabular-nums">{m.evals} éval{m.evals > 1 ? "s" : ""} · moy. <b className="text-ink-2">{m.avgCode}</b></span>}
          </li>
        ))}
      </ul>
      <p className="text-sm">
        ⏱ <b>{s.completedLevels}/{s.totalLevels}</b> niveaux
        {s.finishedMs !== null ? <> · échelle bouclée en <b>{fmt(s.finishedMs)}</b></> : s.lastTickMs !== null ? <> · dernière fiche à {fmt(s.lastTickMs)}</> : null}
        {s.openLevel && <> · arrêtée au niveau {s.openLevel.level}</>}
        {s.paceRatio !== null && <> · rythme <b className={s.paceRatio < 0.7 ? "text-danger" : s.paceRatio > 1.5 ? "text-warn-ink" : ""}>{pct(s.paceRatio)}</b> que les autres équipes</>}
      </p>
      {(s.losses.length > 0 || s.cards.length > 0 || s.switches.length > 0) && (
        <p className="text-sm">
          {s.losses.length > 0 && <>💀 {s.losses.length} vie{s.losses.length > 1 ? "s" : ""} perdue{s.losses.length > 1 ? "s" : ""}{lostHard ? ` (dont ${lostHard} avec descente)` : ""} : {s.losses.map((l) => `niv. ${l.level} à ${fmt(l.atMs)}`).join(", ")}. </>}
          {s.switches.map((sw, i) => <span key={i}>{sw.to < sw.from ? "⬇️ descendue" : "⬆️ montée"} {starsLabel(sw.from)} → {starsLabel(sw.to)} au niveau {sw.fromLevel}. </span>)}
          {s.cards.length > 0 && <>🟧 {s.cards.length} carte{s.cards.length > 1 ? "s" : ""} jaune{s.cards.length > 1 ? "s" : ""} à {s.cards.map(fmt).join(", ")}.</>}
        </p>
      )}
      {s.levels.length > 0 && (
        <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-9 gap-1">
          {s.levels.map((l) => (
            <div
              key={l.level}
              title={`Référence ${fmt(l.referenceMs)} (${l.basis === "moyenne" ? `médiane de ${l.n} passages` : "temps théorique"}) · ×${l.ratio.toFixed(2).replace(".", ",")}`}
              className={cx("rounded-md border px-1 py-0.5 text-center leading-tight", l.ratio < PACE_FAST ? "border-danger/60 bg-danger-soft" : l.ratio > PACE_SLOW ? "border-warn/60 bg-warn-soft" : "border-line bg-surface")}
            >
              <div className={cx("text-[10px] text-ink-3", l.boss && "font-black text-ink")}>{l.boss ? `BOSS ${l.level}` : `N${l.level}`}{l.lost ? ` 💀${l.lost > 1 ? l.lost : ""}` : ""}</div>
              <div className="text-xs font-bold tabular-nums">{fmt(l.durationMs)}</div>
              <div className="text-[10px] text-ink-3 tabular-nums">{fmt(l.referenceMs)}</div>
            </div>
          ))}
        </div>
      )}
      {(s.warmup || s.finisher) && (
        <p className={ui.hint}>
          {s.warmup && <>🔥 Échauffement : {s.warmup.levels}/{s.warmup.total} séries{s.warmup.finishMs !== null ? ` en ${fmt(s.warmup.finishMs)}` : ""}{s.warmup.losses ? ` · 💀 ${s.warmup.losses}` : ""}. </>}
          {s.finisher && <>🪢 Finisher : {s.finisher.levels}/{s.finisher.total} vagues{s.finisher.score ? ` · ${s.finisher.score} cordes` : ""}{s.finisher.losses ? ` · 💀 ${s.finisher.losses}` : ""}.</>}
        </p>
      )}
      {s.suspicious.length > 0 && <ul className="text-sm text-danger space-y-0.5">{s.suspicious.map((r, i) => <li key={i}>🕵️ {r}</li>)}</ul>}
    </div>
  );
}

// Recap d'une seance Level par classe, pour les admins (Sartay 28/09) : les faits a retenir d'un coup d'oeil,
// puis la fiche de chaque equipe (noms, temps, vies, cartes).
export default async function RecapPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { session } = await searchParams;
  const recap = session ? await buildSessionRecap(session) : null;
  const toneCls = (t: RecapFact["tone"]) => (t === "bad" ? "border-danger/40 bg-danger-soft/50" : t === "good" ? "border-success/40 bg-success-soft/50" : t === "warn" ? "border-warn/40 bg-warn-soft/50" : "border-line bg-paper");
  const block = (title: string, facts: RecapFact[]) => (
    <div>
      <p className="font-bold text-sm mb-1">{title}</p>
      {facts.length === 0 ? <p className={ui.hint}>Rien à signaler.</p> : (
        <ul className="space-y-1">{facts.map((f, i) => <li key={i} className={cx("rounded-lg border px-2 py-1 text-sm", toneCls(f.tone))}>{f.text}</li>)}</ul>
      )}
    </div>
  );
  const start = recap?.startedAtMs ? new Date(recap.startedAtMs).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }) : null;
  const subtitle = recap
    ? [recap.label, start && `départ ${start}`, recap.durationMs !== null && `${fmt(recap.durationMs)} de course`, `${recap.evaluations} évaluation(s) d'arbitres`, !recap.ended && "WOD pas encore terminé"].filter(Boolean).join(" · ")
    : "Séance introuvable";
  return (
    <div className={ui.page}>
      <TopBar title="📋 Récap de séance" subtitle={subtitle} back={{ href: "/admin" }} />
      <main className={`${ui.container} py-6 space-y-4`}>
        {!recap ? (
          <p className={ui.alertErr}>Séance Level introuvable.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/greffier?session=${recap.sessionId}`} className={btn.smGhost}>Greffier (résultats, rythme, arbitrage)</Link>
              <span className={ui.hint}>Temps des niveaux : en haut le temps de l&apos;équipe, en bas la référence (médiane des autres équipes sur le même niveau, même parcours, même format). Rouge = moins de la moitié, orange = plus du double.</span>
            </div>
            {recap.classes.length === 0 && <p className={ui.muted}>Aucune équipe dans cette séance.</p>}
            {recap.classes.map((c) => {
              const alerts = c.suspects.length + c.refereeing.filter((f) => f.tone === "bad").length + c.teamsLevel.filter((f) => f.tone !== "good").length + c.evals.filter((f) => f.tone === "bad").length;
              return (
                <section key={c.className} className={`${ui.cardPad} space-y-4`}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className={ui.h2}>{c.className}</h2>
                    <span className={ui.hint}>{c.teams} équipe{c.teams > 1 ? "s" : ""} · {c.students} élève{c.students > 1 ? "s" : ""}</span>
                    <span className={cx(ui.chip, alerts ? ui.chipWarn : ui.chipOk, "ml-auto")}>{alerts ? `${alerts} point${alerts > 1 ? "s" : ""} à regarder` : "RAS"}</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {block("🕵️ Louche", c.suspects)}
                    {block("🏋️ Équipes trop fortes ou trop faibles", c.teamsLevel)}
                    {block("🧑‍⚖️ Arbitrages bizarres", c.refereeing)}
                    {block("📊 Évaluations très basses ou très hautes", c.evals)}
                  </div>
                  {c.teamSheets.length > 0 && (
                    <div>
                      <p className="font-bold text-sm mb-2">👥 Les équipes</p>
                      <div className="grid gap-3 lg:grid-cols-2">{c.teamSheets.map((s) => <TeamCard key={s.teamId} s={s} />)}</div>
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
