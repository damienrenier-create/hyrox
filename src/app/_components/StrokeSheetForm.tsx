"use client";

import { useState, useTransition } from "react";
import { STROKES, strokeLevel, type StrokeId, type StrokeMark, type StrokeSheet } from "@/lib/badminton-scout";
import { scoutStrokesAction } from "@/app/eleve/badminton-actions";
import { btn, cx, ui } from "@/lib/ui";

// Fiche technique remplie par un scout (Sartay 24/11 : « eval simplifiee des mouvements de base, que les joueurs
// rempliraient lors d'un scouting d'un autre eleve ; comme en Hyrox, les 4 criteres les plus importants + emoji ») :
// pour chaque coup VU pendant le match, cocher les criteres reussis ; ❤️ quand les 4 sont vraiment tres bien faits.
export function StrokeSheetForm({ matchId, player, onDone, onClose }: { matchId: string; player: { id: string; name: string }; onDone: () => void; onClose: () => void }) {
  const [sheet, setSheet] = useState<StrokeSheet>({});
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (id: StrokeId, m: StrokeMark | undefined) => setSheet((s) => { const n = { ...s }; if (m) n[id] = m; else delete n[id]; return n; });
  const seen = Object.keys(sheet).length;
  function send() {
    setError("");
    start(async () => {
      const r = await scoutStrokesAction(matchId, player.id, { strokes: sheet });
      if ("error" in r) setError(r.error);
      else onDone();
    });
  }
  return (
    <section className={cx(ui.card, "p-3 space-y-3 border-brand")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-extrabold">🔭 Fiche technique de {player.name}</p>
        <button type="button" onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
      </div>
      <p className={ui.hint}>Regarde son match. Pour chaque coup que tu as vu, touche-le puis coche ce qui est réussi. ❤️ si les 4 sont vraiment très bien faits. Les coups pas vus restent vides.</p>
      {STROKES.map((s) => {
        const m = sheet[s.id];
        return (
          <div key={s.id} className={cx("rounded-xl border px-2 py-1.5", m ? "border-brand bg-brand-soft/40" : "border-line")}>
            <button type="button" onClick={() => set(s.id, m ? undefined : { c: [false, false, false, false], heart: false })} className="w-full flex items-center justify-between gap-2 text-left">
              <span className="font-bold">{s.emoji} {s.name}</span>
              <span className={cx(ui.chip, m ? ui.chipBrand : ui.chipMuted)}>{m ? `vu · ${strokeLevel(m)}` : "pas vu"}</span>
            </button>
            {m && (
              <div className="mt-1.5 space-y-1">
                {s.criteria.map((c, i) => (
                  <label key={i} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className={cx(ui.check, "mt-0.5")} checked={m.c[i]} onChange={(e) => { const c2 = [...m.c] as StrokeMark["c"]; c2[i] = e.target.checked; set(s.id, { c: c2, heart: m.heart && c2.every(Boolean) }); }} />
                    <span>{c}</span>
                  </label>
                ))}
                <button type="button" disabled={!m.c.every(Boolean)} onClick={() => set(s.id, { ...m, heart: !m.heart })} className={cx(ui.chip, m.heart ? "bg-red-100 text-red-700" : ui.chipMuted, "disabled:opacity-40")}>❤️ vraiment très bien fait{m.heart ? " ✓" : ""}</button>
              </div>
            )}
          </div>
        );
      })}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || !seen} onClick={send} className={cx(btn.primary, "w-full")}>{pending ? "Envoi…" : `Envoyer la fiche (${seen} coup${seen > 1 ? "s" : ""} observé${seen > 1 ? "s" : ""})`}</button>
    </section>
  );
}
