"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hideNoteAction, snoozeNotesAction } from "@/app/admin/notes/actions";
import { fmtDay, noteIcon, type NoteView } from "@/lib/student-notes";
import { btn, ui } from "@/lib/ui";

// Notes perso en DEBUT DE COURS (Sartay 13/11) : la fenetre s'ouvre d'office (auto) ; chaque note propose « 🔁 Me le
// rappeler au prochain cours » ou « 🙈 Ne plus me la montrer ». Fermer sans choisir : elle reviendra au prochain
// affichage. auto=false : un simple bouton « 📝 n » (ecran qui peut etre projete).
export function NotesPopup({ notes, title, auto = true }: { notes: NoteView[]; title: string; auto?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(auto);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const left = notes.filter((n) => !done.has(n.id));
  if (!left.length) return null;
  function act(ids: string[], run: () => Promise<{ ok: true } | { error: string }>) {
    setError("");
    start(async () => {
      const r = await run();
      if ("error" in r) { setError(r.error); return; }
      setDone((d) => new Set([...d, ...ids]));
      router.refresh();
    });
  }
  // Une note reportee l'est pour la seance ou elle s'affiche.
  const snooze = (list: NoteView[]) => act(list.map((n) => n.id), async () => {
    for (const sid of [...new Set(list.map((n) => n.sessionId).filter((x): x is string => !!x))]) {
      const r = await snoozeNotesAction(list.filter((n) => n.sessionId === sid).map((n) => n.id), sid);
      if ("error" in r) return r;
    }
    return { ok: true };
  });
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={btn.smGhost} title="Mes notes sur les élèves de ce cours">📝 {left.length}</button>;
  const day = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Brussels" });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-auto" role="dialog" aria-modal="true" aria-label="Mes notes sur les élèves">
      <div className={`${ui.cardPad} w-full max-w-lg space-y-3`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={ui.eyebrow}>📝 Mes notes · début de cours</p>
            <h3 className={ui.h3}>{title}</h3>
          </div>
          <button type="button" onClick={() => setOpen(false)} className={ui.close} aria-label="Fermer (les notes reviendront)">✕</button>
        </div>
        {left.map((n) => (
          <div key={n.id} className="rounded-xl border border-line p-3 space-y-2" data-note={n.id}>
            <p className="text-sm"><span className="text-lg" aria-hidden>{noteIcon(n.category)}</span> <b>{n.studentName}</b> <span className="text-xs text-ink-3">{n.className}</span></p>
            <p className="whitespace-pre-wrap">{n.text}</p>
            <p className={ui.hint}>Notée le {day(n.createdAt)}{n.until ? ` · jusqu'au ${fmtDay(n.until)}` : ""}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={pending} onClick={() => snooze([n])} className={btn.smGhost}>🔁 Me le rappeler au prochain cours</button>
              <button type="button" disabled={pending} onClick={() => act([n.id], () => hideNoteAction(n.id))} className={btn.smGhost}>🙈 Ne plus me la montrer</button>
            </div>
          </div>
        ))}
        {error && <p className={ui.alertErr}>{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {left.length > 1 ? <button type="button" disabled={pending} onClick={() => snooze(left)} className={btn.smPrimary}>🔁 Tout me rappeler au prochain cours</button> : <span />}
          <Link href="/admin/notes" className="text-sm underline">Toutes mes notes</Link>
        </div>
      </div>
    </div>
  );
}
