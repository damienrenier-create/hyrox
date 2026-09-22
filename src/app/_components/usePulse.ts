"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Interroge un « pouls » serveur (quelques compteurs) et ne recharge la page QUE s'il a change.
// Une page inactive ne declenche plus aucun rendu, un onglet cache ne sonde rien, et la base n'est
// reveillee que par des requetes minuscules. Voir src/lib/pulse.ts.
export function usePulse(fetchPulse: () => Promise<string>, intervalMs: number, enabled = true, onChange?: () => void) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const busy = useRef(false);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (stop || busy.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const p = await fetchPulse();
        if (stop || !p) return;
        if (last.current === null) last.current = p;
        else if (p !== last.current) {
          last.current = p;
          if (cb.current) cb.current();
          else router.refresh();
        }
      } catch {
        /* reseau : on retentera au prochain tick */
      } finally {
        busy.current = false;
      }
    };
    const t = setInterval(tick, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [fetchPulse, intervalMs, enabled, router]);
}
