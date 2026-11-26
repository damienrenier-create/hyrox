import { CONCEDED, COURT_LENGTH, NET_Y, SHORT_SERVICE, STROKES, END_STROKES, courtWidth, howInfo, howOf, strokeByWinner, strokeSummary, type CourtKind, type MyRally, type StrokeSheet } from "@/lib/badminton-scout";
import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";
import { CourtSvg } from "./BadmintonCourt";
import { cx, ui } from "@/lib/ui";

// Scouting d'un joueur (Sartay 24/11 : « voir ou et comment les joueurs gagnent et perdent des points » ; fiche technique
// des 6 coups remplie par les scouts). Les impacts sont vus de SON cote : son camp en bas. `me` : vue de l'eleve.
export function ScoutView({ rallies, sheets, me = false }: { rallies: MyRally[]; sheets: { sheet: StrokeSheet; by: string; at: number }[]; me?: boolean }) {
  if (!rallies.length && !sheets.length) return null;
  // Terrain le plus utilise ; les impacts d'un autre terrain y sont ramenes a la meme proportion de largeur.
  const kinds = rallies.reduce<Record<string, number>>((t, r) => ({ ...t, [r.court]: (t[r.court] ?? 0) + 1 }), {});
  const kind = (Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "HALF") as CourtKind;
  const W = courtWidth(kind);
  const fit = (r: MyRally) => { const k = W / courtWidth(r.court); return { x: r.x * k, y: r.y, hx: r.hx !== undefined ? r.hx * k : undefined, hy: r.hy }; };
  const won = rallies.filter((r) => r.won), lost = rallies.filter((r) => !r.won);
  // COMMENT le point s'est fini (etape 1, 26/11 soir ; deviné d'apres l'endroit pour les echanges notes avant) : gagne
  // (le volant tombe dans le terrain adverse) ou concede (service rate, filet, dehors, rate).
  const depth = (r: MyRally) => { const d = Math.abs(r.y - NET_Y); return d <= SHORT_SERVICE ? "devant" : d >= COURT_LENGTH / 2 - 2 ? "au fond" : "au milieu"; };
  const count = (list: MyRally[], f: (r: MyRally) => boolean) => list.filter(f).length;
  const wonWin = won.filter((r) => howOf(r) === "WIN"); // mes coups gagnants
  const lostWin = lost.filter((r) => howOf(r) === "WIN"); // les coups gagnants de l'adversaire
  const zoneLine = (list: MyRally[]) => (["devant", "au milieu", "au fond"] as const).map((d) => `${d} ${count(list, (r) => depth(r) === d)}`).join(" · ");
  const faults = (list: MyRally[]) => CONCEDED.map((h) => ({ h, n: count(list, (r) => howOf(r) === h) }));
  const faultLine = (list: MyRally[]) => {
    const f = faults(list);
    return f.some((x) => x.n) ? f.map((x) => <span key={x.h} className="whitespace-nowrap">{howInfo(x.h).emoji} {howInfo(x.h).name.toLowerCase()} <b>{x.n}</b></span>) : <span className="text-ink-3">aucune</span>;
  };
  // Coup qui finit l'echange : joue par le gagnant (point gagne, ou l'autre a tape a cote), sinon par celui qui concede.
  const mine = rallies.filter((r) => r.stroke && (strokeByWinner(howOf(r)) ? r.won : !r.won));
  const theirs = rallies.filter((r) => r.stroke && (strokeByWinner(howOf(r)) ? !r.won : r.won));
  const tu = (a: string, b: string) => (me ? a : b);
  const summary = strokeSummary(sheets.map((s) => s.sheet));
  const levelColor = (code: string | null) => QUALITY_LEVELS.find((l) => l.code === code)?.color ?? "text-ink-3";
  return (
    <div className="space-y-3">
      {rallies.length > 0 && (
        <div className="space-y-2">
          <p className={ui.eyebrow}>📍 {tu("Où je gagne et perds mes points", "Où l'élève gagne et perd ses points")}</p>
          <div className="flex flex-wrap gap-4 items-start">
            <CourtSvg kind={kind} scale={kind === "HALF" ? 26 : 22} top={tu("adversaire", "adversaire")} bottom={tu("mon camp", "son camp")} marks={rallies.map((r) => ({ ...fit(r), won: r.won, title: `${r.won ? "Point gagné" : "Point perdu"} · ${howInfo(howOf(r)).emoji} ${howInfo(howOf(r)).name}${r.stroke ? ` · ${END_STROKES.find((s) => s.id === r.stroke)?.name}` : ""}` }))} />
            <div className="flex-1 min-w-[14rem] space-y-2 text-sm">
              <p className="flex flex-wrap gap-3"><span><span className="text-success-ink font-black">●</span> point gagné · <b>{won.length}</b></span><span><span className="text-danger-ink font-black">✕</span> point perdu · <b>{lost.length}</b></span><span className="text-ink-3">{rallies.length} échanges notés</span></p>
              <div className="rounded-lg bg-paper px-2 py-1.5">
                <p className="font-bold text-success-ink">Points gagnés · {won.length}</p>
                <p>✅ {tu("gagnés par moi", "gagnés par lui")} (le volant tombe chez l&apos;adversaire) : <b>{wonWin.length}</b>{wonWin.length > 0 && <span className="text-ink-2"> ({zoneLine(wonWin)})</span>}</p>
                <p className="flex flex-wrap gap-x-2">concédés par l&apos;adversaire : {faultLine(won)}</p>
              </div>
              <div className="rounded-lg bg-paper px-2 py-1.5">
                <p className="font-bold text-danger-ink">Points perdus · {lost.length}</p>
                <p>✅ gagnés par l&apos;adversaire (le volant tombe {tu("chez moi", "chez lui")}) : <b>{lostWin.length}</b>{lostWin.length > 0 && <span className="text-ink-2"> ({zoneLine(lostWin)})</span>}</p>
                <p className="flex flex-wrap gap-x-2">{tu("concédés par moi", "concédés par lui")} : {faultLine(lost)}</p>
              </div>
              {(mine.length > 0 || theirs.length > 0) && (
                <table className="w-full text-sm">
                  <thead><tr className="text-left"><th className={ui.th}>Coup qui finit l&apos;échange</th><th className={`${ui.th} text-right`}>{tu("Mes gagnants", "Ses gagnants")}</th><th className={`${ui.th} text-right`}>{tu("Mes fautes", "Ses fautes")}</th><th className={`${ui.th} text-right`}>Subis</th></tr></thead>
                  <tbody>
                    {END_STROKES.filter((s) => rallies.some((r) => r.stroke === s.id)).map((s) => (
                      <tr key={s.id} className="border-t border-line">
                        <td className="p-1">{s.emoji} {s.name}</td>
                        <td className="p-1 text-right tabular-nums">{count(mine, (r) => r.stroke === s.id && r.won) || ""}</td>
                        <td className="p-1 text-right tabular-nums">{count(mine, (r) => r.stroke === s.id && !r.won) || ""}</td>
                        <td className="p-1 text-right tabular-nums">{count(theirs, (r) => r.stroke === s.id && !r.won) || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      {sheets.length > 0 && (
        <div className="space-y-2">
          <p className={ui.eyebrow}>🔭 {tu("Ma technique vue par les scouts", "Technique vue par les scouts")} · {sheets.length} fiche{sheets.length > 1 ? "s" : ""}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((s) => {
              const st = STROKES.find((x) => x.id === s.id)!;
              return (
                <div key={s.id} className="rounded-lg bg-paper px-2 py-1.5 text-sm">
                  <p className="flex justify-between gap-2"><b>{st.emoji} {st.name}</b><span className={cx("font-display font-extrabold", levelColor(s.level))}>{s.level ?? "—"}</span></p>
                  {s.seen === 0 ? <p className={ui.hint}>Pas encore observé.</p> : (
                    <ul className="mt-1 space-y-0.5">
                      {st.criteria.map((c, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs">
                          <span className="tabular-nums font-bold w-9 shrink-0 text-right">{Math.round(s.criteria[i] * 100)} %</span>
                          <span className="text-ink-2">{c}</span>
                        </li>
                      ))}
                      <li className={ui.hint}>{s.seen} observation{s.seen > 1 ? "s" : ""}</li>
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className={ui.hint}>Pour chaque coup observé, le scout coche les 4 critères réussis : 0 = TI, 1 = I, 2 = S, 3 = B, 4 = TB, 4 + ❤️ = E (comme au Hyrox). Ici : le niveau moyen et la part des observations où chaque critère était réussi.</p>
        </div>
      )}
    </div>
  );
}
