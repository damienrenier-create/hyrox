"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fold } from "@/lib/staff-names";
import { BM_MAX_SETS, checkSets, resultOf, swapSets, type BmPersonRef, type BmSet, type BmView } from "@/lib/badminton";
import { askWitnessAction, attestMatchAction, cancelMatchAction, correctMatchAction, disputeMatchAction, finishLiveMatchAction, liveScoreAction, validateMatchAction, type BmResult } from "@/app/eleve/badminton-actions";
import { btn, cx, ui } from "@/lib/ui";

// Morceaux partages des ecrans Badminton (eleve et prof, Sartay 20/10) : choix d'un eleve, saisie des sets, fiche d'un match.

const hm = (ms: number) => new Date(ms).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

// Recherche d'un eleve de la seance par son nom (sans accents) ; une fois choisi, son nom et une croix pour changer.
export function PersonPicker({ people, value, onChange, exclude = [], label, placeholder }: { people: BmPersonRef[]; value: string | null; onChange: (id: string | null) => void; exclude?: string[]; label: string; placeholder: string }) {
  const [q, setQ] = useState("");
  const chosen = value ? people.find((p) => p.id === value) ?? null : null;
  const f = fold(q.trim());
  const hits = f ? people.filter((p) => !exclude.includes(p.id) && fold(`${p.name} ${p.className ?? ""}`).includes(f)).slice(0, 8) : [];
  return (
    <div>
      <span className={ui.label}>{label}</span>
      {chosen ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-brand bg-brand-soft px-3 py-2.5">
          <span className="font-bold">{chosen.name}{chosen.className && <span className="text-ink-2 font-semibold text-sm"> · {chosen.className}</span>}</span>
          <button type="button" onClick={() => onChange(null)} className={btn.smGhost} aria-label="Changer">✕</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={ui.input} autoComplete="off" />
          {hits.length > 0 && (
            <ul className="mt-1 rounded-xl border border-line bg-card divide-y divide-line overflow-hidden">
              {hits.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { onChange(p.id); setQ(""); }} className="w-full text-left px-3 py-2.5 hover:bg-paper">
                    <span className="font-bold">{p.name}</span>{p.className && <span className="text-ink-2 text-sm"> · {p.className}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {f && !hits.length && <p className={`${ui.hint} mt-1`}>Personne de ce nom dans la séance.</p>}
        </>
      )}
    </div>
  );
}

// Saisie des sets : une ligne par set, les points de gauche puis ceux de droite. 1 a 3 sets.
export function SetsEditor({ sets, onChange, left, right }: { sets: BmSet[]; onChange: (s: BmSet[]) => void; left: string; right: string }) {
  const set = (i: number, side: 0 | 1, v: string) => {
    const n = v === "" ? NaN : Math.max(0, Math.min(99, Math.round(Number(v))));
    onChange(sets.map((s, j) => (j === i ? (side === 0 ? [n, s[1]] : [s[0], n]) : s)) as BmSet[]);
  };
  const shown = (n: number) => (Number.isFinite(n) ? String(n) : "");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[3.5rem_1fr_auto_1fr_2rem] items-end gap-2 text-xs font-bold text-ink-2">
        <span />
        <span className="truncate text-center">{left}</span>
        <span />
        <span className="truncate text-center">{right}</span>
        <span />
      </div>
      {sets.map((s, i) => (
        <div key={i} className="grid grid-cols-[3.5rem_1fr_auto_1fr_2rem] items-center gap-2">
          <span className="text-sm font-bold text-ink-2">Set {i + 1}</span>
          <input type="number" inputMode="numeric" min={0} max={99} value={shown(s[0])} onChange={(e) => set(i, 0, e.target.value)} className={`${ui.input} text-center text-xl font-extrabold`} aria-label={`Set ${i + 1} : points de ${left}`} />
          <span className="font-black text-ink-3">–</span>
          <input type="number" inputMode="numeric" min={0} max={99} value={shown(s[1])} onChange={(e) => set(i, 1, e.target.value)} className={`${ui.input} text-center text-xl font-extrabold`} aria-label={`Set ${i + 1} : points de ${right}`} />
          {sets.length > 1 ? <button type="button" onClick={() => onChange(sets.filter((_, j) => j !== i))} className="text-ink-3 font-bold" aria-label={`Retirer le set ${i + 1}`}>✕</button> : <span />}
        </div>
      ))}
      {sets.length < BM_MAX_SETS && <button type="button" onClick={() => onChange([...sets, [NaN, NaN] as unknown as BmSet])} className={btn.smGhost}>+ Ajouter un set</button>}
    </div>
  );
}
export const emptySets = (): BmSet[] => [[NaN, NaN] as unknown as BmSet];
export const setsReady = (sets: BmSet[]) => sets.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b)) && !checkSets(sets);

// « Victoire de Léa 2 sets à 1 », « Égalité » : le resultat en clair, du point de vue de deux noms.
export function resultText(sets: BmSet[], left: string, right: string): string {
  const r = resultOf(sets);
  if (r.winner === "DRAW") return `Égalité (${r.points[0]} points chacun)`;
  const won = r.winner === "A" ? left : right;
  const s = r.winner === "A" ? r.setsWon : [r.setsWon[1], r.setsWon[0]];
  return sets.length > 1 && s[0] !== s[1] ? `Victoire de ${won}, ${s[0]} set${s[0] > 1 ? "s" : ""} à ${s[1]}` : `Victoire de ${won}`;
}

const STATUS_CHIP = { PENDING: ui.chipWarn, VALIDATED: ui.chipOk, DISPUTED: ui.chipErr, CANCELLED: ui.chipMuted, LIVE: ui.chipSea } as const;

// Fiche d'un match, vue par `viewerId` : le score de SON cote d'abord s'il joue, le statut, l'historique complet (qui a
// encode quoi, qui a signe) et les gestes permis. `staff` : vue du prof (noms complets, tous les gestes).
// `roster` : eleves qu'on peut demander comme temoins (match libre).
export function MatchCard({ v, viewerId, staff = false, compact = false, onReferee, roster }: { v: BmView; viewerId: string; staff?: boolean; compact?: boolean; onReferee?: (v: BmView) => void; roster?: BmPersonRef[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  // Cote du lecteur d'abord : « Toi 21 – 15 Tom ».
  const flip = v.meSide === "B";
  const left = v.meSide ? (staff ? (flip ? v.b : v.a).name : "Toi") : v.a.name;
  const right = v.meSide ? (flip ? v.a : v.b).name : v.b.name;
  const leftClass = v.meSide ? (flip ? v.b : v.a).className : v.a.className;
  const rightClass = v.meSide ? (flip ? v.a : v.b).className : v.b.className;
  const shownSets = v.sets ? (flip ? swapSets(v.sets) : v.sets) : null;
  const [draft, setDraft] = useState<BmSet[]>(() => shownSets ?? emptySets());
  const run = (fn: () => Promise<BmResult>) => {
    setError("");
    start(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else { setEditing(false); router.refresh(); }
    });
  };
  const statusText = v.status === "PENDING" && v.needsSecond
    ? v.meSide && !staff ? "⏳ revanche : à toi de signer" : "⏳ revanche : attend la signature d'un joueur"
    : v.status === "PENDING"
    ? v.waitingFor ? (v.waitingFor.id === viewerId && !staff ? "⏳ à toi de signer" : `⏳ attend la signature de ${v.waitingFor.name}`) : "⏳ à signer"
    : v.status === "VALIDATED" ? "✅ validé" : v.status === "DISPUTED" ? "⚠️ contesté" : v.status === "LIVE" ? `🔴 en direct · set ${v.sets?.length ?? 1}` : "✖ annulé";
  const won = v.status !== "LIVE" && v.result && v.meSide && !staff ? (v.result.winner === "DRAW" ? "Égalité" : (v.result.winner === v.meSide ? "🏆 Victoire" : "Défaite")) : null;
  return (
    <div className={cx(ui.card, "p-3 space-y-2", v.status === "CANCELLED" && "opacity-60", v.can.validate && v.status === "PENDING" && !staff && "border-accent")}>
      <div className="space-y-1.5">
        <div className={cx("min-w-0", v.status === "CANCELLED" && "line-through")}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold">{left}{leftClass && (staff || !v.meSide) && <span className="text-ink-3 text-xs font-semibold"> {leftClass}</span>}</span>
            <span className="font-display text-xl font-extrabold tabular-nums">{shownSets ? shownSets.map(([a, b]) => `${a}–${b}`).join("  ") : "—"}</span>
            <span className="font-bold">{right}{rightClass && <span className="text-ink-3 text-xs font-semibold"> {rightClass}</span>}</span>
          </div>
          {!v.meSide && !staff && <p className={ui.hint}>{v.createdBy.id === viewerId ? "Arbitré par toi" : "On te demande d'attester ce match"}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className={cx(ui.chip, STATUS_CHIP[v.status])}>{statusText}</span>
          {won && v.status !== "CANCELLED" && <span className={cx(ui.chip, won.startsWith("🏆") ? ui.chipAccent : ui.chipMuted)}>{won}</span>}
          {v.free && v.status !== "CANCELLED" && v.status !== "LIVE" && (
            <span className={cx(ui.chip, v.official ? ui.chipOk : ui.chipMuted)} title="Officiel = 2 témoins (l'arbitre en est un) ou validé par un prof : il compte au classement">{v.official ? "🏅 officiel" : `👀 témoins ${Math.min(v.witnesses.count, v.witnesses.needed)}/${v.witnesses.needed}`}</span>
          )}
        </div>
      </div>
      {!compact && (
        <ul className="text-xs text-ink-2 space-y-0.5">
          {v.history.map((h, i) => <li key={i}><span className="tabular-nums text-ink-3">{hm(h.at)}</span> {h.icon} {h.text}</li>)}
        </ul>
      )}
      {error && <p className={`${ui.alertErr} py-1 text-sm`}>{error}</p>}
      {editing ? (
        <div className="space-y-2 rounded-xl bg-paper p-2">
          <SetsEditor sets={draft} onChange={setDraft} left={left} right={right} />
          {setsReady(draft) && <p className={ui.hint}>{resultText(draft, left, right)}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={pending || !setsReady(draft)} onClick={() => run(() => correctMatchAction(v.id, flip ? swapSets(draft) : draft))} className={btn.smPrimary}>Enregistrer la correction</button>
            <button type="button" onClick={() => { setEditing(false); setDraft(shownSets ?? emptySets()); }} className={btn.smGhost}>Annuler</button>
          </div>
          {!staff && <p className={ui.hint}>{v.meSide ? "Ton adversaire devra signer ta correction." : "Les joueurs voient ta correction."}</p>}
        </div>
      ) : asking && roster ? (
        <div className="space-y-2 rounded-xl bg-paper p-2">
          <PersonPicker people={roster} value={null} onChange={(id) => { if (id) run(() => askWitnessAction(v.id, id)); setAsking(false); }} exclude={[v.a.id, v.b.id, viewerId, ...v.witnesses.asked.map((p) => p.id)]} label="Qui a vu ce match ?" placeholder="Tape le nom d'un élève" />
          <button type="button" onClick={() => setAsking(false)} className={btn.smGhost}>Annuler</button>
          <p className={ui.hint}>Il recevra le match sur son téléphone et pourra attester le score.</p>
        </div>
      ) : (
        (v.can.validate || v.can.correct || v.can.dispute || v.can.cancel || (v.can.referee && onReferee) || v.can.attest || v.can.decline || (v.can.askWitness && roster)) && (
          <div className="flex flex-wrap gap-2">
            {v.can.attest && <button type="button" disabled={pending} onClick={() => run(() => attestMatchAction(v.id, true))} className={btn.success}>🖊️ J&apos;atteste ce score</button>}
            {v.can.decline && <button type="button" disabled={pending} onClick={() => { if (confirm("Tu n'as pas vu ce match ?")) run(() => attestMatchAction(v.id, false)); }} className={btn.smGhost}>🙈 Je n&apos;ai pas vu ce match</button>}
            {v.can.askWitness && roster && <button type="button" disabled={pending} onClick={() => setAsking(true)} className={btn.smGhost}>👀 Demander un témoin</button>}
            {v.can.referee && onReferee && <button type="button" onClick={() => onReferee(v)} className={staff ? btn.smSea : btn.sea}>🎯 Reprendre l&apos;arbitrage</button>}
            {v.can.validate && <button type="button" disabled={pending} onClick={() => { if (v.status !== "LIVE" || confirm("Terminer ce match en direct avec le score du moment ?")) run(() => validateMatchAction(v.id)); }} className={staff ? btn.smSuccess : btn.success}>✅ {staff ? (v.status === "LIVE" ? "Terminer et valider" : v.free && !v.official ? "Valider (officiel)" : "Valider") : "Je signe ce score"}</button>}
            {v.can.correct && <button type="button" disabled={pending} onClick={() => setEditing(true)} className={btn.smGhost}>✏️ Corriger</button>}
            {v.can.dispute && <button type="button" disabled={pending} onClick={() => { if (confirm("Tu n'as pas joué ce match ? Ton prof verra ta contestation.")) run(() => disputeMatchAction(v.id)); }} className={btn.smGhost}>🚫 Je n&apos;ai pas joué ce match</button>}
            {v.can.cancel && <button type="button" disabled={pending} onClick={() => { if (confirm("Annuler ce match ? Il restera dans l'historique, barré.")) run(() => cancelMatchAction(v.id)); }} className={btn.smGhost}>✖ Annuler</button>}
          </div>
        )
      )}
    </div>
  );
}

// ===== Arbitrage en direct (Sartay 03/11) =====
// Tableau de score plein ecran pour l'arbitre : un gros « +1 » et un petit « −1 » par joueur, le service (celui qui vient
// de marquer), le set suivant, la fin du match. Chaque appui part tout de suite au serveur ; si plusieurs appuis se
// suivent pendant un envoi, seul le dernier score est renvoye (c'est une photo du score : rien ne se perd).
const BM_TARGETS = [11, 13, 15, 21, 0] as const; // 0 = sans limite (match au temps) ; 13 : Sartay 10/11
// `initialTarget` : points du set d'un match de tournoi (sinon le dernier choix de ce telephone, 21 par defaut).
export function LiveBoard({ matchId, aName, bName, initialSets, initialTarget, onClose }: { matchId: string; aName: string; bName: string; initialSets: BmSet[] | null; initialTarget?: number; onClose: () => void }) {
  const router = useRouter();
  const [sets, setSets] = useState<BmSet[]>(() => (initialSets && initialSets.length ? initialSets.map(([a, b]) => [a, b] as BmSet) : [[0, 0]]));
  const [server, setServer] = useState<0 | 1 | null>(null);
  // Points par set (rappel « set gagné ? ») : retenu sur ce telephone. Le tableau n'existe que cote navigateur (ouvert au clic).
  const [target, setTarget] = useState<number>(() => { if (initialTarget && BM_TARGETS.includes(initialTarget as never)) return initialTarget; try { const raw = localStorage.getItem("reps_bm_target"); const t = raw === null ? NaN : Number(raw); return BM_TARGETS.includes(t as never) ? t : 21; } catch { return 21; } });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [finishing, startFinish] = useTransition();
  const latest = useRef(sets);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  async function flush() {
    if (inFlight.current) { dirty.current = true; return; }
    inFlight.current = true;
    setSaving(true);
    try {
      do {
        dirty.current = false;
        const res = await liveScoreAction(matchId, latest.current);
        if ("error" in res) { setError(res.error); break; }
        setError("");
      } while (dirty.current);
    } catch {
      setError("Connexion perdue : le score repartira au prochain appui.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  function change(next: BmSet[]) { latest.current = next; setSets(next); void flush(); }
  const cur = sets[sets.length - 1];
  const plus = (side: 0 | 1) => { const n = sets.map(([a, b]) => [a, b] as BmSet); n[n.length - 1][side] = Math.min(99, n[n.length - 1][side] + 1); setServer(side); change(n); };
  const minus = (side: 0 | 1) => { if (cur[side] === 0) return; const n = sets.map(([a, b]) => [a, b] as BmSet); n[n.length - 1][side] -= 1; setServer(null); change(n); };
  const nextSet = () => { if (sets.length >= BM_MAX_SETS || cur[0] + cur[1] === 0) return; setServer(null); change([...sets, [0, 0]]); };
  // Se rattraper (Sartay 10/11 : « qu'un arbitre puisse annuler l'encodage en cours, pour recommencer le match a zero ; il
  // n'arrivait pas a corriger son encodage ») : chaque geste est une nouvelle photo du score, l'historique garde tout.
  const dropSet = () => { if (sets.length <= 1 || !confirm(`Retirer le set ${sets.length} (${cur[0]}-${cur[1]}) et revenir au set précédent ?`)) return; setServer(null); change(sets.slice(0, -1)); };
  const restart = () => { if (!confirm("Recommencer le match à 0-0 ? (L'historique garde ce qui a été compté.)")) return; setServer(null); change([[0, 0]]); };
  function cancelMatch() {
    if (!confirm("Annuler ce match ? Il restera dans l'historique, barré, et ne comptera pas.")) return;
    setError("");
    startFinish(async () => {
      const res = await cancelMatchAction(matchId);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }
  const pickTarget = (t: number) => { setTarget(t); try { localStorage.setItem("reps_bm_target", String(t)); } catch { /* stockage indisponible */ } };
  // Set gagne (rappel seulement, l'arbitre decide) : la cible atteinte avec 2 points d'avance, ou le plafond (30 a 21 points).
  const cap = target === 21 ? 30 : target + 4;
  const setWinner = target > 0 && ((Math.max(cur[0], cur[1]) >= target && Math.abs(cur[0] - cur[1]) >= 2) || Math.max(cur[0], cur[1]) >= cap) ? (cur[0] > cur[1] ? 0 : 1) : null;
  const names = [aName, bName];
  // Fin du match a tout moment (Sartay 10/11 : « l'arbitre doit pouvoir mettre fin au match meme si le score n'est pas
  // atteint : eleve blesse, cours termine… ; ajoute juste une petite confirmation »).
  function finish() {
    const score = `${aName} ${sets.filter(([a, b], i) => a + b > 0 || i === 0).map(([a, b]) => `${a}-${b}`).join(" · ")} ${bName}`;
    const early = target > 0 && setWinner === null;
    if (!confirm(early ? `Le set n'est pas fini (${target} points pas atteints).\nMettre fin au match quand même (élève blessé, cours terminé…) ?\n\nScore retenu : ${score}` : `Fin du match : ${score} ?`)) return;
    setError("");
    startFinish(async () => {
      const res = await finishLiveMatchAction(matchId, latest.current);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }
  const panel = (side: 0 | 1) => (
    <div className={cx("rounded-3xl p-3 text-white flex flex-col gap-2", side === 0 ? "bg-brand" : "bg-sea")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-extrabold truncate">{names[side]}</span>
        {server === side && <span className="text-xs font-bold bg-white/25 rounded-full px-2 py-0.5 whitespace-nowrap">🏸 au service</span>}
      </div>
      <div className="flex items-stretch gap-2">
        <div className="font-display text-6xl font-extrabold tabular-nums leading-none w-24 text-center self-center">{cur[side]}</div>
        <button type="button" onClick={() => plus(side)} disabled={finishing} className="flex-1 rounded-2xl bg-white/20 active:bg-white/35 text-4xl font-black py-6 select-none touch-manipulation" aria-label={`Un point pour ${names[side]}`}>+1</button>
        <button type="button" onClick={() => minus(side)} disabled={finishing || cur[side] === 0} className="w-14 rounded-2xl bg-black/15 active:bg-black/25 text-2xl font-black disabled:opacity-40 select-none touch-manipulation" aria-label={`Retirer un point à ${names[side]}`}>−</button>
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 bg-paper overflow-auto">
      <div className="max-w-xl mx-auto p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className={ui.eyebrow}>🎯 Arbitrage en direct</p>
            <p className="text-xs text-ink-2">{saving ? "enregistrement…" : error ? "" : "✓ enregistré"}</p>
          </div>
          <button type="button" onClick={() => { router.refresh(); onClose(); }} className={ui.close} aria-label="Fermer (le match reste en direct)">✕</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {sets.map(([a, b], i) => (
            <span key={i} className={cx(ui.chip, i === sets.length - 1 ? ui.chipBrand : ui.chipMuted, "tabular-nums")}>Set {i + 1}{i < sets.length - 1 ? ` · ${a}-${b}` : " en cours"}</span>
          ))}
        </div>
        {error && <p className={ui.alertErr}>{error}</p>}
        {panel(0)}
        {panel(1)}
        {setWinner !== null && sets.length < BM_MAX_SETS && (
          <div className={`${ui.alertInfo} flex items-center justify-between gap-2`}>
            <span>Set gagné par <b>{names[setWinner]}</b> ?</span>
            <span className="flex gap-1.5">
              <button type="button" onClick={finish} disabled={finishing} className={btn.smSuccess}>🏁 Fin du match</button>
              <button type="button" onClick={nextSet} className={btn.smGhost}>Set suivant</button>
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className={ui.hint}>Set en</span>
          {BM_TARGETS.map((t) => (
            <button key={t} type="button" onClick={() => pickTarget(t)} className={cx(ui.chip, target === t ? ui.chipBrand : ui.chipMuted, "py-1")}>{t ? `${t} points` : "sans limite"}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={nextSet} disabled={finishing || sets.length >= BM_MAX_SETS || cur[0] + cur[1] === 0} className={btn.ghost}>Set suivant ›</button>
          <button type="button" onClick={finish} disabled={finishing || sets.every(([a, b]) => a + b === 0)} className={btn.success}>{finishing ? "Enregistrement…" : "🏁 Fin du match"}</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sets.length > 1 && <button type="button" onClick={dropSet} disabled={finishing} className={btn.smGhost}>← Retirer ce set</button>}
          <button type="button" onClick={restart} disabled={finishing || (sets.length === 1 && cur[0] + cur[1] === 0)} className={btn.smGhost}>↺ Recommencer à 0-0</button>
          <button type="button" onClick={cancelMatch} disabled={finishing} className={btn.smGhost}>✖ Annuler ce match</button>
        </div>
        <p className={ui.hint}>Chaque point est enregistré tout de suite : tu peux fermer et reprendre l&apos;arbitrage plus tard (« Matchs que j&apos;ai arbitrés »). À la fin du match, le score compte tout de suite ; les joueurs peuvent encore le corriger.</p>
      </div>
    </div>
  );
}
