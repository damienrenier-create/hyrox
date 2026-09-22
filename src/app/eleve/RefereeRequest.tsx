"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { REFEREE_REASONS } from "@/lib/session-roles";
import { cancelRefereeRequestAction, requestRefereeAction } from "./referee-actions";

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

  // En attente : on re-verifie toutes les 5 s (le greffier accepte depuis l'ecran projete).
  useEffect(() => {
    if (status !== "PENDING") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [status, router]);

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
      <div className="bg-amber-50 border-2 border-amber-300 rounded-xl py-3 px-3 text-xs leading-snug">
        <span className="font-black text-amber-900 block mb-1">🏴‍☠️ Demande envoyée{note ? ` · ${note}` : ""}</span>
        <span className="text-amber-800">En attente du greffier ou d'un prof… cette carte se mettra à jour toute seule.</span>
        <button onClick={cancel} disabled={pending} className="block mt-2 text-[11px] font-bold text-amber-900 underline disabled:opacity-50">Annuler la demande</button>
      </div>
    );
  }

  return (
    <div className="bg-slate-100 text-slate-600 rounded-xl py-3 px-3 text-xs leading-snug">
      <span className="font-black text-slate-800 block mb-1">🏴‍☠️ Arbitre</span>
      {status === "REFUSED" && <span className="block text-red-700 font-bold mb-1">Demande refusée{note ? ` (${note})` : ""}.</span>}
      <span className="block mb-2">
        {inTeam ? `Tu es dans ${inTeam}. Si tu arrêtes, indique pourquoi :` : "Pour arbitrer, indique pourquoi tu ne joues pas :"}
      </span>
      <div className="flex flex-wrap gap-1 mb-2">
        {REFEREE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`text-[11px] font-bold px-2 py-1 rounded-full border-2 ${reason === r ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-300 text-slate-600"}`}
          >
            {r}
          </button>
        ))}
      </div>
      {error && <span className="block text-red-600 font-bold mb-1">{error}</span>}
      <button
        onClick={send}
        disabled={!reason || pending}
        className="w-full bg-[#062230] disabled:bg-slate-300 text-amber-300 disabled:text-slate-500 font-black py-2 rounded-lg"
      >
        {pending ? "…" : "Demander l'autorisation"}
      </button>
    </div>
  );
}
