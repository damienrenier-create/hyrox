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
      <span className="ml-2 text-[10px] font-bold text-amber-900 bg-amber-200 px-1.5 py-0.5 rounded">en attente</span>
    ) : r.status === "REFUSED" ? (
      <span className="ml-2 text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">refusé</span>
    ) : null;

  return (
    <div className="space-y-6">
      {error && <p className="text-red-600 text-sm font-bold">{error}</p>}

      {/* 1. Classes participantes */}
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h3 className="font-black">1 · Classes qui participent <span className="text-slate-400 font-normal text-sm">({classes.length}/{MAX_CLASSES})</span></h3>
          <p className="text-xs text-slate-500">La saisie des noms se limite ensuite à ces classes.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allClasses.map((c) => {
            const on = classes.includes(c);
            return (
              <button
                key={c}
                onClick={() => toggleClass(c)}
                disabled={pending}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-full border-2 transition-colors ${on ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-slate-500"} disabled:opacity-60`}
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
          <h3 className="font-black">2 · Équipes <span className="text-slate-400 font-normal text-sm">({totalMembers} élève{totalMembers > 1 ? "s" : ""} · {filledTeams}/{teams.length} équipes)</span></h3>
          <p className="text-xs text-slate-500">Touche une équipe pour y ajouter des élèves.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => { setActiveTeamId(team.id); setError(""); }}
              className={`text-left bg-white rounded-xl border-2 p-3 transition-colors ${activeTeamId === team.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"}`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-black">{team.name}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${team.members.length ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                  {team.members.length} élève{team.members.length > 1 ? "s" : ""}
                </span>
              </div>
              {team.members.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Aucun élève encodé</p>
              ) : (
                <ul className="text-xs text-slate-700 space-y-0.5">
                  {team.members.map((m) => (
                    <li key={m.id} className="truncate">
                      {m.firstName} {m.lastName} <span className="text-slate-400">· {m.className ?? "?"}</span>
                      {approvedIds.has(m.id) && <span className="ml-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-1 rounded">arbitre</span>}
                    </li>
                  ))}
                </ul>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* 3. Arbitres */}
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-black">
            3 · Arbitres <span className="text-slate-400 font-normal text-sm">({approvedIds.size} autorisé{approvedIds.size > 1 ? "s" : ""}{pendingCount ? ` · ${pendingCount} en attente` : ""})</span>
          </h3>
          <button onClick={() => { setRefereeOpen(true); setError(""); }} className="bg-[#062230] text-amber-300 text-sm font-black px-3 py-2 rounded-lg">+ Ajouter un arbitre</button>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Modifiable pendant tout le WOD{phase === "run" ? " (course en cours)" : ""}. Un élève n'arbitre que s'il est autorisé ici (motif obligatoire) ; ses demandes arrivent aussi en popup.
          Un participant basculé arbitre (blessure, abandon) garde ses résultats d'équipe.
        </p>
        {referees.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Aucun arbitre encodé.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {referees.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <span className="min-w-0">
                  <span className="font-bold">{r.firstName} {r.lastName}</span> <span className="text-slate-400">· {r.className ?? "?"}</span>
                  {r.note && <span className="ml-2 text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{r.note}</span>}
                  {statusBadge(r)}
                  {r.teamName && <span className="block text-[11px] text-slate-500">participait dans {r.teamName} (résultats conservés)</span>}
                </span>
                <span className="flex gap-1 flex-shrink-0">
                  {r.status !== "APPROVED" && (
                    <button onClick={() => decide(r.id, "APPROVED")} disabled={pending} className="text-emerald-800 text-xs font-bold px-2 py-1 rounded bg-emerald-100 disabled:opacity-50">Accepter</button>
                  )}
                  {r.status === "PENDING" && (
                    <button onClick={() => decide(r.id, "REFUSED")} disabled={pending} className="text-red-700 text-xs font-bold px-2 py-1 rounded bg-red-100 disabled:opacity-50">Refuser</button>
                  )}
                  <button onClick={() => removeReferee(r.id)} disabled={pending} className="text-red-600 text-xs font-bold px-2 py-1 rounded bg-red-50 disabled:opacity-50">Retirer</button>
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
    <div className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3 gap-2">
          <h3 className="font-black text-lg">{title}</h3>
          <div className="flex items-center gap-2">
            {nextLabel && <button onClick={onNext} className="text-xs font-bold bg-slate-100 px-2 py-1 rounded">{nextLabel}</button>}
            <button onClick={onClose} className="text-slate-400 font-bold">✕</button>
          </div>
        </div>

        <ul className="mb-4 divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {list.length === 0 && <li className="p-2 text-sm text-slate-400 italic">Personne pour l'instant.</li>}
          {list.map((m) => (
            <li key={m.id} className="flex items-center justify-between p-2 text-sm">
              <span>
                <span className="font-bold">{m.firstName} {m.lastName}</span> <span className="text-slate-400">· {m.className ?? "?"}</span>
                {m.tag && <span className="ml-2 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{m.tag}</span>}
              </span>
              <button onClick={() => onRemove(m.id)} disabled={pending} className="text-red-600 text-xs font-bold px-2 py-1 rounded bg-red-50 disabled:opacity-50">Retirer</button>
            </li>
          ))}
        </ul>

        {withNote && (
          <div className="mb-2">
            <p className="text-xs font-bold text-slate-600 mb-1">Motif (obligatoire)</p>
            <div className="flex flex-wrap gap-1">
              {REFEREE_REASONS.map((n) => (
                <button key={n} onClick={() => setNote(n)} className={`text-xs font-bold px-2.5 py-1.5 rounded-full border-2 ${note === n ? "bg-slate-900 border-slate-900 text-white" : "border-slate-200 text-slate-500"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block text-sm font-bold mb-1">Ajouter un élève</label>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Prénom ou nom…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full border-2 border-slate-300 focus:border-slate-900 rounded-lg p-3 text-base outline-none"
        />
        <p className="text-[11px] text-slate-400 mt-1">Recherche dans : {classes.length ? classes.join(", ") : "toutes les classes (aucune classe sélectionnée)"}.</p>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        {hits.length > 0 && (
          <ul className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-auto">
            {hits.map((h) => {
              const st = statusOf(h);
              return (
                <li key={h.id}>
                  <button
                    onClick={() => pick(h)}
                    disabled={pending || st.disabled}
                    className={`w-full text-left p-2 text-sm flex justify-between items-center gap-2 ${st.disabled ? "text-slate-400" : "hover:bg-slate-50"}`}
                  >
                    <span><span className="font-bold">{h.lastName}</span> {h.firstName}</span>
                    <span className="text-xs text-slate-400 text-right">{h.className ?? "?"}{st.label ? ` · ${st.label}` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.trim().length > 0 && hits.length === 0 && <p className="text-xs text-slate-400 mt-2">Aucun élève trouvé.</p>}
      </div>
    </div>
  );
}
