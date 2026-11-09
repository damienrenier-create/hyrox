"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makePools, TOUR_POINTS, TOUR_POOL_SIZES, type TourPairing, type TourPool } from "@/lib/badminton-tournament";
import { closeTournamentAction, createTournamentAction } from "@/app/eleve/badminton-actions";
import { btn, cx, ui } from "@/lib/ui";

// Tournoi par poules, cote prof (Sartay 09/11) : choisir les participants (cochés d'office : ceux qui ont deja joue ou
// arbitre dans la seance), regler la taille des poules et le format, voir les poules avant de lancer ; puis suivre chaque
// poule (classement, rondes, rencontres) et clore le tournoi. Regles : src/lib/badminton-tournament.ts.

export type TourEntrantRow = { id: string; name: string; className: string | null; elo: number; present: boolean };
export type TourView = { id: string; label: string; format: string; pools: TourPool[]; names: Record<string, { name: string; className: string | null }> };

export function TournamentPanel({ sessionId, entrants, active, previous }: { sessionId: string; entrants: TourEntrantRow[]; active: TourView | null; previous: TourView | null }) {
  if (active) return <TournamentBoard t={active} />;
  return (
    <div className="space-y-4">
      <NewTournament sessionId={sessionId} entrants={entrants} />
      {previous && (
        <details className={`${ui.cardPad}`}>
          <summary className="cursor-pointer font-bold">Dernier tournoi clos : {previous.label}</summary>
          <div className="mt-3"><TournamentBoard t={previous} closed /></div>
        </details>
      )}
    </div>
  );
}

function NewTournament({ sessionId, entrants }: { sessionId: string; entrants: TourEntrantRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entrants.filter((e) => e.present).map((e) => e.id)));
  const [poolSize, setPoolSize] = useState(4);
  const [sets, setSets] = useState<1 | 2 | 3>(1);
  const [points, setPoints] = useState(15);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(entrants.map((e) => [e.id, e])), [entrants]);
  const preview = useMemo(() => makePools(entrants.filter((e) => selected.has(e.id)).map((e) => ({ id: e.id, elo: e.elo })), poolSize), [entrants, selected, poolSize]);
  const poolNames = [...new Set(preview.map((p) => p.pool))];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const seg = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg", on ? ui.segOn : ui.segOff);
  function launch() {
    setError("");
    start(async () => {
      const res = await createTournamentAction(sessionId, { playerIds: [...selected], poolSize, sets, points });
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
    });
  }
  return (
    <section className={`${ui.cardPad} space-y-4`}>
      <h3 className={ui.h3}>🏆 Nouveau tournoi par poules de niveau</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <span className={ui.label}>Joueurs par poule</span>
          <div className={ui.segmented}>{TOUR_POOL_SIZES.map((n) => <button key={n} type="button" onClick={() => setPoolSize(n)} className={seg(poolSize === n)}>{n}</button>)}</div>
        </div>
        <div>
          <span className={ui.label}>Sets par match</span>
          <div className={ui.segmented}>
            <button type="button" onClick={() => setSets(1)} className={seg(sets === 1)}>1 set</button>
            <button type="button" onClick={() => setSets(2)} className={seg(sets === 2)}>2 sets</button>
            <button type="button" onClick={() => setSets(3)} className={seg(sets === 3)}>Au meilleur des 3</button>
          </div>
        </div>
        <div>
          <span className={ui.label}>Points par set</span>
          <div className={ui.segmented}>{TOUR_POINTS.map((n) => <button key={n} type="button" onClick={() => setPoints(n)} className={seg(points === n)}>{n}</button>)}</div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className={ui.label}>Participants · {selected.size} coché{selected.size > 1 ? "s" : ""}</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSelected(new Set(entrants.filter((e) => e.present).map((e) => e.id)))} className={btn.smGhost}>Ceux qui ont joué aujourd&apos;hui</button>
            <button type="button" onClick={() => setSelected(new Set(entrants.map((e) => e.id)))} className={btn.smGhost}>Tout cocher</button>
            <button type="button" onClick={() => setSelected(new Set())} className={btn.smGhost}>Tout décocher</button>
          </div>
        </div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 max-h-80 overflow-auto rounded-xl border border-line p-2">
          {entrants.map((e) => (
            <label key={e.id} className={cx("flex items-center gap-2 rounded-lg px-2 py-1 text-sm cursor-pointer", selected.has(e.id) ? "bg-brand-soft" : "hover:bg-paper")}>
              <input type="checkbox" className={ui.check} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="flex-1 min-w-0 truncate">{e.name} <span className="text-ink-3 text-xs">{e.className}</span></span>
              <span className="tabular-nums text-xs text-ink-2">{e.elo}</span>
            </label>
          ))}
        </div>
      </div>

      {preview.length > 0 && (
        <div>
          <span className={ui.label}>Aperçu : {poolNames.length} poule{poolNames.length > 1 ? "s" : ""} (A = les meilleurs ELO)</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {poolNames.map((n) => (
              <div key={n} className="rounded-xl border border-line p-2 text-sm">
                <p className="font-display font-extrabold mb-1">Poule {n}</p>
                {preview.filter((p) => p.pool === n).map((p) => <p key={p.studentId} className="flex justify-between gap-2"><span className="truncate">{byId.get(p.studentId)?.name}</span><span className="tabular-nums text-ink-3">{p.elo}</span></p>)}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || selected.size < 2} onClick={launch} className={btn.primary}>{pending ? "Lancement…" : "🏆 Lancer le tournoi"}</button>
      <p className={ui.hint}>Chacun joue contre chacun dans sa poule, ronde par ronde : chaque élève voit son adversaire sur son téléphone, puis le suivant quand toute sa poule a fini la ronde. Les élèves encodent leurs matchs comme d&apos;habitude (ou un arbitre) ; ils comptent aussi au classement ELO.</p>
    </section>
  );
}

function TournamentBoard({ t, closed = false }: { t: TourView; closed?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const nm = (id: string | null) => (id ? t.names[id]?.name ?? "?" : "");
  const line = (p: TourPairing) => {
    if (p.status === "bye") return <><b>{nm(p.a)}</b> <span className="text-ink-3">· repos</span></>;
    const score = p.sets ? p.sets.map(([x, y]) => `${x}-${y}`).join(" ") : "–";
    const tag = p.status === "played" ? "✅" : p.status === "live" ? "🔴 en direct" : p.status === "disputed" ? "⚠️ contesté" : "⏳";
    return <><span className={cx(p.winner === "A" && "font-bold")}>{nm(p.a)}</span> <span className="tabular-nums font-bold">{score}</span> <span className={cx(p.winner === "B" && "font-bold")}>{nm(p.b)}</span> <span className="text-xs">{tag}</span></>;
  };
  function close() {
    if (!confirm("Clore le tournoi ? Il restera consultable et ses matchs restent comptés ; vous pourrez en lancer un autre.")) return;
    setError("");
    start(async () => {
      const res = await closeTournamentAction(t.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={ui.h3}>🏆 {t.label}</h3>
          <p className={ui.hint}>{t.format} · {t.pools.filter((p) => p.done).length}/{t.pools.length} poule{t.pools.length > 1 ? "s" : ""} terminée{t.pools.length > 1 ? "s" : ""}</p>
        </div>
        {!closed && <button type="button" disabled={pending} onClick={close} className={btn.smGhost}>Clore le tournoi</button>}
      </div>
      {error && <p className={ui.alertErr}>{error}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {t.pools.map((p) => (
          <div key={p.name} className={`${ui.cardPad} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-lg font-extrabold">Poule {p.name}</p>
              <span className={cx(ui.chip, p.done ? ui.chipOk : ui.chipWarn)}>{p.done ? "terminée" : `ronde ${p.current}/${p.rounds.length}`}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left"><th className={ui.th}>#</th><th className={ui.th}>Élève</th><th className={`${ui.th} text-right`}>Pts</th><th className={`${ui.th} text-right`}>V-N-D</th><th className={`${ui.th} text-right`}>Sets</th><th className={`${ui.th} text-right`}>Points</th></tr>
              </thead>
              <tbody>
                {p.standings.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="p-1.5 tabular-nums text-ink-3">{s.rank}</td>
                    <td className="p-1.5 font-bold">{nm(s.id)} <span className="text-ink-3 text-xs font-normal">{t.names[s.id]?.className} · {s.elo}</span></td>
                    <td className="p-1.5 text-right tabular-nums font-bold">{String(s.score).replace(".", ",")}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.won}-{s.drawn}-{s.lost}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.setsFor}-{s.setsAgainst}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.pointsFor}-{s.pointsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ol className="space-y-1.5 text-sm">
              {p.rounds.map((r) => (
                <li key={r.n} className={cx("rounded-lg px-2 py-1", r.n === p.current ? "bg-accent-soft/50 border border-accent/40" : "bg-paper")}>
                  <span className="text-xs font-bold text-ink-2">Ronde {r.n}</span>
                  {r.pairings.map((x, i) => <p key={i}>{line(x)}</p>)}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className={ui.hint}>Classement de poule : victoires (égalité = ½), puis différence de sets, puis différence de points, puis ELO de départ.</p>
    </section>
  );
}
