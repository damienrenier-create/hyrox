"use client";

import { useEffect, useRef, useState } from "react";
import { COURT_LENGTH, COURT_MARGIN, END_KINDS, END_STROKES, NET_Y, SHORT_SERVICE, DOUBLE_LONG_SERVICE, courtWidth, howInfo, howOptions, NET_ZONE, type CourtKind, type EndKind, type EndStroke, type HowOption, type Rally, type RallyHow } from "@/lib/badminton-scout";
import { btn, cx, ui } from "@/lib/ui";

// Terrain de badminton dessine a l'echelle (Sartay 24/11 : « simple, double, demi-terrain sans couloir (par defaut) »),
// vu du dessus, joueur A en haut, B en bas, filet au milieu. Pour l'arbitre (toucher = impact du volant) et pour les cartes
// « ou je gagne / ou je perds mes points ». Marques : point gagne = rond plein (vert), point perdu = croix (rouge) : la
// forme dit la meme chose que la couleur. Couleurs du theme (pas de mode sombre dans l'appli).
// last (26/11) : le dernier impact, entoure ; k : son numero (appui long).
export type CourtMark = { x: number; y: number; won?: boolean; hx?: number; hy?: number; title?: string; pending?: boolean; muted?: boolean; last?: boolean; k?: number };
// onLongPress (26/11, Sartay : « appuyer longtemps sur un impact pour l'annuler, donner des infos ») : un appui de plus de
// LONG_PRESS_MS ne compte pas d'impact, il signale l'endroit (le parent ouvre le menu de l'impact le plus proche).
const LONG_PRESS_MS = 450;
// mx / my (26/11 soir) : marges dessinees autour du terrain (par defaut COURT_MARGIN) ; le grand terrain du scouting les
// elargit pour remplir l'ecran : toucher n'importe ou autour = « dehors ». Le point est ramene a COURT_MARGIN des lignes
// (c'est ce que le serveur accepte, et ce que les cartes d'analyse dessinent).
export function CourtSvg({ kind, scale, marks = [], top, bottom, onTap, onLongPress, mx, my }: { kind: CourtKind; scale: number; marks?: CourtMark[]; top?: string; bottom?: string; onTap?: (x: number, y: number) => void; onLongPress?: (x: number, y: number) => void; mx?: number; my?: number }) {
  const w = courtWidth(kind), L = COURT_LENGTH, M = COURT_MARGIN;
  const MX = Math.max(M, mx ?? M), MY = Math.max(M, my ?? M);
  const ref = useRef<SVGSVGElement>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | null; long: boolean } | null>(null);
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.max(-M, Math.min(w + M, ((e.clientX - r.left) / r.width) * (w + 2 * MX) - MX));
    const y = Math.max(-M, Math.min(L + M, ((e.clientY - r.top) / r.height) * (L + 2 * MY) - MY));
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onTap || !ref.current) return;
    const p = at(e);
    const cur = { ...p, timer: null as ReturnType<typeof setTimeout> | null, long: false };
    if (onLongPress) cur.timer = setTimeout(() => { cur.long = true; try { navigator.vibrate?.(30); } catch { /* vibreur absent */ } onLongPress(p.x, p.y); }, LONG_PRESS_MS);
    press.current = cur;
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p || !onTap) return;
    if (p.timer) clearTimeout(p.timer);
    if (!p.long) onTap(p.x, p.y);
  };
  const cancel = () => { const p = press.current; if (p?.timer) clearTimeout(p.timer); press.current = null; };
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
      viewBox={`${-MX} ${-MY} ${w + 2 * MX} ${L + 2 * MY}`}
      width={Math.round((w + 2 * MX) * scale)}
      height={Math.round((L + 2 * MY) * scale)}
      className={cx("block select-none touch-manipulation", onTap && "cursor-crosshair")}
      role={onTap ? "button" : "img"}
      aria-label={onTap ? "Terrain : touchez l'endroit où le volant est tombé" : "Terrain et impacts du volant"}
      onPointerDown={onTap ? down : undefined}
      onPointerUp={onTap ? up : undefined}
      onPointerLeave={onTap ? cancel : undefined}
      onPointerCancel={onTap ? cancel : undefined}
      onContextMenu={onTap ? (e) => e.preventDefault() : undefined}
    >
      <rect x={-MX} y={-MY} width={w + 2 * MX} height={L + 2 * MY} rx={0.3} className="fill-paper" />
      <rect x={0} y={0} width={w} height={L} className="fill-emerald-50" />
      {/* Pave de l'arbitre : la bande du filet, en deux zones (cote du haut, cote du bas ; Sartay 26/11 soir). */}
      {onTap && (
        <g>
          <rect x={0} y={NET_Y - NET_ZONE} width={w} height={NET_ZONE} className="fill-amber-100" />
          <rect x={0} y={NET_Y} width={w} height={NET_ZONE} className="fill-sky-100" />
          <g className="text-ink-3" strokeDasharray="0.12 0.1">{ln(0, NET_Y - NET_ZONE, w, NET_Y - NET_ZONE, "nz1", 0.025)}{ln(0, NET_Y + NET_ZONE, w, NET_Y + NET_ZONE, "nz2", 0.025)}</g>
        </g>
      )}
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
            <g>{m.last && <circle cx={m.x} cy={m.y} r={0.3} fill="none" stroke="currentColor" strokeWidth={0.06} className="text-accent" />}<circle cx={m.x} cy={m.y} r={m.last ? 0.16 : 0.13} className={m.last ? "fill-accent" : "fill-ink-3"} fillOpacity={m.last ? 1 : 0.6}>{m.title && <title>{m.title}</title>}</circle></g>
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

// « Comment s'est fini le point ? » (ETAPE 1 du scouting, Sartay 26/11 soir) : les manieres possibles d'apres l'endroit
// touche, la plus probable d'abord ; chaque bouton dit qui a gagne ou concede le point, et pour qui il compte.
// Partage par le pave (apres le toucher) et le menu d'un impact (appui long, pour corriger).
export function HowPicker({ options, names, current = null, onPick }: { options: HowOption[]; names: [string, string]; current?: { how: RallyHow; by: 0 | 1 } | null; onPick: (o: HowOption) => void }) {
  const won = options.filter((o) => o.how === "WIN"), gave = options.filter((o) => o.how !== "WIN");
  // Prenoms (plus court), sauf si les deux joueurs ont le meme.
  const first = names.map((n) => n.split(" ")[0]);
  const nm = (i: 0 | 1) => (first[0] !== first[1] ? first[i] : names[i]);
  const one = (o: HowOption, i: number) => {
    const h = howInfo(o.how);
    const on = current?.how === o.how && current.by === o.by;
    const win = o.how === "WIN";
    return (
      <button
        key={`${o.how}${o.by}`}
        type="button"
        onClick={() => onPick(o)}
        aria-pressed={on}
        className={cx(
          "w-full min-w-0 rounded-xl border-2 px-3 py-2 text-left leading-tight transition active:scale-[0.98] select-none touch-manipulation",
          win ? "border-success bg-success-soft text-success-ink" : "border-danger/40 bg-danger-soft text-danger-ink",
          on && "ring-4 ring-accent",
          i === 0 && !current && "shadow-md",
        )}
      >
        {i === 0 && !current && <span className="block text-[10px] font-bold uppercase tracking-wide opacity-70">★ le plus probable ici</span>}
        <span className="block font-extrabold">{h.emoji} {win ? `Gagné par ${nm(o.by)}` : `${h.name} · ${nm(o.by)}`}</span>
        <span className="block text-xs font-semibold opacity-80">{h.hint} → point pour {nm(o.w)}</span>
      </button>
    );
  };
  return (
    <div className="space-y-1.5">
      <p className="font-bold">Comment s&apos;est fini le point ?</p>
      {won.length > 0 && <div className="space-y-1"><p className="text-[11px] font-bold uppercase tracking-wide text-success-ink">A · Point gagné</p>{won.map((o) => one(o, options.indexOf(o)))}</div>}
      {gave.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-danger-ink">B · Point concédé</p>
          <div className={cx("grid gap-1", gave.length > 2 ? "grid-cols-2" : "grid-cols-1")}>{gave.map((o) => one(o, options.indexOf(o)))}</div>
        </div>
      )}
    </div>
  );
}

// Pave de l'arbitre en direct (scouting) : toucher l'impact, dire COMMENT le point s'est fini (ce qui donne le point au bon
// joueur), puis, selon les COUCHES, le coup, le frappeur, faute provoquee ou directe ; « ✓ Point » ferme l'echange.
// Couche 1 : le toucher, puis la maniere : le point est compte tout de suite.
// server : qui servait (dans le repere du dessin, 0 = en haut), pour proposer le bon « service rate ».
type Draft = { x: number; y: number; w: 0 | 1 | null; how?: RallyHow; by?: 0 | 1; stroke?: EndStroke; hx?: number; hy?: number; end?: EndKind; hitter: boolean };
// `big` (26/11, Sartay : « le terrain doit prendre plus de place sur l'ecran, le score un petit bandeau en haut ou en bas ») :
// le terrain REMPLIT son parent (largeur ET hauteur, a l'echelle), les choix (comment, le coup…) s'affichent en bas.
// impacts / onImpact (26/11) : le parent tient la liste des impacts (pour les annuler et les preciser).
export function CourtPad({ kind, level, names, disabled, onCommit, big = false, impacts, onImpact, server = null }: { kind: CourtKind; level: number; names: [string, string]; disabled?: boolean; onCommit: (r: Omit<Rally, "court" | "layer">) => void; big?: boolean; impacts?: CourtMark[]; onImpact?: (k: number) => void; server?: 0 | 1 | null }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [last, setLast] = useState<CourtMark[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ s: number; mx: number; my: number } | null>(null);
  useEffect(() => {
    if (!big || !box.current) return;
    const el = box.current;
    const measure = () => {
      // Le terrain a l'echelle, aussi grand que possible ; les marges s'elargissent pour couvrir toute la zone (= dehors).
      const cw = el.clientWidth - 4, ch = el.clientHeight - 4, w = courtWidth(kind), M = COURT_MARGIN;
      const s = Math.max(10, Math.min(cw / (w + 2 * M), ch / (COURT_LENGTH + 2 * M)));
      setFit({ s, mx: Math.max(M, (cw / s - w) / 2), my: Math.max(M, (ch / s - COURT_LENGTH) / 2) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [big, kind]);
  const commit = (d: Draft) => {
    if (d.w === null) return;
    onCommit({ x: d.x, y: d.y, w: d.w, ...(d.how ? { how: d.how } : {}), ...(d.stroke ? { stroke: d.stroke } : {}), ...(d.hx !== undefined && d.hy !== undefined ? { hx: d.hx, hy: d.hy } : {}), ...(d.end ? { end: d.end } : {}) });
    setLast((l) => [...l.slice(-7), { x: d.x, y: d.y, muted: true, title: `Point pour ${names[d.w!]}` }]);
    setDraft(null);
  };
  const tap = (x: number, y: number) => {
    if (disabled) return;
    if (draft?.hitter) return setDraft({ ...draft, hx: x, hy: y, hitter: false }); // toucher suivant : le frappeur
    setDraft({ x, y, w: null, hitter: false }); // puis : comment le point s'est fini
  };
  // La maniere donne qui marque. Un point gagne est un « point gagnant » (couche 4) ; couche 1 : c'est fini.
  const pickHow = (o: HowOption) => {
    if (!draft) return;
    const d: Draft = { ...draft, how: o.how, by: o.by, w: o.w, end: o.how === "WIN" ? "WIN" : draft.end === "WIN" ? undefined : draft.end };
    if (level <= 1) return commit(d);
    setDraft({ ...d, hitter: level >= 3 && d.hx === undefined });
  };
  // Les derniers impacts du match en gris, le toucher en cours en orange.
  const marks: CourtMark[] = [...(impacts ?? last), ...(draft ? [{ x: draft.x, y: draft.y, hx: draft.hx, hy: draft.hy, pending: true }] : [])];
  // Appui long : l'impact le plus proche (a moins de 0,9 m).
  const longPress = (x: number, y: number) => {
    if (!onImpact || !impacts?.length) return;
    const best = [...impacts].filter((m) => m.k !== undefined).sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
    if (best && Math.hypot(best.x - x, best.y - y) < 0.9) onImpact(best.k!);
  };
  const chip = (on: boolean) => cx(ui.chip, on ? ui.chipBrand : ui.chipMuted, "py-1 text-sm");
  const options = draft ? howOptions(kind, draft.x, draft.y, server) : [];
  const chosen = draft?.how && draft.by !== undefined ? { how: draft.how, by: draft.by } : null;
  const controls = draft && (
    <>
      {!draft.how || level <= 1 ? (
        <HowPicker options={options} names={names} onPick={pickHow} />
      ) : (
        <>
          <button type="button" onClick={() => setDraft({ ...draft, how: undefined, by: undefined, w: null })} className={cx("w-full rounded-xl border-2 px-3 py-1.5 text-left text-sm font-bold", draft.how === "WIN" ? "border-success bg-success-soft text-success-ink" : "border-danger/40 bg-danger-soft text-danger-ink")}>
            {howInfo(draft.how).emoji} {draft.how === "WIN" ? `Gagné par ${names[chosen!.by]}` : `${howInfo(draft.how).name} · ${names[chosen!.by]}`} <span className="font-normal opacity-80">· changer</span>
          </button>
          {draft.hitter && <p className="font-bold text-accent-ink">🧍 Touchez où était le joueur qui a frappé.</p>}
          {level >= 2 && (
            <div>
              <p className="font-bold">Le coup</p>
              <div className="flex flex-wrap gap-1">{END_STROKES.map((s) => <button key={s.id} type="button" onClick={() => setDraft({ ...draft, stroke: draft.stroke === s.id ? undefined : s.id })} className={chip(draft.stroke === s.id)}>{s.emoji} {s.name}</button>)}</div>
            </div>
          )}
          {level >= 4 && draft.how !== "WIN" && (
            <div>
              <p className="font-bold">Faute provoquée ou directe ?</p>
              <div className="flex flex-wrap gap-1">{END_KINDS.filter((k) => k.id !== "WIN").map((k) => <button key={k.id} type="button" onClick={() => setDraft({ ...draft, end: draft.end === k.id ? undefined : k.id })} className={chip(draft.end === k.id)}>{k.name}</button>)}</div>
            </div>
          )}
        </>
      )}
      <div className="flex gap-1.5">
        {draft.how && level > 1 && <button type="button" onClick={() => commit(draft)} className={cx(btn.primary, "flex-1")}>✓ Point pour {names[draft.w!].split(" ")[0]}</button>}
        <button type="button" onClick={() => setDraft(null)} className={cx(btn.ghost, !(draft.how && level > 1) && "flex-1")} aria-label="Annuler ce toucher">{draft.how && level > 1 ? "✕" : "✕ Pas là (annuler ce toucher)"}</button>
      </div>
    </>
  );
  if (big) {
    return (
      <div ref={box} className="w-full h-full overflow-hidden flex items-center justify-center">
        {fit !== null && <CourtSvg kind={kind} scale={fit.s} mx={fit.mx} my={fit.my} marks={marks} top={names[0]} bottom={names[1]} onTap={tap} onLongPress={onImpact ? longPress : undefined} />}
        {draft && (
          <div className="fixed inset-x-0 bottom-0 z-[55] bg-card border-t-2 border-accent shadow-2xl p-3 text-sm max-h-[62vh] overflow-auto">
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
          {!draft && <p className={ui.hint}>📍 À la fin de l&apos;échange, touchez l&apos;endroit où le volant est tombé, puis dites comment le point s&apos;est fini.</p>}
          {controls}
        </div>
      </div>
    </div>
  );
}
