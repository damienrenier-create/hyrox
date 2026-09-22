import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { cleanupInventory } from "@/lib/cleanup";
import { CLEANUP_PHRASE } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import { TZ } from "@/lib/scheduling";
import { TopBar } from "../../_components/TopBar";
import { resetRaceAction } from "./actions";
import { PurgeForm, type PurgeRow } from "./PurgeForm";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });

// Page de menage, reservee a DAMZER. Elle affiche d'abord ce qui NE bougera PAS (programmation, eleves),
// puis deux outils distincts : remettre une seance a zero (on garde les equipes), et le grand menage.
export default async function NettoyagePage({ searchParams }: { searchParams: Promise<{ ok?: string; msg?: string }> }) {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") redirect("/");
  const { ok, msg } = await searchParams;

  const inv = await cleanupInventory();
  const now = Date.now();
  const withContent = inv.sessions.filter((s) => s.started || s.ended || s.laps || s.shots || s.evals || s.selfEvals);
  // Une seance dont l'heure d'ouverture est encore a venir est une seance PREPAREE, meme si elle a ete
  // lancee par erreur et donc refermee : elle ne doit jamais partir sans un geste explicite.
  const future = (s: { opensAtMs: number | null }) => !!s.opensAtMs && s.opensAtMs > now;

  const rows: PurgeRow[] = inv.sessions.map((s) => ({
    id: s.id,
    label: s.label === s.wodType ? wodLabel(s.wodType) : s.label,
    when: s.opensAtMs ? `prévue ${fmt(s.opensAtMs)}` : fmt(s.dateMs),
    state: s.state,
    detail:
      [
        `${s.teams} équipes`,
        `${s.members} participants`,
        s.laps ? `${s.laps} tours` : "",
        s.cards ? `${s.cards} cartes` : "",
        s.evals ? `${s.evals} évaluations` : "",
        s.shots ? `${s.shots} tirs` : "",
        s.selfEvals ? `${s.selfEvals} auto-évals` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    protectedReason: future(s)
      ? `Séance préparée pour le ${fmt(s.opensAtMs!)} : la supprimer annulerait ta préparation.${s.ended ? " Elle a été lancée par erreur — utilise plutôt « Remettre à zéro » ci-dessus." : ""}`
      : s.state === "ouverte"
        ? "Séance actuellement ouverte aux élèves."
        : null,
  }));

  return (
    <div className={ui.page}>
      <TopBar
        title="Nettoyage"
        subtitle="Remise à zéro d'une séance et effacement définitif des données de test"
        back={{ href: "/admin" }}
        right={<Link href="/admin" className={btn.smGhost}>Console</Link>}
      />

      <main className={`${ui.container} py-6 space-y-5`}>
        {ok && <p className={ui.alertOk}>✅ {ok}</p>}
        {msg && <p className={ui.alertErr}>⚠️ {msg}</p>}

        {/* ===== Ce qui ne bouge jamais ===== */}
        <section className={`${ui.cardPad} border-success/40`}>
          <h2 className={`${ui.h2} mb-1`}>🔒 Ce qui reste</h2>
          <p className={`${ui.hint} mb-3`}>
            Les élèves ne sont JAMAIS supprimés. La programmation est gardée par défaut, sauf si tu coches la remise à
            blanc tout en bas.
          </p>
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            <li className={`${ui.inset} p-3`}>
              <b>Cycles ({inv.kept.cycles.length})</b>
              <span className="block text-ink-2 text-xs">{inv.kept.cycles.join(" · ") || "aucun"}</span>
            </li>
            <li className={`${ui.inset} p-3`}>
              <b>Séances-types ({inv.kept.plans.length})</b>
              <span className="block text-ink-2 text-xs">{inv.kept.plans.join(" · ") || "aucune"}</span>
            </li>
            <li className={`${ui.inset} p-3`}>
              <b>Créneaux horaires ({inv.kept.slots})</b>
              <span className="block text-ink-2 text-xs">Les ouvertures automatiques continueront exactement pareil, sauf remise à blanc.</span>
            </li>
            <li className={`${ui.inset} p-3 border-success/50`}>
              <b>Élèves ({inv.kept.students})</b>
              <span className="block text-ink-2 text-xs">
                Noms, classes, dates de naissance et comptes conservés dans tous les cas. Seul le code PIN peut être remis à zéro.
              </span>
            </li>
          </ul>
        </section>

        {/* ===== Remettre une seance a zero ===== */}
        <section className={ui.cardPad}>
          <h2 className={`${ui.h2} mb-1`}>↺ Remettre une séance à zéro</h2>
          <p className={`${ui.hint} mb-3`}>
            Pour une séance lancée par erreur. Le chronomètre, les tours, les cartes jaunes et les pauses sont effacés, et la séance
            redevient « pas commencée ». Les équipes, leurs membres et tes réglages sont conservés : tu peux la relancer telle quelle.
          </p>
          {withContent.length === 0 ? (
            <p className={ui.muted}>Aucune séance n&apos;a été lancée : rien à remettre à zéro.</p>
          ) : (
            <ul className="space-y-2">
              {withContent.map((s) => (
                <li key={s.id} className={`${ui.inset} p-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm">
                        {s.label === s.wodType ? wodLabel(s.wodType) : s.label}
                        <span className="font-normal text-ink-3"> · {s.opensAtMs ? `prévue ${fmt(s.opensAtMs)}` : fmt(s.dateMs)}</span>
                        <span className={cx(ui.chip, "ml-2", s.ended ? ui.chipErr : s.started ? ui.chipWarn : ui.chipMuted)}>
                          {s.ended ? "WOD terminé" : s.started ? "en cours" : "pas démarrée"}
                        </span>
                      </div>
                      <div className="text-xs text-ink-2">
                        {s.teams} équipes · {s.members} participants · {s.laps} tours · {s.cards} cartes · {s.evals} évaluations · {s.shots} tirs · {s.fleets} flottes
                      </div>
                      {future(s) && (
                        <div className="text-xs font-bold text-success-ink mt-0.5">
                          Séance préparée : après remise à zéro elle redevient « programmée » et s&apos;ouvrira toute seule le {fmt(s.opensAtMs!)}.
                        </div>
                      )}
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className={`${btn.smDanger} cursor-pointer list-none inline-flex`}>Remettre cette séance à zéro…</summary>
                    <form action={resetRaceAction} className="mt-2 space-y-2">
                      <input type="hidden" name="sessionId" value={s.id} />
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" name="clearReferees" className={`${ui.check} mt-0.5`} />
                        <span>
                          Effacer aussi l&apos;arbitrage <b>({s.shots} tirs, {s.evals} évaluations, {s.fleets} flottes)</b>. Décoché, les bateaux
                          déjà placés et les évaluations des arbitres sont gardés.
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" name="clearMembers" className={`${ui.check} mt-0.5`} />
                        <span>
                          Vider aussi la composition des équipes <b>({s.members} participants)</b>. Décoché, tu récupères la séance avec ses
                          équipes déjà formées.
                        </span>
                      </label>
                      <button type="submit" className={btn.smDanger}>Confirmer la remise à zéro</button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ===== Grand menage ===== */}
        <section className={`${ui.cardPad} border-danger/40`}>
          <h2 className={`${ui.h2} mb-1`}>🗑️ Effacer les données de test</h2>
          <p className={`${ui.hint} mb-3`}>
            Suppression <b>définitive</b> et sans retour des séances cochées, avec leurs équipes, tours, cartes, évaluations, tirs, flottes et
            auto-évaluations. Les séances <b>programmées</b> ou <b>ouvertes</b> ne sont jamais cochées d&apos;avance : coche-les seulement si tu
            veux vraiment les perdre. Mot de passe du ménage : <b className="text-danger-ink tracking-wider">{CLEANUP_PHRASE}</b>
          </p>
          {rows.length === 0 && !inv.pinCount && !inv.reliabilityCount && !inv.kept.cycles.length && !inv.kept.plans.length && !inv.kept.slots ? (
            <p className={ui.muted}>La base est déjà vierge : aucune séance, aucun code PIN, aucune programmation.</p>
          ) : (
            <PurgeForm
              rows={rows}
              pinCount={inv.pinCount}
              reliabilityCount={inv.reliabilityCount}
              programme={`${inv.kept.cycles.length} cycle(s), ${inv.kept.plans.length} séance(s)-type, ${inv.kept.slots} créneau(x)`}
            />
          )}
        </section>
      </main>
    </div>
  );
}
