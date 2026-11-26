"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { fold } from "@/lib/staff-names";
import { BM_MAX_SETS, checkSets, resultOf, swapSets, type BmPersonRef, type BmSet, type BmView } from "@/lib/badminton";
import { THEME_CAPS, THEME_FLOORS, THEME_KINDS, THEME_STARTS, faultOutcome, needsServer, priceOf, priced, rallyOutcome, readTheme, themeText, type BmTheme, type ThemeKind } from "@/lib/badminton-themes";
import { StudentName } from "./StudentName";
import { askWitnessAction, attestMatchAction, cancelMatchAction, correctMatchAction, disputeMatchAction, editRallyAction, finishLiveMatchAction, liveRallyAction, liveScoreAction, undoRallyAction, setSessionThemeAction, validateMatchAction, type BmResult } from "@/app/eleve/badminton-actions";
import { CourtPad } from "./BadmintonCourt";
import { COURT_LENGTH, END_KINDS, END_STROKES, courtWidth, type CourtKind } from "@/lib/badminton-scout";
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
  // Prof (15/11) : les noms ouvrent ses notes perso sur l'eleve.
  const leftId = staff && !v.meSide ? v.a.id : null;
  const rightId = staff && !v.meSide ? v.b.id : null;
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
            <span className="font-bold">{leftId ? <StudentName id={leftId} name={left} /> : left}{leftClass && (staff || !v.meSide) && <span className="text-ink-3 text-xs font-semibold"> {leftClass}</span>}</span>
            <span className="font-display text-xl font-extrabold tabular-nums">{shownSets ? shownSets.map(([a, b]) => `${a}–${b}`).join("  ") : "—"}</span>
            <span className="font-bold">{rightId ? <StudentName id={rightId} name={right} /> : right}{rightClass && <span className="text-ink-3 text-xs font-semibold"> {rightClass}</span>}</span>
          </div>
          {!v.meSide && !staff && <p className={ui.hint}>{v.createdBy.id === viewerId ? "Arbitré par toi" : "On te demande d'attester ce match"}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className={cx(ui.chip, STATUS_CHIP[v.status])}>{statusText}</span>
          {won && v.status !== "CANCELLED" && <span className={cx(ui.chip, won.startsWith("🏆") ? ui.chipAccent : ui.chipMuted)}>{won}</span>}
          {v.theme && <span className={cx(ui.chip, ui.chipMuted)} title="Match à thème : il compte pour moitié à l'ELO, sans l'écart au score">🎲 {themeText(v.theme)}</span>}
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

// ===== Chrono du tournoi par equipes au temps (Sartay 24/11 : « tous les matchs commencent en meme temps et finissent en
// meme temps ») : temps restant jusqu'a `endsAt` (heure du serveur ; `serverNow` = heure du serveur a l'affichage de la
// page, pour corriger l'horloge du telephone). A 0 : « Temps écoulé » et une vibration. Affiche seulement apres le
// chargement (l'heure du telephone n'existe pas cote serveur).
export function Countdown({ endsAt, stoppedAt = null, serverNow, big = false }: { endsAt: number; stoppedAt?: number | null; serverNow?: number; big?: boolean }) {
  const [offset] = useState(() => (serverNow ? serverNow - Date.now() : 0));
  const [now, setNow] = useState<number | null>(null);
  const buzzed = useRef(false);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  }, [offset]);
  // Chrono arrete : le temps qu'il restait au moment de l'arret.
  const left = now === null ? null : Math.max(0, endsAt - (stoppedAt ?? now));
  const over = !stoppedAt && left !== null && left <= 0;
  useEffect(() => {
    if (left === null) return;
    if (left > 0) { buzzed.current = true; return; } // il tournait : on vibrera a 0
    if (over && buzzed.current) { buzzed.current = false; try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch { /* vibreur absent */ } }
  }, [left, over]);
  if (left === null) return <span className={big ? "font-display text-5xl font-extrabold tabular-nums" : "font-bold tabular-nums"}>…</span>;
  const s = Math.ceil(left / 1000);
  const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (stoppedAt) return <span className={cx(big ? "font-display text-3xl font-extrabold" : "font-bold", "tabular-nums text-ink-2")}>⏸ chrono arrêté ({txt})</span>;
  if (over) return <span className={cx(big ? "font-display text-3xl font-extrabold" : "font-bold", "text-red-600 dark:text-red-400 animate-pulse")}>⏱️ Temps écoulé !</span>;
  return <span className={cx(big ? "font-display text-5xl font-extrabold" : "font-bold", "tabular-nums", s <= 30 && "text-red-600 dark:text-red-400")}>⏱️ {txt}</span>;
}

// ===== Arbitrage en direct (Sartay 03/11) =====
// Tableau de score plein ecran pour l'arbitre : un gros « +1 » et un petit « −1 » par joueur, le service (celui qui vient
// de marquer), le set suivant, la fin du match. Chaque appui part tout de suite au serveur ; si plusieurs appuis se
// suivent pendant un envoi, seul le dernier score est renvoye (c'est une photo du score : rien ne se perd).
const BM_TARGETS = [11, 13, 15, 21, 0] as const; // 0 = sans limite (match au temps) ; 13 : Sartay 10/11
// `initialTarget` : points du set d'un match de tournoi (sinon le dernier choix de ce telephone, 21 par defaut).
// `rule` : regle de fin de set d'un match de tournoi (12/11 : par defaut le premier a l'objectif gagne ; option 2 points
// d'ecart, eventuellement plafonnee). Sans regle (match ordinaire) : 2 points d'ecart, plafond 30 en 21 (sinon objectif + 4).
// sets : format du match de tournoi (balle de match) ; head : score de depart de chaque set (championnat a handicap, 13/11).
// endsAt : fin du chrono (tournoi par equipes au temps, 24/11).
export type LiveRule = { deuce: boolean; cap: number; sets?: 1 | 2 | 3; head?: BmSet; endsAt?: number };
// Scouting de l'arbitre (24/11) : terrain dessine et ses couches.
export type LiveScout = { court: CourtKind; level: number };
// Points d'avance du championnat a handicap, EN ROUGE ET EN GRAS (Sartay 16/11 : « plusieurs eleves sont passes a cote »).
export const BM_ADVANCE = "font-extrabold text-red-600 dark:text-red-400";
// theme (24/11) : match a theme (voir src/lib/badminton-themes.ts) ; l'arbitre clot chaque echange en l'attribuant a un
// joueur, la regle du theme donne les points et le service.
// scouting (26/11) : une OBSERVATION, pas un match : score indicatif (ni ELO, ni tournoi), « Fin du scouting ».
export function LiveBoard({ matchId, aName, bName, initialSets, initialTarget, rule, theme = null, scout = null, scouting = false, onClose }: { matchId: string; aName: string; bName: string; initialSets: BmSet[] | null; initialTarget?: number; rule?: LiveRule; theme?: BmTheme | null; scout?: LiveScout | null; scouting?: boolean; onClose: () => void }) {
  const router = useRouter();
  const [sets, setSets] = useState<BmSet[]>(() => (initialSets && initialSets.length ? initialSets.map(([a, b]) => [a, b] as BmSet) : [[0, 0]]));
  const [server, setServer] = useState<0 | 1 | null>(null);
  const [exchanges, setExchanges] = useState(0); // prix de l'echange : appuis sur le bouton central
  const [flip, setFlip] = useState(false); // scouting : les joueurs ont change de cote
  // Impacts notes sur cet ecran (26/11 : « annuler la derniere frappe ; appui long sur un impact pour l'annuler ou donner des
  // infos ») : repere du journal (A en haut) ; add = points donnes ; set = set ou il a compte ; id = sa ligne RALLY (promesse).
  const [impacts, setImpacts] = useState<{ k: number; x: number; y: number; w: 0 | 1; add: [number, number]; set: number; stroke?: string; end?: string }[]>([]);
  const impactIds = useRef(new Map<number, Promise<string | null>>());
  const impactSeq = useRef(0);
  const [menuK, setMenuK] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null); // scouting : « +1 pour X » apres un toucher
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = (t: string) => { setFlash(t); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(null), 1800); };
  // Points par set (rappel « set gagné ? ») : retenu sur ce telephone. Le tableau n'existe que cote navigateur (ouvert au clic).
  // 0 (« sans limite ») est un objectif de tournoi valable : match au temps (24/11).
  const [target, setTarget] = useState<number>(() => { if (initialTarget !== undefined && BM_TARGETS.includes(initialTarget as never)) return initialTarget; try { const raw = localStorage.getItem("reps_bm_target"); const t = raw === null ? NaN : Number(raw); return BM_TARGETS.includes(t as never) ? t : 21; } catch { return 21; } });
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
  // Ajoute [a, b] au set en cours (jamais sous 0, jamais au-dessus de 99).
  const addPoints = (add: [number, number]) => { const n = sets.map(([a, b]) => [a, b] as BmSet); const last = n[n.length - 1]; last[0] = Math.max(0, Math.min(99, last[0] + add[0])); last[1] = Math.max(0, Math.min(99, last[1] + add[1])); change(n); };
  // L'echange est gagne par `side` : la regle du theme (classique : +1) donne les points et le service.
  const plus = (side: 0 | 1) => { const o = rallyOutcome(theme, side, server, exchanges); setServer(o.server); setExchanges(0); addPoints(o.add); };
  // Service rate (option du theme) : le serveur perd 1 point, l'adversaire en gagne 1 et prend le service.
  const fault = () => { if (server === null) return; const o = faultOutcome(server); setServer(o.server); setExchanges(0); addPoints(o.add); };
  const price = priceOf(theme, exchanges);
  const minus = (side: 0 | 1) => { if (cur[side] === 0) return; const n = sets.map(([a, b]) => [a, b] as BmSet); n[n.length - 1][side] -= 1; setServer(null); change(n); };
  // Handicap (13/11) : chaque set repart du score de depart (0-3…), « Recommencer » aussi.
  const head: BmSet = rule?.head ?? [0, 0];
  const fresh = cur[0] + cur[1] <= head[0] + head[1];
  const nextSet = () => { if (sets.length >= BM_MAX_SETS || fresh) return; setServer(null); change([...sets, [head[0], head[1]]]); };
  // Se rattraper (Sartay 10/11 : « qu'un arbitre puisse annuler l'encodage en cours, pour recommencer le match a zero ; il
  // n'arrivait pas a corriger son encodage ») : chaque geste est une nouvelle photo du score, l'historique garde tout.
  const dropSet = () => { if (sets.length <= 1 || !confirm(`Retirer le set ${sets.length} (${cur[0]}-${cur[1]}) et revenir au set précédent ?`)) return; setServer(null); change(sets.slice(0, -1)); };
  const restart = () => { if (!confirm(`Recommencer le match à ${head[0]}-${head[1]} ? (L'historique garde ce qui a été compté.)`)) return; setServer(null); change([[head[0], head[1]]]); };
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
  const deuce = rule ? rule.deuce : true;
  const cap = rule ? rule.cap : target === 21 ? 30 : target + 4;
  const hi = Math.max(cur[0], cur[1]);
  const setWinner = target > 0 && (deuce ? (hi >= target && Math.abs(cur[0] - cur[1]) >= 2) || (cap > target && hi >= cap) : hi >= target) ? (cur[0] > cur[1] ? 0 : 1) : null;
  // Balle de set / de match (Sartay 12/11 : « l'arbitre reçoit une petite notif quand il encode la balle de match ») : un
  // point de plus fait gagner le set ; c'est une balle de MATCH si ce set termine le match (format du tournoi : 1 set,
  // 2e set gagnant au meilleur des 3, ou dernier des 2 sets). Match hors tournoi : format inconnu, « balle de set ».
  const setPoint = (side: 0 | 1) => {
    if (target <= 0 || setWinner !== null) return false;
    const me = cur[side] + 1;
    const op = cur[side === 0 ? 1 : 0];
    return deuce ? (me >= target && me - op >= 2) || (cap > target && me >= cap) : me >= target;
  };
  const setsWon = (side: 0 | 1) => sets.slice(0, -1).filter(([x, y]) => (side === 0 ? x > y : y > x)).length;
  const matchPoint = (side: 0 | 1) => (rule?.sets === 1 ? true : rule?.sets === 3 ? setsWon(side) >= 1 : rule?.sets === 2 ? sets.length >= 2 : false);
  const alerts = ([0, 1] as const).filter(setPoint).map((side) => ({ side, match: matchPoint(side) }));
  const alertKey = alerts.map((x) => `${x.side}${x.match ? "m" : "s"}`).join(",");
  useEffect(() => {
    if (!alertKey) return;
    try { navigator.vibrate?.(alertKey.includes("m") ? [120, 80, 120] : 120); } catch { /* vibreur absent */ }
  }, [alertKey]);
  const names = [aName, bName];
  // Theme : il faut savoir qui sert (points au service, service rate) ; le bouton dit ce que l'echange rapporte.
  const waitServer = needsServer(theme) && server === null;
  const plusLabel = (side: 0 | 1) => (theme?.kind === "SERVE" && server !== null && server !== side ? "↺ service" : `+${price}`);
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
    <div className={cx("rounded-3xl p-3 text-white flex flex-col gap-2", side === 0 ? "bg-brand" : "bg-sea", alerts.some((x) => x.side === side) && "ring-4 ring-red-500")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-extrabold truncate">{names[side]}</span>
        {server === side && <span className="text-xs font-bold bg-white/25 rounded-full px-2 py-0.5 whitespace-nowrap">🏸 au service</span>}
      </div>
      <div className="flex items-stretch gap-2">
        <div className="font-display text-6xl font-extrabold tabular-nums leading-none w-24 text-center self-center">{cur[side]}</div>
        <button type="button" onClick={() => plus(side)} disabled={finishing || waitServer} className="flex-1 rounded-2xl bg-white/20 active:bg-white/35 text-4xl font-black py-6 select-none touch-manipulation disabled:opacity-40" aria-label={`Échange gagné par ${names[side]}`}>{plusLabel(side)}</button>
        <button type="button" onClick={() => minus(side)} disabled={finishing || cur[side] === 0} className="w-14 rounded-2xl bg-black/15 active:bg-black/25 text-2xl font-black disabled:opacity-40 select-none touch-manipulation" aria-label={`Retirer un point à ${names[side]}`}>−</button>
      </div>
    </div>
  );
  // Plein ecran, rendu hors de la page (26/11 : un bandeau de la page passait par-dessus le terrain).
  const overlay = (content: React.ReactNode) => (typeof document === "undefined" ? null : createPortal(<div className="fixed inset-0 z-[70] bg-paper overflow-auto">{content}</div>, document.body));
  const header = (title: string) => (
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className={ui.eyebrow}>{title}</p>
        <p className="text-xs text-ink-2">{saving ? "enregistrement…" : error ? "" : "✓ enregistré"}</p>
      </div>
      <button type="button" onClick={() => { router.refresh(); onClose(); }} className={ui.close} aria-label="Fermer (le match reste en direct)">✕</button>
    </div>
  );
  const setChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {sets.map(([a, b], i) => (
        <span key={i} className={cx(ui.chip, i === sets.length - 1 ? ui.chipBrand : ui.chipMuted, "tabular-nums")}>Set {i + 1}{i < sets.length - 1 ? ` · ${a}-${b}` : " en cours"}</span>
      ))}
    </div>
  );
  const extras = (
    <>
      {error && <p className={ui.alertErr}>{error}</p>}
      {/* Match de championnat a handicap (rule.head) : l'avance, ou « aucun point d'avance » (Sartay 16/11 : « signifie-le ! »). */}
      {(rule?.head || head[0] > 0 || head[1] > 0) && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 text-amber-950 text-center px-3 py-2 dark:bg-amber-950 dark:text-amber-100" aria-label="Handicap">
          {head[0] > 0 || head[1] > 0 ? (
            <>⚖️ Handicap : <b>{names[head[0] > 0 ? 0 : 1]}</b> commence chaque set avec <b className={BM_ADVANCE}>{Math.max(head[0], head[1])} point{Math.max(head[0], head[1]) > 1 ? "s" : ""} d&apos;avance</b> <b className={BM_ADVANCE}>({head[0]}-{head[1]})</b></>
          ) : (
            <>⚖️ Handicap : <b className={BM_ADVANCE}>aucun point d&apos;avance</b> dans ce match : les deux joueurs commencent à <b className={BM_ADVANCE}>0-0</b></>
          )}
        </div>
      )}
      {rule?.endsAt && (
        <div className="rounded-2xl border-2 border-line bg-card text-center px-3 py-2" aria-label="Chrono">
          <Countdown endsAt={rule.endsAt} big /> <span className={`${ui.hint} block`}>Match au temps : le score au coup de sifflet compte (égalité possible).</span>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="rounded-2xl bg-red-600 text-white text-center font-display text-lg font-extrabold px-3 py-2 animate-pulse" role="status">
          {alerts.map((x) => `🔥 Balle de ${x.match ? "match" : "set"} pour ${names[x.side]}`).join(" · ")}
        </div>
      )}
    </>
  );
  const themeBlock = theme && (
    <div className="rounded-2xl border-2 border-line bg-card px-3 py-2 space-y-2" aria-label="Thème du match">
      <p className="text-sm text-center">🎲 <b>{themeText(theme)}</b></p>
      {waitServer && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <b>Qui sert ?</b>
          <button type="button" onClick={() => setServer(0)} className={btn.smPrimary}>{aName}</button>
          <button type="button" onClick={() => setServer(1)} className={btn.smPrimary}>{bName}</button>
        </div>
      )}
      {priced(theme) && (
        <div className="flex items-stretch gap-2">
          <button type="button" onClick={() => setExchanges((x) => x + 1)} disabled={finishing} className="flex-1 rounded-2xl bg-accent text-white text-xl font-black py-4 select-none touch-manipulation" aria-label="Un échange de plus">🏸 Échange +1</button>
          <button type="button" onClick={() => setExchanges((x) => Math.max(0, x - 1))} disabled={finishing || exchanges === 0} className="w-12 rounded-2xl bg-black/10 text-xl font-black disabled:opacity-40" aria-label="Un échange de moins">−</button>
          <div className="text-center self-center min-w-[5.5rem]"><div className="font-display text-3xl font-extrabold tabular-nums leading-none">{price}</div><div className="text-[11px] text-ink-2">{exchanges} échange{exchanges > 1 ? "s" : ""} · le point vaut</div></div>
        </div>
      )}
      {theme.serveFault && (
        <button type="button" onClick={fault} disabled={finishing || server === null} className={cx(btn.ghost, "w-full")}>❌ Service raté{server !== null ? ` de ${names[server]}` : ""} (−1, +1 à l&apos;autre)</button>
      )}
      {theme.kind === "SERVE" && server !== null && <p className={`${ui.hint} text-center`}>Seul {names[server]} (au service) peut marquer ; si l&apos;autre gagne l&apos;échange, il prend le service.</p>}
    </div>
  );
  const footer = (
    <>
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
        <span className={ui.hint}>{rule ? (rule.deuce ? `Tournoi : 2 points d'écart${rule.cap ? ` (max ${rule.cap})` : ""} · ` : "Tournoi : le premier au score gagne · ") : ""}Set en</span>
        {BM_TARGETS.map((t) => (
          <button key={t} type="button" onClick={() => pickTarget(t)} className={cx(ui.chip, target === t ? ui.chipBrand : ui.chipMuted, "py-1")}>{t ? `${t} points` : "sans limite"}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={nextSet} disabled={finishing || sets.length >= BM_MAX_SETS || fresh} className={btn.ghost}>Set suivant ›</button>
        <button type="button" onClick={finish} disabled={finishing || sets.every(([a, b]) => a + b === 0)} className={btn.success}>{finishing ? "Enregistrement…" : scouting ? "🏁 Fin du scouting" : "🏁 Fin du match"}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sets.length > 1 && <button type="button" onClick={dropSet} disabled={finishing} className={btn.smGhost}>← Retirer ce set</button>}
        <button type="button" onClick={restart} disabled={finishing || (sets.length === 1 && fresh)} className={btn.smGhost}>↺ Recommencer à {head[0]}-{head[1]}</button>
        <button type="button" onClick={cancelMatch} disabled={finishing} className={btn.smGhost}>✖ Annuler ce match</button>
      </div>
      <p className={ui.hint}>{scouting ? "Chaque impact est enregistré tout de suite : tu peux fermer et reprendre plus tard (« Mes scoutings en cours »)." : "Chaque point est enregistré tout de suite : tu peux fermer et reprendre plus tard (« Matchs que j'ai arbitrés »). À la fin du match, le score compte tout de suite ; les joueurs peuvent encore le corriger."}</p>
    </>
  );

  // ===== Scouting en direct (Sartay 26/11 : « le but du scouting n'est pas d'arbitrer mais de definir ou le joueur rate et
  // marque les points ; en touchant l'ecran en fonction des zones, ca compte les points ; le dessin du terrain pourrait
  // prendre plus de place et le scoring moins ») : le TERRAIN en grand, le score en petit. Toucher l'impact donne le point
  // au bon joueur (dans les lignes : l'adversaire de ce camp ; dehors : le joueur de ce camp ; filet : on choisit).
  // « ⇅ » : les joueurs changent de cote (le dessin suit ; le journal garde toujours A en haut).
  if (scout) {
    const top: 0 | 1 = flip ? 1 : 0;
    const bottom: 0 | 1 = flip ? 0 : 1;
    const W = courtWidth(scout.court);
    const scoreChip = (side: 0 | 1) => (
      <div className={cx("flex-1 min-w-0 rounded-2xl pl-3 pr-1.5 py-1.5 text-white flex items-center gap-2", side === 0 ? "bg-brand" : "bg-sea", alerts.some((x) => x.side === side) && "ring-4 ring-red-500")}>
        <span className="flex-1 min-w-0 truncate font-bold text-sm">{names[side]}{server === side ? " 🏸" : ""}</span>
        <span className="font-display text-3xl font-extrabold tabular-nums leading-none">{cur[side]}</span>
        <span className="flex flex-col gap-0.5">
          <button type="button" onClick={() => plus(side)} disabled={finishing || waitServer} className="rounded-lg bg-white/20 active:bg-white/35 text-xs font-black px-2 py-1 disabled:opacity-40" aria-label={`Point pour ${names[side]} (sans impact)`}>+1</button>
          <button type="button" onClick={() => minus(side)} disabled={finishing || cur[side] === 0} className="rounded-lg bg-black/15 active:bg-black/25 text-xs font-black px-2 py-1 disabled:opacity-40" aria-label={`Retirer un point à ${names[side]}`}>−1</button>
        </span>
      </div>
    );
    // Annuler un impact : il disparait du terrain, ses points sont retires (s'il est du set en cours), une ligne UNRALLY part au serveur.
    const undoImpact = (k: number) => {
      const im = impacts.find((x) => x.k === k);
      if (!im) return;
      setImpacts((l) => l.filter((x) => x.k !== k));
      if (im.set === sets.length - 1) addPoints([-im.add[0], -im.add[1]]);
      setMenuK(null);
      showFlash(`↶ Impact annulé (point de ${names[im.w]} retiré)`);
      void (impactIds.current.get(k) ?? Promise.resolve(null)).then((id) => (id ? undoRallyAction(matchId, id).then((res) => { if ("error" in res) setError(res.error); }) : undefined));
    };
    // Preciser un impact (le coup, gagnant ou faute) : la ligne RALLY est remplacee (l'ancienne annulee).
    const editImpact = (k: number, patch: { stroke?: string | null; end?: string | null }) => {
      setImpacts((l) => l.map((x) => (x.k === k ? { ...x, ...(patch.stroke !== undefined ? { stroke: patch.stroke ?? undefined } : {}), ...(patch.end !== undefined ? { end: patch.end ?? undefined } : {}) } : x)));
      const prev = impactIds.current.get(k) ?? Promise.resolve(null);
      impactIds.current.set(k, prev.then((id) => (id ? editRallyAction(matchId, id, patch).then((res) => { if ("error" in res) { setError(res.error); return id; } return ("eventId" in res && res.eventId) || id; }) : null)));
    };
    const chip = (on: boolean) => cx(ui.chip, on ? ui.chipBrand : ui.chipMuted, "py-1 text-sm");
    const menu = menuK !== null ? impacts.find((x) => x.k === menuK) ?? null : null;
    return overlay(
        <div className="max-w-xl mx-auto p-3 space-y-2 pb-44">
          {menu && (
            <div className="fixed inset-x-0 bottom-0 z-[60] bg-card border-t-2 border-accent shadow-2xl p-3 text-sm max-h-[65vh] overflow-auto" role="dialog" aria-label="Cet impact">
              <div className="max-w-xl mx-auto space-y-2">
                <div className="flex items-center justify-between gap-2"><p className="font-bold">Cet impact · point pour {names[menu.w]}</p><button type="button" onClick={() => setMenuK(null)} className={ui.close} aria-label="Fermer">✕</button></div>
                <button type="button" onClick={() => undoImpact(menu.k)} className={cx(btn.ghost, "w-full border-2 border-red-500 text-red-700 font-extrabold")}>✖ Annuler cet impact</button>
                <p className="font-bold">Le coup</p>
                <div className="flex flex-wrap gap-1">{END_STROKES.map((x) => <button key={x.id} type="button" onClick={() => editImpact(menu.k, { stroke: menu.stroke === x.id ? null : x.id })} className={chip(menu.stroke === x.id)}>{x.emoji} {x.name}</button>)}</div>
                <p className="font-bold">Comment ?</p>
                <div className="flex flex-wrap gap-1">{END_KINDS.map((x) => <button key={x.id} type="button" onClick={() => editImpact(menu.k, { end: menu.end === x.id ? null : x.id })} className={chip(menu.end === x.id)}>{x.name}</button>)}</div>
                <button type="button" onClick={() => setMenuK(null)} className={cx(btn.primary, "w-full")}>✓ OK</button>
              </div>
            </div>
          )}
          {header(scouting ? "🔭 Scouting · score indicatif" : "🔭 Arbitrage + scouting")}
          {scouting && <p className={ui.hint}>Ce n&apos;est pas un arbitrage : ce score ne compte ni à l&apos;ELO ni au tournoi. Seuls les impacts comptent, pour l&apos;analyse des deux joueurs.</p>}
          {extras}
          {themeBlock}
          <div className="flex items-stretch gap-1.5">
            {scoreChip(top)}
            <button type="button" onClick={() => setFlip((f) => !f)} className="rounded-2xl border-2 border-line bg-card px-2 text-lg font-black" title="Les joueurs changent de côté" aria-label="Les joueurs changent de côté">⇅</button>
            {scoreChip(bottom)}
          </div>
          <details className="rounded-xl bg-accent-soft/60 px-3 py-1.5 text-sm leading-snug">
            <summary className="cursor-pointer">👆 <b>Touche où le volant est tombé : le point va tout seul au bon joueur.</b></summary>
            <p className="mt-1">Dans le terrain : point pour l&apos;adversaire de ce camp · dehors : point pour le joueur de ce camp · sur le filet : tu choisis. En haut : <b>{names[top]}</b>, en bas : <b>{names[bottom]}</b> ; « ⇅ » quand ils changent de côté.</p>
          </details>
          {flash && <p className="text-center font-display font-extrabold text-success-ink" role="status">{flash}</p>}
          <CourtPad
            key={flip ? "flip" : "normal"}
            big
            kind={scout.court}
            level={scout.level}
            names={[names[top], names[bottom]]}
            disabled={finishing || waitServer}
            impacts={impacts.slice(-14).map((im, n, arr) => ({ ...(flip ? { x: W - im.x, y: COURT_LENGTH - im.y } : { x: im.x, y: im.y }), muted: true, last: n === arr.length - 1, k: im.k, title: `Point pour ${names[im.w]}` }))}
            onUndo={() => { const l = impacts[impacts.length - 1]; if (l) undoImpact(l.k); }}
            onImpact={setMenuK}
            onCommit={(shown) => {
              // Le dessin est retourne si les joueurs ont change de cote : on revient au repere du journal (A en haut).
              const r = flip ? { ...shown, x: W - shown.x, y: COURT_LENGTH - shown.y, ...(shown.hx !== undefined && shown.hy !== undefined ? { hx: W - shown.hx, hy: COURT_LENGTH - shown.hy } : {}), w: (shown.w === 0 ? 1 : 0) as 0 | 1 } : shown;
              const o = rallyOutcome(theme, r.w, server, exchanges);
              plus(r.w);
              showFlash(o.add[r.w] > 0 ? `+${o.add[r.w]} pour ${names[r.w]}` : `${names[r.w]} reprend le service`);
              const k = ++impactSeq.current;
              setImpacts((l) => [...l, { k, x: r.x, y: r.y, w: r.w, add: o.add, set: sets.length - 1, ...(r.stroke ? { stroke: r.stroke } : {}), ...(r.end ? { end: r.end } : {}) }]);
              impactIds.current.set(k, liveRallyAction(matchId, { ...r, court: scout.court, layer: scout.level }).then((res) => { if ("error" in res) { setError(res.error); return null; } return "eventId" in res ? res.eventId ?? null : null; }).catch(() => { setError("Connexion perdue : cet impact n'a pas été enregistré."); return null; }));
            }}
          />
          {setChips}
          {footer}
        </div>
    );
  }
  return overlay(
      <div className="max-w-xl mx-auto p-3 space-y-3">
        {header("🎯 Arbitrage en direct")}
        {setChips}
        {extras}
        {panel(0)}
        {themeBlock}
        {panel(1)}
        {footer}
      </div>
  );
}

// ===== Matchs a theme : reglage du prof pour la seance (Sartay 24/11) =====
// Le theme vaut pour les matchs crees ensuite dans la seance (ceux deja crees gardent le leur).
export function ThemePanel({ sessionId, current }: { sessionId: string; current: BmTheme | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ThemeKind>(current?.kind ?? "CLASSIC");
  const [serveFault, setServeFault] = useState(current?.serveFault ?? false);
  const [cap, setCap] = useState(current?.cap ?? 5);
  const [startAt, setStartAt] = useState(current?.start ?? 10);
  const [floor, setFloor] = useState(current?.floor ?? 1);
  const draft = readTheme({ kind, serveFault, cap, start: startAt, floor });
  const same = JSON.stringify(draft) === JSON.stringify(current);
  function save() {
    setError("");
    start(async () => {
      const r = await setSessionThemeAction(sessionId, draft);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }
  const seg = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg whitespace-nowrap", on ? ui.segOn : ui.segOff);
  return (
    <details className={cx(ui.cardPad, current && "border-accent")}>
      <summary className="cursor-pointer font-bold">🎲 Matchs à thème : {current ? themeText(current) : "aucun (classique)"}</summary>
      <div className="mt-3 space-y-3">
        <div className={cx(ui.segmented, "flex-wrap")}>{THEME_KINDS.map((k) => <button key={k.id} type="button" onClick={() => setKind(k.id)} className={seg(kind === k.id)}>{k.name}</button>)}</div>
        <p className={ui.hint}>{THEME_KINDS.find((k) => k.id === kind)?.rule}</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {kind === "PRICE_UP" && (
            <label className="flex items-center gap-1.5">Plafond
              <select value={cap} onChange={(e) => setCap(Number(e.target.value))} className={`${ui.input} w-auto`}>{THEME_CAPS.map((c) => <option key={c} value={c}>{c ? `${c} points` : "sans plafond"}</option>)}</select>
            </label>
          )}
          {kind === "PRICE_DOWN" && (
            <>
              <label className="flex items-center gap-1.5">Départ
                <select value={startAt} onChange={(e) => setStartAt(Number(e.target.value))} className={`${ui.input} w-auto`}>{THEME_STARTS.map((c) => <option key={c} value={c}>{c} points</option>)}</select>
              </label>
              <label className="flex items-center gap-1.5">jusqu&apos;à
                <select value={floor} onChange={(e) => setFloor(Number(e.target.value))} className={`${ui.input} w-auto`}>{THEME_FLOORS.filter((c) => c < startAt).map((c) => <option key={c} value={c}>{c} point{c > 1 ? "s" : ""}</option>)}</select>
              </label>
            </>
          )}
          <label className="flex items-center gap-1.5"><input type="checkbox" className={ui.check} checked={serveFault} onChange={(e) => setServeFault(e.target.checked)} /> Service raté : −1 au serveur, +1 à l&apos;adversaire</label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending || same} onClick={save} className={btn.smPrimary}>{draft ? "Appliquer ce thème" : "Revenir aux matchs classiques"}</button>
          {error && <span className={ui.alertErr}>{error}</span>}
        </div>
        <p className={ui.hint}>Pour les matchs créés ensuite dans cette séance ; l&apos;arbitre en direct applique la règle à chaque échange. Un match à thème compte pour moitié au classement ELO, sans l&apos;écart au score.</p>
      </div>
    </details>
  );
}
