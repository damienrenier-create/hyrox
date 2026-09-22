"use client";

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
    <button type="button" onClick={download} className="bg-slate-800 hover:bg-slate-700 text-cyan-100 border border-cyan-900 font-black tracking-wider px-4 py-2.5 rounded text-sm">
      ⬇︎ Exporter CSV
    </button>
  );
}
