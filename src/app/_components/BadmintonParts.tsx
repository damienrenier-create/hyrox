"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fold } from "@/lib/staff-names";
import { BM_MAX_SETS, checkSets, resultOf, swapSets, type BmPersonRef, type BmSet, type BmView } from "@/lib/badminton";
import { cancelMatchAction, correctMatchAction, disputeMatchAction, validateMatchAction, type BmResult } from "@/app/eleve/badminton-actions";
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

const STATUS_CHIP = { PENDING: ui.chipWarn, VALIDATED: ui.chipOk, DISPUTED: ui.chipErr, CANCELLED: ui.chipMuted } as const;

// Fiche d'un match, vue par `viewerId` : le score de SON cote d'abord s'il joue, le statut, l'historique complet (qui a
// encode quoi, qui a signe) et les gestes permis. `staff` : vue du prof (noms complets, tous les gestes).
export function MatchCard({ v, viewerId, staff = false, compact = false }: { v: BmView; viewerId: string; staff?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
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
  const statusText = v.status === "PENDING"
    ? v.waitingFor ? (v.waitingFor.id === viewerId && !staff ? "⏳ à toi de signer" : `⏳ attend la signature de ${v.waitingFor.name}`) : "⏳ à signer"
    : v.status === "VALIDATED" ? "✅ validé" : v.status === "DISPUTED" ? "⚠️ contesté" : "✖ annulé";
  const won = v.result && v.meSide && !staff ? (v.result.winner === "DRAW" ? "Égalité" : (v.result.winner === v.meSide ? "🏆 Victoire" : "Défaite")) : null;
  return (
    <div className={cx(ui.card, "p-3 space-y-2", v.status === "CANCELLED" && "opacity-60", v.waitingFor?.id === viewerId && !staff && "border-accent")}>
      <div className="space-y-1.5">
        <div className={cx("min-w-0", v.status === "CANCELLED" && "line-through")}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold">{left}{leftClass && (staff || !v.meSide) && <span className="text-ink-3 text-xs font-semibold"> {leftClass}</span>}</span>
            <span className="font-display text-xl font-extrabold tabular-nums">{shownSets ? shownSets.map(([a, b]) => `${a}–${b}`).join("  ") : "—"}</span>
            <span className="font-bold">{right}{rightClass && <span className="text-ink-3 text-xs font-semibold"> {rightClass}</span>}</span>
          </div>
          {!v.meSide && !staff && <p className={ui.hint}>Arbitré par toi</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className={cx(ui.chip, STATUS_CHIP[v.status])}>{statusText}</span>
          {won && v.status !== "CANCELLED" && <span className={cx(ui.chip, won.startsWith("🏆") ? ui.chipAccent : ui.chipMuted)}>{won}</span>}
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
      ) : (
        (v.can.validate || v.can.correct || v.can.dispute || v.can.cancel) && (
          <div className="flex flex-wrap gap-2">
            {v.can.validate && <button type="button" disabled={pending} onClick={() => run(() => validateMatchAction(v.id))} className={staff ? btn.smSuccess : btn.success}>✅ {staff ? "Valider" : "Je signe ce score"}</button>}
            {v.can.correct && <button type="button" disabled={pending} onClick={() => setEditing(true)} className={btn.smGhost}>✏️ Corriger</button>}
            {v.can.dispute && <button type="button" disabled={pending} onClick={() => { if (confirm("Tu n'as pas joué ce match ? Ton prof verra ta contestation.")) run(() => disputeMatchAction(v.id)); }} className={btn.smGhost}>🚫 Je n&apos;ai pas joué ce match</button>}
            {v.can.cancel && <button type="button" disabled={pending} onClick={() => { if (confirm("Annuler ce match ? Il restera dans l'historique, barré.")) run(() => cancelMatchAction(v.id)); }} className={btn.smGhost}>✖ Annuler</button>}
          </div>
        )
      )}
    </div>
  );
}
