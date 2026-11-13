"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNoteAction, addPeriodAction, cancelPeriodAction, hideNoteAction, seePeriodAction, unhideNoteAction } from "./actions";
import { NOTE_CATEGORIES, type NoteCategory } from "@/lib/student-notes";
import { btn, cx, ui } from "@/lib/ui";

export type NoteRosterRow = { id: string; name: string; className: string | null };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Nouvelle note : l'eleve (recherche par nom ou classe), la categorie, le texte, une date de fin facultative.
export function NoteForm({ roster, preset }: { roster: NoteRosterRow[]; preset: string | null }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(preset && roster.some((r) => r.id === preset) ? preset : null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<NoteCategory | null>(null);
  const [text, setText] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const picked = roster.find((r) => r.id === studentId) ?? null;
  const hits = useMemo(() => {
    const f = fold(q.trim());
    if (f.length < 2) return [];
    return roster.filter((r) => fold(`${r.name} ${r.className ?? ""}`).includes(f)).slice(0, 8);
  }, [q, roster]);
  function save() {
    setError("");
    setSaved("");
    if (!studentId) { setError("Choisis un élève."); return; }
    start(async () => {
      const r = await addNoteAction({ studentId, category, text, until: until || null });
      if ("error" in r) { setError(r.error); return; }
      setSaved(`Note enregistrée pour ${picked?.name ?? "l'élève"}.`);
      setText("");
      setUntil("");
      setCategory(null);
      router.refresh();
    });
  }
  const seg = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg whitespace-nowrap", on ? ui.segOn : ui.segOff);
  return (
    <section id="nouvelle" className={`${ui.cardPad} space-y-3`}>
      <h3 className={ui.h3}>✍️ Nouvelle note</h3>
      <div>
        <span className={ui.label}>Élève</span>
        {picked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx(ui.chip, ui.chipBrand)}>{picked.name} · {picked.className ?? "sans classe"}</span>
            <button type="button" onClick={() => { setStudentId(null); setQ(""); }} className={btn.smGhost}>Changer</button>
          </div>
        ) : (
          <div className="space-y-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou classe de l'élève" className={ui.input} aria-label="Chercher un élève" />
            {hits.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {hits.map((h) => <button key={h.id} type="button" onClick={() => setStudentId(h.id)} className={btn.smGhost}>{h.name} <span className="text-ink-3 text-xs">{h.className}</span></button>)}
              </div>
            )}
          </div>
        )}
      </div>
      <div>
        <span className={ui.label}>Catégorie</span>
        <div className={cx(ui.segmented, "flex-wrap")}>
          {NOTE_CATEGORIES.map((c) => <button key={c.id} type="button" onClick={() => setCategory(category === c.id ? null : c.id)} className={seg(category === c.id)}>{c.icon} {c.name}</button>)}
        </div>
      </div>
      <div>
        <span className={ui.label}>La note</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} placeholder="ex. certificat médical jusqu'au 20/12 · pas en ordre administratif · pas sa tenue" className={ui.input} aria-label="Texte de la note" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className={ui.label}>Jusqu&apos;au (facultatif)</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={`${ui.input} w-auto`} aria-label="Date de fin de la note" />
        </label>
        <button type="button" disabled={pending} onClick={save} className={btn.primary}>{pending ? "Enregistrement…" : "Enregistrer la note"}</button>
      </div>
      <p className={ui.hint}>Seul vous la voyez. Elle s&apos;affiche au début de chaque cours de l&apos;élève jusqu&apos;à ce que vous choisissiez « Ne plus me la montrer » (ou après sa date de fin). Elle n&apos;est jamais effacée.</p>
      {error && <p className={ui.alertErr}>{error}</p>}
      {saved && <p className={ui.alertOk}>✅ {saved}</p>}
    </section>
  );
}

// Masquer / reactiver une note (rien n'est efface).
export function NoteToggle({ id, hidden }: { id: string; hidden: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = () => start(async () => { const r = await (hidden ? unhideNoteAction(id) : hideNoteAction(id)); if ("error" in r) setError(r.error); else router.refresh(); });
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={pending} onClick={run} className={btn.smGhost}>{hidden ? "↩︎ Réactiver" : "🙈 Masquer"}</button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

// Ajouter une fin de periode de bulletin.
export function PeriodForm() {
  const router = useRouter();
  const [endDate, setEndDate] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const add = () => start(async () => {
    setError("");
    const r = await addPeriodAction({ endDate, label });
    if ("error" in r) { setError(r.error); return; }
    setEndDate("");
    setLabel("");
    router.refresh();
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1"><span className={ui.label}>Fin de période</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`${ui.input} w-auto`} aria-label="Date de fin de période" /></label>
      <label className="space-y-1"><span className={ui.label}>Nom (facultatif)</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. bulletin de Noël" maxLength={60} className={`${ui.input} w-auto`} aria-label="Nom de la période" /></label>
      <button type="button" disabled={pending || !endDate} onClick={add} className={btn.smPrimary}>Ajouter</button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

export function PeriodCancel({ id, when }: { id: string; when: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" disabled={pending} onClick={() => { if (confirm(`Retirer la fin de période du ${when} ? (Vos notes ne changent pas.)`)) start(async () => { await cancelPeriodAction(id); router.refresh(); }); }} className={btn.smGhost}>Retirer</button>;
}

// Le recapitulatif est ouvert : le rappel de fin de periode ne s'affichera plus.
export function MarkPeriodSeen({ id }: { id: string }) {
  useEffect(() => { void seePeriodAction(id); }, [id]);
  return null;
}

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={btn.smGhost}>🖨️ Imprimer</button>;
}
