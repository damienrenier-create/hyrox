"use client";

import { useEffect, useRef, useState } from "react";
import { btn, cx, ui } from "@/lib/ui";

// Rappel de l'auto-evaluation de badminton (Sartay 24/11 : « je voudrais inviter, a partir des 10 dernieres minutes de la
// seance, a bien remplir son auto-eval ») : il apparait tout seul 10 min avant la fin du cours (heure du serveur), tant
// que l'auto-evaluation n'est pas envoyee, et jusqu'a la fin de la fenetre (24 h apres le cours). Une vibration quand il
// apparait pendant que la page est ouverte. `chip` : la petite version de la carte « Badminton » de l'accueil.
export const NUDGE_BEFORE_MS = 10 * 60_000;
// modalKey (26/11 soir, Sartay : « fin de seance, durant les 10 dernieres minutes, faut les pousser a completer leur
// auto-eval ») : en plus du bandeau, une fenetre plein ecran s'ouvre UNE fois par cours (retenu sur ce telephone).
export function SelfEvalNudge({ closesAt, windowEnd, serverNow, sent, chip = false, modalKey }: { closesAt: number | null; windowEnd: number; serverNow: number; sent: boolean; chip?: boolean; modalKey?: string }) {
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState<number | null>(null);
  const shownBefore = useRef<boolean | null>(null);
  const [opened, setOpened] = useState(false); // l'eleve est alle a sa grille : le bandeau ne la cache plus
  const [modal, setModal] = useState(false);
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
    if (show && !chip && modalKey) {
      let seen = false;
      try { seen = localStorage.getItem(modalKey) === "1"; localStorage.setItem(modalKey, "1"); } catch { /* stockage indisponible */ }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!seen) setModal(true);
    }
  }, [show, now, chip, modalKey]);
  if (!show || closesAt === null || now === null) return null;
  const left = Math.max(0, Math.ceil((closesAt - now) / 60_000));
  if (chip) return <span className={cx(ui.chip, ui.chipWarn, "animate-pulse")}>📝 Auto-évaluation à remplir</span>;
  const open = () => {
    const d = document.querySelector<HTMLDetailsElement>("#auto-eval details");
    if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
    setOpened(true);
  };
  return (
    <>
    {modal && (
      <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-label="Auto-évaluation">
        <div className="max-w-sm w-full rounded-3xl bg-card border-4 border-amber-400 shadow-2xl p-5 space-y-3 text-center">
          <p className="text-5xl">📝</p>
          <p className="font-display text-xl font-extrabold">{now < closesAt ? `Plus que ${left} minute${left > 1 ? "s" : ""} de cours !` : "Le cours est terminé !"}</p>
          <p className="text-sm">C&apos;est le moment de remplir ton auto-évaluation, pendant que tout est encore frais. Sans elle, pas de classement ELO !</p>
          <button type="button" onClick={() => { setModal(false); open(); }} className={cx(btn.primary, "w-full py-3 text-base")}>Remplir mon auto-évaluation</button>
          <button type="button" onClick={() => setModal(false)} className="text-sm text-ink-2 underline">Dans un instant</button>
        </div>
      </div>
    )}
    <div className={cx("rounded-2xl border-2 border-amber-400 bg-amber-50 text-amber-950 px-3 py-2 shadow-card space-y-1.5", !opened && "sticky top-2 z-30")} role="status">
      <p className="text-sm">
        📝 <b>{now < closesAt ? `Le cours se termine dans ${left} min` : "Le cours est terminé"}</b> : prends le temps de bien remplir ton auto-évaluation, critère par critère, honnêtement. Sans elle, pas de classement ELO.
      </p>
      <button type="button" onClick={open} className={cx(btn.primary, "w-full")}>Remplir mon auto-évaluation</button>
    </div>
    </>
  );
}
