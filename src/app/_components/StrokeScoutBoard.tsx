"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { END_STROKES } from "@/lib/badminton-scout";
import { STROKE_OUTS, TOP_STROKES, strokeCounts, topStrokes, type StrokeOut, type StrokeTap } from "@/lib/badminton-strokes";
import { endStrokeScoutAction, strokeBatchAction } from "@/app/eleve/badminton-actions";
import { StrokeSheetForm } from "./StrokeSheetForm";
import { btn, cx, ui } from "@/lib/ui";

// Scouting des COUPS (etape 2, Sartay 26/11 soir) : plein ecran, un joueur. Chaque coup vu = UN toucher dans la grille
// (le coup, et sur quoi il debouche : ❌ perd le point · ↔️ l'echange continue · ✅ gagne le point). « ↶ » annule le
// dernier. « 🏁 Fin » : la fiche technique des 3 coups les plus utilises (les 4 criteres de chaque coup).
export type StrokeResume = { id: string; playerId: string; playerName: string; oppName: string; taps: { id: string; tap: StrokeTap }[] };
export function StrokeScoutBoard({ obs, onClose }: { obs: StrokeResume; onClose: () => void }) {
  const router = useRouter();
  // Coups deja notes (reprise) : numeros 1..n, leurs lignes sont connues. Les nouveaux partent PAR PAQUETS : un seul envoi
  // a la fois (les touchers faits pendant un envoi partent au suivant) ; « fermer » attend que tout soit parti.
  const seq = useRef(obs.taps.length);
  const sent = useRef(new Map<number, string>(obs.taps.map((x, i) => [i + 1, x.id])));
  const queue = useRef<{ k: number; tap: StrokeTap }[]>([]);
  const undoQ = useRef<string[]>([]);
  const running = useRef<Promise<boolean> | null>(null); // l'envoi en cours : on peut l'attendre (fermer, fin)
  const [waiting, setWaiting] = useState(0); // coups (et annulations) pas encore enregistres
  const [taps, setTaps] = useState<{ k: number; tap: StrokeTap }[]>(() => obs.taps.map((x, i) => ({ k: i + 1, tap: x.tap })));
  const flush = (): Promise<boolean> => {
    if (running.current) return running.current; // il enverra aussi ce qui vient d'arriver (il boucle tant qu'il reste)
    const p = (async () => {
      try {
        while (queue.current.length || undoQ.current.length) {
          const add = queue.current.slice(), undo = undoQ.current.slice();
          const r = await strokeBatchAction(obs.id, { add: add.map((x) => ({ k: x.k, stroke: x.tap.stroke, out: x.tap.out })), undo });
          if ("error" in r) { setError(r.error); return false; }
          for (const [k, id] of Object.entries(r.ids)) sent.current.set(Number(k), id);
          queue.current = queue.current.filter((q) => !add.some((x) => x.k === q.k));
          undoQ.current = undoQ.current.filter((u) => !undo.includes(u));
          setError("");
          setWaiting(queue.current.length + undoQ.current.length);
        }
        return true;
      } catch {
        setError("Connexion perdue : les derniers coups partiront au prochain toucher.");
        return false;
      } finally {
        running.current = null;
      }
    })();
    running.current = p;
    return p;
  };
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState<"tap" | "eval">("tap");
  const [ending, startEnd] = useTransition();
  const first = obs.playerName.split(" ")[0];
  const counts = strokeCounts(taps.map((t) => t.tap));
  const n = (id: string, out: StrokeOut) => taps.filter((t) => t.tap.stroke === id && t.tap.out === out).length;
  const show = (t: string) => { setFlash(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setFlash(null), 1200); };
  const tap = (stroke: StrokeTap["stroke"], out: StrokeOut) => {
    const k = ++seq.current;
    const t: StrokeTap = { stroke, out };
    setTaps((l) => [...l, { k, tap: t }]);
    queue.current.push({ k, tap: t });
    setWaiting(queue.current.length + undoQ.current.length);
    const s = END_STROKES.find((x) => x.id === stroke)!;
    show(`${s.emoji} ${s.name} ${STROKE_OUTS.find((o) => o.v === out)!.emoji}`);
    void flush();
  };
  // Annuler le dernier : pas encore parti, il ne part pas ; deja enregistre, une annulation part (rien n'est efface).
  const undo = () => {
    const last = taps[taps.length - 1];
    if (!last) return;
    setTaps((l) => l.slice(0, -1));
    show("↶ Dernier coup annulé");
    if (queue.current.some((q) => q.k === last.k)) queue.current = queue.current.filter((q) => q.k !== last.k);
    else { const id = sent.current.get(last.k); if (id) undoQ.current.push(id); }
    setWaiting(queue.current.length + undoQ.current.length);
    void flush();
  };
  const close = () => startEnd(async () => { await flush(); router.refresh(); onClose(); });
  const end = () => startEnd(async () => { if (!(await flush())) return; const r = await endStrokeScoutAction(obs.id); if ("error" in r) { setError(r.error); return; } router.refresh(); onClose(); });
  const top = topStrokes(counts);
  const shell = (content: React.ReactNode) => (typeof document === "undefined" ? null : createPortal(<div className="fixed inset-0 z-[70] bg-paper flex flex-col overflow-hidden">{content}</div>, document.body));
  if (step === "eval") {
    return shell(
      <div className="flex-1 overflow-auto p-3">
        <div className="max-w-xl mx-auto space-y-3">
          <p className="font-display text-lg font-extrabold">🏁 Fin du scouting des coups de {first}</p>
          {top.length ? (
            <>
              <p className="text-sm">Ses {top.length} coup{top.length > 1 ? "s" : ""} le{top.length > 1 ? "s" : ""} plus utilisé{top.length > 1 ? "s" : ""} : coche les critères réussis (❤️ si les 4 sont vraiment très bien faits).</p>
              <StrokeSheetForm matchId={obs.id} player={{ id: obs.playerId, name: obs.playerName }} only={top} onClose={() => setStep("tap")} onDone={end} />
            </>
          ) : <p className={ui.muted}>Aucun des 6 coups techniques (services, clear, smash, drop, lob) n&apos;a été noté : rien à évaluer.</p>}
          <button type="button" disabled={ending} onClick={end} className={cx(btn.ghost, "w-full")}>{ending ? "…" : "Terminer sans évaluer"}</button>
          {error && <p className={ui.alertErr}>{error}</p>}
        </div>
      </div>
    );
  }
  return shell(
    <>
      <div className="shrink-0 bg-card border-b border-line px-3 py-2 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-display font-extrabold truncate">🏸 Coups de {obs.playerName}</p>
          <p className="text-xs text-ink-2 truncate">contre {obs.oppName} · {taps.length} coup{taps.length > 1 ? "s" : ""} noté{taps.length > 1 ? "s" : ""} · {waiting ? `enregistrement (${waiting})…` : "✓ enregistré"}</p>
        </div>
        <button type="button" disabled={ending} onClick={close} className={ui.close} aria-label="Fermer (reprendre plus tard)">{ending ? "…" : "✕"}</button>
      </div>
      {error && <p className="shrink-0 px-3 pt-1 text-xs font-bold text-danger-ink">⚠️ {error}</p>}
      <div className="relative flex-1 min-h-0 overflow-auto px-2 py-2">
        <div className="grid grid-cols-[1fr_repeat(3,minmax(0,4.2rem))] gap-1 items-stretch text-center">
          <span />
          {STROKE_OUTS.map((o) => <span key={o.v} className="text-[10px] font-bold text-ink-2 leading-tight">{o.emoji}<br />{o.name}</span>)}
          {END_STROKES.map((s) => (
            <div key={s.id} className="contents">
              <span className="text-left text-sm font-bold self-center leading-tight">{s.emoji} {s.name}</span>
              {STROKE_OUTS.map((o) => (
                <button key={o.v} type="button" onClick={() => tap(s.id, o.v)} aria-label={`${s.name} : ${o.name}`} className={cx("rounded-xl border-2 py-3 font-display text-lg font-extrabold tabular-nums active:scale-95 transition select-none touch-manipulation", o.v === 1 ? "border-success/50 bg-success-soft text-success-ink" : o.v === -1 ? "border-danger/40 bg-danger-soft text-danger-ink" : "border-line bg-card text-ink")}>
                  {n(s.id, o.v) || "·"}
                </button>
              ))}
            </div>
          ))}
        </div>
        <p className={`${ui.hint} mt-2`}>Un toucher par coup de {first} : le coup, et sur quoi il débouche. La plupart des coups « continuent » (colonne du milieu) ; le dernier de l&apos;échange le gagne ✅ ou le perd ❌.</p>
        {flash && <div className="pointer-events-none fixed inset-x-0 top-1/3 flex justify-center" role="status"><p className="rounded-full bg-ink/85 text-white font-display text-lg font-extrabold px-4 py-1.5 shadow-lg">{flash}</p></div>}
      </div>
      <div className="shrink-0 bg-card border-t border-line px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex gap-1.5">
        <button type="button" disabled={!taps.length} onClick={undo} className={cx(btn.ghost, "flex-1 border-2 border-accent font-extrabold")}>↶ Annuler le dernier coup</button>
        <button type="button" onClick={() => { void flush(); setStep("eval"); }} className={cx(btn.success, "shrink-0")}>🏁 Fin : évaluer {Math.min(TOP_STROKES, top.length) || ""}</button>
      </div>
    </>
  );
}
