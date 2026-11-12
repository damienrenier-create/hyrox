"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TOUR_CAPS, TOUR_ELO_PER_POINT, TOUR_KINDS, TOUR_POINTS, TOUR_POOL_COUNTS, TOUR_POOL_SIZES, bracketSize, handicapOf, makePlayers, pairKey, readTourSettings, seedOrder, type Bracket, type BracketPairing, type TourKind, type TourPairing, type TourPlayer, type TourPool, type TourSettings } from "@/lib/badminton-tournament";
import { addLatePlayerAction, closeTournamentAction, createTournamentAction, moveTournamentAction, setPlayerGoneAction, setTournamentRuleAction } from "@/app/eleve/badminton-actions";
import { btn, cx, ui } from "@/lib/ui";

// Tournois de badminton, cote prof (Sartay 09/11) : choisir le format (poules de niveau, grand tableau, championnat a
// handicap), les participants (coches d'office : ceux qui ont deja joue ou arbitre dans la seance) et les reglages, voir
// le tournoi avant de lancer ; puis le suivre et le clore. Regles : src/lib/badminton-tournament.ts.

export type TourEntrantRow = { id: string; name: string; className: string | null; elo: number; present: boolean };
export type TourView = { id: string; kind: TourKind; label: string; format: string; pools: TourPool[] | null; bracket: Bracket | null; names: Record<string, { name: string; className: string | null }>; gone: string[]; settings: TourSettings; players: TourPlayer[] };
export type TourElsewhere = { id: string; label: string; players: number; when: string };

export type TourCandidate = { id: string; name: string; className: string | null };
export function TournamentPanel({ sessionId, entrants, active, previous, elsewhere, candidates }: { sessionId: string; entrants: TourEntrantRow[]; active: TourView | null; previous: TourView | null; elsewhere: TourElsewhere[]; candidates: TourCandidate[] }) {
  if (active) return <TournamentBoard t={active} candidates={candidates} />;
  return (
    <div className="space-y-4">
      {elsewhere.length > 0 && <Elsewhere sessionId={sessionId} list={elsewhere} />}
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

// Tournois pas encore clos, lances a un cours precedent avec ces eleves : on peut les continuer ici.
function Elsewhere({ sessionId, list }: { sessionId: string; list: TourElsewhere[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <section className={`${ui.cardPad} space-y-2 border-accent`}>
      <h3 className={ui.h3}>Tournoi en cours d&apos;un cours précédent</h3>
      {list.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span><b>{t.label}</b> · {t.players} participants · lancé {t.when}</span>
          <button type="button" disabled={pending} onClick={() => start(async () => { const r = await moveTournamentAction(t.id, sessionId); if ("error" in r) setError(r.error); else router.refresh(); })} className={btn.smPrimary}>Continuer ici</button>
        </div>
      ))}
      {error && <p className={ui.alertErr}>{error}</p>}
    </section>
  );
}

function NewTournament({ sessionId, entrants }: { sessionId: string; entrants: TourEntrantRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<TourKind>("POOLS");
  // Toute la classe par defaut (Sartay 10/11 : « je decoche ceux qui n'y participent pas, ou qui arbitrent, et pas le contraire »).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entrants.map((e) => e.id)));
  const [poolSizes, setPoolSizes] = useState<Record<TourKind, number>>({ POOLS: 4, BRACKET: 0, HANDICAP: 0 });
  // Nombre de poules (12/11) : s'il est choisi, il remplace « joueurs par poule » (0 = pas choisi).
  const [poolCounts, setPoolCounts] = useState<Record<TourKind, number>>({ POOLS: 0, BRACKET: 0, HANDICAP: 0 });
  const [sets, setSets] = useState<1 | 2 | 3>(1);
  const [points, setPoints] = useState(15);
  const [eloPerPoint, setEloPerPoint] = useState(20);
  // Fin du set (12/11) : par defaut le premier a l'objectif gagne ; option 2 points d'ecart, plafond facultatif.
  const [deuce, setDeuce] = useState(false);
  const [cap, setCap] = useState(0);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const poolSize = poolSizes[kind];
  const poolCount = poolCounts[kind];
  const settings = readTourSettings({ sets, points, poolSize, poolCount, eloPerPoint, deuce, cap }, kind);
  const byId = useMemo(() => new Map(entrants.map((e) => [e.id, e])), [entrants]);
  const chosen = entrants.filter((e) => selected.has(e.id)).map((e) => ({ id: e.id, elo: e.elo }));
  const preview = makePlayers(kind, chosen, settings);
  const poolNames = [...new Set(preview.map((p) => p.pool))];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const seg = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg whitespace-nowrap", on ? ui.segOn : ui.segOff);
  const nm = (id: string | undefined) => (id ? byId.get(id)?.name ?? "?" : "");
  function launch() {
    setError("");
    start(async () => {
      const res = await createTournamentAction(sessionId, { kind, playerIds: [...selected], poolSize, poolCount, sets: settings.sets, points, eloPerPoint, deuce, cap: settings.cap });
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
    });
  }
  const size = bracketSize(Math.max(2, chosen.length));
  return (
    <section className={`${ui.cardPad} space-y-4`}>
      <h3 className={ui.h3}>🏆 Nouveau tournoi</h3>
      <div className={cx(ui.segmented, "flex-wrap")}>
        {TOUR_KINDS.map((k) => <button key={k.id} type="button" onClick={() => setKind(k.id)} className={seg(kind === k.id)}>{k.name}</button>)}
      </div>
      <p className={ui.hint}>
        {kind === "POOLS" && "Poules par niveau (A = les meilleurs ELO) : chacun contre chacun dans sa poule, ronde par ronde."}
        {kind === "BRACKET" && "Tableau à têtes de série (selon l'ELO) : à chaque tour, les gagnants jouent les places du haut, les perdants celles du bas. Chacun joue tous les tours : classement final de 1 à N."}
        {kind === "HANDICAP" && "Chacun contre chacun ; le moins bien classé commence chaque set avec des points d'avance pour rendre les matchs serrés. À l'ELO, ces matchs comptent comme entre deux joueurs de même niveau."}
      </p>
      {/* Reglages : ils passent a la ligne au lieu de se chevaucher (12/11 : « l onglet pour regler le nombre de sets se chevauche »). */}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {kind !== "BRACKET" && (
          <div>
            <span className={ui.label}>Joueurs par poule</span>
            <div className={ui.segmented}>{TOUR_POOL_SIZES.map((n) => <button key={n} type="button" onClick={() => { setPoolSizes((s) => ({ ...s, [kind]: n })); setPoolCounts((s) => ({ ...s, [kind]: 0 })); }} className={seg(!poolCount && poolSize === n)}>{n || "Tous"}</button>)}</div>
          </div>
        )}
        {kind !== "BRACKET" && (
          <div>
            <span className={ui.label}>… ou nombre de poules</span>
            <div className={ui.segmented}>{TOUR_POOL_COUNTS.map((n) => <button key={n} type="button" onClick={() => setPoolCounts((s) => ({ ...s, [kind]: s[kind] === n ? 0 : n }))} className={seg(poolCount === n)}>{n}</button>)}</div>
          </div>
        )}
        <div>
          <span className={ui.label}>Sets par match</span>
          <div className={ui.segmented}>
            <button type="button" onClick={() => setSets(1)} className={seg(settings.sets === 1)}>1 set</button>
            {kind !== "BRACKET" && <button type="button" onClick={() => setSets(2)} className={seg(settings.sets === 2)}>2 sets</button>}
            <button type="button" onClick={() => setSets(3)} className={seg(settings.sets === 3)}>Au meilleur des 3</button>
          </div>
        </div>
        <div>
          <span className={ui.label}>Points par set</span>
          <div className={ui.segmented}>{TOUR_POINTS.map((n) => <button key={n} type="button" onClick={() => setPoints(n)} className={seg(points === n)}>{n}</button>)}</div>
        </div>
        <div>
          <span className={ui.label}>Fin du set</span>
          <div className={ui.segmented}>
            <button type="button" onClick={() => setDeuce(false)} className={seg(!deuce)}>Premier à {points}</button>
            <button type="button" onClick={() => setDeuce(true)} className={seg(deuce)}>2 points d&apos;écart</button>
          </div>
          {deuce && (
            <select value={settings.cap} onChange={(e) => setCap(Number(e.target.value))} className={`${ui.input} mt-1`} aria-label="Plafond">
              <option value={0}>sans plafond</option>
              {TOUR_CAPS.filter((c) => c > points).map((c) => <option key={c} value={c}>max {c}</option>)}
            </select>
          )}
        </div>
        {kind === "HANDICAP" && (
          <div>
            <span className={ui.label}>1 point d&apos;avance pour … d&apos;ELO d&apos;écart</span>
            <select value={eloPerPoint} onChange={(e) => setEloPerPoint(Number(e.target.value))} className={ui.input}>
              {TOUR_ELO_PER_POINT.map((n) => <option key={n} value={n}>{n}{n === 20 ? " (d'après les 515 matchs joués)" : ""}</option>)}
            </select>
            <span className={ui.hint}>Pour un set de 15 (proportionnel en 11 ou 21) ; au plus la moitié du set.</span>
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className={ui.label}>Participants · {selected.size} coché{selected.size > 1 ? "s" : ""} sur {entrants.length} · décochez les absents et ceux qui arbitrent</span>
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

      {preview.length > 1 && kind !== "BRACKET" && (
        <div>
          <span className={ui.label}>Aperçu : {poolNames.length} poule{poolNames.length > 1 ? "s" : ""}{poolNames.length > 1 ? " (A = les meilleurs ELO)" : ""}</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {poolNames.map((n) => {
              const members = preview.filter((p) => p.pool === n);
              const top = members[0];
              return (
                <div key={n} className="rounded-xl border border-line p-2 text-sm">
                  <p className="font-display font-extrabold mb-1">Poule {n} · {members.length} joueurs, {members.length - 1 + (members.length % 2)} rondes</p>
                  {members.map((p) => (
                    <p key={p.studentId} className="flex justify-between gap-2">
                      <span className="truncate">{nm(p.studentId)}</span>
                      <span className="tabular-nums text-ink-3">{p.elo}{kind === "HANDICAP" && p !== top ? ` · +${handicapOf(top.elo, p.elo, settings)[1]} contre ${nm(top.studentId).split(" ")[0]}` : ""}</span>
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {preview.length > 1 && kind === "BRACKET" && (
        <div>
          <span className={ui.label}>Aperçu : tableau de {size} places, {Math.log2(size)} tours, {size - preview.length} exempt{size - preview.length > 1 ? "s" : ""} (pour les meilleures têtes de série)</span>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            {seedOrder(size).reduce<[number, number][]>((acc, s, i, arr) => (i % 2 ? acc : [...acc, [s, arr[i + 1]]]), []).map(([x, y], i) => {
              const px = preview.find((p) => p.seed === x);
              const py = preview.find((p) => p.seed === y);
              return <p key={i} className="rounded-lg bg-paper px-2 py-1"><span className="text-ink-3 tabular-nums">{x}.</span> {nm(px?.studentId)} – {py ? <><span className="text-ink-3 tabular-nums">{y}.</span> {nm(py.studentId)}</> : <span className="text-ink-3">exempt</span>}</p>;
            })}
          </div>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || selected.size < 2} onClick={launch} className={btn.primary}>{pending ? "Lancement…" : "🏆 Lancer le tournoi"}</button>
      <p className={ui.hint}>Chaque élève voit son prochain adversaire sur son téléphone. Les élèves encodent leurs matchs comme d&apos;habitude (ou un arbitre) ; ils comptent aussi au classement ELO.</p>
    </section>
  );
}

function TournamentBoard({ t, closed = false, candidates = [] }: { t: TourView; closed?: boolean; candidates?: TourCandidate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [lateId, setLateId] = useState("");
  function addLate() {
    if (!lateId) return;
    setError("");
    start(async () => {
      const res = await addLatePlayerAction(t.id, lateId);
      if ("error" in res) setError(res.error);
      else { setLateId(""); router.refresh(); }
    });
  }
  const [goneId, setGoneId] = useState("");
  // Score final (12/11) : regle par defaut du tournoi, objectif d'une poule ou d'un match.
  function setRule(patch: Parameters<typeof setTournamentRuleAction>[1]) {
    setError("");
    start(async () => {
      const res = await setTournamentRuleAction(t.id, patch);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  function setGone(id: string, gone: boolean) {
    if (!id) return;
    if (gone && !confirm(`${t.names[id]?.name ?? "Ce joueur"} quitte le tournoi ? Ses matchs pas encore joués sortent de l'ordre ; ses matchs joués restent. Vous pourrez le remettre s'il revient.`)) return;
    setError("");
    start(async () => {
      const res = await setPlayerGoneAction(t.id, id, gone);
      if ("error" in res) setError(res.error);
      else { setGoneId(""); router.refresh(); }
    });
  }
  function close() {
    if (!confirm("Clore le tournoi ? Il restera consultable et ses matchs restent comptés ; vous pourrez en lancer un autre.")) return;
    setError("");
    start(async () => {
      const res = await closeTournamentAction(t.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  const pools = t.pools ?? [];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={ui.h3}>🏆 {t.label}</h3>
          <p className={ui.hint}>
            {t.format}
            {t.bracket ? ` · tableau de ${t.bracket.size} places · ${t.bracket.done ? "terminé" : "en cours"}` : ` · ${pools.filter((p) => p.done).length}/${pools.length} poule${pools.length > 1 ? "s" : ""} terminée${pools.length > 1 ? "s" : ""}`}
          </p>
        </div>
        {!closed && <button type="button" disabled={pending} onClick={close} className={btn.smGhost}>Clore le tournoi</button>}
      </div>
      {!closed && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">🎯 Score final :</span>
            <select value={t.settings.points} disabled={pending} onChange={(e) => setRule({ points: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Score final par défaut">
              {TOUR_POINTS.map((n) => <option key={n} value={n}>{n} points</option>)}
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" className={ui.check} checked={t.settings.deuce} disabled={pending} onChange={(e) => setRule({ deuce: e.target.checked })} /> 2 points d&apos;écart</label>
            {t.settings.deuce && (
              <select value={t.settings.cap} disabled={pending} onChange={(e) => setRule({ cap: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Plafond du tournoi">
                <option value={0}>sans plafond</option>
                {TOUR_CAPS.filter((c) => c > t.settings.points).map((c) => <option key={c} value={c}>max {c}</option>)}
              </select>
            )}
          </div>
          <p className={ui.hint}>Pour tous les matchs du tournoi ; une poule ou un match peut avoir son propre score (menus « pts » ci-dessous). Les matchs déjà joués ne changent pas.</p>
        </div>
      )}
      {!closed && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm">🚪 Joueur parti :</span>
            <select value={goneId} onChange={(e) => setGoneId(e.target.value)} className={`${ui.input} w-auto`} aria-label="Joueur parti">
              <option value="">Choisir un joueur…</option>
              {Object.entries(t.names).filter(([id]) => !t.gone.includes(id)).sort((a, b) => a[1].name.localeCompare(b[1].name, "fr")).map(([id, n]) => <option key={id} value={id}>{n.name}{n.className ? ` (${n.className})` : ""}</option>)}
            </select>
            <button type="button" disabled={pending || !goneId} onClick={() => setGone(goneId, true)} className={btn.smGhost}>Retirer du tournoi</button>
          </div>
          {t.gone.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className={ui.hint}>Partis :</span>
              {t.gone.map((id) => <span key={id} className={cx(ui.chip, ui.chipMuted)}>{t.names[id]?.name ?? "?"} <button type="button" disabled={pending} onClick={() => setGone(id, false)} className="underline ml-1">↩ remettre</button></span>)}
            </div>
          )}
          <p className={ui.hint}>Pour un élève qui doit partir avant la fin (blessé, rendez-vous…) : ses matchs pas encore joués sortent de l&apos;ordre, plus personne ne l&apos;attend{t.bracket ? " (au tableau, son adversaire passe)" : ""}. Rien n&apos;est effacé.</p>
        </div>
      )}
      {!closed && candidates.length > 0 && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm">＋ Retardataire :</span>
            <select value={lateId} onChange={(e) => setLateId(e.target.value)} className={`${ui.input} w-auto`} aria-label="Retardataire">
              <option value="">Choisir un élève…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.className ? ` (${c.className})` : ""}</option>)}
            </select>
            <button type="button" disabled={pending || !lateId} onClick={addLate} className={btn.smPrimary}>Ajouter au tournoi</button>
          </div>
          <p className={ui.hint}>{t.bracket ? "Il prend la dernière tête de série, à la place d'un exempt (possible tant que le joueur qu'il affronte n'a pas encore joué)." : "Il rejoint la poule la plus proche de son ELO et joue des matchs de rattrapage contre chacun, quand ils sont libres ; les rondes des autres ne changent pas."}</p>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      {t.bracket ? <BracketBoard b={t.bracket} names={t.names} t={t} onRule={closed ? undefined : setRule} /> : <PoolsBoard pools={pools} names={t.names} t={t} onRule={closed ? undefined : setRule} />}
    </section>
  );
}

const tagOf = (status: string) => (status === "gone" ? "🚪 parti" : status === "played" ? "✅" : status === "live" ? "🔴 en direct" : status === "disputed" ? "⚠️ contesté" : status === "tie" ? "⚖️ égalité : à départager" : status === "wait" ? "" : "⏳");

// Objectif d'un match a part : menu « pts » (valeur vide = celui de la poule ou du tournoi).
type OnRule = (patch: Parameters<typeof setTournamentRuleAction>[1]) => void;
function MatchPoints({ t, a, b, onRule }: { t: TourView; a: string; b: string; onRule?: OnRule }) {
  const own = t.settings.matchPoints[pairKey(a, b)];
  const pool = t.players.find((p) => p.studentId === a)?.pool;
  const base = (pool && t.settings.poolPoints[pool]) || t.settings.points;
  if (!onRule) return own ? <span className="text-xs text-accent-ink"> · {own} pts</span> : null;
  return (
    <select value={own ?? ""} onChange={(e) => onRule({ match: { a, b, points: e.target.value ? Number(e.target.value) : null } })} className={cx("ml-1 text-xs rounded border px-1 py-0", own ? "border-accent text-accent-ink font-bold" : "border-line text-ink-3")} aria-label="Score final de ce match">
      <option value="">{base} pts</option>
      {TOUR_POINTS.filter((n) => n !== base).map((n) => <option key={n} value={n}>{n} pts</option>)}
    </select>
  );
}

function PoolsBoard({ pools, names, t, onRule }: { pools: TourPool[]; names: TourView["names"]; t: TourView; onRule?: OnRule }) {
  const nm = (id: string | null) => (id ? names[id]?.name ?? "?" : "");
  const editable = (p: TourPairing) => !!p.b && p.status !== "played" && p.status !== "bye" && p.status !== "gone";
  const line = (p: TourPairing) => {
    if (p.status === "bye") return <><b>{nm(p.a)}</b> <span className="text-ink-3">· repos</span></>;
    const score = p.sets ? p.sets.map(([x, y]) => `${x}-${y}`).join(" ") : "–";
    const h = p.handicap && (p.handicap[0] || p.handicap[1]) ? <span className="text-xs text-accent-ink"> (+{p.handicap[0] || p.handicap[1]} pour {nm(p.handicap[0] ? p.a : p.b).split(" ")[0]})</span> : null;
    return <><span className={cx(p.winner === "A" && "font-bold")}>{nm(p.a)}</span> <span className="tabular-nums font-bold">{score}</span> <span className={cx(p.winner === "B" && "font-bold")}>{nm(p.b)}</span>{h} <span className="text-xs">{tagOf(p.status)}</span>{p.b && <MatchPoints t={t} a={p.a} b={p.b} onRule={editable(p) ? onRule : undefined} />}</>;
  };
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {pools.map((p) => (
          <div key={p.name} className={`${ui.cardPad} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-lg font-extrabold">{pools.length > 1 ? `Poule ${p.name}` : "Tous les joueurs"}
                {onRule ? (
                  <select value={t.settings.poolPoints[p.name] ?? ""} onChange={(e) => onRule({ pool: { name: p.name, points: e.target.value ? Number(e.target.value) : null } })} className={cx("ml-2 text-xs font-sans font-normal rounded border px-1 py-0.5 align-middle", t.settings.poolPoints[p.name] ? "border-accent text-accent-ink font-bold" : "border-line text-ink-3")} aria-label={`Score final de la poule ${p.name}`}>
                    <option value="">{t.settings.points} pts (tournoi)</option>
                    {TOUR_POINTS.filter((n) => n !== t.settings.points).map((n) => <option key={n} value={n}>{n} pts</option>)}
                  </select>
                ) : t.settings.poolPoints[p.name] ? <span className="ml-2 text-xs font-sans text-accent-ink">{t.settings.poolPoints[p.name]} pts</span> : null}
              </p>
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
                    <td className={cx("p-1.5 font-bold", s.gone && "text-ink-3")}>{nm(s.id)}{s.gone && <span className={cx(ui.chip, ui.chipMuted, "ml-1 text-[10px]")}>parti</span>} <span className="text-ink-3 text-xs font-normal">{names[s.id]?.className} · {s.elo}</span></td>
                    <td className="p-1.5 text-right tabular-nums font-bold">{String(s.score).replace(".", ",")}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.won}-{s.drawn}-{s.lost}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.setsFor}-{s.setsAgainst}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.pointsFor}-{s.pointsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.catchUp.length > 0 && (
              <div className="rounded-lg px-2 py-1 bg-sky-50 border border-sky-200 text-sm">
                <span className="text-xs font-bold text-ink-2">Rattrapages (arrivé en retard, à jouer quand les deux sont libres)</span>
                {p.catchUp.map((x, i) => <p key={i}>{line(x)}</p>)}
              </div>
            )}
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
    </>
  );
}

function BracketBoard({ b, names, t, onRule }: { b: Bracket; names: TourView["names"]; t: TourView; onRule?: OnRule }) {
  const nm = (id: string | null | undefined) => (id ? names[id]?.name ?? "?" : id === null ? "exempt" : "…");
  const line = (p: BracketPairing) => {
    const score = p.sets ? p.sets.map(([x, y]) => `${x}-${y}`).join(" ") : "–";
    if (p.status === "bye") return <span className="text-ink-3">{p.a === null && p.b === null ? "—" : <><b className="text-ink">{nm(p.a ?? p.b)}</b> passe (exempt)</>}</span>;
    return <><span className={cx(p.winner === "A" && "font-bold", p.a === undefined && "text-ink-3")}>{nm(p.a)}</span> <span className="tabular-nums font-bold">{p.status === "wait" ? "" : score}</span> <span className={cx(p.winner === "B" && "font-bold", p.b === undefined && "text-ink-3")}>{nm(p.b)}</span> <span className="text-xs">{tagOf(p.status)}</span>{p.a && p.b && <MatchPoints t={t} a={p.a} b={p.b} onRule={p.status === "todo" || p.status === "live" || p.status === "disputed" || p.status === "tie" ? onRule : undefined} />}</>;
  };
  return (
    <div className="space-y-3">
      <div className={`${ui.cardPad}`}>
        <p className="font-display text-lg font-extrabold mb-2">{b.done ? "Classement final" : "Classement (places encore en jeu)"}</p>
        <ol className="grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {b.ranks.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="truncate"><span className="tabular-nums text-ink-3">{r.rank ?? (r.lo === r.hi ? r.lo : `${r.lo}-${r.hi}`)}.</span> <b>{nm(r.id)}</b> <span className="text-ink-3 text-xs">{names[r.id]?.className} · tête de série {r.seed}</span></span>
              <span className="tabular-nums text-xs text-ink-2 whitespace-nowrap">{r.won}/{r.played} gagnés</span>
            </li>
          ))}
        </ol>
      </div>
      {b.rounds.map((r) => (
        <div key={r.n} className={`${ui.cardPad} space-y-2`}>
          <p className="font-display font-extrabold">Tour {r.n}/{b.rounds.length}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {r.groups.filter((g) => g.pairings.some((p) => p.status !== "bye" || p.a || p.b)).map((g) => (
              <div key={g.lo} className="rounded-lg bg-paper px-2 py-1 text-sm">
                <span className="text-xs font-bold text-ink-2">Places {g.lo} à {g.hi}</span>
                {g.pairings.map((p, i) => <p key={i}>{line(p)}</p>)}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className={ui.hint}>Les places du classement comptent les places vides (exempts) du tableau ; le classement final, lui, va de 1 au nombre de joueurs.</p>
    </div>
  );
}
