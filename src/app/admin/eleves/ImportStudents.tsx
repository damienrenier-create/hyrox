"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { btn, cx, ui } from "@/lib/ui";
import { buildRows, FIELD_LABELS, guessMapping, MAX_IMPORT_ROWS, type ImportField, type PlannedRow } from "@/lib/student-import";
import { importStudentsAction, previewStudentImportAction } from "./actions";

// Importer une liste d'eleves (Sartay 18/11) : coller les colonnes copiees depuis le tableur, ou choisir un fichier .csv.
// 1) la page devine les colonnes et montre ce qu'elle a compris ; 2) « Vérifier » : le serveur repere les eleves deja
// inscrits et les doublons ; 3) « Importer » cree seulement les nouveaux.
const FIELDS: ImportField[] = ["lastName", "firstName", "fullName", "className", "dateOfBirth", "sex", "skip"];
const STATUS: Record<PlannedRow["status"], { label: string; chip: string }> = {
  new: { label: "nouveau", chip: ui.chipOk },
  exists: { label: "déjà inscrit", chip: ui.chipMuted },
  dupInList: { label: "en double", chip: ui.chipWarn },
  invalid: { label: "incomplet", chip: ui.chipErr },
};
const fmtDob = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

function parseTable(text: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  return (res.data as string[][]).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()));
}

// Un .csv d'Excel sous Windows est souvent en « ANSI » (windows-1252) : relu dans cet encodage si l'UTF-8 echoue.
async function readFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

export function ImportStudents({ classes }: { classes: string[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [defaultClass, setDefaultClass] = useState("");
  const [plan, setPlan] = useState<PlannedRow[] | null>(null);
  const [newClasses, setNewClasses] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const load = (raw: string) => {
    setText(raw);
    setPlan(null);
    setMessage(null);
    const t = parseTable(raw);
    setTable(t);
    const g = guessMapping(t);
    setMapping(g.mapping);
    setHasHeader(g.hasHeader);
  };
  const rows = useMemo(() => buildRows(table, mapping, hasHeader, defaultClass), [table, mapping, hasHeader, defaultClass]);
  const width = Math.max(0, ...table.slice(0, 50).map((r) => r.length));
  const reset = () => { setPlan(null); setMessage(null); };
  const missing = (["className", "dateOfBirth"] as ImportField[]).filter((f) => !mapping.includes(f) && !(f === "className" && defaultClass.trim()));
  const noName = !mapping.includes("fullName") && !(mapping.includes("lastName") && mapping.includes("firstName"));

  const verify = () => start(async () => {
    setMessage(null);
    const res = await previewStudentImportAction(rows);
    if ("error" in res) { setPlan(null); setMessage({ kind: "err", text: res.error }); return; }
    setPlan(res.plan);
    setNewClasses(res.newClasses);
  });
  const doImport = () => start(async () => {
    const res = await importStudentsAction(rows);
    if ("error" in res) { setMessage({ kind: "err", text: res.error }); return; }
    setPlan(res.plan);
    setNewClasses(res.newClasses);
    const n = res.created ?? 0;
    setMessage({ kind: "ok", text: n === 1 ? "1 élève importé. Il choisira son code PIN à sa première connexion (classe, nom, date de naissance)." : `${n} élèves importés. Ils choisiront leur code PIN à leur première connexion (classe, nom, date de naissance).` });
    router.refresh();
  });

  const counts = plan ? { new: plan.filter((r) => r.status === "new").length, exists: plan.filter((r) => r.status === "exists").length, dup: plan.filter((r) => r.status === "dupInList").length, invalid: plan.filter((r) => r.status === "invalid").length, noDob: plan.filter((r) => r.status === "new" && !r.dateOfBirth).length } : null;
  const imported = message?.kind === "ok";

  return (
    <div className="mt-3 space-y-4">
      <ol className={`${ui.muted} list-decimal pl-5 space-y-1`}>
        <li>Dans votre tableur (Excel, export de l&apos;école…), sélectionnez les colonnes <b>Nom</b>, <b>Prénom</b>, <b>Classe</b>, <b>Date de naissance</b> (et <b>Sexe</b> si vous l&apos;avez), avec ou sans la ligne de titres, puis copiez (Ctrl+C).</li>
        <li>Collez ci-dessous (Ctrl+V), ou choisissez un fichier .csv.</li>
        <li>Vérifiez ce que la page a compris, puis importez. Les élèves déjà inscrits sont reconnus et ne sont pas recréés.</li>
      </ol>

      <textarea
        value={text}
        onChange={(e) => load(e.target.value)}
        rows={6}
        placeholder={"Nom\tPrénom\tClasse\tDate de naissance\tSexe\nDUPONT\tJean\t5A\t12/03/2010\tG"}
        className={cx(ui.input, "font-mono text-xs")}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className={cx(btn.smGhost, "cursor-pointer")}>
          📄 Choisir un fichier .csv
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await readFile(f)); e.target.value = ""; }} />
        </label>
        <span className={ui.hint}>Un fichier Excel (.xlsx) : ouvrez-le, copiez les colonnes et collez-les ici (ou « Enregistrer sous » CSV).</span>
      </div>

      {table.length > 0 && (
        <section className="space-y-3">
          <h3 className={ui.h3}>Ce que la page a compris</h3>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={ui.check} checked={hasHeader} onChange={(e) => { setHasHeader(e.target.checked); reset(); }} />
              La première ligne contient les titres des colonnes
            </label>
            <label className="text-xs">
              <span className={ui.label}>Classe pour toute la liste (si pas de colonne Classe)</span>
              <input value={defaultClass} onChange={(e) => { setDefaultClass(e.target.value); reset(); }} list="import-classes" placeholder="ex. 5A" className={cx(ui.input, "w-40")} />
              <datalist id="import-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
          </div>

          <div className={`${ui.inset} overflow-x-auto`}>
            <table className="text-xs w-full">
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, i) => (
                    <th key={i} className="p-1.5 text-left align-bottom">
                      <select value={mapping[i] ?? "skip"} onChange={(e) => { const m = [...mapping]; while (m.length < width) m.push("skip"); m[i] = e.target.value as ImportField; setMapping(m); reset(); }} className={cx(ui.input, "py-1 text-xs min-w-[9rem]", (mapping[i] ?? "skip") === "skip" && "text-ink-3")}>
                        {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.slice(0, 6).map((r, i) => (
                  <tr key={i} className={cx(ui.tr, hasHeader && i === 0 && "font-bold text-ink-3")}>
                    {Array.from({ length: width }, (_, j) => <td key={j} className="p-1.5 whitespace-nowrap">{r[j] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.length > 6 && <p className={`${ui.hint} px-2 pb-2`}>… et {table.length - 6} autres lignes.</p>}
          </div>

          {noName && <p className={ui.alertWarn}>Choisissez la colonne du <b>Nom</b> et celle du <b>Prénom</b> (ou une colonne « Nom + prénom »).</p>}
          {missing.includes("className") && <p className={ui.alertWarn}>Pas de colonne <b>Classe</b> : indiquez la classe de toute la liste ci-dessus. Les élèves se connectent en choisissant leur classe.</p>}
          {missing.includes("dateOfBirth") && <p className={ui.alertWarn}>Pas de colonne <b>Date de naissance</b> : sans elle, un élève ne peut pas faire sa première connexion. Vous pourrez l&apos;ajouter ensuite dans sa fiche.</p>}
          {rows.length > MAX_IMPORT_ROWS && <p className={ui.alertErr}>{rows.length} lignes : {MAX_IMPORT_ROWS} au maximum par import. Importez la liste en plusieurs fois.</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={verify} disabled={pending || noName || rows.length === 0 || rows.length > MAX_IMPORT_ROWS} className={btn.primary}>
              {pending && !plan ? "Vérification…" : `Vérifier les ${rows.length} ligne${rows.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </section>
      )}

      {message && <p className={message.kind === "ok" ? ui.alertOk : message.kind === "err" ? ui.alertErr : ui.alertInfo}>{message.kind === "ok" ? "✅ " : message.kind === "err" ? "⚠️ " : ""}{message.text}</p>}

      {plan && counts && (
        <section className="space-y-3">
          <p className="flex flex-wrap gap-2 text-sm">
            <span className={cx(ui.chip, ui.chipOk)}>{counts.new} {imported ? "importé(s)" : "nouveau(x)"}</span>
            <span className={cx(ui.chip, ui.chipMuted)}>{counts.exists} déjà inscrit(s)</span>
            {counts.dup > 0 && <span className={cx(ui.chip, ui.chipWarn)}>{counts.dup} en double dans la liste</span>}
            {counts.invalid > 0 && <span className={cx(ui.chip, ui.chipErr)}>{counts.invalid} incomplet(s), ignoré(s)</span>}
            {counts.noDob > 0 && <span className={cx(ui.chip, ui.chipWarn)}>{counts.noDob} sans date de naissance</span>}
          </p>
          {newClasses.length > 0 && !imported && <p className={ui.alertInfo}>Nouvelle{newClasses.length > 1 ? "s" : ""} classe{newClasses.length > 1 ? "s" : ""} : <b>{newClasses.join(", ")}</b>. Vérifiez l&apos;orthographe : c&apos;est ce que les élèves verront dans la liste des classes. (Une classe qui commence par 7 est une classe de test.)</p>}
          <div className={`${ui.card} overflow-auto max-h-[28rem]`}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr><th className={ui.th}>Ligne</th><th className={ui.th}>Nom</th><th className={ui.th}>Prénom</th><th className={ui.th}>Classe</th><th className={ui.th}>Naissance</th><th className={ui.th}>Sexe</th><th className={ui.th}>État</th></tr>
              </thead>
              <tbody>
                {plan.map((r) => (
                  <tr key={r.line} className={cx(ui.tr, r.status !== "new" && "text-ink-3")}>
                    <td className="p-2 tabular-nums">{r.line}</td>
                    <td className="p-2 font-semibold">{r.lastName}</td>
                    <td className="p-2">{r.firstName}</td>
                    <td className="p-2">{r.className}</td>
                    <td className="p-2 whitespace-nowrap">{fmtDob(r.dateOfBirth) || (r.dobRaw ? <span className="text-danger-ink" title="Date illisible : l'élève sera créé sans date de naissance">illisible : {r.dobRaw}</span> : <span className="text-warn-ink">—</span>)}</td>
                    <td className="p-2">{r.sex ?? "—"}</td>
                    <td className="p-2"><span className={cx(ui.chip, STATUS[r.status].chip)}>{r.status === "new" && imported ? "importé" : STATUS[r.status].label}</span>{r.note && <span className={`${ui.hint} ml-1`}>{r.note}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!imported && (
            <button type="button" onClick={doImport} disabled={pending || counts.new === 0} className={btn.success}>
              {pending ? "Import en cours…" : counts.new === 0 ? "Aucun nouvel élève à importer" : counts.new === 1 ? "Importer le nouvel élève" : `Importer les ${counts.new} nouveaux élèves`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
