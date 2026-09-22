"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { decideRefereeAction, listPendingRequestsAction, type PendingRequest } from "./referee-decisions";
import { btn, ui } from "@/lib/ui";

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
    }, 8000);
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
            className="pointer-events-auto bg-card text-ink border-2 border-accent rounded-2xl p-3 shadow-pop"
          >
            <div className={`${ui.eyebrow} text-accent-ink mb-1`}>🏴‍☠️ Demande d&apos;arbitrage</div>
            <div className="font-display font-extrabold text-base leading-tight">{r.name} <span className="text-ink-3 font-sans font-bold text-sm">· {r.className ?? "?"}</span></div>
            <div className="text-xs text-ink-2 mb-2">
              Motif : <b className="text-ink">{r.note ?? "—"}</b>
              {r.teamName && <> · participait dans {r.teamName}</>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => decide(r.userId, "APPROVED")} disabled={pending} className={btn.success}>Accepter</button>
              <button onClick={() => decide(r.userId, "REFUSED")} disabled={pending} className={btn.danger}>Refuser</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
