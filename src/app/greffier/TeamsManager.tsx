"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTeamMemberAction, removeTeamMemberAction, searchAllStudentsAction, type StudentHit } from "./team-actions";

export type TeamMemberView = { id: string; firstName: string; lastName: string; className: string | null };
export type TeamWithMembers = { id: string; name: string; order: number; members: TeamMemberView[] };

// Onglet "Equipes" du greffier : composition des equipes par identifiant permanent (jamais par nom).
// Un eleve ne peut appartenir qu'a une seule equipe par seance (verifie cote serveur).
export function TeamsManager({ teams }: { teams: TeamWithMembers[] }) {
  const router = useRouter();
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const assigned = new Set(teams.flatMap((t) => t.members.map((m) => m.id)));
  const totalMembers = assigned.size;

  useEffect(() => {
    if (!activeTeamId) return;
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await searchAllStudentsAction(q);
      if (!cancelled) setHits(res);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, activeTeamId]);

  function openTeam(teamId: string) {
    setActiveTeamId(teamId);
    setQuery("");
    setHits([]);
    setError("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function add(student: StudentHit) {
    if (!activeTeamId) return;
    setError("");
    startTransition(async () => {
      const res = await addTeamMemberAction(activeTeamId, student.id);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setQuery("");
      setHits([]);
      router.refresh();
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  }

  function remove(teamId: string, userId: string) {
    setError("");
    startTransition(async () => {
      await removeTeamMemberAction(teamId, userId);
      router.refresh();
    });
  }

  const active = teams.find((t) => t.id === activeTeamId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-600">
          <span className="font-black text-slate-900">{totalMembers}</span> élève(s) réparti(s) dans {teams.filter((t) => t.members.length > 0).length}/{teams.length} équipes.
          Touche une équipe pour ajouter des élèves.
        </p>
        {error && <p className="text-red-600 text-sm font-bold">{error}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {teams.map((team) => (
          <button
            key={team.id}
            onClick={() => openTeam(team.id)}
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
                  </li>
                ))}
              </ul>
            )}
          </button>
        ))}
      </div>

      {active && (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setActiveTeamId(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-black text-lg">{active.name}</h3>
              <button onClick={() => setActiveTeamId(null)} className="text-slate-400 font-bold">✕</button>
            </div>

            <ul className="mb-4 divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {active.members.length === 0 && <li className="p-2 text-sm text-slate-400 italic">Aucun élève pour l'instant.</li>}
              {active.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between p-2 text-sm">
                  <span>
                    <span className="font-bold">{m.firstName} {m.lastName}</span> <span className="text-slate-400">· {m.className ?? "?"}</span>
                  </span>
                  <button onClick={() => remove(active.id, m.id)} disabled={pending} className="text-red-600 text-xs font-bold px-2 py-1 rounded bg-red-50 disabled:opacity-50">
                    Retirer
                  </button>
                </li>
              ))}
            </ul>

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
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            {hits.length > 0 && (
              <ul className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-auto">
                {hits.map((h) => {
                  const taken = assigned.has(h.id);
                  return (
                    <li key={h.id}>
                      <button
                        onClick={() => add(h)}
                        disabled={pending || taken}
                        className={`w-full text-left p-2 text-sm flex justify-between items-center ${taken ? "text-slate-400" : "hover:bg-slate-50"}`}
                      >
                        <span>
                          <span className="font-bold">{h.lastName}</span> {h.firstName}
                        </span>
                        <span className="text-xs text-slate-400">{h.className ?? "?"}{taken ? " · déjà placé" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {query.trim().length > 0 && hits.length === 0 && <p className="text-xs text-slate-400 mt-2">Aucun élève trouvé.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
