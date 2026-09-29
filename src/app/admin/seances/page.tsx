import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { isScheduled, isSessionOpen, toMs } from "@/lib/scheduling";
import { notDeleted, readSessionClasses } from "@/lib/session-roles";
import { wodLabel } from "@/lib/student-sessions";
import { listWodEngines } from "@/lib/wod-engines";
import { TopBar } from "../../_components/TopBar";
import { SessionDeleteButton } from "../SessionDeleteButton";
import { sessionsPlayedByRealStudents } from "@/lib/session-protect";
import { restoreSessionAction, softDeleteDraftsAction } from "../cycles-actions";
import { btn, cx, ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

const TZ = "Europe/Brussels";
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TZ });
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const PAGE = 40;

// Statut d'une seance (Sartay 29/09 nuit : « voir toutes les dernières séances et leur statut, il y a beaucoup de
// brouillons qui traînent »).
type Status = "open" | "scheduled" | "draft" | "abandoned" | "done";
const STATUS: Record<Status, { label: string; chip: string; hint: string }> = {
  open: { label: "Ouverte", chip: ui.chipOk, hint: "ouverte aux élèves en ce moment" },
  scheduled: { label: "Programmée", chip: ui.chipSea, hint: "créée, s'ouvrira à son heure" },
  draft: { label: "Brouillon", chip: ui.chipWarn, hint: "jamais lancée (aucun départ de chrono)" },
  abandoned: { label: "Lancée, pas terminée", chip: ui.chipMuted, hint: "chrono lancé, jamais de « Fin du WOD »" },
  done: { label: "Terminée", chip: ui.chipOk, hint: "WOD joué jusqu'à la fin" },
};
const FILTERS: { q: string; label: string; keep: (s: Status) => boolean }[] = [
  { q: "", label: "Toutes", keep: () => true },
  { q: "brouillons", label: "Brouillons", keep: (s) => s === "draft" },
  { q: "inachevees", label: "Lancées, pas terminées", keep: (s) => s === "abandoned" },
  { q: "terminees", label: "Terminées", keep: (s) => s === "done" },
  { q: "a-venir", label: "Ouvertes / programmées", keep: (s) => s === "open" || s === "scheduled" },
];

export default async function SeancesPage({ searchParams }: { searchParams: Promise<{ statut?: string; n?: string; ok?: string; msg?: string; undo?: string }> }) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN"].includes(user.role)) redirect("/");
  const canDelete = user.role === "MASTER_ADMIN";
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.q === (sp.statut ?? "")) ?? FILTERS[0];
  const limit = Math.max(PAGE, Math.min(1000, parseInt(sp.n ?? "", 10) || PAGE));

  const sessions = (await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).all()).filter(notDeleted);
  const ids = sessions.map((s) => s.id);
  const [raceStates, teams] = await Promise.all([
    ids.length ? db.orm.public.RaceState.where((r) => r.sessionId.in(ids)).all() : Promise.resolve([]),
    ids.length ? db.orm.public.Team.where((t) => t.sessionId.in(ids)).all() : Promise.resolve([]),
  ]);
  const members = teams.length ? await db.orm.public.TeamMember.where((m) => m.teamId.in(teams.map((t) => t.id))).all() : [];
  // Historique protege : jouee par de vrais eleves -> ni corbeille ni purge (regle d'or).
  const played = await sessionsPlayedByRealStudents(ids);
  const now = Date.now();
  const engines = listWodEngines();
  const rows = sessions.map((s) => {
    const rs = raceStates.find((r) => r.sessionId === s.id);
    const child = (s.settings as { child?: { kind?: string } } | null)?.child?.kind ?? null;
    const status: Status = isSessionOpen(s, now) ? "open" : s.isActive && isScheduled(s, now) ? "scheduled" : s.raceEndedAt ? "done" : rs?.startedAt ? "abandoned" : "draft";
    const myTeams = teams.filter((t) => t.sessionId === s.id);
    const students = members.filter((m) => myTeams.some((t) => t.id === m.teamId)).length;
    const dateMs = rs?.startedAt ? toMs(rs.startedAt) : s.opensAt ? toMs(s.opensAt) : toMs(s.createdAt);
    return { s, status, child, teams: myTeams.length, students, dateMs, classes: readSessionClasses(s.settings) };
  });
  const counts = Object.fromEntries(FILTERS.map((f) => [f.q, rows.filter((r) => f.keep(r.status)).length]));
  const filtered = rows.filter((r) => filter.keep(r.status));
  const shown = filtered.slice(0, limit);
  const drafts = rows.filter((r) => r.status === "draft");
  const href = (patch: { statut?: string; n?: number }) => {
    const p = new URLSearchParams();
    const statut = patch.statut ?? filter.q;
    if (statut) p.set("statut", statut);
    if (patch.n) p.set("n", String(patch.n));
    const q = p.toString();
    return `/admin/seances${q ? `?${q}` : ""}`;
  };
  const back = href({});

  return (
    <div className={ui.page}>
      <TopBar title="Toutes les séances" subtitle={`${rows.length} séances · ${drafts.length} brouillon${drafts.length > 1 ? "s" : ""}`} back={{ href: "/admin", label: "Console" }} />
      <main className={`${ui.container} py-6 space-y-4`}>
        {sp.ok && (
          <div className={`${ui.alertOk} flex flex-wrap items-center gap-2`}>
            <span>✅ {sp.ok}</span>
            {sp.undo && canDelete && (
              <form action={restoreSessionAction} className="ml-auto">
                <input type="hidden" name="id" value={sp.undo} />
                <input type="hidden" name="back" value="/admin/seances" />
                <button type="submit" className={btn.smGhost}>↩︎ Annuler la suppression</button>
              </form>
            )}
          </div>
        )}
        {sp.msg && <p className={ui.alertErr}>⚠️ {sp.msg}</p>}

        <div className={`${ui.cardPad} space-y-3`}>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link key={f.q || "all"} href={href({ statut: f.q })} className={cx(ui.pill, f === filter ? ui.pillOn : ui.pillOff)}>{f.label} ({counts[f.q]})</Link>
            ))}
          </div>
          <p className={ui.hint}>
            {Object.values(STATUS).map((x) => `${x.label} = ${x.hint}`).join(" · ")}. 🔒 = jouée par de vrais élèves : elle reste toujours dans l&apos;historique. Supprimer (💀) ne détruit rien : la séance va dans Nettoyage › Corbeille.
          </p>
          {canDelete && drafts.length > 0 && (
            <form action={softDeleteDraftsAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="ids" value={drafts.map((r) => r.s.id).join(",")} />
              <button type="submit" className={btn.smGhost} title="Suppression douce : restaurables une par une dans Nettoyage › Corbeille">💀 Ranger les {drafts.length} brouillon{drafts.length > 1 ? "s" : ""} dans la corbeille</button>
              <span className={ui.hint}>(jamais lancés et ni ouverts ni programmés ; leurs équipes encodées suivent)</span>
            </form>
          )}
        </div>

        <ul className="space-y-2">
          {shown.map(({ s, status, child, teams: nTeams, students, dateMs, classes }) => {
            const st = STATUS[status];
            const name = s.label ?? wodLabel(s.wodType);
            return (
              <li key={s.id} className={`${ui.inset} p-3 flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0 flex items-start gap-2">
                  {played.has(s.id) ? (
                    <span className="w-7 h-7 flex items-center justify-center flex-shrink-0" title="Jouée par de vrais élèves : gardée dans l'historique (règle d'or)">🔒</span>
                  ) : canDelete && status !== "open" && (
                    <SessionDeleteButton id={s.id} back={back} label={`${name} · ${fmtDay(dateMs)} ${fmtTime(dateMs)}`} detail={`${classes.length ? classes.join(", ") : "toutes classes"} · ${nTeams} équipe${nTeams > 1 ? "s" : ""} · ${st.label}`} />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold">
                      {name}
                      <span className="text-ink-3 font-normal"> · {fmtDay(dateMs)} {fmtTime(dateMs)}</span>
                      <span className={cx(ui.chip, st.chip, "ml-2")} title={st.hint}>{st.label}</span>
                      {child && <span className={cx(ui.chip, ui.chipMuted, "ml-1")}>{child === "warmup" ? "échauffement" : "finisher"}</span>}
                    </div>
                    <div className="text-xs text-ink-2">
                      {classes.length ? classes.join(", ") : "toutes classes"} · {engines.find((e) => e.id === s.wodType)?.name ?? wodLabel(s.wodType)} · {nTeams} équipe{nTeams > 1 ? "s" : ""}, {students} élève{students > 1 ? "s" : ""} encodé{students > 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/greffier?session=${s.id}`} className={btn.smPrimary}>{status === "done" || status === "abandoned" ? "Résultats" : "Greffier"}</Link>
                  {s.wodType === "LEVEL" && !child && status === "done" && <Link href={`/admin/recap?session=${s.id}`} className={btn.smGhost}>📋 Récap</Link>}
                  {(status === "done" || status === "abandoned") && <Link href={`/admin/resultats?session=${s.id}`} className={btn.smGhost}>Consultation</Link>}
                  {status === "done" && <Link href={`/admin/auto-evaluations?session=${s.id}`} className={btn.smGhost}>Auto-évals</Link>}
                </div>
              </li>
            );
          })}
          {shown.length === 0 && <li className={`${ui.cardPad} ${ui.muted}`}>Aucune séance avec ce statut.</li>}
        </ul>
        {filtered.length > shown.length && (
          <Link href={href({ n: limit + PAGE })} className={`block text-center ${btn.ghost}`}>Voir plus ({filtered.length - shown.length} de plus)</Link>
        )}
      </main>
    </div>
  );
}
