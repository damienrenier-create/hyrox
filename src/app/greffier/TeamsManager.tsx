"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addRefereeAction,
  addTeamMemberAction,
  removeRefereeAction,
  removeTeamMemberAction,
  setSessionClassesAction,
  teamDeletionPreviewAction,
  deleteTeamAction,
  type StudentHit,
} from "./team-actions";
import { decideRefereeAction } from "./referee-decisions";
import { MAX_CLASSES, REFEREE_REASONS } from "@/lib/session-roles";
import { btn, cx, ui } from "@/lib/ui";
import { cake } from "@/lib/birthday";
import { fold } from "@/lib/staff-names";
import type { PairHit } from "@/lib/teammates";

// Tout ce dont le selecteur a besoin, precharge par la page : plus aucune requete pendant la frappe.
export type PickerData = { roster: StudentHit[]; pairs: Record<string, PairHit[]> };

export type TeamMemberView = { id: string; firstName: string; lastName: string; className: string | null; birthday?: boolean };
export type TeamWithMembers = { id: string; name: string; order: number; members: TeamMemberView[] };
export type RefereeView = TeamMemberView & { note: string | null; status: string; teamName: string | null };

type Props = {
  sessionId: string;
  teams: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  phase: "pre" | "run" | "post";
  startByTeam?: Record<string, { number: number; label: string }>; // Pyramide : atelier de depart, annonce aux eleves
  picker: PickerData;
};

// Preparation du WOD par le greffier : 1) classes participantes (max 5), 2) composition des equipes
// (saisie intelligente restreinte a ces classes), 3) arbitres (motif obligatoire) — modifiable pendant tout
// le WOD. Tout est persiste par identifiant permanent, jamais par nom.
const byLastName = (a: TeamMemberView, b: TeamMemberView) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

export function TeamsManager({ sessionId, teams: propTeams, classes, allClasses, referees: propReferees, phase, startByTeam, picker }: Props) {
  const router = useRouter();
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [refereeOpen, setRefereeOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Suppression d'une equipe : deux confirmations, la premiere montrant ce qui va disparaitre.
  const [del, setDel] = useState<{ id: string; name: string; counts: Record<string, number> } | null>(null);
  const [delStage, setDelStage] = useState<1 | 2>(1);

  // Etat LOCAL mis a jour au tap (ajout / retrait / decision) : l'ecran ne depend plus du re-rendu serveur
  // de toute la page greffier (des dizaines de requetes), qui n'est relance qu'en arriere-plan, groupe.
  const [teams, setTeams] = useState(propTeams);
  const [referees, setReferees] = useState(propReferees);
  useEffect(() => setTeams(propTeams), [propTeams]);
  useEffect(() => setReferees(propReferees), [propReferees]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 2000);
  }
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  function askDelete(teamId: string) {
    setError("");
    startTransition(async () => {
      const res = await teamDeletionPreviewAction(teamId);
      if ("error" in res) { setError(res.error); return; }
      setDel({ id: teamId, name: res.name, counts: res.counts as unknown as Record<string, number> });
      setDelStage(1);
    });
  }

  function confirmDelete() {
    if (!del) return;
    const id = del.id;
    startTransition(async () => {
      const res = await deleteTeamAction(id);
      if ("error" in res) { setError(res.error); setDel(null); return; }
      setTeams((ts) => ts.filter((t) => t.id !== id));
      if (activeTeamId === id) setActiveTeamId(null);
      setDel(null);
      router.refresh();
    });
  }

  const assigned = new Map<string, string>(); // studentId -> teamName
  teams.forEach((t) => t.members.forEach((m) => assigned.set(m.id, t.name)));
  const approvedIds = new Set(referees.filter((r) => r.status === "APPROVED").map((r) => r.id));
  const statusOfId = new Map(referees.map((r) => [r.id, r.status]));
  const totalMembers = assigned.size;
  const filledTeams = teams.filter((t) => t.members.length > 0).length;
  const pendingCount = referees.filter((r) => r.status === "PENDING").length;

  function toggleClass(c: string) {
    const next = classes.includes(c) ? classes.filter((x) => x !== c) : [...classes, c];
    if (next.length > MAX_CLASSES) {
      setError(`Maximum ${MAX_CLASSES} classes par séance.`);
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await setSessionClassesAction(sessionId, next);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function removeMember(teamId: string, userId: string) {
    setError("");
    setTeams((ts) => ts.map((t) => (t.id === teamId ? { ...t, members: t.members.filter((m) => m.id !== userId) } : t)));
    startTransition(async () => {
      await removeTeamMemberAction(teamId, userId);
      scheduleRefresh();
    });
  }
  function removeReferee(userId: string) {
    setError("");
    setReferees((rs) => rs.filter((r) => r.id !== userId));
    startTransition(async () => {
      await removeRefereeAction(sessionId, userId);
      scheduleRefresh();
    });
  }
  function decide(userId: string, decision: "APPROVED" | "REFUSED") {
    setError("");
    setReferees((rs) => rs.map((r) => (r.id === userId ? { ...r, status: decision } : r)));
    startTransition(async () => {
      const res = await decideRefereeAction(sessionId, userId, decision);
      if ("error" in res) {
        setError(res.error);
        router.refresh();
        return;
      }
      scheduleRefresh();
    });
  }

  const active = teams.find((t) => t.id === activeTeamId) ?? null;
  const activeIndex = active ? teams.findIndex((t) => t.id === active.id) : -1;

  const statusBadge = (r: RefereeView) =>
    r.status === "PENDING" ? (
      <span className={`${ui.chip} ${ui.chipWarn} ml-2`}>en attente</span>
    ) : r.status === "REFUSED" ? (
      <span className={`${ui.chip} ${ui.chipErr} ml-2`}>refusé</span>
    ) : null;

  const counter = "text-ink-3 font-sans font-normal text-sm";

  return (
    <div className="space-y-6">
      {error && <p className={ui.alertErr}>{error}</p>}

      {/* 1. Classes participantes */}
      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h3 className={ui.h3}>1 · Classes qui participent <span className={counter}>({classes.length}/{MAX_CLASSES})</span></h3>
          <p className={ui.hint}>La saisie des noms se limite ensuite à ces classes.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allClasses.map((c) => {
            const on = classes.includes(c);
            return (
              <button
                key={c}
                onClick={() => toggleClass(c)}
                disabled={pending}
                className={cx(ui.pill, on ? ui.pillOn : ui.pillOff, "disabled:opacity-60")}
              >
                {c}
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Equipes */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h3 className={ui.h3}>2 · Équipes <span className={counter}>({totalMembers} élève{totalMembers > 1 ? "s" : ""} · {filledTeams}/{teams.length} équipes)</span></h3>
          <p className={ui.hint}>Touche une équipe pour y ajouter des élèves.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {teams.map((team) => (
            <div
              key={team.id}
              role="button"
              tabIndex={0}
              onClick={() => { setActiveTeamId(team.id); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { setActiveTeamId(team.id); setError(""); } }}
              className={cx("text-left bg-card rounded-2xl border p-3 transition shadow-card cursor-pointer", activeTeamId === team.id ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-brand/60")}
            >
              <div className="flex justify-between items-center gap-2 mb-1">
                <span className="font-display font-bold text-lg">{team.name}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={cx(ui.chip, team.members.length ? ui.chipOk : ui.chipMuted)}>
                    {team.members.length} élève{team.members.length > 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); askDelete(team.id); }}
                    disabled={pending}
                    title={`Supprimer ${team.name}`}
                    aria-label={`Supprimer ${team.name}`}
                    className="w-6 h-6 rounded-full text-ink-3 hover:bg-danger-soft hover:text-danger-ink font-bold leading-none flex items-center justify-center"
                  >
                    ✕
                  </button>
                </span>
              </div>
              {/* L'ecran est projete : l'atelier de depart doit se lire depuis le fond de la salle. */}
              {startByTeam?.[team.id]?.label && (
                <p className="flex items-baseline gap-1.5 bg-accent/30 border border-accent rounded-lg px-2 py-1 mb-1.5">
                  <span className="font-display font-extrabold text-xl text-ink tabular-nums">{startByTeam[team.id].number}</span>
                  <span className="font-bold text-base text-ink truncate">{startByTeam[team.id].label}</span>
                </p>
              )}
              {team.members.length === 0 ? (
                <p className="text-sm text-ink-3 italic">Aucun élève encodé</p>
              ) : (
                <ul className="text-base text-ink-2 space-y-0.5 leading-snug">
                  {team.members.map((m) => (
                    <li key={m.id} className="truncate">
                      <span className="text-ink font-semibold">{m.firstName} {m.lastName}{cake(m.birthday)}</span>
                      {approvedIds.has(m.id) && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>arbitre</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 3. Arbitres */}
      <section className={ui.cardPad}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className={ui.h3}>
            3 · Arbitres <span className={counter}>({approvedIds.size} autorisé{approvedIds.size > 1 ? "s" : ""}{pendingCount ? ` · ${pendingCount} en attente` : ""})</span>
          </h3>
          <button onClick={() => { setRefereeOpen(true); setError(""); }} className={btn.sea}>🏴‍☠️ Ajouter un arbitre</button>
        </div>
        <p className={`${ui.hint} mb-3`}>
          Modifiable pendant tout le WOD{phase === "run" ? " (course en cours)" : ""}. Un élève n&apos;arbitre que s&apos;il est autorisé ici (motif obligatoire) ; ses demandes arrivent aussi en popup.
          Un participant basculé arbitre (blessure, abandon) garde ses résultats d&apos;équipe.
        </p>
        {referees.length === 0 ? (
          <p className="text-sm text-ink-3 italic">Aucun arbitre encodé.</p>
        ) : (
          <ul className="divide-y divide-line border border-line rounded-xl">
            {referees.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <span className="min-w-0">
                  <span className="font-bold">{r.firstName} {r.lastName}</span> <span className="text-ink-3">· {r.className ?? "?"}</span>
                  {r.note && <span className={`${ui.chip} ${ui.chipMuted} ml-2`}>{r.note}</span>}
                  {statusBadge(r)}
                  {r.teamName && <span className="block text-[11px] text-ink-2">participait dans {r.teamName} (résultats conservés)</span>}
                </span>
                <span className="flex gap-1 flex-shrink-0">
                  {r.status !== "APPROVED" && (
                    <button onClick={() => decide(r.id, "APPROVED")} disabled={pending} className={btn.smSuccess}>Accepter</button>
                  )}
                  {r.status === "PENDING" && (
                    <button onClick={() => decide(r.id, "REFUSED")} disabled={pending} className={btn.smDanger}>Refuser</button>
                  )}
                  <button onClick={() => removeReferee(r.id)} disabled={pending} className={btn.smDanger}>Retirer</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && (
        <StudentPicker
          title={active.name}
          start={startByTeam?.[active.id] ?? null}
          classes={classes}
          picker={picker}
          onClose={() => setActiveTeamId(null)}
          nextLabel={activeIndex >= 0 && activeIndex < teams.length - 1 ? `${teams[activeIndex + 1].name} →` : null}
          onNext={() => activeIndex >= 0 && activeIndex < teams.length - 1 && setActiveTeamId(teams[activeIndex + 1].id)}
          list={active.members.map((m) => ({ ...m, tag: approvedIds.has(m.id) ? "arbitre" : null }))}
          onRemove={(id) => removeMember(active.id, id)}
          statusOf={(h) => {
            const t = assigned.get(h.id);
            if (t === active.name) return { disabled: true, label: "déjà ici" };
            if (t) return { disabled: true, label: `déjà dans ${t}` };
            return { disabled: false, label: null };
          }}
          onPick={async (h) => {
            const res = await addTeamMemberAction(active.id, h.id);
            if ("error" in res) return res.error;
            setTeams((ts) => ts.map((t) => (t.id === active.id ? { ...t, members: [...t.members.filter((m) => m.id !== res.member.id), res.member].sort(byLastName) } : t)));
            scheduleRefresh();
            return null;
          }}
        />
      )}

      {refereeOpen && (
        <StudentPicker
          title="Ajouter un arbitre"
          classes={classes}
          picker={picker}
          onClose={() => setRefereeOpen(false)}
          nextLabel={null}
          onNext={() => {}}
          list={referees.map((r) => ({ ...r, tag: r.status === "PENDING" ? `en attente · ${r.note ?? ""}` : r.status === "REFUSED" ? "refusé" : r.note }))}
          onRemove={(id) => removeReferee(id)}
          withNote
          statusOf={(h) => {
            if (approvedIds.has(h.id)) return { disabled: true, label: "déjà arbitre" };
            const st = statusOfId.get(h.id);
            const t = assigned.get(h.id);
            if (st === "PENDING") return { disabled: false, label: "en attente → accepter" };
            return { disabled: false, label: t ? `dans ${t}` : null };
          }}
          onPick={async (h, note) => {
            const res = await addRefereeAction(sessionId, h.id, note);
            if ("error" in res) return res.error;
            const added: RefereeView = { ...res.referee, teamName: assigned.get(h.id) ?? null };
            setReferees((rs) => [...rs.filter((r) => r.id !== added.id), added]);
            scheduleRefresh();
            return null;
          }}
        />
      )}

      {/* Double confirmation : on montre d'abord ce qui va disparaitre, puis on redemande. */}
      {del && (
        <div className={ui.backdrop} onClick={() => setDel(null)}>
          <div className={`${ui.sheet} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`${ui.h2} mb-1`}>Supprimer {del.name} ?</h3>
            {delStage === 1 ? (
              <>
                <p className={`${ui.hint} mb-3`}>Cette suppression est définitive. Voici ce qui part avec l&apos;équipe.</p>
                <ul className="space-y-1 mb-4">
                  {([
                    ["élèves dans l'équipe", del.counts.members],
                    ["tours validés", del.counts.laps],
                    ["cartes jaunes", del.counts.cards],
                    ["évaluations reçues", del.counts.evaluations],
                    ["tirs qui la visaient", del.counts.shots],
                    ["cases de bateaux sur sa ligne", del.counts.placements],
                  ] as [string, number][]).map(([label, n]) => (
                    <li key={label} className={`${ui.inset} px-3 py-1.5 flex justify-between text-sm`}>
                      <span className="text-ink-2">{label}</span>
                      <b className={n > 0 ? "text-danger-ink" : "text-ink-3"}>{n}</b>
                    </li>
                  ))}
                </ul>
                <p className={`${ui.hint} mb-3`}>
                  Les autres équipes gardent leur numéro. Les bateaux qui se retrouvent hors carte sont replacés automatiquement.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setDel(null)} className={btn.ghost}>Annuler</button>
                  <button onClick={() => setDelStage(2)} className={btn.danger}>Continuer</button>
                </div>
              </>
            ) : (
              <>
                <p className={`${ui.alertErr} mb-4`}>
                  Dernière vérification : <b>{del.name}</b> et tout son contenu vont être effacés. Il n&apos;y a pas de retour en arrière.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setDelStage(1)} disabled={pending} className={btn.ghost}>Revenir</button>
                  <button onClick={confirmDelete} disabled={pending} className={btn.lgDanger}>
                    {pending ? "…" : "Supprimer définitivement"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Modale de saisie intelligente : recherche (prefixe prenom/nom) restreinte aux classes choisies.
function StudentPicker({
  title, start = null, classes, picker, onClose, nextLabel, onNext, list, onRemove, statusOf, onPick, withNote,
}: {
  title: string;
  start?: { number: number; label: string } | null; // atelier de depart, annonce en grand aux eleves
  classes: string[];
  picker: PickerData;
  onClose: () => void;
  nextLabel: string | null;
  onNext: () => void;
  list: (TeamMemberView & { tag: string | null })[];
  onRemove: (id: string) => void;
  statusOf: (h: StudentHit) => { disabled: boolean; label: string | null };
  onPick: (h: StudentHit, note?: string) => Promise<string | null>;
  withNote?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string>(REFEREE_REASONS[0]);
  // Coequipiers habituels des personnes deja dans la liste, sans doublon ni personne deja presente.
  const memberKey = list.map((m) => m.id).join(",");
  const suggested = useMemo(() => {
    const seen = new Set(memberKey ? memberKey.split(",") : []);
    const out: PairHit[] = [];
    for (const id of [...seen]) for (const p of picker.pairs[id] ?? []) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
    return out;
  }, [memberKey, picker.pairs]);
  const pairOf = useMemo(() => new Map(suggested.map((p) => [p.id, p])), [suggested]);
  // Sans saisie : les coequipiers habituels. Avec saisie : le roster precharge, coequipiers en tete.
  const hits = useMemo<StudentHit[]>(() => {
    const qf = fold(query.trim());
    if (!qf) return suggested.slice(0, 6).map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, className: p.className }));
    const rank = new Map(suggested.map((p, i) => [p.id, i]));
    return picker.roster
      .filter((h) => {
        const first = fold(h.firstName);
        const last = fold(h.lastName);
        return first.startsWith(qf) || last.startsWith(qf) || `${first} ${last}`.startsWith(qf) || `${last} ${first}`.startsWith(qf);
      })
      .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || a.lastName.localeCompare(b.lastName, "fr") || a.firstName.localeCompare(b.firstName, "fr"))
      .slice(0, 12);
  }, [query, picker.roster, suggested]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [title]);

  function pick(h: StudentHit) {
    setError("");
    startTransition(async () => {
      const err = await onPick(h, withNote ? note : undefined);
      if (err) {
        setError(err);
        return;
      }
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  }

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3 gap-2">
          <h3 className="font-display font-extrabold text-3xl text-ink">{title}</h3>
          <div className="flex items-center gap-2">
            {nextLabel && <button onClick={onNext} className={btn.smSoft}>{nextLabel}</button>}
            <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
          </div>
        </div>

        {/* Ecran projete : les eleves de l'equipe lisent d'ici leur atelier de depart. */}
        {start?.label && (
          <div className="bg-accent border-2 border-accent rounded-2xl px-4 py-3 mb-4 flex items-center gap-4">
            <div className="font-display font-extrabold text-5xl text-ink tabular-nums leading-none">{start.number}</div>
            <div className="min-w-0">
              <div className="text-[11px] font-extrabold uppercase tracking-widest text-ink/70">Vous commencez à l&apos;atelier</div>
              <div className="font-display font-extrabold text-2xl text-ink leading-tight truncate">{start.label}</div>
            </div>
          </div>
        )}

        {withNote && (
          <div className="mb-3">
            <p className={ui.label}>Motif (obligatoire)</p>
            <div className="flex flex-wrap gap-1">
              {REFEREE_REASONS.map((n) => (
                <button key={n} onClick={() => setNote(n)} className={cx(ui.pill, note === n ? ui.pillOn : ui.pillOff)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* La saisie vient EN PREMIER : sur mobile, le clavier prend la moitie de l'ecran et le champ doit
            rester en haut de la feuille (recentre au focus par securite). */}
        <label className={ui.label}>Ajouter un élève</label>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
          }}
          placeholder="Prénom ou nom…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={`${ui.input} text-base py-3`}
        />
        <p className={`${ui.hint} mt-1`}>
          Recherche dans : {classes.length ? classes.join(", ") : "toutes les classes (aucune classe sélectionnée)"}, et les profs par nom de famille.
          {suggested.length > 0 && !query.trim() && <> · <b>Coéquipiers habituels</b> proposés d&apos;abord ; en <span className="text-red-700 font-bold">rouge</span>, ceux dont la dernière équipe commune a fini dans les 3 moins bons scores ou avec une auto-évaluation sous 3/5.</>}
        </p>
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
        {hits.length > 0 && (
          <ul className="mt-2 border border-line rounded-xl divide-y divide-line max-h-64 overflow-auto">
            {hits.map((h) => {
              const st = statusOf(h);
              return (
                <li key={h.id}>
                  <button
                    onClick={() => pick(h)}
                    disabled={pending || st.disabled}
                    title={pairOf.get(h.id)?.why || undefined}
                    className={cx(
                      "w-full text-left p-2 text-sm flex justify-between items-center gap-2 transition",
                      st.disabled ? "text-ink-3" : pairOf.get(h.id)?.red ? "bg-red-50 text-red-800 hover:bg-red-100" : "hover:bg-brand-soft"
                    )}
                  >
                    <span>
                      <span className="font-bold">{h.lastName}</span> {h.firstName}
                      {pairOf.get(h.id) && (
                        <span className={cx(ui.chip, "ml-2", pairOf.get(h.id)!.red ? "bg-red-600 text-white" : ui.chipBrand)}>
                          {pairOf.get(h.id)!.red ? "⚠ à l'œil" : "coéquipier habituel"} ×{pairOf.get(h.id)!.count}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-ink-3 text-right">{h.className ?? "?"}{st.label ? ` · ${st.label}` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.trim().length > 0 && hits.length === 0 && <p className={`${ui.hint} mt-2`}>Personne ne correspond dans ces classes (ni chez les profs).</p>}

        <p className={`${ui.label} mt-4`}>Déjà dans {title.startsWith("Ajouter") ? "la liste" : title} ({list.length})</p>
        <ul className="divide-y divide-line border border-line rounded-xl">
          {list.length === 0 && <li className="p-3 text-base text-ink-3 italic">Personne pour l&apos;instant.</li>}
          {list.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 p-3">
              <span className="min-w-0">
                {/* Les eleves cherchent leur nom sur l'ecran projete : il doit etre gros. */}
                <span className="font-display font-bold text-xl text-ink">{m.firstName} {m.lastName}</span>
                <span className="text-ink-3 text-sm"> · {m.className ?? "?"}</span>
                {m.tag && <span className={`${ui.chip} ${ui.chipSea} ml-2`}>{m.tag}</span>}
              </span>
              <button onClick={() => onRemove(m.id)} disabled={pending} className={btn.smDanger}>Retirer</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
