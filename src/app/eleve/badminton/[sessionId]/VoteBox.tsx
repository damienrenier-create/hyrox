"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voteCoachAction } from "../../badminton-actions";
import type { BmPersonRef } from "@/lib/badminton";
import { cx, ui } from "@/lib/ui";

// Vote du meilleur coach (Sartay 27/11) : a la fin du cours, chaque joueur choisit le meilleur coach de sa poule (de son
// equipe) ; il peut changer d'avis jusqu'a 24 h apres le cours.
export function VoteBox({ sessionId, candidates, mine, where }: { sessionId: string; candidates: BmPersonRef[]; mine: string | null; where: string }) {
  const router = useRouter();
  const [pick, setPick] = useState<string | null>(mine);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const vote = (id: string) => {
    setError("");
    const before = pick;
    setPick(id);
    start(async () => {
      const r = await voteCoachAction(sessionId, id);
      if ("error" in r) { setError(r.error); setPick(before); } else router.refresh();
    });
  };
  return (
    <section className={cx(ui.card, "p-3 space-y-2 border-2 border-brand")} aria-label="Vote du meilleur coach">
      <p className="text-sm"><b>🗳️ Qui a été le meilleur coach de {where} aujourd&apos;hui ?</b> <span className="text-ink-2">Celui qui t&apos;a donné les meilleurs conseils, à toi ou aux autres. Ton vote est secret.</span></p>
      <div className="grid grid-cols-2 gap-1.5">
        {candidates.map((p) => (
          <button key={p.id} type="button" disabled={pending} onClick={() => vote(p.id)} aria-pressed={pick === p.id} className={cx("rounded-xl border-2 px-2 py-2 text-sm font-bold text-left leading-tight transition active:scale-[0.98]", pick === p.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-paper")}>
            {pick === p.id ? "✅ " : ""}{p.name}
          </button>
        ))}
      </div>
      <p className={ui.hint}>{pick ? "Merci ! Tu peux encore changer d'avis jusqu'à demain." : "Un seul vote, pas pour toi-même."}</p>
      {error && <p className={ui.alertErr}>{error}</p>}
    </section>
  );
}
