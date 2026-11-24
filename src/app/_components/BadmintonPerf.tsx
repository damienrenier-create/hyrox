import { setsText } from "@/lib/badminton";
import { PERF_GAP, type PerfReport, type PerfRow } from "@/lib/badminton-perf";
import { EloCurve } from "./EloCurve";
import { cx, ui } from "@/lib/ui";

// Progression ELO d'un joueur (Sartay 24/11, en vue de l'evaluation) : chiffres cles, courbe, cours par cours, 10 meilleures
// et 10 moins bonnes perfs avec l'ELO de l'adversaire au moment du match et aujourd'hui. Regles : src/lib/badminton-perf.ts.
// `me` : vue de l'eleve (« tu ») ; sinon vue du prof.
type Names = Record<string, { name: string; className: string | null }>;
const TZ = "Europe/Brussels";
const dd = (ms: number) => new Date(ms).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: TZ });
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const res = (o: PerfRow["outcome"]) => (o === "W" ? "V" : o === "L" ? "D" : "N");

export function BadmintonPerf({ report: r, names, me = false }: { report: PerfReport; names: Names; me?: boolean }) {
  const nm = (id: string) => names[id]?.name ?? "?";
  const byId = new Map(r.rows.map((x) => [x.matchId, x]));
  const points = r.curve.map((c, i) => {
    const row = c.matchId ? byId.get(c.matchId) : null;
    return { elo: c.elo, day: dd(c.at), label: !row ? (i === 0 ? "départ" : "") : `${dd(row.at)} · ${res(row.outcome)} ${setsText(row.sets)} contre ${nm(row.opponentId)} (${row.theirs}) · ${row.mine} → ${row.after}` };
  });
  const tu = (a: string, b: string) => (me ? a : b);
  const list = (rows: PerfRow[], good: boolean) => (
    <ol className="space-y-1.5">
      {rows.map((x) => (
        <li key={x.matchId} className="rounded-lg bg-paper px-2 py-1.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span>
              <span className={cx("font-black mr-1", x.outcome === "W" ? "text-success-ink" : x.outcome === "L" ? "text-danger-ink" : "text-ink-2")}>{res(x.outcome)}</span>
              <span className="tabular-nums font-bold">{setsText(x.sets)}</span> contre <b>{nm(x.opponentId)}</b> <span className="text-ink-3 text-xs">{names[x.opponentId]?.className ?? ""}</span>
              {x.tag && <span className={cx(ui.chip, x.tag === "exploit" ? ui.chipOk : ui.chipWarn, "ml-1 text-[10px]")}>{x.tag === "exploit" ? "exploit" : "contre-perf"}</span>}
            </span>
            <span className={cx("font-display font-extrabold tabular-nums", good ? "text-success-ink" : "text-danger-ink")} title="Valeur de la perf (points ELO à K 20)">{signed(x.value)}</span>
          </div>
          <p className="text-xs text-ink-2 tabular-nums">
            {dd(x.at)} · {tu("toi", "l'élève")} {x.mine}, {tu("ton adversaire", "l'adversaire")} {x.theirs} ({x.gap > 0 ? `+${x.gap}` : x.gap}) · chances de gagner : {Math.round(x.chance * 100)} %
            {x.theirsNow !== null && <> · {tu("ton adversaire", "l'adversaire")} aujourd&apos;hui : <b>{x.theirsNow}</b> ({signed(x.theirsNow - x.theirs)})</>}
          </p>
        </li>
      ))}
      {rows.length === 0 && <li className={ui.hint}>{good ? "Aucune victoire pour l'instant." : "Aucune défaite pour l'instant."}</li>}
    </ol>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label={`ELO (départ ${r.start})`} value={String(r.now)} sub={signed(r.now - r.start)} />
        <Stat label="Plus haut · plus bas" value={`${r.max} · ${r.min}`} />
        <Stat label="Matchs · V-N-D" value={String(r.games)} sub={`${r.won}-${r.drawn}-${r.lost}`} />
        <Stat label="Exploits · contre-perfs" value={`${r.exploits} · ${r.contres}`} />
      </div>
      <div>
        <p className={`${ui.eyebrow} mb-1`}>{me ? "Mon ELO, match après match" : "ELO, match après match"}</p>
        <EloCurve points={points} start={r.start} />
      </div>
      <details open={!me}>
        <summary className="cursor-pointer text-sm font-bold">Cours par cours</summary>
        <div className="overflow-x-auto mt-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left"><th className={ui.th}>Jour</th><th className={`${ui.th} text-right`}>Matchs</th><th className={`${ui.th} text-right`}>V-N-D</th><th className={`${ui.th} text-right`}>ELO</th><th className={`${ui.th} text-right`}>Évolution</th><th className={`${ui.th} text-right`}>Exploits</th><th className={`${ui.th} text-right`}>Contre-perfs</th></tr>
            </thead>
            <tbody>
              {r.days.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="p-1.5 tabular-nums">{new Date(d.at).toLocaleDateString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TZ })}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.games}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.won}-{d.drawn}-{d.lost}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.start} → <b>{d.end}</b></td>
                  <td className={cx("p-1.5 text-right tabular-nums font-bold", d.end > d.start ? "text-success-ink" : d.end < d.start ? "text-danger-ink" : "text-ink-2")}>{signed(d.end - d.start)}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.exploits || ""}</td>
                  <td className="p-1.5 text-right tabular-nums">{d.contres || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className={`${ui.eyebrow} mb-1`}>🌟 {me ? "Mes" : "Ses"} {r.best.length > 1 ? `${r.best.length} ` : ""}meilleures perfs</p>
          {list(r.best, true)}
        </div>
        <div>
          <p className={`${ui.eyebrow} mb-1`}>🌧️ {me ? "Mes" : "Ses"} {r.worst.length > 1 ? `${r.worst.length} ` : ""}moins bonnes perfs</p>
          {list(r.worst, false)}
        </div>
      </div>
      <p className={ui.hint}>
        Valeur d&apos;une perf : ce que le match aurait rapporté (ou coûté) à l&apos;ELO avec un K fixe de 20, selon les chances de gagner avant le match et l&apos;écart au score.
        Exploit : victoire ou égalité contre plus fort ; contre-perf : défaite ou égalité contre moins fort (au moins {PERF_GAP} d&apos;ELO d&apos;écart au moment du match).
        Les matchs de championnat à handicap sont dans la courbe, pas dans ces listes (le handicap égalise les chances).
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <div className="font-display text-2xl font-extrabold tabular-nums leading-tight">{value}{sub && <span className="text-sm text-ink-2 font-sans font-bold ml-1.5">{sub}</span>}</div>
      <div className={ui.hint}>{label}</div>
    </div>
  );
}
