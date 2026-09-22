"use client";

import { useState } from "react";
import { CLEANUP_PHRASE } from "@/lib/session-roles";
import { purgeAction } from "./actions";
import { btn, cx, ui } from "@/lib/ui";

export type PurgeRow = {
  id: string;
  label: string;
  when: string;
  state: "ouverte" | "programmée" | "terminée";
  detail: string;
  protectedReason: string | null; // non pre-cochee, et affichee en garde-fou
};

// Grand menage : rien ne part tant que la phrase n'est pas tapee exactement. Les seances programmees
// ou ouvertes ne sont jamais cochees d'avance — il faut aller les decocher... pardon, les cocher soi-meme.
export function PurgeForm({ rows, pinCount, reliabilityCount }: { rows: PurgeRow[]; pinCount: number; reliabilityCount: number }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.protectedReason).map((r) => r.id)));
  const [pins, setPins] = useState(true);
  const [rel, setRel] = useState(true);
  const [phrase, setPhrase] = useState("");

  const ready = phrase.trim().toUpperCase() === CLEANUP_PHRASE && (picked.size > 0 || pins || rel);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const risky = rows.filter((r) => r.protectedReason && picked.has(r.id));

  return (
    <form action={purgeAction} className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className={ui.eyebrow}>Séances à supprimer définitivement ({picked.size}/{rows.length})</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPicked(new Set(rows.map((r) => r.id)))} className={btn.smSoft}>Tout cocher</button>
            <button type="button" onClick={() => setPicked(new Set())} className={btn.smSoft}>Tout décocher</button>
          </div>
        </div>
        <ul className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
          {rows.map((r) => {
            const on = picked.has(r.id);
            return (
              <li key={r.id}>
                <label
                  className={cx(
                    "flex items-start gap-3 rounded-xl border p-2.5 cursor-pointer transition",
                    on ? "bg-danger-soft border-danger/40" : "bg-paper border-line hover:border-line-2"
                  )}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className={`${ui.check} mt-0.5`} />
                  {on && <input type="hidden" name="session" value={r.id} />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-sm">
                      {r.label} <span className="font-normal text-ink-3">· {r.when}</span>
                      <span
                        className={cx(
                          ui.chip,
                          "ml-2",
                          r.state === "programmée" ? ui.chipAccent : r.state === "ouverte" ? ui.chipOk : ui.chipMuted
                        )}
                      >
                        {r.state}
                      </span>
                    </span>
                    <span className="block text-xs text-ink-2">{r.detail}</span>
                    {r.protectedReason && <span className="block text-xs font-bold text-warn-ink mt-0.5">⚠️ {r.protectedReason}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className={cx("flex items-start gap-3 rounded-xl border p-3 cursor-pointer", pins ? "bg-danger-soft border-danger/40" : "bg-paper border-line")}>
          <input type="checkbox" name="resetPins" checked={pins} onChange={(e) => setPins(e.target.checked)} className={`${ui.check} mt-0.5`} />
          <span>
            <span className="block font-bold text-sm">Remettre les codes PIN à zéro <span className="font-normal text-ink-3">({pinCount})</span></span>
            <span className={ui.hint}>Chaque élève en recréera un à sa prochaine connexion. Son compte, sa classe et son nom sont conservés.</span>
          </span>
        </label>
        <label className={cx("flex items-start gap-3 rounded-xl border p-3 cursor-pointer", rel ? "bg-danger-soft border-danger/40" : "bg-paper border-line")}>
          <input type="checkbox" name="resetReliability" checked={rel} onChange={(e) => setRel(e.target.checked)} className={`${ui.check} mt-0.5`} />
          <span>
            <span className="block font-bold text-sm">Remettre la fiabilité à zéro <span className="font-normal text-ink-3">({reliabilityCount})</span></span>
            <span className={ui.hint}>Score d&apos;arbitrage accumulé pendant les tests.</span>
          </span>
        </label>
      </div>

      {risky.length > 0 && (
        <p className={ui.alertWarn}>
          {risky.length > 1
            ? `⚠️ ${risky.length} séances protégées sont cochées : `
            : "⚠️ Une séance protégée est cochée : "}
          {risky.map((r) => r.label).join(", ")}. Décoche-la si tu ne veux pas la perdre.
        </p>
      )}

      <div className={`${ui.inset} p-3`}>
        <label className={ui.label} htmlFor="phrase">
          Pour confirmer, tape exactement : <b className="text-danger-ink tracking-wider">{CLEANUP_PHRASE}</b>
        </label>
        <input
          id="phrase"
          name="phrase"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
          placeholder={CLEANUP_PHRASE}
          className={`${ui.input} font-mono tracking-wider`}
        />
      </div>

      <button type="submit" disabled={!ready} className={`${btn.lgDanger} w-full`}>
        {ready ? "Supprimer définitivement" : "Tape la phrase pour débloquer"}
      </button>
    </form>
  );
}
