"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addRefereeAction,
  addTeamMemberAction,
  removeRefereeAction,
  removeTeamMemberAction,
  searchAllStudentsAction,
  setSessionClassesAction,
  type StudentHit,
} from "./team-actions";
import { decideRefereeAction } from "./referee-decisions";
import { MAX_CLASSES, REFEREE_REASONS } from "@/lib/session-roles";
import { btn, cx, ui } from "@/lib/ui";

export type TeamMemberView = { id: string; firstName: string; lastName: string; className: string | null };
export type TeamWithMembers = { id: string; name: string; order: number; members: TeamMemberView[] };
export type RefereeView = TeamMemberView & { note: string | null; status: string; teamName: string | null };

type Props = {
  sessionId: string;
  teams: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  phase: "pre" | "run" | "post";
};

// Preparation du WOD par le greffier : 1) classes participantes (max 5), 2) composition des equipes
// (saisie intelligente restreinte a ces classes), 3) arbitres (motif obligatoire) — modifiable pendant tout
// le WOD. Tout est persiste par identifiant permanent, jamais par nom.
export function TeamsManager({ sessionId, teams, classes, allClasses, referees, phase }: Props) {
  const router = useRouter();
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [refereeOpen, setRefereeOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

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
    startTransition(async () => {
      await removeTeamMemberAction(teamId, userId);
      router.refresh();
    });
  }
  function removeReferee(userId: string) {
    setError("");
    startTransition(async () => {
      await removeRefereeAction(sessionId, userId);
      router.refresh();
    });
  }
  function decide(userId: string, decision: "APPROVED" | "REFUSED") {
    setError("");
    startTransition(async () => {
      const res = await decideRefereeAction(sessionId, userId, decision);
      if ("error" in res) setError(res.error);
      router.refresh();
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
            <button
              key={team.id}
              onClick={() => { setActiveTeamId(team.id); setError(""); }}
              className={cx("text-left bg-card rounded-2xl border p-3 transition shadow-card", activeTeamId === team.id ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-brand/60")}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-display font-bold">{team.name}</span>
                <span className={cx(ui.chip, team.members.length ? ui.chipOk : ui.chipMuted)}>
                  {team.members.length} élève{team.members.length > 1 ? "s" : ""}
                </span>
              </div>
              {team.members.length === 0 ? (
                <p className="text-xs text-ink-3 italic">Aucun élève encodé</p>
              ) : (
                <ul className="text-xs text-ink-2 space-y-0.5">
                  {team.members.map((m) => (
                    <li key={m.id} className="truncate">
                      <span className="text-ink">{m.firstName} {m.lastName}</span> <span className="text-ink-3">· {m.className ?? "?"}</span>
                      {approvedIds.has(m.id) && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>arbitre</span>}
                    </li>
                  ))}
                </ul>
              )}
            </button>
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
          classes={classes}
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
            return "error" in res ? res.error : null;
          }}
        />
      )}

      {refereeOpen && (
        <StudentPicker
          title="Ajouter un arbitre"
          classes={classes}
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
            return "error" in res ? res.error : null;
          }}
        />
      )}
    </div>
  );
}

// Modale de saisie intelligente : recherche (prefixe prenom/nom) restreinte aux classes choisies.
function StudentPicker({
  title, classes, onClose, nextLabel, onNext, list, onRemove, statusOf, onPick, withNote,
}: {
  title: string;
  classes: string[];
  onClose: () => void;
  nextLabel: string | null;
  onNext: () => void;
  list: (TeamMemberView & { tag: string | null })[];
  onRemove: (id: string) => void;
  statusOf: (h: StudentHit) => { disabled: boolean; label: string | null };
  onPick: (h: StudentHit, note?: string) => Promise<string | null>;
  withNote?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [note, setNote] = useState<string>(REFEREE_REASONS[0]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [title]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await searchAllStudentsAction(q, classes);
      if (!cancelled) setHits(res);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, classes]);

  function pick(h: StudentHit) {
    setError("");
    startTransition(async () => {
      const err = await onPick(h, withNote ? note : undefined);
      if (err) {
        setError(err);
        return;
      }
      setQuery("");
      setHits([]);
      router.refresh();
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  }

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3 gap-2">
          <h3 className={ui.h2}>{title}</h3>
          <div className="flex items-center gap-2">
            {nextLabel && <button onClick={onNext} className={btn.smSoft}>{nextLabel}</button>}
            <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
          </div>
        </div>

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
        <p className={`${ui.hint} mt-1`}>Recherche dans : {classes.length ? classes.join(", ") : "toutes les classes (aucune classe sélectionnée)"}.</p>
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
                    className={cx("w-full text-left p-2 text-sm flex justify-between items-center gap-2 transition", st.disabled ? "text-ink-3" : "hover:bg-brand-soft")}
                  >
                    <span><span className="font-bold">{h.lastName}</span> {h.firstName}</span>
                    <span className="text-xs text-ink-3 text-right">{h.className ?? "?"}{st.label ? ` · ${st.label}` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.trim().length > 0 && hits.length === 0 && <p className={`${ui.hint} mt-2`}>Aucun élève trouvé.</p>}

        <p className={`${ui.label} mt-4`}>Déjà dans {title.startsWith("Ajouter") ? "la liste" : title}</p>
        <ul className="divide-y divide-line border border-line rounded-xl">
          {list.length === 0 && <li className="p-2 text-sm text-ink-3 italic">Personne pour l&apos;instant.</li>}
          {list.map((m) => (
            <li key={m.id} className="flex items-center justify-between p-2 text-sm">
              <span>
                <span className="font-bold">{m.firstName} {m.lastName}</span> <span className="text-ink-3">· {m.className ?? "?"}</span>
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
