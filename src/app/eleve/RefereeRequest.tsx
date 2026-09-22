"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { REFEREE_REASONS } from "@/lib/session-roles";
import { cancelRefereeRequestAction, requestRefereeAction } from "./referee-actions";
import { myRefereeStatusPulseAction } from "@/lib/pulse";
import { usePulse } from "../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";

type Props = {
  sessionId: string;
  status: "PENDING" | "REFUSED" | null;
  note: string | null;
  inTeam: string | null; // nom de l'equipe si participant
};

// Carte « Arbitre » de l'eleve tant qu'il n'est pas autorise : demande (motif obligatoire), attente (polling), refus.
export function RefereeRequest({ sessionId, status, note, inTeam }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // En attente : on interroge SON statut (une requete) et on ne recharge la page que s'il a change.
  const pulse = useCallback(() => myRefereeStatusPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 6000, status === "PENDING");

  function send() {
    if (!reason) return;
    setError("");
    startTransition(async () => {
      const res = await requestRefereeAction(sessionId, reason);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  function cancel() {
    startTransition(async () => {
      await cancelRefereeRequestAction(sessionId);
      router.refresh();
    });
  }

  if (status === "PENDING") {
    return (
      <div className="bg-warn-soft border-2 border-warn/60 rounded-xl py-3 px-3 text-xs leading-snug">
        <span className="font-extrabold text-warn-ink block mb-1">🏴‍☠️ Demande envoyée{note ? ` · ${note}` : ""}</span>
        <span className="text-warn-ink/90">En attente du greffier ou d&apos;un prof… cette carte se mettra à jour toute seule.</span>
        <button onClick={cancel} disabled={pending} className="block mt-2 text-[11px] font-bold text-warn-ink underline disabled:opacity-50">Annuler la demande</button>
      </div>
    );
  }

  return (
    <div className="bg-paper border border-line text-ink-2 rounded-xl py-3 px-3 text-xs leading-snug">
      <span className="font-extrabold text-ink block mb-1">🏴‍☠️ Arbitre</span>
      {status === "REFUSED" && <span className="block text-danger-ink font-bold mb-1">Demande refusée{note ? ` (${note})` : ""}.</span>}
      <span className="block mb-2">
        {inTeam ? `Tu es dans ${inTeam}. Si tu arrêtes, indique pourquoi :` : "Pour arbitrer, indique pourquoi tu ne joues pas :"}
      </span>
      <div className="flex flex-wrap gap-1 mb-2">
        {REFEREE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={cx(ui.pill, "text-[11px] px-2 py-1", reason === r ? ui.pillOn : ui.pillOff)}
          >
            {r}
          </button>
        ))}
      </div>
      {error && <span className="block text-danger-ink font-bold mb-1">{error}</span>}
      <button onClick={send} disabled={!reason || pending} className={`${btn.sea} w-full`}>
        {pending ? "…" : "Demander l'autorisation"}
      </button>
    </div>
  );
}
