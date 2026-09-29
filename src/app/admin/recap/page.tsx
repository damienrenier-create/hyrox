import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { buildSessionRecap, fmtDuration as fmt, SELF_EVAL_LABELS, type RecapFact, type TeamRecap } from "@/lib/session-recap";
import { fmtGrade, gradeTone } from "@/lib/carnet";
import { PACE_FAST, PACE_SLOW } from "@/lib/level-pace";
import { starsLabel } from "@/lib/wod-engines/templates/level-engine";
import { TopBar } from "../../_components/TopBar";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const FORMAT_LABEL = { big: "5 et +", mid: "4", small: "1 à 3" } as const;
const pct = (ratio: number) => (ratio < 1 ? `${Math.round((1 - ratio) * 100)} % plus rapide` : `${Math.round((ratio - 1) * 100)} % plus lente`);
const toneCls = (t: RecapFact["tone"]) => (t === "bad" ? "border-danger/40 bg-danger-soft/50" : t === "good" ? "border-success/40 bg-success-soft/50" : t === "warn" ? "border-warn/40 bg-warn-soft/50" : "border-line bg-paper");
const Facts = ({ facts, empty }: { facts: RecapFact[]; empty?: string }) =>
  facts.length === 0 ? (empty ? <p className={ui.hint}>{empty}</p> : null) : <ul className="space-y-1">{facts.map((f, i) => <li key={i} className={cx("rounded-lg border px-2 py-1 text-sm", toneCls(f.tone))}>{f.text}</li>)}</ul>;

// Fiche d'une equipe (Sartay 30/09 : le rapport par numero d'equipe) : eleves avec evaluations des arbitres et
// auto-evaluation, parcours, temps niveau par niveau (rouge = anormalement vite, orange = tres lent), faits.
function TeamCard({ t }: { t: TeamRecap }) {
  const s = t.sheet;
  const lostHard = s.losses.filter((l) => !l.soft).length;
  return (
    <section className={cx(ui.cardPad, "space-y-3", s.suspicious.length > 0 && "ring-2 ring-danger/40")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className={ui.h2}>{s.name}</h2>
        <span className="text-warn-ink font-bold">{starsLabel(s.stars)}</span>
        {s.rankOf > 0 && <span className={cx(ui.chip, s.rank === 1 ? ui.chipOk : ui.chipMuted)}>{s.rank}{s.rank === 1 ? "re" : "e"}/{s.rankOf} du parcours</span>}
        <span className={ui.hint}>équipe de {FORMAT_LABEL[s.format]}</span>
        <span className={cx(ui.chip, t.alerts ? ui.chipWarn : ui.chipOk, "ml-auto")}>{t.alerts ? `${t.alerts} point${t.alerts > 1 ? "s" : ""} à regarder` : "RAS"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={ui.th}>Élève</th>
              <th className={`${ui.th} text-right`} title="Évaluations reçues des arbitres (démineur) et leur moyenne">Arbitres</th>
              <th className={`${ui.th} text-right`} title="Auto-évaluation de l'élève, note sur 5 comme au carnet (forme du jour non comptée)">Auto-éval</th>
              <th className={`${ui.th} text-right`}>Forme</th>
              <th className={`${ui.th} text-right`} title="Grille remplie par le prof">Prof</th>
            </tr>
          </thead>
          <tbody>
            {s.members.map((m) => {
              const se = m.selfEval;
              const grid = se ? SELF_EVAL_LABELS.map((c) => `${c.label} : ${se.codes[c.id] ?? "—"}`).join("\n") : "";
              return (
                <tr key={m.id} className={ui.tr}>
                  <td className="p-1.5"><Link href={`/admin/eleves/${m.id}`} className="font-bold hover:underline">{m.name}</Link> <span className="text-ink-3">{m.className}</span></td>
                  <td className="p-1.5 text-right tabular-nums">{m.evals ? <>{m.evals} · <b className={gradeTone(m.avgGrade)}>{m.avgCode}</b></> : <span className="text-ink-3">—</span>}</td>
                  <td className="p-1.5 text-right tabular-nums" title={grid || undefined}>{se?.grade != null ? <b className={gradeTone(se.grade)}>{fmtGrade(se.grade)}/5</b> : <span className="text-ink-3">pas rendue</span>}</td>
                  <td className="p-1.5 text-right">{se?.forme ?? <span className="text-ink-3">—</span>}</td>
                  <td className="p-1.5 text-right tabular-nums">{se?.review != null ? <b className={gradeTone(se.review)}>{fmtGrade(se.review)}/5</b> : <span className="text-ink-3">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
      <Facts facts={t.facts} />
    </section>
  );
}

// Recap d'une seance Level pour les admins (Sartay 28/09 ; par numero d'equipe depuis le 30/09) : les arbitres
// d'abord (ils ne sont dans aucune equipe), puis chaque equipe dans l'ordre de ses numeros.
export default async function RecapPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const { session } = await searchParams;
  const recap = session ? await buildSessionRecap(session) : null;
  const start = recap?.startedAtMs ? new Date(recap.startedAtMs).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }) : null;
  const subtitle = recap
    ? [recap.label, recap.classes.join(", "), start && `départ ${start}`, recap.durationMs !== null && `${fmt(recap.durationMs)} de course`, !recap.ended && "WOD pas encore terminé"].filter(Boolean).join(" · ")
    : "Séance introuvable";
  const alerts = recap ? recap.teams.reduce((n, t) => n + t.alerts, 0) : 0;
  return (
    <div className={ui.page}>
      <TopBar title="📋 Récap de séance" subtitle={subtitle} back={{ href: "/admin" }} />
      <main className={`${ui.container} py-6 space-y-4`}>
        {!recap ? (
          <p className={ui.alertErr}>Séance Level introuvable.</p>
        ) : (
          <>
            <div className={`${ui.cardPad} flex flex-wrap items-center gap-2`}>
              <span className={cx(ui.chip, ui.chipMuted)}>{recap.teams.length} équipe{recap.teams.length > 1 ? "s" : ""}</span>
              <span className={cx(ui.chip, ui.chipMuted)}>{recap.evaluations} évaluation{recap.evaluations > 1 ? "s" : ""} d&apos;arbitres</span>
              <span className={cx(ui.chip, recap.selfEvals.submitted < recap.selfEvals.expected ? ui.chipWarn : ui.chipOk)}>auto-évaluations rendues : {recap.selfEvals.submitted}/{recap.selfEvals.expected}</span>
              <span className={cx(ui.chip, alerts ? ui.chipWarn : ui.chipOk)}>{alerts ? `${alerts} point${alerts > 1 ? "s" : ""} à regarder` : "RAS"}</span>
              <Link href={`/greffier?session=${recap.sessionId}`} className={`${btn.smGhost} ml-auto`}>Greffier (résultats, rythme, arbitrage)</Link>
              <p className={`${ui.hint} w-full`}>Temps des niveaux : en haut le temps de l&apos;équipe, en bas la référence (médiane des autres équipes sur le même niveau, même parcours, même format). Rouge = moins de la moitié, orange = plus du double. Survole une auto-évaluation pour voir sa grille.</p>
            </div>
            <section className={`${ui.cardPad} space-y-2`}>
              <h2 className={ui.h2}>🧑‍⚖️ Arbitres</h2>
              <Facts facts={recap.referees} empty="Rien à signaler." />
            </section>
            {recap.teams.length === 0 && <p className={ui.muted}>Aucune équipe dans cette séance.</p>}
            <div className="grid gap-4 xl:grid-cols-2">{recap.teams.map((t) => <TeamCard key={t.sheet.teamId} t={t} />)}</div>
          </>
        )}
      </main>
    </div>
  );
}
