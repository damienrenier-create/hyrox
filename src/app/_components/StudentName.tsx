"use client";

import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addNoteAction, hideNoteAction, studentNotesAction, unhideNoteAction } from "@/app/admin/notes/actions";
import { NOTE_CATEGORIES, fmtDay, noteIcon, type NoteCategory, type NoteView } from "@/lib/student-notes";
import { btn, cx, ui } from "@/lib/ui";

// Le nom d'un eleve, CLIQUABLE partout chez les profs (Sartay 15/11 : « est-ce que je peux mettre une note sur un eleve en
// cliquant sur son profil a partir d'une page tournoi, ou de n'importe quel endroit ? il faudrait que le prenom et le
// nom soient un lien avec mes notes de prof ») : ouvre SUR PLACE mes notes sur cet eleve (masquer, reactiver, en ajouter
// une) et un lien vers sa fiche. Un petit 📝 suit le nom des eleves qui ont une note active (NotedProvider).

const NotedContext = createContext<ReadonlySet<string>>(new Set());
export function NotedProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const set = useMemo(() => new Set(ids), [ids]);
  return <NotedContext.Provider value={set}>{children}</NotedContext.Provider>;
}

type Loaded = { error: string } | { student: { id: string; name: string; className: string | null }; notes: NoteView[] };

export function StudentName({ id, name, children, className }: { id: string; name: string; children?: ReactNode; className?: string }) {
  const noted = useContext(NotedContext).has(id);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, start] = useTransition();
  const load = () => start(async () => {
    const r = await studentNotesAction(id);
    setData("error" in r ? { error: r.error } : { student: r.student, notes: r.notes });
  });
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); load(); }}
        className={cx("text-left underline decoration-dotted decoration-1 underline-offset-2 hover:decoration-solid cursor-pointer", className)}
        title={`Mes notes sur ${name}`}
      >
        {children ?? name}
        {noted && <span className="ml-0.5" aria-label="(a une note)" title="Vous avez une note sur cet élève">📝</span>}
      </button>
      {open && createPortal(<NotesDialog name={name} data={data} loading={loading} reload={load} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function NotesDialog({ name, data, loading, reload, onClose }: { name: string; data: Loaded | null; loading: boolean; reload: () => void; onClose: () => void }) {
  const router = useRouter();
  const [category, setCategory] = useState<NoteCategory | null>(null);
  const [text, setText] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const student = data && "student" in data ? data.student : null;
  const day = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
  function run(fn: () => Promise<{ ok: true } | { error: string }>, done?: () => void) {
    setError("");
    setSaved("");
    start(async () => {
      const r = await fn();
      if ("error" in r) { setError(r.error); return; }
      done?.();
      reload();
      router.refresh();
    });
  }
  const add = () => {
    if (!student) return;
    run(() => addNoteAction({ studentId: student.id, category, text, until: until || null }), () => { setText(""); setUntil(""); setCategory(null); setSaved("Note enregistrée."); });
  };
  const seg = (on: boolean) => cx("text-xs font-bold px-2 py-1 rounded-lg whitespace-nowrap", on ? ui.segOn : ui.segOff);
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-auto text-left font-normal text-ink" role="dialog" aria-modal="true" aria-label={`Mes notes sur ${name}`} onClick={onClose}>
      <div className={`${ui.cardPad} w-full max-w-md space-y-3`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={ui.eyebrow}>📝 Mes notes</p>
            <h3 className={ui.h3}>{student?.name ?? name} {student?.className && <span className="text-ink-3 text-sm font-sans font-normal">{student.className}</span>}</h3>
          </div>
          <button type="button" onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {!data && <p className={ui.hint}>Chargement…</p>}
        {data && "error" in data && <p className={ui.alertWarn}>{data.error}</p>}
        {student && data && "notes" in data && (
          <>
            {data.notes.length === 0 ? <p className={ui.hint}>Aucune note sur cet élève.</p> : (
              <div className="space-y-2 max-h-64 overflow-auto">
                {data.notes.map((n) => (
                  <div key={n.id} className={cx("rounded-xl border border-line p-2 flex items-start gap-2", n.hiddenAt !== null && "opacity-70")}>
                    <span className="text-lg" aria-hidden>{noteIcon(n.category)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="whitespace-pre-wrap text-sm">{n.text}</p>
                      <p className={ui.hint}>notée le {day(n.createdAt)}{n.until ? ` · jusqu'au ${fmtDay(n.until)}` : ""}{n.hiddenAt ? ` · masquée le ${day(n.hiddenAt)}` : ""}</p>
                    </div>
                    <button type="button" disabled={pending} onClick={() => run(() => (n.hiddenAt ? unhideNoteAction(n.id) : hideNoteAction(n.id)))} className={btn.smGhost}>{n.hiddenAt ? "↩︎ Réactiver" : "🙈 Masquer"}</button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2 border-t border-line pt-3">
              <div className={cx(ui.segmented, "flex-wrap")}>
                {NOTE_CATEGORIES.map((c) => <button key={c.id} type="button" onClick={() => setCategory(category === c.id ? null : c.id)} className={seg(category === c.id)}>{c.icon} {c.name}</button>)}
              </div>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} placeholder="Nouvelle note (vous seul la verrez)" className={ui.input} aria-label="Nouvelle note" />
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={`${ui.input} w-auto`} aria-label="Jusqu'au (facultatif)" title="Jusqu'au (facultatif)" />
                <button type="button" disabled={pending || !text.trim()} onClick={add} className={btn.smPrimary}>{pending ? "…" : "Ajouter la note"}</button>
                <Link href={`/admin/eleves/${student.id}`} className="ml-auto text-sm underline">Sa fiche →</Link>
              </div>
            </div>
          </>
        )}
        {loading && data && <p className={ui.hint}>Mise à jour…</p>}
        {error && <p className={ui.alertErr}>{error}</p>}
        {saved && <p className={ui.alertOk}>✅ {saved}</p>}
      </div>
    </div>
  );
}
