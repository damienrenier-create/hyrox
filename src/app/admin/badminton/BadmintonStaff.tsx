"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { matchesSearch, setsText, STATUS_TEXT, type BmPersonRef, type BmPupilStats, type BmSet, type BmView } from "@/lib/badminton";
import { badmintonPulseAction, recordMatchAction, startLiveMatchAction, startScoutingAction } from "@/app/eleve/badminton-actions";
import { LiveBoard, MatchCard, PersonPicker, SetsEditor, ThemePanel, emptySets, resultText, setsReady, type LiveRule } from "../../_components/BadmintonParts";
import type { BmTheme } from "@/lib/badminton-themes";
import { STROKES, type ScoutConfig, type ScoutRow } from "@/lib/badminton-scout";
import { ScoutPanel, type ScoutStudentRow } from "./ScoutPanel";
import { usePulse } from "../../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { fmtElo } from "@/lib/badminton-elo";
import { TournamentPanel, type TourElsewhere, type TourEntrantRow, type TourView } from "./TournamentPanel";
import { NotedProvider, ScoutUnlockProvider, StudentName } from "../../_components/StudentName";
const NO_IDS: string[] = [];
import type { HandicapCalibration } from "@/lib/badminton-tournament";

export type BmPupilRow = { id: string; name: string; className: string | null; stats: BmPupilStats };
export type BmSelfEvalRow = { id: string; name: string; className: string | null; answers: Record<string, string> | null; grade: number | null; at: number | null };
export type BmEloRow = { id: string; name: string; className: string | null; rating: number; games: number; won: number; draws: number; lost: number; provisional: boolean };
type SeCol = { id: string; short: string; label: string };
type Tab = "matchs" | "eleves" | "autoevals" | "elo" | "tournoi" | "encoder" | "scouting";
export type BmTourProps = { entrants: TourEntrantRow[]; active: TourView | null; previous: TourView | null; elsewhere: TourElsewhere[]; candidates: { id: string; name: string; className: string | null }[]; calibrations?: Record<number, HandicapCalibration | null> };
type Filter = "all" | "LIVE" | "PENDING" | "DISPUTED" | "VALIDATED" | "CANCELLED";

// `free` : les matchs libres (03/11) ; pas d'auto-evaluations, la validation du prof rend un match officiel.
// `tour` : le tournoi par poules de la seance (09/11), absent pour les matchs libres.
export function BadmintonStaff({ sessionId, viewerId, views, rows, roster, selfEvals, seCols, elo, groupClasses, free = false, tour, liveRules = {}, noted = [], sessionTheme = null, scoutCfg = null, scoutStudents = [], scoutRows = [] }: { sessionTheme?: BmTheme | null; scoutCfg?: ScoutConfig | null; scoutStudents?: ScoutStudentRow[]; scoutRows?: ScoutRow[]; sessionId: string; viewerId: string; views: BmView[]; rows: BmPupilRow[]; roster: BmPersonRef[]; selfEvals: BmSelfEvalRow[]; seCols: SeCol[]; elo: BmEloRow[]; groupClasses: string[]; free?: boolean; tour?: BmTourProps; liveRules?: Record<string, LiveRule & { target: number }>; noted?: string[] }) {
  const pulse = useCallback(() => badmintonPulseAction(sessionId), [sessionId]);
  const [refLive, setRefLive] = useState<BmView | null>(null); // le prof reprend l'arbitrage en direct d'un match
  // Le prof lance lui-meme un match en direct (26/11 : « les profs doivent pouvoir scouter par defaut depuis leur telephone »).
  const [ownLive, setOwnLive] = useState<StaffLive | null>(null);
  const router = useRouter();
  usePulse(pulse, 10000, !refLive && !ownLive);
  const [tab, setTab] = useState<Tab>("matchs");
  const [filter, setFilter] = useState<Filter>("all");
  // Recherche (20/11) : nom, classe, score « 15-13 », statut… ; les compteurs des statuts suivent la recherche.
  const [query, setQuery] = useState("");
  const found = useMemo(() => (query.trim() ? views.filter((v) => matchesSearch(v, query)) : views), [views, query]);
  const count = (s: Filter) => found.filter((v) => v.status === s).length;
  const total = (s: Filter) => views.filter((v) => v.status === s).length; // compteurs du haut : toute la seance
  const live = views.filter((v) => v.status !== "CANCELLED").length;
  const played = rows.filter((r) => r.stats.played + r.stats.pending + r.stats.disputed > 0).length;
  const shown = filter === "all" ? found : found.filter((v) => v.status === filter);
  const tabBtn = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg transition whitespace-nowrap shrink-0 snap-start", on ? ui.segOn : ui.segOff);

  function exportCsv() {
    const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const hm = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
    const L = [["Heure", "Joueur A", "Classe A", "Score (A-B)", "Joueur B", "Classe B", "Vainqueur", "Statut", "Encodé par", "Historique"].join(";")];
    for (const v of [...views].reverse()) {
      const w = v.result ? (v.result.winner === "DRAW" ? "égalité" : v.result.winner === "A" ? v.a.name : v.b.name) : "";
      L.push([hm(v.createdAt), v.a.name, v.a.className ?? "", setsText(v.sets), v.b.name, v.b.className ?? "", w, STATUS_TEXT[v.status], `${v.createdBy.name} (${v.createdBy.role === "PLAYER" ? "joueur" : v.createdBy.role === "REFEREE" ? "arbitre" : "prof"})`, v.history.map((h) => `${hm(h.at)} ${h.text}`).join(" | ")].map((x) => q(String(x))).join(";"));
    }
    L.push("");
    const eloOf = new Map(elo.map((e) => [e.id, e]));
    L.push(["Élève", "Classe", "Matchs validés", "Victoires", "Égalités", "Défaites", "Sets +", "Sets -", "Points +", "Points -", "À signer", "Contestés", "Arbitrés", "ELO"].join(";"));
    for (const r of rows) { const s = r.stats; const e = eloOf.get(r.id); L.push([r.name, r.className ?? "", s.played, s.won, s.draws, s.lost, s.setsFor, s.setsAgainst, s.pointsFor, s.pointsAgainst, s.pending, s.disputed, s.refereed, e ? fmtElo(e.rating) : ""].map((x) => q(String(x))).join(";")); }
    L.push("");
    L.push(["Auto-évaluation", "Classe", ...seCols.map((c) => c.label), "Note /5"].join(";"));
    for (const r of selfEvals) L.push([r.name, r.className ?? "", ...seCols.map((c) => r.answers?.[c.id] ?? ""), r.grade === null ? "" : r.grade.toFixed(1).replace(".", ",")].map((x) => q(String(x))).join(";"));
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

  // Scouting du prof (26/11) : toujours, sans deverrouillage (hors matchs libres), toutes les couches.
  const profScout = !free && scoutCfg ? { court: scoutCfg.court, level: 4 } : null;
  return (
    <NotedProvider ids={noted}>
    {/* Scouting verrouille par defaut (26/11) : le nom d un eleve permet de le deverrouiller pour ce cours. */}
    <ScoutUnlockProvider sessionId={!free && scoutCfg ? sessionId : null} on={!!scoutCfg?.on} unlocked={!free && scoutCfg ? scoutCfg.unlocked : NO_IDS}>
    <div className="space-y-4">
      {refLive && <LiveBoard key={refLive.id} matchId={refLive.id} aName={refLive.a.name} bName={refLive.b.name} initialSets={refLive.sets} initialTarget={liveRules[refLive.id]?.target} rule={liveRules[refLive.id]} theme={refLive.theme} scout={profScout} onClose={() => setRefLive(null)} />}
      {ownLive && <LiveBoard key={ownLive.id} matchId={ownLive.id} aName={ownLive.aName} bName={ownLive.bName} initialSets={ownLive.sets} initialTarget={ownLive.target} rule={ownLive.rule} theme={ownLive.theme} scout={profScout} scouting={!!ownLive.scouting} onClose={() => { setOwnLive(null); router.refresh(); }} />}
      {!free && <ThemePanel sessionId={sessionId} current={sessionTheme} />}
      {!free && scoutCfg && <ScoutPanel sessionId={sessionId} config={scoutCfg} students={scoutStudents} />}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Kpi label="Matchs encodés" value={live} />
        <Kpi label="Validés" value={total("VALIDATED")} tone="ok" />
        <Kpi label="À signer" value={total("PENDING")} tone={total("PENDING") ? "warn" : undefined} />
        <Kpi label="Contestés" value={total("DISPUTED")} tone={total("DISPUTED") ? "err" : undefined} />
        {free ? <Kpi label="Officiels (au classement)" value={views.filter((v) => v.official).length} tone="ok" /> : <Kpi label="Élèves ayant joué" value={`${played}/${rows.length}`} />}
      </div>
      {/* Onglets en CARROUSEL sur telephone (Sartay 26/11 : « je dois decaler l'affichage de toute la page, pas du tout ok ») :
          la barre defile seule, horizontalement, sans elargir la page. */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className={cx(ui.segmented, "flex-nowrap")}>
          <button type="button" onClick={() => setTab("matchs")} className={tabBtn(tab === "matchs")}>Matchs</button>
          <button type="button" onClick={() => setTab("eleves")} className={tabBtn(tab === "eleves")}>Élèves</button>
          {!free && <button type="button" onClick={() => setTab("autoevals")} className={tabBtn(tab === "autoevals")}>Auto-évaluations · {selfEvals.filter((r) => r.answers).length}</button>}
          <button type="button" onClick={() => setTab("elo")} className={tabBtn(tab === "elo")}>Classement ELO</button>
          {!free && <button type="button" onClick={() => setTab("scouting")} className={tabBtn(tab === "scouting")}>🔭 Scouting</button>}
          {tour && <button type="button" onClick={() => setTab("tournoi")} className={tabBtn(tab === "tournoi")}>🏆 Tournoi{tour.active ? " · en cours" : ""}</button>}
          <button type="button" onClick={() => setTab("encoder")} className={tabBtn(tab === "encoder")}>＋ Encoder un match</button>
        </div>
        </div>
        <button type="button" onClick={exportCsv} className={cx(btn.smGhost, "shrink-0")}>⬇ Excel</button>
      </div>

      {tab === "matchs" && (
        <section className="space-y-2">
          <div className="relative">
            <input type="text" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 Rechercher : nom, classe, score (15-13), « à signer »…" aria-label="Rechercher un match" className={cx(ui.input, "pr-10")} autoComplete="off" />
            {query && <button type="button" onClick={() => setQuery("")} className={cx(ui.close, "absolute right-1.5 top-1/2 -translate-y-1/2")} aria-label="Effacer la recherche">✕</button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "LIVE", "PENDING", "DISPUTED", "VALIDATED", "CANCELLED"] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cx(ui.chip, filter === f ? ui.chipBrand : ui.chipMuted, "py-1")}>{f === "all" ? `Tous · ${found.length}` : `${STATUS_TEXT[f]} · ${count(f)}`}</button>
            ))}
          </div>
          {shown.length === 0 ? <p className={`${ui.cardPad} ${ui.muted}`}>Aucun match{query.trim() ? " ne correspond à cette recherche" : filter === "all" ? " encodé pour l'instant" : " dans cette catégorie"}.</p> : (
            <div className="grid gap-2 lg:grid-cols-2">{shown.map((v) => <MatchCard key={v.id} v={v} viewerId={viewerId} staff onReferee={setRefLive} />)}</div>
          )}
        </section>
      )}

      {tab === "eleves" && <PupilsTable rows={rows} />}

      {tab === "autoevals" && <SelfEvalTable rows={selfEvals} cols={seCols} />}

      {tab === "elo" && <EloTable rows={elo} groupClasses={groupClasses} />}

      {tab === "scouting" && <ScoutTable rows={rows} scout={scoutRows} />}

      {tab === "tournoi" && tour && <TournamentPanel sessionId={sessionId} entrants={tour.entrants} active={tour.active} previous={tour.previous} elsewhere={tour.elsewhere} candidates={tour.candidates} calibrations={tour.calibrations} />}

      {tab === "encoder" && <StaffEntry sessionId={sessionId} roster={roster} free={free} onDone={() => setTab("matchs")} onLive={setOwnLive} />}
    </div>
    </ScoutUnlockProvider>
    </NotedProvider>
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
                  <td className="p-2 font-bold"><StudentName id={r.id} name={r.name} /></td>
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

// Auto-evaluations de la seance (grille badminton) : code par critere, note /5 calculee comme au carnet (forme hors note).
function SelfEvalTable({ rows, cols }: { rows: BmSelfEvalRow[]; cols: SeCol[] }) {
  const done = rows.filter((r) => r.answers).length;
  const color = (code: string | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";
  const hm = (ms: number) => new Date(ms).toLocaleString("fr-BE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return (
    <section className={`${ui.cardPad} space-y-2`}>
      <p className={ui.hint}>{done} auto-évaluation{done > 1 ? "s" : ""} rendue{done > 1 ? "s" : ""} sur {rows.length} élève{rows.length > 1 ? "s" : ""}. Note /5 comme au carnet (« Forme du jour » hors note).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className={ui.th}>Élève</th><th className={ui.th}>Classe</th>
              {cols.map((c) => <th key={c.id} className={`${ui.th} text-center`} title={c.label}>{c.short}</th>)}
              <th className={`${ui.th} text-right`}>Note /5</th><th className={ui.th}>Envoyée</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cx("border-t border-line", !r.answers && "text-ink-3")}>
                <td className="p-2 font-bold"><StudentName id={r.id} name={r.name} /></td>
                <td className="p-2">{r.className ?? ""}</td>
                {cols.map((c) => <td key={c.id} className={cx("p-2 text-center font-black", color(r.answers?.[c.id]))}>{r.answers?.[c.id] ?? "—"}</td>)}
                <td className="p-2 text-right tabular-nums font-bold">{r.grade === null ? "" : r.grade.toFixed(1).replace(".", ",")}</td>
                <td className="p-2 text-xs whitespace-nowrap">{r.at ? hm(r.at) : "pas encore"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Classement ELO (regles : src/lib/badminton-elo.ts) : le groupe de la seance par defaut, ou toutes les classes.
function EloTable({ rows, groupClasses }: { rows: BmEloRow[]; groupClasses: string[] }) {
  const [all, setAll] = useState(groupClasses.length === 0);
  const list = all ? rows : rows.filter((r) => r.className && groupClasses.includes(r.className));
  return (
    <section className={`${ui.cardPad} space-y-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={ui.segmented}>
          {groupClasses.length > 0 && <button type="button" onClick={() => setAll(false)} className={cx("text-sm font-bold px-3 py-1.5 rounded-lg", !all ? ui.segOn : ui.segOff)}>{groupClasses.join(" + ")}</button>}
          <button type="button" onClick={() => setAll(true)} className={cx("text-sm font-bold px-3 py-1.5 rounded-lg", all ? ui.segOn : ui.segOff)}>Toutes classes · {rows.length}</button>
        </div>
        <span className={ui.hint}>Départ à 1000 · un match de cours compte s&apos;il n&apos;est ni contesté, ni annulé (signé ou pas) ; un match libre, une fois officiel · provisoire avant 5 matchs</span>
      </div>
      {list.length === 0 ? <p className={ui.muted}>Aucun match qui compte pour l&apos;instant.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className={`${ui.th} text-right`}>#</th><th className={ui.th}>Élève</th><th className={ui.th}>Classe</th><th className={`${ui.th} text-right`}>ELO</th><th className={`${ui.th} text-right`}>Matchs</th><th className={`${ui.th} text-right`}>V</th><th className={`${ui.th} text-right`}>N</th><th className={`${ui.th} text-right`}>D</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-2 text-right tabular-nums text-ink-3">{i + 1}</td>
                  <td className="p-2 font-bold"><StudentName id={r.id} name={r.name} />{r.provisional && <span className={cx(ui.chip, ui.chipMuted, "ml-1.5 text-[10px]")}>provisoire</span>}{r.className && <Link href={`/admin/eleves/${r.id}#badminton`} className="ml-1.5 text-xs font-normal text-ink-3 hover:text-brand" title="Progression ELO, meilleures et moins bonnes perfs">📈</Link>}</td>
                  <td className="p-2">{r.className ?? ""}</td>
                  <td className="p-2 text-right tabular-nums font-display font-extrabold">{fmtElo(r.rating)}</td>
                  <td className="p-2 text-right tabular-nums">{r.games}</td>
                  <td className="p-2 text-right tabular-nums">{r.won}</td>
                  <td className="p-2 text-right tabular-nums">{r.draws}</td>
                  <td className="p-2 text-right tabular-nums">{r.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type StaffLive = { id: string; aName: string; bName: string; sets: BmSet[]; target?: number; rule?: LiveRule; theme?: BmTheme | null; scouting?: boolean };
function StaffEntry({ sessionId, roster, free, onDone, onLive }: { sessionId: string; roster: BmPersonRef[]; free: boolean; onDone: () => void; onLive: (x: StaffLive) => void }) {
  const router = useRouter();
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [sets, setSets] = useState<BmSet[]>(emptySets);
  const [error, setError] = useState("");
  const [twin, setTwin] = useState<string | null>(null);
  const [twinLive, setTwinLive] = useState(false); // le doublon signale concernait « Arbitrer en direct »
  const [pending, start] = useTransition();
  const first = (id: string | null) => roster.find((p) => p.id === id)?.name ?? "";
  const ready = !!a && !!b && setsReady(sets);
  // Arbitrer en direct (26/11) : le tableau +1 / −1 et, hors matchs libres, le terrain du scouting (toutes les couches).
  function live(force = false) {
    setError("");
    start(async () => {
      const res = await startLiveMatchAction(sessionId, { playerAId: a ?? "", playerBId: b ?? "", force });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setTwin(res.duplicate.text); setTwinLive(true); return; }
      if (res.matchId) { onLive({ id: res.matchId, aName: first(a), bName: first(b), sets: res.sets ?? [[0, 0]], target: res.target, rule: res.rule, theme: res.theme }); setA(null); setB(null); setTwin(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  }
  // Scouter sans arbitrer (26/11 : « le scouting n'est pas l'arbitrage ») : une observation, score indicatif.
  function scoutOnly() {
    setError("");
    start(async () => {
      const res = await startScoutingAction(sessionId, { playerAId: a ?? "", playerBId: b ?? "" });
      if ("error" in res) { setError(res.error); return; }
      if ("matchId" in res && res.matchId) { onLive({ id: res.matchId, aName: first(a), bName: first(b), sets: res.sets ?? [[0, 0]], scouting: true }); setA(null); setB(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  }
  function save(force = false) {
    setError("");
    start(async () => {
      const res = await recordMatchAction(sessionId, { playerAId: a, playerBId: b ?? "", sets, force });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setTwin(res.duplicate.text); setTwinLive(false); return; }
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
      <button type="button" disabled={pending || !a || !b} onClick={() => live(false)} className={cx(btn.lgPrimary, "w-full")}>🎯 Arbitrer en direct</button>
      {!free && <button type="button" disabled={pending || !a || !b} onClick={scoutOnly} className={cx(btn.ghost, "w-full")}>🔭 Scouter seulement (score indicatif, ne compte pas)</button>}
      <p className={ui.hint}>{free ? "" : "Avec le terrain du scouting : à chaque fin d'échange, touchez où le volant est tombé. "}… ou, si le match est déjà joué, son score final :</p>
      <SetsEditor sets={sets} onChange={setSets} left={first(a) || "Joueur 1"} right={first(b) || "Joueur 2"} />
      {setsReady(sets) && a && b && <p className={ui.hint}>{resultText(sets, first(a), first(b))}</p>}
      {twin && (
        <div className={`${ui.alertWarn} space-y-2`}>
          <p>{twin}</p>
          <button type="button" disabled={pending} onClick={() => (twinLive ? live(true) : save(true))} className={btn.smGhost}>C&apos;est un autre match (une revanche) : {twinLive ? "l'arbitrer quand même" : "l'encoder quand même"}</button>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || !ready} onClick={() => save(false)} className={btn.primary}>{pending ? "Enregistrement…" : "Enregistrer le match"}</button>
    </section>
  );
}

// Scouting de la seance (24/11, Sartay : « il faudra qu'on puisse analyser les stats de scouting ») : par eleve, ses
// echanges notes, ses points gagnes et perdus, ses fautes ; le niveau moyen de chaque coup sur les fiches recues ; ce
// qu'il a scoute lui-meme. Le detail (carte du terrain, criteres) est sur sa fiche (📈).
function ScoutTable({ rows, scout }: { rows: BmPupilRow[]; scout: ScoutRow[] }) {
  const by = new Map(scout.map((s) => [s.id, s]));
  const levelColor = (code: string | null | undefined) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";
  const any = scout.some((s) => s.rallies || s.sheets || s.gaveRallies || s.gaveSheets);
  return (
    <section className={`${ui.cardPad} space-y-2`}>
      {!any ? <p className={ui.muted}>Pas encore de scouting dans cette séance : activez les impacts dans « 🔭 Scouting » (en haut), et les élèves peuvent remplir des fiches techniques depuis leur page (« Scouter un joueur »).</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className={ui.th}>Élève</th><th className={`${ui.th} text-right`} title="Échanges notés par un arbitre dans ses matchs">Échanges</th><th className={`${ui.th} text-right`}>Gagnés</th><th className={`${ui.th} text-right`}>Perdus</th><th className={`${ui.th} text-right`} title="Points GAGNÉS par lui : le volant tombe dans le terrain adverse">✅</th><th className={`${ui.th} text-right`} title="Points concédés : service raté">🏸</th><th className={`${ui.th} text-right`} title="Points concédés : dans le filet">🕸️</th><th className={`${ui.th} text-right`} title="Points concédés : dehors (hors du terrain adverse)">↗️</th><th className={`${ui.th} text-right`} title="Points concédés : raté (tapé à côté)">💨</th>
                {STROKES.map((s) => <th key={s.id} className={`${ui.th} text-center`} title={`${s.name} : niveau moyen sur les fiches reçues`}>{s.emoji}</th>)}
                <th className={`${ui.th} text-right`} title="Fiches techniques reçues">Fiches</th><th className={`${ui.th} text-right`} title="Ce qu'il a scouté : impacts notés comme arbitre · fiches remplies">A scouté</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = by.get(r.id);
                if (!s) return null;
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="p-1.5 font-bold whitespace-nowrap"><StudentName id={r.id} name={r.name} /> <span className="text-ink-3 text-xs font-normal">{r.className}</span> <Link href={`/admin/eleves/${r.id}#badminton`} className="text-xs font-normal text-ink-3 hover:text-brand" title="Sa fiche : carte du terrain, critères">📈</Link></td>
                    <td className="p-1.5 text-right tabular-nums">{s.rallies || ""}</td>
                    <td className="p-1.5 text-right tabular-nums text-success-ink">{s.rallies ? s.won : ""}</td>
                    <td className="p-1.5 text-right tabular-nums text-danger-ink">{s.rallies ? s.lost : ""}</td>
                    <td className="p-1.5 text-right tabular-nums text-success-ink">{s.winners || ""}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.serve || ""}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.net || ""}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.out || ""}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.miss || ""}</td>
                    {STROKES.map((st) => <td key={st.id} className={cx("p-1.5 text-center font-display font-extrabold", levelColor(s.levels[st.id]))}>{s.levels[st.id] ?? ""}</td>)}
                    <td className="p-1.5 text-right tabular-nums">{s.sheets || ""}</td>
                    <td className="p-1.5 text-right tabular-nums text-ink-2">{s.gaveRallies || s.gaveSheets ? `${s.gaveRallies} · ${s.gaveSheets}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={ui.hint}>Échanges : notés par un arbitre ou un scout dans ses matchs de cette séance. ✅ points qu&apos;il a gagnés (le volant tombe chez l&apos;adversaire) ; points qu&apos;il a concédés : 🏸 service raté · 🕸️ filet · ↗️ dehors · 💨 raté (tapé à côté). Coups : niveau moyen sur les fiches des scouts (0 critère = TI … 4 = TB, ❤️ = E). « A scouté » : impacts qu&apos;il a notés comme arbitre · fiches qu&apos;il a remplies.</p>
    </section>
  );
}
