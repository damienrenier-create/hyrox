"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voteCoachAction } from "../../badminton-actions";
import type { BmPersonRef } from "@/lib/badminton";
import { VOTE_KINDS, type VoteKind } from "@/lib/badminton-vote";
import { cx, ui } from "@/lib/ui";

// Les votes de fin de cours (Sartay 27/11) : 👑 le meilleur coach de sa poule (son equipe), 💪 l'adversaire du jour le plus
// difficile a jouer, 🤝 le plus agreable a jouer. Secrets ; on peut changer d'avis jusqu'a 24 h apres le cours.
export type VoteData = { kind: VoteKind; where?: string; candidates: BmPersonRef[]; mine: string | null };
export function VoteBox({ sessionId, votes }: { sessionId: string; votes: VoteData[] }) {
  return (
    <section className={cx(ui.card, "p-3 space-y-3 border-2 border-brand")} aria-label="Votes de fin de cours">
      <p className="text-sm"><b>🗳️ Les votes de fin de cours</b> <span className="text-ink-2">· secrets, un vote par question, jamais pour toi.</span></p>
      {votes.map((v) => <OneVote key={v.kind} sessionId={sessionId} v={v} />)}
    </section>
  );
}
function OneVote({ sessionId, v }: { sessionId: string; v: VoteData }) {
  const router = useRouter();
  const meta = VOTE_KINDS.find((k) => k.id === v.kind)!;
  const [pick, setPick] = useState<string | null>(v.mine);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const vote = (id: string) => {
    setError("");
    const before = pick;
    setPick(id);
    start(async () => {
      const r = await voteCoachAction(sessionId, id, v.kind);
      if ("error" in r) { setError(r.error); setPick(before); } else router.refresh();
    });
  };
  return (
    <div className="space-y-1.5" aria-label={meta.title}>
      <p className="text-sm"><b>{meta.emoji} {meta.title}{v.where ? ` de ${v.where}` : ""}</b> <span className="text-ink-2">{meta.hint}</span></p>
      <div className="grid grid-cols-2 gap-1.5">
        {v.candidates.map((p) => (
          <button key={p.id} type="button" disabled={pending} onClick={() => vote(p.id)} aria-pressed={pick === p.id} className={cx("rounded-xl border-2 px-2 py-2 text-sm font-bold text-left leading-tight transition active:scale-[0.98]", pick === p.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-paper")}>
            {pick === p.id ? "✅ " : ""}{p.name}
          </button>
        ))}
      </div>
      {error && <p className={ui.alertErr}>{error}</p>}
    </div>
  );
}
