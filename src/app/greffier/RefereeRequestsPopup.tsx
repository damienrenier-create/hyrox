"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { decideRefereeAction, listPendingRequestsAction, type PendingRequest } from "./referee-decisions";

// Popup du greffier (ecran projete) : demandes d'arbitrage des eleves, rafraichies toutes les 5 s, meme
// quand la course n'est pas lancee. Accepter / refuser en un clic.
export function RefereeRequestsPopup({ sessionId, initial }: { sessionId: string; initial: PendingRequest[] }) {
  const router = useRouter();
  const [requests, setRequests] = useState<PendingRequest[]>(initial);
  const [pending, startTransition] = useTransition();
  const known = useRef(new Set(initial.map((r) => r.userId)));

  useEffect(() => {
    setRequests(initial);
  }, [initial]);

  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await listPendingRequestsAction(sessionId);
        setRequests(next);
        const fresh = next.some((r) => !known.current.has(r.userId));
        next.forEach((r) => known.current.add(r.userId));
        if (fresh) router.refresh(); // la liste des arbitres de l'onglet Equipes suit
      } catch {
        // reseau : on retentera au prochain tick
      }
    }, 5000);
    return () => clearInterval(t);
  }, [sessionId, router]);

  function decide(userId: string, decision: "APPROVED" | "REFUSED") {
    startTransition(async () => {
      await decideRefereeAction(sessionId, userId, decision);
      setRequests((rs) => rs.filter((r) => r.userId !== userId));
      router.refresh();
    });
  }

  return (
    <div className="fixed top-24 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] space-y-2 pointer-events-none">
      <AnimatePresence>
        {requests.map((r) => (
          <motion.div
            key={r.userId}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            className="pointer-events-auto bg-[#062230] text-amber-50 border-2 border-amber-400 rounded-2xl p-3 shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1">🏴‍☠️ Demande d'arbitrage</div>
            <div className="font-black text-base leading-tight">{r.name} <span className="text-amber-200/60 font-bold text-sm">· {r.className ?? "?"}</span></div>
            <div className="text-xs text-amber-100/80 mb-2">
              Motif : <b>{r.note ?? "—"}</b>
              {r.teamName && <> · participait dans {r.teamName}</>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => decide(r.userId, "APPROVED")} disabled={pending} className="bg-emerald-500 text-slate-950 font-black py-2 rounded-lg disabled:opacity-50">Accepter</button>
              <button onClick={() => decide(r.userId, "REFUSED")} disabled={pending} className="bg-red-700 text-red-50 font-black py-2 rounded-lg disabled:opacity-50">Refuser</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
