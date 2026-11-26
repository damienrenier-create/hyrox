"use client";

import { useEffect, useState } from "react";
import type { QualityCode } from "@/lib/wod-engines/core/quality";
import { readSelfEvalDraft, writeSelfEvalDraft } from "../../SelfEvalGrid";
import { btn, cx, ui } from "@/lib/ui";

// Pour que TOUS les eleves remplissent leur auto-evaluation de badminton (Sartay 26/11 soir : « il n'y a que deux eleves
// qui ont rempli leur auto-eval ; avant d'encoder un match, il peut deja noter sa forme du jour (uniquement ca) pour ne
// pas perdre de temps ; apres chaque match, un petit rappel : veux-tu t'auto-evaluer maintenant ? »).

// Ouvre la grille de la page (section #auto-eval) et la fait defiler.
export function openSelfEvalGrid() {
  const d = document.querySelector<HTMLDetailsElement>("#auto-eval details");
  if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

// ===== 1. La forme du jour, avant le premier match =====
// Une seule ligne de la grille, notee en un toucher ; elle est deja cochee quand l'eleve ouvre sa grille a la fin (brouillon
// sur ce telephone, rien n'est envoye avant « Envoyer mon auto-évaluation »).
const FORMS: { code: QualityCode; emoji: string; name: string }[] = [
  { code: "TI", emoji: "😫", name: "Pas en forme du tout" },
  { code: "I", emoji: "😕", name: "Petite forme" },
  { code: "S", emoji: "😐", name: "Forme moyenne" },
  { code: "B", emoji: "🙂", name: "Bonne forme" },
  { code: "TB", emoji: "😄", name: "Très bonne forme" },
  { code: "E", emoji: "🔥", name: "Pleine forme" },
];
export function FormeQuick({ sessionId }: { sessionId: string }) {
  const [forme, setForme] = useState<string | null | undefined>(undefined); // undefined = pas encore lu (rendu serveur)
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForme(readSelfEvalDraft(sessionId).forme ?? null);
  }, [sessionId]);
  if (forme === undefined) return null;
  const pick = (code: QualityCode) => {
    writeSelfEvalDraft(sessionId, { ...readSelfEvalDraft(sessionId), forme: code });
    setForme(code);
    setEdit(false);
  };
  const cur = FORMS.find((f) => f.code === forme) ?? null;
  if (cur && !edit) {
    return (
      <p className="rounded-xl bg-card border border-line px-3 py-2 text-sm flex items-center justify-between gap-2">
        <span>⚡ Ma forme du jour : <b>{cur.emoji} {cur.name}</b> <span className="text-ink-3">· le reste de l&apos;auto-éval à la fin</span></span>
        <button type="button" onClick={() => setEdit(true)} className="text-xs font-bold text-brand underline">changer</button>
      </p>
    );
  }
  return (
    <section className={cx(ui.card, "p-3 space-y-2 border-2 border-accent")} aria-label="Ma forme du jour">
      <p className="text-sm"><b>⚡ Avant ton premier match : ta forme du jour ?</b> <span className="text-ink-2">Un toucher, c&apos;est tout (une ligne de ton auto-évaluation déjà faite).</span></p>
      <div className="grid grid-cols-3 gap-1.5">
        {FORMS.map((f) => (
          <button key={f.code} type="button" onClick={() => pick(f.code)} className={cx("rounded-xl border-2 px-1.5 py-2 text-center leading-tight active:scale-[0.98] transition", forme === f.code ? "border-brand bg-brand-soft" : "border-line bg-paper")}>
            <span className="block text-2xl">{f.emoji}</span>
            <span className="block text-[11px] font-bold">{f.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ===== 2. Apres chaque match : « Tu veux t'auto-evaluer maintenant ? » =====
// `played` = mes matchs de ce cours qui ont un score (ni en direct, ni annules). Quand il augmente (la page se met a jour
// toute seule), une petite fenetre propose de remplir l'auto-evaluation ; « Plus tard » la ferme jusqu'au match suivant.
// Pas pendant les 10 dernieres minutes : le rappel de fin de cours (SelfEvalNudge) prend le relais.
const seenKey = (sessionId: string) => `reps_bm_ae_seen_${sessionId}`;
export function AfterMatchPrompt({ sessionId, played, closesAt, serverNow }: { sessionId: string; played: number; closesAt: number | null; serverNow: number }) {
  const [seen, setSeen] = useState<number | null>(null);
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let v = 0;
    try { v = Number(localStorage.getItem(seenKey(sessionId)) ?? 0) || 0; } catch { /* stockage indisponible */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(v);
  }, [sessionId]);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const h = setInterval(tick, 30_000);
    return () => clearInterval(h);
  }, [offset]);
  if (seen === null || now === null || played <= seen) return null;
  if (closesAt !== null && now >= closesAt - 10 * 60_000) return null;
  const done = () => { try { localStorage.setItem(seenKey(sessionId), String(played)); } catch { /* stockage indisponible */ } setSeen(played); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3" role="dialog" aria-label="Auto-évaluation après ton match">
      <div className="max-w-xl mx-auto rounded-2xl border-2 border-accent bg-card shadow-2xl p-4 space-y-2">
        <p className="font-display text-lg font-extrabold">🏸 Match terminé !</p>
        <p className="text-sm">Tu veux t&apos;auto-évaluer maintenant, pendant que c&apos;est frais ? 2 minutes, et c&apos;est fait (tu pourras encore la corriger à la fin du cours).</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => { done(); openSelfEvalGrid(); }} className={cx(btn.primary, "flex-1")}>📝 Oui, maintenant</button>
          <button type="button" onClick={done} className={btn.ghost}>Plus tard</button>
        </div>
      </div>
    </div>
  );
}
