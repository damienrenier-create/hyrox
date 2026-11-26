"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeBetAction } from "../../badminton-actions";
import { PersonPicker } from "../../../_components/BadmintonParts";
import { BET_LEVELS, BET_TEXT, betTable, multText } from "@/lib/badminton-constraints";
import { expectedScore } from "@/lib/badminton-elo";
import type { BmPersonRef } from "@/lib/badminton";
import { cx, ui } from "@/lib/ui";

// 🎯 MISE DE CERTITUDE (Sartay 26/11 soir, regles dans src/lib/badminton-constraints.ts) : avant son match, l'eleve mise de
// 0 a 5 sur sa victoire. Il voit, pour chaque mise, ce qu'il gagne ou perd en points ELO (match serre) avec son vrai ELO.
// La mise est secrete jusqu'au lancement du match (ou l'encodage du score) ; il peut la changer jusque-la.
// k = mon K ; even = match a handicap (chances ½) ; weight = ½ si match a theme ; me / opps = ELO ; mine = mes mises en cours.
export type BetData = { k: number; even: boolean; weight: number; me: number; opps: Record<string, number>; mine: Record<string, number> };

export function BetBox({ sessionId, data, opponent = null, roster = [] }: { sessionId: string; data: BetData; opponent?: BmPersonRef | null; roster?: BmPersonRef[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<string | null>(null); // adversaire choisi (hors tournoi)
  const opp = opponent?.id ?? pick;
  const [local, setLocal] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const current = opp ? local[opp] ?? data.mine[opp] ?? null : null;
  const name = opponent?.name ?? roster.find((p) => p.id === pick)?.name ?? "";
  const expect = opp ? (data.even ? 0.5 : expectedScore(data.me, data.opps[opp] ?? 1000)) : 0.5;
  const table = betTable(data.k, expect, data.weight);
  const place = (c: number) => {
    if (!opp) return;
    setError("");
    setLocal((l) => ({ ...l, [opp]: c }));
    start(async () => {
      const r = await placeBetAction(sessionId, opp, c);
      if ("error" in r) { setError(r.error); setLocal((l) => { const n = { ...l }; delete n[opp]; return n; }); }
      else router.refresh();
    });
  };
  return (
    <section className={cx(ui.card, "p-3 space-y-2 border-2 border-accent")} aria-label="Ma mise de certitude">
      <p className="text-sm"><b>🎯 Ta mise de certitude{name ? <> contre {name.split(" ")[0]}</> : null}</b> <span className="text-ink-2">: es-tu sûr de gagner ? Plus tu mises haut, plus tu gagnes… ou perds de points ELO. Secrète jusqu&apos;au lancement du match.</span></p>
      {!opponent && <PersonPicker people={roster} value={pick} onChange={setPick} label="Mon prochain adversaire" placeholder="Tape son nom…" />}
      {opp && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {BET_LEVELS.map((c) => {
              const t = table[c];
              return (
                <button key={c} type="button" disabled={pending} onClick={() => place(c)} aria-pressed={current === c} className={cx("rounded-xl border-2 px-1.5 py-1.5 text-center leading-tight transition active:scale-[0.98]", current === c ? "border-brand bg-brand-soft" : "border-line bg-paper")}>
                  <span className="block font-display text-xl font-extrabold">{c}</span>
                  <span className="block text-[10px] font-bold text-ink-2">{BET_TEXT[c]} · {multText(c)}</span>
                  <span className="block text-[11px] tabular-nums"><span className="text-success-ink font-bold">+{t.win}</span> / <span className="text-danger-ink font-bold">−{t.lose}</span></span>
                </button>
              );
            })}
          </div>
          <p className={ui.hint}>{current !== null ? <>Ta mise : <b>{current}</b> ({multText(current)}). Tu peux la changer jusqu&apos;au lancement du match.</> : "Pas encore de mise : sans mise, ton ELO bouge normalement (×1)."} Chiffres pour un match serré{data.even ? " à handicap (chances égales)" : ""} ; un score très large compte un peu plus.</p>
        </>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
    </section>
  );
}
