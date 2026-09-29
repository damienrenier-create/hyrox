"use client";

import { useState, useTransition } from "react";
import { impersonateStudentAction } from "../../actions";
import { btn, cx, ui } from "@/lib/ui";

// Choix de l'eleve + mot de passe de l'admin, puis bascule sur l'espace de l'eleve (lecture seule).
export function ImpersonateForm({ students, preselected }: { students: { id: string; name: string }[]; preselected: string | null }) {
  const [studentId, setStudentId] = useState<string>(preselected ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId) { setError("Choisis un élève."); return; }
    setError("");
    start(async () => {
      const res = await impersonateStudentAction(studentId, password);
      if (res && "error" in res) setError(res.error);
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {students.length === 0 ? <p className={ui.muted}>Aucun élève dans cette classe.</p> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {students.map((s) => (
            <button key={s.id} type="button" onClick={() => setStudentId(s.id)} className={cx("text-left rounded-xl border px-3 py-2 text-sm font-bold transition", studentId === s.id ? "border-brand bg-brand-soft" : "border-line bg-paper hover:border-brand/60")}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs flex-1 min-w-[12rem]">
          <span className={ui.label}>Ton mot de passe</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ui.input} />
        </label>
        <button type="submit" disabled={pending || !studentId || !password} className={btn.primary}>{pending ? "…" : "👁 Voir son compte"}</button>
      </div>
      {error && <p className={ui.alertErr}>{error}</p>}
    </form>
  );
}
