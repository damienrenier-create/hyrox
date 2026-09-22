"use client";

import { btn } from "@/lib/ui";

export function ExportCsvButton({ csv, filename }: { csv: string; filename: string }) {
  function download() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return (
    <button type="button" onClick={download} className={btn.ghost}>
      ⬇︎ Exporter CSV
    </button>
  );
}
