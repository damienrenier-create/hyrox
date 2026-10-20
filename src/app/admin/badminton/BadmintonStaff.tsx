"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setsText, STATUS_TEXT, type BmPersonRef, type BmPupilStats, type BmSet, type BmView } from "@/lib/badminton";
import { badmintonPulseAction, recordMatchAction } from "@/app/eleve/badminton-actions";
import { MatchCard, PersonPicker, SetsEditor, emptySets, resultText, setsReady } from "../../_components/BadmintonParts";
import { usePulse } from "../../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";

export type BmPupilRow = { id: string; name: string; className: string | null; stats: BmPupilStats };
type Tab = "matchs" | "eleves" | "encoder";
type Filter = "all" | "PENDING" | "DISPUTED" | "VALIDATED" | "CANCELLED";

export function BadmintonStaff({ sessionId, viewerId, views, rows, roster }: { sessionId: string; viewerId: string; views: BmView[]; rows: BmPupilRow[]; roster: BmPersonRef[] }) {
  const pulse = useCallback(() => badmintonPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 10000, true);
  const [tab, setTab] = useState<Tab>("matchs");
  const [filter, setFilter] = useState<Filter>("all");
  const count = (s: Filter) => views.filter((v) => v.status === s).length;
  const live = views.filter((v) => v.status !== "CANCELLED").length;
  const played = rows.filter((r) => r.stats.played + r.stats.pending + r.stats.disputed > 0).length;
  const shown = filter === "all" ? views : views.filter((v) => v.status === filter);
  const tabBtn = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg transition", on ? ui.segOn : ui.segOff);

  function exportCsv() {
    const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const hm = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
    const L = [["Heure", "Joueur A", "Classe A", "Score (A-B)", "Joueur B", "Classe B", "Vainqueur", "Statut", "Encodé par", "Historique"].join(";")];
    for (const v of [...views].reverse()) {
      const w = v.result ? (v.result.winner === "DRAW" ? "égalité" : v.result.winner === "A" ? v.a.name : v.b.name) : "";
      L.push([hm(v.createdAt), v.a.name, v.a.className ?? "", setsText(v.sets), v.b.name, v.b.className ?? "", w, STATUS_TEXT[v.status], `${v.createdBy.name} (${v.createdBy.role === "PLAYER" ? "joueur" : v.createdBy.role === "REFEREE" ? "arbitre" : "prof"})`, v.history.map((h) => `${hm(h.at)} ${h.text}`).join(" | ")].map((x) => q(String(x))).join(";"));
    }
    L.push("");
    L.push(["Élève", "Classe", "Matchs validés", "Victoires", "Égalités", "Défaites", "Sets +", "Sets -", "Points +", "Points -", "À signer", "Contestés", "Arbitrés"].join(";"));
    for (const r of rows) { const s = r.stats; L.push([r.name, r.className ?? "", s.played, s.won, s.draws, s.lost, s.setsFor, s.setsAgainst, s.pointsFor, s.pointsAgainst, s.pending, s.disputed, s.refereed].map((x) => q(String(x))).join(";")); }
    const blob = new Blob(["﻿" + L.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `badminton_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Kpi label="Matchs encodés" value={live} />
        <Kpi label="Validés" value={count("VALIDATED")} tone="ok" />
        <Kpi label="À signer" value={count("PENDING")} tone={count("PENDING") ? "warn" : undefined} />
        <Kpi label="Contestés" value={count("DISPUTED")} tone={count("DISPUTED") ? "err" : undefined} />
        <Kpi label="Élèves ayant joué" value={`${played}/${rows.length}`} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={ui.segmented}>
          <button type="button" onClick={() => setTab("matchs")} className={tabBtn(tab === "matchs")}>Matchs</button>
          <button type="button" onClick={() => setTab("eleves")} className={tabBtn(tab === "eleves")}>Élèves</button>
          <button type="button" onClick={() => setTab("encoder")} className={tabBtn(tab === "encoder")}>＋ Encoder un match</button>
        </div>
        <button type="button" onClick={exportCsv} className={btn.smGhost}>⬇ Excel</button>
      </div>

      {tab === "matchs" && (
        <section className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "PENDING", "DISPUTED", "VALIDATED", "CANCELLED"] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cx(ui.chip, filter === f ? ui.chipBrand : ui.chipMuted, "py-1")}>{f === "all" ? `Tous · ${views.length}` : `${STATUS_TEXT[f]} · ${count(f)}`}</button>
            ))}
          </div>
          {shown.length === 0 ? <p className={`${ui.cardPad} ${ui.muted}`}>Aucun match{filter === "all" ? " encodé pour l'instant" : " dans cette catégorie"}.</p> : (
            <div className="grid gap-2 lg:grid-cols-2">{shown.map((v) => <MatchCard key={v.id} v={v} viewerId={viewerId} staff />)}</div>
          )}
        </section>
      )}

      {tab === "eleves" && <PupilsTable rows={rows} />}

      {tab === "encoder" && <StaffEntry sessionId={sessionId} roster={roster} onDone={() => setTab("matchs")} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "warn" | "err" }) {
  return (
    <div className={cx(ui.cardPad, "py-2")}>
      <div className={cx("font-display text-2xl font-extrabold tabular-nums", tone === "ok" && "text-success-ink", tone === "warn" && "text-accent-ink", tone === "err" && "text-danger-ink")}>{value}</div>
      <div className={ui.hint}>{label}</div>
    </div>
  );
}

function PupilsTable({ rows }: { rows: BmPupilRow[] }) {
  const [onlyNone, setOnlyNone] = useState(false);
  const list = useMemo(() => (onlyNone ? rows.filter((r) => r.stats.played + r.stats.pending + r.stats.disputed === 0) : rows), [rows, onlyNone]);
  return (
    <section className={`${ui.cardPad} space-y-2`}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className={ui.check} checked={onlyNone} onChange={(e) => setOnlyNone(e.target.checked)} /> Seulement les élèves sans aucun match</label>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className={ui.th}>Élève</th><th className={ui.th}>Classe</th><th className={`${ui.th} text-right`}>Validés</th><th className={`${ui.th} text-right`}>V</th><th className={`${ui.th} text-right`}>N</th><th className={`${ui.th} text-right`}>D</th><th className={`${ui.th} text-right`}>Sets</th><th className={`${ui.th} text-right`}>Points</th><th className={`${ui.th} text-right`}>À signer</th><th className={`${ui.th} text-right`}>Contestés</th><th className={`${ui.th} text-right`}>Arbitrés</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const s = r.stats;
              const none = s.played + s.pending + s.disputed === 0;
              return (
                <tr key={r.id} className={cx("border-t border-line", none && "text-ink-3")}>
                  <td className="p-2 font-bold">{r.name}</td>
                  <td className="p-2">{r.className ?? ""}</td>
                  <td className="p-2 text-right tabular-nums">{s.played}</td>
                  <td className="p-2 text-right tabular-nums">{s.won}</td>
                  <td className="p-2 text-right tabular-nums">{s.draws}</td>
                  <td className="p-2 text-right tabular-nums">{s.lost}</td>
                  <td className="p-2 text-right tabular-nums">{s.played ? `${s.setsFor}-${s.setsAgainst}` : ""}</td>
                  <td className="p-2 text-right tabular-nums">{s.played ? `${s.pointsFor}-${s.pointsAgainst}` : ""}</td>
                  <td className={cx("p-2 text-right tabular-nums", s.pending > 0 && "text-accent-ink font-bold")}>{s.pending || ""}</td>
                  <td className={cx("p-2 text-right tabular-nums", s.disputed > 0 && "text-danger-ink font-bold")}>{s.disputed || ""}</td>
                  <td className="p-2 text-right tabular-nums">{s.refereed || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={ui.hint}>Seuls les matchs validés comptent dans les victoires, sets et points. « À signer » : l&apos;adversaire n&apos;a pas encore signé ; « Contestés » : un joueur dit ne pas avoir joué ce match.</p>
    </section>
  );
}

function StaffEntry({ sessionId, roster, onDone }: { sessionId: string; roster: BmPersonRef[]; onDone: () => void }) {
  const router = useRouter();
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [sets, setSets] = useState<BmSet[]>(emptySets);
  const [error, setError] = useState("");
  const [twin, setTwin] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = (id: string | null) => roster.find((p) => p.id === id)?.name ?? "";
  const ready = !!a && !!b && setsReady(sets);
  function save(force = false) {
    setError("");
    start(async () => {
      const res = await recordMatchAction(sessionId, { playerAId: a, playerBId: b ?? "", sets, force });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setTwin(res.duplicate.text); return; }
      setA(null); setB(null); setSets(emptySets()); setTwin(null);
      router.refresh();
      onDone();
    });
  }
  return (
    <section className={`${ui.cardPad} space-y-4 max-w-xl`}>
      <p className={ui.hint}>Un score encodé par un prof est validé tout de suite ; les joueurs le voient dans leur liste.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <PersonPicker people={roster} value={a} onChange={setA} exclude={b ? [b] : []} label="Joueur 1" placeholder="Tape un nom" />
        <PersonPicker people={roster} value={b} onChange={setB} exclude={a ? [a] : []} label="Joueur 2" placeholder="Tape un nom" />
      </div>
      <SetsEditor sets={sets} onChange={setSets} left={first(a) || "Joueur 1"} right={first(b) || "Joueur 2"} />
      {setsReady(sets) && a && b && <p className={ui.hint}>{resultText(sets, first(a), first(b))}</p>}
      {twin && (
        <div className={`${ui.alertWarn} space-y-2`}>
          <p>{twin}</p>
          <button type="button" disabled={pending} onClick={() => save(true)} className={btn.smGhost}>C&apos;est un autre match : l&apos;encoder quand même</button>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || !ready} onClick={() => save(false)} className={btn.primary}>{pending ? "Enregistrement…" : "Enregistrer le match"}</button>
    </section>
  );
}
