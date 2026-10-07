"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setObsWatchAction } from "./actions";
import { btn, cx, ui } from "@/lib/ui";

type Row = { userId: string; name: string; teamName: string; className: string | null; byDefault?: boolean };

// « Élèves à observer en priorité » : coches par equipe, invisibles pour les arbitres eleves (le tirage les sert d'abord, jamais deux
// arbitres en meme temps sur le meme eleve, jamais deux fois le meme arbitre) ; marque ★ pour les profs.
export function ObsWatchForm({ sessionId, rows, initial }: { sessionId: string; rows: Row[]; initial: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const [msg, setMsg] = useState("");
  const teams = [...new Set(rows.map((r) => r.teamName))];
  const dirty = sel.size !== initial.length || initial.some((id) => !sel.has(id));
  function save() {
    setMsg("");
    startTransition(async () => {
      const res = await setObsWatchAction(sessionId, [...sel]);
      if ("error" in res) { setMsg(res.error); return; }
      setMsg(res.n ? `${res.n} élève${res.n > 1 ? "s" : ""} à observer en priorité.` : "Plus personne en priorité.");
      router.refresh();
    });
  }
  return (
    <details className={ui.cardPad}>
      <summary className="cursor-pointer font-bold">★ Élèves à observer en priorité <span className={cx(ui.chip, sel.size ? ui.chipAccent : ui.chipMuted, "ml-1")}>{sel.size}</span></summary>
      <p className={`${ui.hint} mt-2`}>Les arbitres élèves ne le voient pas : le tirage au sort leur donne ces élèves en premier, jamais deux arbitres en même temps sur le même, jamais deux fois le même arbitre, jusqu&apos;à 2 observations chacun. Les profs voient une ★ dans leur liste. Les élèves marqués ★ sur leur fiche élève sont cochés d&apos;office (☆ fiche) ; les décocher ici ne vaut que pour cette séance.</p>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 mt-3">
        {teams.map((tn) => (
          <div key={tn} className="min-w-0">
            <p className={`${ui.eyebrow} mt-2`}>{tn}</p>
            {rows.filter((r) => r.teamName === tn).map((r) => (
              <label key={r.userId} className="flex items-center gap-2 py-0.5 text-sm cursor-pointer">
                <input type="checkbox" className={ui.check} checked={sel.has(r.userId)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.userId)) n.delete(r.userId); else n.add(r.userId); return n; })} />
                <span className="truncate">{r.name}</span><span className={ui.hint}>{r.className ?? ""}</span>{r.byDefault && <span className={ui.hint} title="Coché d'office : marqué « à observer en priorité » sur sa fiche élève">☆ fiche</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button type="button" onClick={save} disabled={pending || !dirty} className={btn.primary}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
        {msg && <span className={ui.muted}>{msg}</span>}
      </div>
    </details>
  );
}
