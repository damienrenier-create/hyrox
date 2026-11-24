"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/ui";

// Courbe de l'ELO d'un joueur, match apres match (Sartay 24/11 : « garder une trace de l'evolution ELO du joueur afin de
// l'evaluer au mieux »). Une seule serie : pas de legende (le titre la nomme) ; ligne fine de la couleur de la marque,
// grille discrete, repere au depart (1000) ; au survol ou au doigt : un repere vertical, le point et une bulle (date,
// adversaire, score, ELO avant → apres). Abscisse = les matchs dans l'ordre (un cours charge ne tasse pas la courbe) ;
// la date est ecrite sous le 1er match de chaque cours (au plus 6, sans chevauchement).
export type CurvePoint = { elo: number; day: string; label: string };
export function EloCurve({ points, start }: { points: CurvePoint[]; start: number }) {
  const [hover, setHover] = useState<number | null>(null);
  // Dessinee a la largeur reelle (pas reduite a l'echelle : sur telephone, les chiffres resteraient lisibles).
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) return null;
  const W = width, H = 200, L = 40, R = 12, T = 10, B = 26;
  const lo = Math.floor((Math.min(start, ...points.map((p) => p.elo)) - 10) / 25) * 25;
  const hi = Math.ceil((Math.max(start, ...points.map((p) => p.elo)) + 10) / 25) * 25;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / Math.max(1, hi - lo);
  const step = Math.max(25, Math.ceil((hi - lo) / 4 / 25) * 25);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  // Une date par cours (1er match du jour), au plus 6, espacees d'au moins 60 unites.
  const dayIdx = points.map((p, i) => (i === 0 || p.day !== points[i - 1].day ? i : -1)).filter((i) => i >= 0);
  const every = Math.ceil(dayIdx.length / 6);
  const labels: number[] = [];
  dayIdx.filter((_, k) => k % every === 0).forEach((i) => { if (!labels.length || x(i) - x(labels[labels.length - 1]) >= 60) labels.push(i); });
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.elo).toFixed(1)}`).join(" ");
  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - L) * (points.length - 1)) / (W - L - R));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover !== null ? points[hover] : null;
  return (
    <div ref={box} className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full touch-pan-y"
        role="img"
        aria-label={`Évolution de l'ELO : de ${points[0].elo} à ${points[points.length - 1].elo} en ${points.length - 1} matchs`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        <g className="text-line">
          {ticks.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeWidth={1} />)}
        </g>
        <g className="text-ink-3" fontSize={10} fill="currentColor">
          {ticks.map((v) => <text key={v} x={L - 6} y={y(v) + 3} textAnchor="end">{v}</text>)}
          {labels.map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{points[i].day}</text>)}
        </g>
        {start >= lo && start <= hi && (
          <g className="text-ink-3">
            <line x1={L} x2={W - R} y1={y(start)} y2={y(start)} stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" />
          </g>
        )}
        <g className="text-brand">
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].elo)} r={4} fill="currentColor" stroke="var(--color-card)" strokeWidth={2} />
          {h && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
              <circle cx={x(hover)} cy={y(h.elo)} r={5} fill="currentColor" stroke="var(--color-card)" strokeWidth={2} />
            </>
          )}
        </g>
      </svg>
      {h && hover !== null && (
        <div
          className={cx("pointer-events-none absolute top-1 z-10 max-w-[16rem] rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink shadow-card", x(hover) / W > 0.55 ? "-translate-x-full" : "")}
          style={{ left: `${(x(hover) / W) * 100}%`, marginLeft: x(hover) / W > 0.55 ? -8 : 8 }}
          role="status"
        >
          <b className="tabular-nums">{h.elo}</b> · {h.label}
        </div>
      )}
    </div>
  );
}
