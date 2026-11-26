"use client";

import { useEffect, useRef, useState } from "react";
import { COURT_LENGTH, COURT_MARGIN, END_KINDS, END_STROKES, NET_Y, SHORT_SERVICE, DOUBLE_LONG_SERVICE, courtWidth, guessWinner, type CourtKind, type EndKind, type EndStroke, type Rally } from "@/lib/badminton-scout";
import { btn, cx, ui } from "@/lib/ui";

// Terrain de badminton dessine a l'echelle (Sartay 24/11 : « simple, double, demi-terrain sans couloir (par defaut) »),
// vu du dessus, joueur A en haut, B en bas, filet au milieu. Pour l'arbitre (toucher = impact du volant) et pour les cartes
// « ou je gagne / ou je perds mes points ». Marques : point gagne = rond plein (vert), point perdu = croix (rouge) : la
// forme dit la meme chose que la couleur. Couleurs du theme (pas de mode sombre dans l'appli).
export type CourtMark = { x: number; y: number; won?: boolean; hx?: number; hy?: number; title?: string; pending?: boolean; muted?: boolean };
export function CourtSvg({ kind, scale, marks = [], top, bottom, onTap }: { kind: CourtKind; scale: number; marks?: CourtMark[]; top?: string; bottom?: string; onTap?: (x: number, y: number) => void }) {
  const w = courtWidth(kind), L = COURT_LENGTH, M = COURT_MARGIN;
  const ref = useRef<SVGSVGElement>(null);
  const tap = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onTap || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * (w + 2 * M) - M;
    const y = ((e.clientY - r.top) / r.height) * (L + 2 * M) - M;
    onTap(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  };
  const ln = (x1: number, y1: number, x2: number, y2: number, k: string | number, sw = 0.04) => <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={sw} />;
  const lines = [ln(0, NET_Y - SHORT_SERVICE, w, NET_Y - SHORT_SERVICE, "s1"), ln(0, NET_Y + SHORT_SERVICE, w, NET_Y + SHORT_SERVICE, "s2")];
  if (kind !== "HALF") lines.push(ln(w / 2, 0, w / 2, NET_Y - SHORT_SERVICE, "c1"), ln(w / 2, NET_Y + SHORT_SERVICE, w / 2, L, "c2"));
  // Couloir du fond (ligne de service long du double, a 0,76 m du fond) sur les TROIS terrains (Sartay 26/11 : « je voudrais
  // que tu dessines quand meme le couloir du fond, pareil pour le terrain simple ») ; couloirs lateraux : double seulement.
  lines.push(ln(0, DOUBLE_LONG_SERVICE, w, DOUBLE_LONG_SERVICE, "l1"), ln(0, L - DOUBLE_LONG_SERVICE, w, L - DOUBLE_LONG_SERVICE, "l2"));
  if (kind === "DOUBLE") lines.push(ln(0.46, 0, 0.46, L, "a1"), ln(w - 0.46, 0, w - 0.46, L, "a2"));
  return (
    <svg
      ref={ref}
      viewBox={`${-M} ${-M} ${w + 2 * M} ${L + 2 * M}`}
      width={Math.round((w + 2 * M) * scale)}
      height={Math.round((L + 2 * M) * scale)}
      className={cx("block select-none touch-manipulation", onTap && "cursor-crosshair")}
      role={onTap ? "button" : "img"}
      aria-label={onTap ? "Terrain : touchez l'endroit où le volant est tombé" : "Terrain et impacts du volant"}
      onPointerDown={onTap ? tap : undefined}
    >
      <rect x={-M} y={-M} width={w + 2 * M} height={L + 2 * M} rx={0.3} className="fill-paper" />
      <rect x={0} y={0} width={w} height={L} className="fill-emerald-50" />
      <g className="text-emerald-800">
        <rect x={0} y={0} width={w} height={L} fill="none" stroke="currentColor" strokeWidth={0.06} />
        {lines}
      </g>
      <g className="text-ink-2">{ln(-0.3, NET_Y, w + 0.3, NET_Y, "net", 0.1)}</g>
      {top && <text x={w / 2} y={-M / 2 + 0.15} textAnchor="middle" fontSize={0.5} className="fill-ink-3">{top}</text>}
      {bottom && <text x={w / 2} y={L + M / 2 + 0.2} textAnchor="middle" fontSize={0.5} className="fill-ink-3">{bottom}</text>}
      {marks.map((m, i) => (
        <g key={i}>
          {m.hx !== undefined && m.hy !== undefined && <line x1={m.hx} y1={m.hy} x2={m.x} y2={m.y} stroke="currentColor" strokeWidth={0.03} strokeDasharray="0.15 0.12" className="text-ink-3" />}
          {m.muted ? (
            <circle cx={m.x} cy={m.y} r={0.13} className="fill-ink-3" fillOpacity={0.6}>{m.title && <title>{m.title}</title>}</circle>
          ) : m.won === undefined || m.pending ? (
            <circle cx={m.x} cy={m.y} r={0.22} className="fill-accent" stroke="white" strokeWidth={0.06}>{m.title && <title>{m.title}</title>}</circle>
          ) : m.won ? (
            <circle cx={m.x} cy={m.y} r={0.16} className="fill-success-ink" fillOpacity={0.8} stroke="white" strokeWidth={0.04}>{m.title && <title>{m.title}</title>}</circle>
          ) : (
            <g className="text-danger-ink" strokeWidth={0.07} stroke="currentColor" strokeLinecap="round">
              <line x1={m.x - 0.14} y1={m.y - 0.14} x2={m.x + 0.14} y2={m.y + 0.14} />
              <line x1={m.x - 0.14} y1={m.y + 0.14} x2={m.x + 0.14} y2={m.y - 0.14} />
              {m.title && <title>{m.title}</title>}
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

// Pave de l'arbitre en direct (scouting) : toucher l'impact, puis, selon ses COUCHES, qui marque, le coup, le frappeur,
// gagnant ou faute ; « ✓ Point » ferme l'echange. Couche 1 : un seul toucher (qui marque est devine d'apres l'impact ;
// sur le filet, l'arbitre choisit).
type Draft = { x: number; y: number; w: 0 | 1 | null; stroke?: EndStroke; hx?: number; hy?: number; end?: EndKind; hitter: boolean };
// `big` (26/11, Sartay : « le dessin du terrain pourrait prendre plus de place et le scoring moins ») : le terrain occupe la
// largeur de l'ecran (au plus ~65 % de sa hauteur), les choix (qui marque, le coup…) s'affichent en bas de l'ecran.
export function CourtPad({ kind, level, names, disabled, onCommit, big = false }: { kind: CourtKind; level: number; names: [string, string]; disabled?: boolean; onCommit: (r: Omit<Rally, "court" | "layer">) => void; big?: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [last, setLast] = useState<CourtMark[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  useEffect(() => {
    if (!big || !box.current) return;
    const el = box.current;
    const measure = () => {
      const vbW = courtWidth(kind) + 2 * COURT_MARGIN, vbH = COURT_LENGTH + 2 * COURT_MARGIN;
      setFit(Math.max(18, Math.min(el.clientWidth / vbW, (window.innerHeight * 0.6) / vbH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [big, kind]);
  const commit = (d: Draft) => {
    if (d.w === null) return;
    onCommit({ x: d.x, y: d.y, w: d.w, ...(d.stroke ? { stroke: d.stroke } : {}), ...(d.hx !== undefined && d.hy !== undefined ? { hx: d.hx, hy: d.hy } : {}), ...(d.end ? { end: d.end } : {}) });
    setLast((l) => [...l.slice(-7), { x: d.x, y: d.y, muted: true, title: `Point pour ${names[d.w!]}` }]);
    setDraft(null);
  };
  const tap = (x: number, y: number) => {
    if (disabled) return;
    if (draft?.hitter) return setDraft({ ...draft, hx: x, hy: y, hitter: false }); // 2e toucher : le frappeur
    const w = guessWinner(kind, x, y);
    const d: Draft = { x, y, w, hitter: false };
    if (level <= 1 && w !== null) return commit(d); // couche 1 : un seul toucher
    setDraft({ ...d, hitter: level >= 3 });
  };
  // Les derniers impacts du match en gris, le toucher en cours en orange.
  const marks: CourtMark[] = [...last, ...(draft ? [{ x: draft.x, y: draft.y, hx: draft.hx, hy: draft.hy, pending: true }] : [])];
  const chip = (on: boolean) => cx(ui.chip, on ? ui.chipBrand : ui.chipMuted, "py-1 text-sm");
  const controls = draft && (
    <>
      {draft.hitter && <p className="font-bold text-accent-ink">🧍 Touchez où était le joueur qui a frappé.</p>}
      <div>
        <p className="font-bold">Qui marque ?</p>
        <div className="flex flex-wrap gap-1">{([0, 1] as const).map((s) => <button key={s} type="button" onClick={() => setDraft({ ...draft, w: s })} className={chip(draft.w === s)}>{names[s]}</button>)}</div>
      </div>
      {level >= 2 && (
        <div>
          <p className="font-bold">Le coup</p>
          <div className="flex flex-wrap gap-1">{END_STROKES.map((s) => <button key={s.id} type="button" onClick={() => setDraft({ ...draft, stroke: draft.stroke === s.id ? undefined : s.id })} className={chip(draft.stroke === s.id)}>{s.emoji} {s.name}</button>)}</div>
        </div>
      )}
      {level >= 4 && (
        <div>
          <p className="font-bold">Comment ?</p>
          <div className="flex flex-wrap gap-1">{END_KINDS.map((k) => <button key={k.id} type="button" onClick={() => setDraft({ ...draft, end: draft.end === k.id ? undefined : k.id })} className={chip(draft.end === k.id)}>{k.name}</button>)}</div>
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="button" disabled={draft.w === null} onClick={() => commit(draft)} className={cx(btn.primary, "flex-1")}>✓ Point{draft.w !== null ? ` pour ${names[draft.w].split(" ")[0]}` : ""}</button>
        <button type="button" onClick={() => setDraft(null)} className={btn.ghost} aria-label="Annuler ce toucher">✕</button>
      </div>
    </>
  );
  if (big) {
    return (
      <div ref={box} className="w-full">
        <div className="flex justify-center">
          <CourtSvg kind={kind} scale={fit ?? 22} marks={marks} top={names[0]} bottom={names[1]} onTap={tap} />
        </div>
        {draft && (
          <div className="fixed inset-x-0 bottom-0 z-[55] bg-card border-t-2 border-accent shadow-2xl p-3 text-sm max-h-[50vh] overflow-auto">
            <div className="max-w-xl mx-auto space-y-2">{controls}</div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border-2 border-line bg-card p-2 space-y-2">
      <div className="flex gap-3 items-start">
        <CourtSvg kind={kind} scale={kind === "HALF" ? 25 : 21} marks={marks} top={names[0]} bottom={names[1]} onTap={tap} />
        <div className="flex-1 min-w-0 space-y-2 text-sm">
          {!draft && <p className={ui.hint}>📍 À la fin de l&apos;échange, touchez l&apos;endroit où le volant est tombé{level <= 1 ? " : le point est compté tout de suite (dans les lignes : pour l'adversaire ; dehors : pour l'autre)." : "."}</p>}
          {controls}
        </div>
      </div>
    </div>
  );
}
