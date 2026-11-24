"use client";

import { useEffect, useRef, useState } from "react";
import { btn, cx, ui } from "@/lib/ui";

// Rappel de l'auto-evaluation de badminton (Sartay 24/11 : « je voudrais inviter, a partir des 10 dernieres minutes de la
// seance, a bien remplir son auto-eval ») : il apparait tout seul 10 min avant la fin du cours (heure du serveur), tant
// que l'auto-evaluation n'est pas envoyee, et jusqu'a la fin de la fenetre (24 h apres le cours). Une vibration quand il
// apparait pendant que la page est ouverte. `chip` : la petite version de la carte « Badminton » de l'accueil.
export const NUDGE_BEFORE_MS = 10 * 60_000;
export function SelfEvalNudge({ closesAt, windowEnd, serverNow, sent, chip = false }: { closesAt: number | null; windowEnd: number; serverNow: number; sent: boolean; chip?: boolean }) {
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState<number | null>(null);
  const shownBefore = useRef<boolean | null>(null);
  const [opened, setOpened] = useState(false); // l'eleve est alle a sa grille : le bandeau ne la cache plus
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const h = setInterval(tick, 15_000);
    return () => clearInterval(h);
  }, [offset]);
  const show = !sent && closesAt !== null && now !== null && now >= closesAt - NUDGE_BEFORE_MS && now < windowEnd;
  useEffect(() => {
    if (now === null) return;
    if (shownBefore.current === false && show && !chip) { try { navigator.vibrate?.([200, 100, 200]); } catch { /* vibreur absent */ } }
    shownBefore.current = show;
  }, [show, now, chip]);
  if (!show || closesAt === null || now === null) return null;
  const left = Math.max(0, Math.ceil((closesAt - now) / 60_000));
  if (chip) return <span className={cx(ui.chip, ui.chipWarn, "animate-pulse")}>📝 Auto-évaluation à remplir</span>;
  const open = () => {
    const d = document.querySelector<HTMLDetailsElement>("#auto-eval details");
    if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
    setOpened(true);
  };
  return (
    <div className={cx("rounded-2xl border-2 border-amber-400 bg-amber-50 text-amber-950 px-3 py-2 shadow-card space-y-1.5", !opened && "sticky top-2 z-30")} role="status">
      <p className="text-sm">
        📝 <b>{now < closesAt ? `Le cours se termine dans ${left} min` : "Le cours est terminé"}</b> : prends le temps de bien remplir ton auto-évaluation, critère par critère, honnêtement.
      </p>
      <button type="button" onClick={open} className={cx(btn.primary, "w-full")}>Remplir mon auto-évaluation</button>
    </div>
  );
}
