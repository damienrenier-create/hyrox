"use client";

import { useState, useEffect, useTransition, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RaceSettings,
  pyramid,
  total,
  levelOf,
  lapsOf,
  cardsOf,
  finishAt,
  arrivalRank,
  partialOf,
  totalReps,
  timeline,
  standings,
  medalInfo,
  maxMedals,
  medalOrder,
  tierSizes,
  dirLabel,
  tierOf,
  startOf,
  elapsed,
  fmt,
  fmtDown,
  fmtUp,
  Standing,
  MEDAL_BONUS_S,
  finalScores,
  type FinalScore,
} from "@/lib/wod-engines/templates/pyramide-engine";
import type { RaceContextBundle } from "@/lib/race-context";
import { TeamsManager, type TeamWithMembers, type RefereeView, type TeamMemberView, type PickerData } from "./TeamsManager";
import { RefereeRequestsPopup } from "./RefereeRequestsPopup";
import { SettingsPanel } from "./SettingsPanel";
import { ArbitrageTab } from "./ArbitrageTab";
import { RecordsTab } from "./RecordsTab";
import { LogoutButton } from "../_components/LogoutButton";
import type { BoardData } from "@/lib/referee-board";
import { motion } from "framer-motion";
import type { PendingRequest } from "./referee-decisions";
import {
  startRaceAction,
  togglePauseAction,
  validateLapAction,
  giveCardAction,
  undoLastAction,
  setTeamStartAction,
  setTeamEndAction,
  teamLapsAction,
  deleteLapAction,
  type TeamLap,
} from "./race-actions";
import { setRaceStatus } from "@/lib/firebase/firebase-sync";
import { greffierPulseAction } from "@/lib/pulse";
import { usePulse } from "../_components/usePulse";
import { finishRaceAction } from "./actions";
import { resetSessionAction } from "./race-actions";
import { btn, cx, ui } from "@/lib/ui";
import { cake } from "@/lib/birthday";

// ===== Tuiles d'equipe : port FIDELE de « compte-tours-wod Pyramide final.html » (memes classes, memes
// couleurs, memes degrades). 15 medailles = 5 paliers (bronze, argent, or, platine, diamant) x 3 eclats ;
// fond de la tuile = couleur de la derniere medaille ; diamant = reflet anime ; flash jaune au tour valide.
const TIERS = ["b", "s", "g", "p", "d"];
const MEDAL_NAMES = ["Bronze", "Argent", "Or", "Platine", "Diamant"];
const TOP_RANKED = 5; // les 5 premieres equipes a obtenir une medaille voient leur rang inscrit dedans
const ordinal = (n: number) => (n === 1 ? "1re" : `${n}e`);
const MIN_LAP_GAP_MS = 60_000; // deux tours de la meme equipe a moins d'une minute = double clic (idem serveur)
const CHOICE = "border border-line-2 rounded-xl py-2 text-sm font-semibold bg-card hover:bg-paper transition disabled:opacity-50";

// ===== Saisies optimistes (tours, cartes) =====
// Une saisie locale porte le compte serveur de son equipe au moment du clic (`serverCountBefore`). Elle est
// « vivante » tant que le serveur n'a pas renvoye plus que ce compte ; au-dela, il l'a absorbee.
type LocalEntry = { id: number; teamId: string; at: number; serverCountBefore: number };
const countOf = (list: { teamId: string }[], teamId: string) => list.reduce((n, x) => (x.teamId === teamId ? n + 1 : n), 0);
function stillLive(entries: LocalEntry[], server: { teamId: string }[]): LocalEntry[] {
  const kept = entries.filter((e) => e.serverCountBefore >= countOf(server, e.teamId));
  return kept.length === entries.length ? entries : kept; // meme reference si rien ne change : pas de re-rendu
}
// Une action qui echoue en vol (reseau coupe, session expiree) doit rendre une erreur lisible, jamais laisser
// une saisie locale orpheline que le serveur ne connait pas.
async function settle(action: () => Promise<{ error: string } | { ok: true }>): Promise<{ error: string } | { ok: true }> {
  try {
    return await action();
  } catch (e) {
    return { error: "Saisie non enregistrée (réseau ou session expirée) : " + (e instanceof Error ? e.message : String(e)) };
  }
}
const fmtGap = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : fmtUp(ms));

const PYR_STYLES = `
.pyr{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
@media(min-width:560px){.pyr{grid-template-columns:repeat(4,1fr)}}
@media(min-width:900px){.pyr{grid-template-columns:repeat(6,1fr)}}
@media(min-width:1200px){.pyr{grid-template-columns:repeat(8,1fr)}}
@media(min-width:1600px){.pyr{grid-template-columns:repeat(12,1fr)}}
.pyr .cell{display:flex;flex-direction:column;min-width:0}
.pyr .cell .tile{flex:1}
.pyr .tile{border:0;border-radius:12px;padding:6px 3px 7px;background:#16344E;color:#fff;font:inherit;text-align:center;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-height:92px;overflow:hidden;
  min-width:0;width:100%;position:relative;cursor:pointer;transition:transform .08s}
.pyr .tile:active{transform:scale(.97)}
.pyr .tile > span{max-width:100%}
/* « EQUIPE 4 » en pastille noire tout en haut de la tuile, au-dessus des medailles : lisible sur tous les fonds. */
.pyr .tile .tnum{display:inline-flex;align-items:center;justify-content:center;height:19px;padding:0 9px;border-radius:999px;
  background:#000;color:#fff;font:800 11px/1 inherit;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px;box-shadow:0 0 0 1px rgba(255,255,255,.35);white-space:nowrap}
.pyr .tile .reps{font-size:28px;font-weight:800;line-height:1.05;letter-spacing:-.02em}
.pyr .tile.done .reps{font-size:22px}
.pyr .tile .lbl{font-size:10.5px;opacity:.88;line-height:1.15;padding:0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pyr .tile .who{font-size:12px;font-weight:700;opacity:.92;padding:0 3px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pyr .tile.unset{box-shadow:inset 0 0 0 3px #FFC93C}
/* Cartes jaunes : contrastes releves, le creme sur blanc disparaissait au projecteur. */
.pyr .ycard{margin-top:3px;width:100%;min-height:19px;border:1.5px dashed #9A7400;background:#FFF0A8;color:#3D2E00;border-radius:8px;
  padding:1px 6px;font:700 10.5px/1.2 inherit;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;overflow:hidden;cursor:pointer}
.pyr .ycard.has{border-style:solid;border-color:#7A5C00;background:#FFD23F;color:#241B00}
.pyr .ycard:active{background:#F2BC00}
/* Montee / descente de la pyramide : la tuile se souleve ou s'affaisse de quelques pixels. */
.pyr .cell{transition:transform .25s ease}
.pyr .cell.up{transform:translateY(-5px)}
.pyr .cell.down{transform:translateY(5px)}
.pyr .yc{width:8px;height:11px;border-radius:1.5px;background:#FFD200;box-shadow:0 0 0 1px #A88700;display:inline-block;transform:rotate(-8deg);flex:none}
.pyr .yplus{font-weight:600;opacity:.75}
/* Medailles : seulement celles gagnees dans les 5 premiers d'un tour, donc plus grandes et plus lisibles. */
.pyr .medals{display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:3px 4px;max-width:140px;margin:0 auto 3px;min-height:16px}
.pyr .trio{display:flex;gap:2px}
.pyr .md{width:16px;height:16px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 1px rgba(0,0,0,.30);font:800 10px/1 "Helvetica Neue",Arial,sans-serif;color:#1A1A1A;text-shadow:none}
.pyr .md i{font-style:normal;display:block}
.pyr .md.b0{background:radial-gradient(circle at 40% 35%,#B9906E,#8C5E3A 60%,#664127);color:#FFF}
.pyr .md.b1{background:radial-gradient(circle at 34% 30%,#EBC39C,#C27A3E 55%,#7E4A1E)}
.pyr .md.b2{background:radial-gradient(circle at 30% 26%,#FFE3C4 0%,#E3903F 38%,#9A5520 100%);box-shadow:0 0 0 1px rgba(0,0,0,.25),0 0 4px rgba(227,144,63,.85)}
.pyr .md.s0{background:radial-gradient(circle at 40% 35%,#C4C4C4,#979797 60%,#6E6E6E)}
.pyr .md.s1{background:radial-gradient(circle at 34% 30%,#F2F2F2,#B8B8B8 55%,#7A7A7A)}
.pyr .md.s2{background:radial-gradient(circle at 30% 26%,#FFFFFF 0%,#E4E4E4 35%,#9A9A9A 100%);box-shadow:0 0 0 1px rgba(0,0,0,.25),0 0 4px rgba(255,255,255,.95)}
.pyr .md.g0{background:radial-gradient(circle at 40% 35%,#D6C07E,#B39433 60%,#86690F)}
.pyr .md.g1{background:radial-gradient(circle at 34% 30%,#FFF0A8,#E8BE1E 55%,#9C7400)}
.pyr .md.g2{background:radial-gradient(circle at 30% 26%,#FFFBE0 0%,#FFD700 38%,#C08A00 100%);box-shadow:0 0 0 1px rgba(0,0,0,.2),0 0 5px rgba(255,215,0,.95)}
.pyr .md.p0{background:radial-gradient(circle at 40% 35%,#E3EAEE,#AEBFCA 60%,#7D93A2);box-shadow:0 0 0 1px #5A7282}
.pyr .md.p1{background:radial-gradient(circle at 34% 30%,#FAFDFF,#C9D9E3 50%,#7F9AAC);box-shadow:0 0 0 1px #57758A}
.pyr .md.p2{background:radial-gradient(circle at 30% 26%,#FFFFFF 0%,#E4F4FC 40%,#8FB9CF 100%);box-shadow:0 0 0 1px #4E7A92,0 0 5px rgba(200,235,250,.95)}
.pyr .md.d0,.pyr .md.d1,.pyr .md.d2{border-radius:1px;transform:rotate(45deg) scale(.84)}
.pyr .md.d0 i,.pyr .md.d1 i,.pyr .md.d2 i{transform:rotate(-45deg)}
.pyr .md.d0{background:linear-gradient(135deg,#EAFBFF,#A3DDEE 60%,#70B9CF);box-shadow:0 0 0 1px #3F8FA8}
.pyr .md.d1{background:linear-gradient(135deg,#F7FEFF,#B4ECF8 50%,#6CC6DE);box-shadow:0 0 0 1px #3593B0,0 0 3px rgba(95,205,235,.8)}
.pyr .md.d2{background:linear-gradient(135deg,#FFFFFF,#BDF4FF 40%,#5FCDEB 70%,#FFFFFF);box-shadow:0 0 0 1px #2B8FB0,0 0 7px 1px rgba(95,205,235,.95)}
.pyr .cell.tier .tile{text-shadow:0 1px 2px rgba(0,0,0,.45)}
.pyr .cell.t1 .tile{outline:2px solid #CD7F32;outline-offset:-2px;background:linear-gradient(115deg,transparent 35%,rgba(255,205,160,.22) 48%,transparent 62%),linear-gradient(160deg,#8A5226 0%,#5A3316 55%,#3A2010 100%)}
.pyr .cell.t2 .tile{outline:2px solid #D5DBE0;outline-offset:-2px;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.26) 48%,transparent 62%),linear-gradient(160deg,#7C8894 0%,#4F5B66 55%,#313A43 100%)}
.pyr .cell.t3 .tile{outline:2px solid #FFD000;outline-offset:-2px;background:linear-gradient(115deg,transparent 35%,rgba(255,232,140,.30) 48%,transparent 62%),linear-gradient(160deg,#A07A08 0%,#6E5200 55%,#463400 100%)}
.pyr .cell.t4 .tile{outline:2px solid #E4F4FF;outline-offset:-2px;box-shadow:0 0 10px rgba(180,225,245,.65);background:linear-gradient(115deg,transparent 32%,rgba(235,248,255,.36) 47%,transparent 62%),linear-gradient(160deg,#8FA9BA 0%,#4E6A7D 55%,#2C3F4C 100%)}
.pyr .cell.t4 .tile.unset{box-shadow:inset 0 0 0 3px #FFC93C,0 0 10px rgba(180,225,245,.65)}
.pyr .cell.t5 .tile{background:linear-gradient(135deg,#0A3350 0%,#17678A 42%,#46B3D1 52%,#17678A 62%,#0A3350 100%);box-shadow:0 0 0 2px #BDF4FF,0 0 16px rgba(95,205,235,.8)}
.pyr .cell.t5 .tile.unset{box-shadow:inset 0 0 0 3px #FFC93C,0 0 16px rgba(95,205,235,.8)}
.pyr .cell.t5 .tile::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.5) 45%,transparent 60%);background-size:250% 100%;animation:pyr-sheen 2.4s linear infinite}
.pyr .cell.t5 .reps{text-shadow:0 0 10px rgba(189,244,255,.9)}
.pyr .cell .tile.hit{background:#FFC93C !important;color:#0E1A26;text-shadow:none}
@keyframes pyr-sheen{from{background-position:130% 0}to{background-position:-130% 0}}
@keyframes pyr-blink{0%,100%{opacity:1}50%{opacity:.25}}
.pyr-blink{animation:pyr-blink .9s steps(1,end) infinite}
@media (prefers-reduced-motion: reduce){.pyr .cell.t5 .tile::after{animation:none;background-position:50% 0}.pyr-blink{animation:none}}

/* Piste « course de chevaux » : 7 couloirs, une seule bande au-dessus de la grille. */
.hr{margin:0 0 10px;background:#fff;border:1px solid #E6EBEF;border-radius:12px;padding:6px 8px}
.hr-track{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.hr-slot{position:relative;border-radius:9px;background:#F4F7F9;border:1px solid #E6EBEF;min-height:48px;padding:15px 4px 4px;
  display:flex;flex-wrap:wrap;gap:3px;align-content:flex-start;justify-content:center}
/* Couleurs relevees pour le projecteur : les pastels jaunes s'y effacent completement. */
.hr-slot.win{background:linear-gradient(160deg,#FFE58A,#F5C518);border-color:#B8860B}
.hr-slot.lastslot{background:#F7D5DB;border-color:#D9899A}
.hr-num{position:absolute;top:3px;left:6px;font:800 9px/1 inherit;color:#4A5A68;letter-spacing:.06em;text-transform:uppercase}
/* Seule dans son couloir, l'equipe prend toute la place : c'est ce qui doit se lire du fond de la salle. */
.hr-car{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;background:#16344E;color:#fff;border-radius:8px;padding:6px 8px;font:800 14px/1.2 inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hr-car .v{opacity:.8;font-weight:700;font-size:11px}
.hr-dot{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:#16344E;color:#fff;font:800 11px/1 inherit}
.hr-fin{display:flex;align-items:center;gap:5px;margin-top:5px;padding-top:5px;border-top:1px dashed #E6EBEF;overflow-x:auto}
.hr-flag{font-size:13px;flex:none}
.hr-none{font-size:11px;color:#8FA0AE}
.hr-f{display:inline-flex;align-items:center;gap:5px;background:#EEF9F1;border:1px solid #BFE3CA;border-radius:999px;padding:2px 9px;font:800 11px/1.4 inherit;white-space:nowrap;flex:none}
.hr-f .r{width:14px;height:14px;border-radius:50%;background:#2E7D4F;color:#fff;font:800 9px/14px inherit;text-align:center;flex:none}
.hr-f .t{font-weight:700;opacity:.7;font-variant-numeric:tabular-nums}

/* Classement en tete, sous la grille : port de #leaders du fichier d'origine. */
.ld{margin-top:12px}
.ld.top{margin-top:0;margin-bottom:10px}
.ld ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.ld li{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:10px;background:#fff;border:1px solid #E6EBEF}
.ld li.done{background:#EEF9F1;border-color:#BFE3CA}
.ld .rank{font:800 13px/1 inherit;width:18px;text-align:center;opacity:.75}
.ld .who{font-size:12px;color:#5C6B78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.ld .team{font-weight:800;font-size:13px;white-space:nowrap}
.ld .val{margin-left:auto;font-weight:800;font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums}
.ld .y{display:inline-flex;align-items:center;gap:2px;font-size:11px;font-weight:700;color:#6B5600}
`;


// Temps signe court (le score peut devenir negatif si l'equipe a beaucoup de reps et de medailles).
function fmtSigned(ms: number): string {
  const neg = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  return `${neg ? "−" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// medalsHtml() du fichier d'origine : groupes par palier, eclat croissant, rang inscrit pour les 5 premieres.
function Medals({ settings, n, ord }: { settings: RaceSettings; n: number; ord?: { pos: number; at: number }[] }) {
  const k = Math.min(n, maxMedals(settings));
  const sz = tierSizes(settings);
  const p = pyramid(settings);
  const groups = [];
  let idx = 0;
  for (let i = 0; i < 5 && idx < k; i++) {
    if (!sz[i]) continue;
    const items = [];
    for (let j = 0; j < sz[i] && idx < k; j++, idx++) {
      const m = medalInfo(settings, idx);
      const o = ord?.[idx];
      const pos = o ? o.pos : 0;
      // Une medaille ne s'affiche que si l'equipe a boucle ce tour dans les 5 premieres : les autres tours
      // se lisent au survol de la tuile (nombre de tours), pas ici.
      if (!(pos && pos <= TOP_RANKED)) continue;
      const title = `${MEDAL_NAMES[i]} ${j + 1}/${sz[i]} · tour à ${p[idx]} reps${pos && o ? ` · ${ordinal(pos)} équipe à l'obtenir · ${fmt(o.at)}` : ""}`;
      items.push(
        <span key={idx} className={`md ${TIERS[i]}${m.variant}`} title={title}>
          {pos && pos <= TOP_RANKED ? <i>{pos}</i> : null}
        </span>
      );
    }
    if (items.length) groups.push(<span key={i} className="trio">{items}</span>);
  }
  return <span className="medals" aria-label={`${n} tour${n > 1 ? "s" : ""}`}>{groups}</span>;
}

// ===== Piste « course de chevaux » =====
// Sept couloirs, de gauche a droite : 1 = le dernier, 2 = le peloton, 3 a 7 = les cinq de tete (7 = leader).
// Au depart tout le monde est dans le peloton. Une equipe qui termine quitte la piste et rejoint la ligne
// d'arrivee, en dessous, dans l'ordre d'arrivee. Remplace le classement vertical, qui mangeait l'ecran.
type PyrCtx = import("@/lib/wod-engines/templates/pyramide-engine").RaceContext;
const teamNum = (label: string | undefined) => (label ?? "").match(/\d+/)?.[0] ?? "?";
const SPRING = { type: "spring" as const, stiffness: 280, damping: 30 };

function RaceStrip({
  ctx, phase, tl, teamNames, T,
}: {
  ctx: PyrCtx;
  phase: "pre" | "run" | "post";
  tl: ReturnType<typeof timeline>;
  teamNames: Record<string, string>;
  T: number;
}) {
  const all = standings(ctx, phase === "post");
  const finished = all.filter((e) => e.done).sort((a, b) => (a.finishAt ?? 0) - (b.finishAt ?? 0));
  const racing = all.filter((e) => !e.done);
  const started = phase !== "pre";
  const lapsE = (e: Standing) => lapsOf(ctx, e.team.id);

  // Les cinq de tete : uniquement des equipes qui ont valide au moins un tour, sinon tout le monde serait
  // classe des le coup d'envoi alors que personne n'a encore bouge.
  const head = started ? racing.filter((e) => lapsE(e) > 0).slice(0, 5) : [];
  const headIds = new Set(head.map((e) => e.team.id));
  const rest = racing.filter((e) => !headIds.has(e.team.id));
  // Le dernier ne descend que s'il est STRICTEMENT derriere : pas de bonnet d'ane sur une egalite.
  const last =
    started && rest.length >= 2 && lapsE(rest[rest.length - 1]) < lapsE(rest[rest.length - 2])
      ? rest[rest.length - 1]
      : null;
  const pack = last ? rest.slice(0, -1) : rest;
  const inSlot = (i: number): Standing[] =>
    i === 1 ? (last ? [last] : []) : i === 2 ? pack : head[7 - i] ? [head[7 - i]] : [];

  // `tiny` = pastille numerotee (peloton a plusieurs) ; sinon la vignette prend tout le couloir.
  const car = (e: Standing, tiny: boolean) => {
    const n = lapsE(e);
    const m = medalInfo(ctx.settings, Math.max(0, Math.min(n, maxMedals(ctx.settings)) - 1));
    return (
      <motion.span
        key={e.team.id}
        layoutId={`car_${e.team.id}`}
        transition={SPRING}
        className={tiny ? "hr-dot" : "hr-car"}
        title={`${teamNames[e.team.id] ?? ""} · ${n}/${T} tours`}
      >
        {!tiny && n > 0 && <span className={`md ${TIERS[m.tier]}${m.variant}`} />}
        <b>{tiny ? teamNum(teamNames[e.team.id]) : teamNames[e.team.id] ?? teamNum(teamNames[e.team.id])}</b>
        {!tiny && <span className="v">{n}/{T}</span>}
      </motion.span>
    );
  };

  return (
    <section className="hr col-span-full">
      <div className="hr-track">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => {
          const here = inSlot(i);
          return (
            <div key={i} className={cx("hr-slot", i === 7 && "win", i === 1 && "lastslot")}>
              <span className="hr-num">{i === 1 ? "dernier" : i === 2 ? "peloton" : ordinal(8 - i)}</span>
              {here.map((e) => car(e, here.length > 1))}
            </div>
          );
        })}
      </div>
      <div className="hr-fin">
        <span className="hr-flag">🏁</span>
        {finished.length === 0 ? (
          <span className="hr-none">{started ? "Personne n'est encore arrivé" : "Tout le monde sur la ligne de départ"}</span>
        ) : (
          finished.map((e, i) => (
            <motion.span key={e.team.id} layoutId={`car_${e.team.id}`} transition={SPRING} className="hr-f">
              <b className="r">{i + 1}</b>
              {teamNames[e.team.id] ?? e.team.id}
              <span className="t">
                {fmt(e.finishAt)}
                {tl.late[e.team.id] != null ? ` +${fmt(tl.late[e.team.id])}` : ""}
              </span>
            </motion.span>
          ))
        )}
      </div>
    </section>
  );
}

export type SessionOption = { id: string; label: string; classes: string[]; open: boolean; dateMs: number };

export const sessionDay = (ms: number) =>
  new Date(ms).toLocaleString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

// Un pas en arriere (seance plus ancienne) ou en avant (plus recente). Grise et inerte quand il n'y a rien
// de ce cote, pour que la place reste stable et que le chronometre ne bouge pas d'un pixel.
export function SessionStep({ to, dir }: { to: SessionOption | null; dir: "older" | "newer" }) {
  const router = useRouter();
  const arrow = dir === "older" ? "‹" : "›";
  if (!to) return <span className="w-9 h-9 flex-shrink-0 rounded-full bg-paper/60 text-line-2 flex items-center justify-center text-xl leading-none select-none">{arrow}</span>;
  return (
    <button
      type="button"
      onClick={() => router.push(`/greffier?session=${to.id}`)}
      title={`${dir === "older" ? "Séance précédente" : "Séance suivante"} : ${to.label}${to.classes.length ? ` · ${to.classes.join(", ")}` : ""} · ${to.open ? "ouverte" : sessionDay(to.dateMs)}`}
      aria-label={dir === "older" ? "Séance précédente" : "Séance suivante"}
      className="w-9 h-9 flex-shrink-0 rounded-full bg-paper hover:bg-line text-ink-2 hover:text-ink flex items-center justify-center font-bold text-xl leading-none transition"
    >
      {arrow}
    </button>
  );
}

export function GreffierClient({
  sessionId, sessionLabel, sessionOptions, olderSession, newerSession, isMaster = false, canCorrect = false, bundle, teamsWithMembers, classes, allClasses, referees, pendingRequests, board, picker,
}: {
  sessionId: string;
  sessionLabel: string;
  sessionOptions: SessionOption[];
  olderSession: SessionOption | null;
  newerSession: SessionOption | null;
  isMaster?: boolean;
  picker: PickerData; // roster precharge + coequipiers habituels (voir TeamsManager)
  canCorrect?: boolean; // DAMZER et GREFFIER : retirer un tour precis (les coachs ne suppriment rien)
  bundle: RaceContextBundle;
  teamsWithMembers: TeamWithMembers[];
  classes: string[];
  allClasses: string[];
  referees: RefereeView[];
  pendingRequests: PendingRequest[];
  board: BoardData | null;
}) {
  const router = useRouter();
  const { ctx: serverCtx, startedAtMs, endedAtMs, pauses, teamNames, exerciseLabels } = bundle;
  const [now, setNow] = useState(() => Date.now());

  // ===== Etat OPTIMISTE : un tap = un tour (ou une carte) affiche IMMEDIATEMENT — medaille, palier, niveau,
  // classement — sans attendre le serveur. L'action part en arriere-plan ; le re-rendu serveur est groupe
  // (1,5 s apres la derniere saisie) et absorbe les saisies locales une a une (pas de doublon, pas de saut).
  // Le tri « vivante / absorbee » se fait PENDANT le rendu, des que de nouvelles donnees serveur arrivent
  // (pattern React « ajuster un etat quand une prop change » : React relance le rendu avant d'afficher quoi
  // que ce soit). Jamais dans un effet : l'image ou les donnees serveur arrivent compterait le meme tour deux
  // fois (9 → 7 → 8 sur la tuile), quelle que soit la source du rafraichissement (pouls, minuterie, annulation).
  const seq = useRef(0);
  const [localLaps, setLocalLaps] = useState<LocalEntry[]>([]);
  const [localCards, setLocalCards] = useState<LocalEntry[]>([]);
  const [seenCtx, setSeenCtx] = useState(serverCtx); // dernier etat serveur deja depouille
  if (seenCtx !== serverCtx) {
    setSeenCtx(serverCtx);
    const ls = stillLive(localLaps, serverCtx.laps);
    if (ls !== localLaps) setLocalLaps(ls);
    const cs = stillLive(localCards, serverCtx.cards);
    if (cs !== localCards) setLocalCards(cs);
  }
  const ctx = useMemo<typeof serverCtx>(() => {
    if (!localLaps.length && !localCards.length) return serverCtx;
    return {
      ...serverCtx,
      laps: [...serverCtx.laps, ...localLaps.map(({ teamId, at }) => ({ teamId, at }))].sort((a, b) => a.at - b.at),
      cards: [...serverCtx.cards, ...localCards.map(({ teamId, at }) => ({ teamId, at }))],
    };
  }, [serverCtx, localLaps, localCards]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh(ms = 1500) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), ms);
  }
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const lastTap = useRef(new Map<string, number>()); // anti double-tap par equipe (600 ms)
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false); // « Annuler un tour » : equipe → tours → retrait
  const [hitTeam, setHitTeam] = useState<string | null>(null);
  const memberCount = useMemo(() => teamsWithMembers.reduce((n, t) => n + t.members.length, 0), [teamsWithMembers]);

  const isPaused = pauses.some((p) => p.to === null);
  const phase: "pre" | "run" | "post" = startedAtMs === null ? "pre" : endedAtMs !== null ? "post" : "run";
  // Avant le depart et sans aucun eleve encode, on ouvre directement sur la preparation des equipes.
  const [view, setView] = useState<"grid" | "results" | "score" | "records" | "teams" | "arbitrage">(phase === "pre" && memberCount === 0 ? "teams" : "grid");

  useEffect(() => {
    if (phase !== "run" || isPaused) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase, isPaused]);

  // Rafraichissement econome : on interroge un « pouls » (compteurs de tours, cartes, evaluations, arbitres)
  // et on ne refabrique la page QUE s'il a change — au lieu de la reconstruire toutes les 5 s pour rien.
  // Actif meme avant le depart : les equipes et les arbitres bougent aussi depuis un autre appareil.
  const pulse = useCallback(() => greffierPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 10000, phase !== "post" && !openTeamId && !settingsOpen && !fixOpen && !pending);

  const liveMs = useMemo(() => {
    if (phase === "pre") return 0;
    const ref = phase === "post" ? endedAtMs! : now;
    return elapsed(startedAtMs, pauses, ref) ?? 0;
  }, [phase, startedAtMs, endedAtMs, pauses, now]);

  const tl = useMemo(() => timeline(ctx), [ctx]);
  const ord = useMemo(() => medalOrder(ctx), [ctx]);
  const membersByTeam = useMemo(() => new Map(teamsWithMembers.map((t) => [t.id, t.members])), [teamsWithMembers]);
  // Atelier de depart de chaque equipe : annonce aux eleves pendant l'encodage (ecran projete).
  const startByTeam = useMemo(
    () =>
      Object.fromEntries(
        ctx.teams.map((t) => {
          const st = startOf(ctx, t);
          return [t.id, { number: st.number, label: exerciseLabels[st.id] ?? "" }];
        })
      ),
    [ctx, exerciseLabels]
  );
  const finishedCount = useMemo(() => ctx.teams.filter((t) => finishAt(ctx, t.id) !== null).length, [ctx]);
  const T = total(ctx.settings);

  function refresh() {
    router.refresh();
  }

  function run(action: () => Promise<{ error: string } | { ok: true }>) {
    setError("");
    startTransition(async () => {
      const res = await settle(action);
      if ("error" in res) setError(res.error);
      else refresh();
    });
  }

  function handleStart() {
    run(async () => {
      const res = await startRaceAction(sessionId);
      if (!("error" in res)) void setRaceStatus(sessionId, "COMBAT"); // diffusion live, jamais bloquante
      return res;
    });
  }
  function handlePause() {
    run(() => togglePauseAction(sessionId));
  }
  function nowElapsed() {
    return elapsed(startedAtMs, pauses, Date.now()) ?? 0;
  }
  function handleLap(teamId: string) {
    if (phase !== "run" || isPaused) {
      setOpenTeamId(teamId);
      return;
    }
    if (finishAt(ctx, teamId) !== null) return;
    // Un tour de pyramide prend plusieurs minutes : une deuxieme validation de la meme equipe a moins
    // d'une minute est un double clic. Refus immediat ici, et le serveur refuse aussi de son cote.
    const lastAt = Math.max(-Infinity, ...ctx.laps.filter((l) => l.teamId === teamId).map((l) => l.at));
    if (Number.isFinite(lastAt) && nowElapsed() - lastAt < MIN_LAP_GAP_MS) {
      setError(`${teamNames[teamId] ?? "Cette équipe"} vient déjà de valider un tour il y a ${Math.round((nowElapsed() - lastAt) / 1000)} s : double clic ignoré. Pour corriger un tour, ouvre l'équipe.`);
      return;
    }
    const t = Date.now();
    if (t - (lastTap.current.get(teamId) ?? 0) < 600) return; // double-tap accidentel = un seul tour
    lastTap.current.set(teamId, t);
    // blink() du fichier d'origine : la tuile flashe en jaune 350 ms + vibration.
    setHitTeam(teamId);
    setTimeout(() => setHitTeam((x) => (x === teamId ? null : x)), 350);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(40);
    // Affichage immediat, serveur ensuite. Le compte de reference = compte serveur + saisies locales encore
    // vivantes (l'etat est depouille a chaque arrivee de donnees, voir plus haut) : une saisie deja absorbee
    // n'est jamais comptee, sinon un clic tombant entre deux rendus laisserait un tour fantome a l'ecran.
    const before = countOf(serverCtx.laps, teamId) + countOf(localLaps, teamId);
    const id = ++seq.current;
    setLocalLaps((ls) => [...ls, { id, teamId, at: nowElapsed(), serverCountBefore: before }]);
    setError("");
    startTransition(async () => {
      const res = await settle(() => validateLapAction(sessionId, teamId));
      if ("error" in res) {
        setError(res.error);
        setLocalLaps((ls) => ls.filter((l) => l.id !== id)); // le serveur n'a rien : la tuile revient a l'etat vrai
        return;
      }
      scheduleRefresh();
    });
  }
  function handleCard(teamId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const before = countOf(serverCtx.cards, teamId) + countOf(localCards, teamId);
    const id = ++seq.current;
    setLocalCards((cs) => [...cs, { id, teamId, at: nowElapsed(), serverCountBefore: before }]);
    setError("");
    startTransition(async () => {
      const res = await settle(() => giveCardAction(sessionId, teamId));
      if ("error" in res) {
        setError(res.error);
        setLocalCards((cs) => cs.filter((c) => c.id !== id));
        return;
      }
      scheduleRefresh();
    });
  }
  function handleUndo() {
    // Le serveur retire SA saisie la plus recente. On ne retire une saisie locale que si c'est la meme : une
    // saisie encore vivante, plus recente que tout ce que le serveur connait. Sinon on laisse le serveur
    // trancher et le rafraichissement recoller — jamais deux retraits pour un seul clic.
    const newestServer = Math.max(-Infinity, ...serverCtx.laps.map((l) => l.at), ...serverCtx.cards.map((c) => c.at));
    const lastLap = localLaps[localLaps.length - 1];
    const lastCard = localCards[localCards.length - 1];
    const lapWins = !!lastLap && (!lastCard || lastLap.at >= lastCard.at);
    const newest = lapWins ? lastLap : lastCard;
    if (newest && newest.at >= newestServer) {
      if (lapWins) setLocalLaps((ls) => ls.filter((l) => l.id !== newest.id));
      else setLocalCards((cs) => cs.filter((c) => c.id !== newest.id));
    }
    if (refreshTimer.current) clearTimeout(refreshTimer.current); // run() rafraichit tout de suite
    run(() => undoLastAction(sessionId));
  }
  // Un tour retire a la main (panneau d'equipe ou « Annuler un tour ») : les saisies locales de cette equipe
  // n'ont plus de sens — le compte serveur baisse, elles redeviendraient « vivantes » et re-afficheraient
  // un tour de trop. On les jette et on relit le serveur.
  function handleLapDeleted(teamId: string) {
    setLocalLaps((ls) => (ls.some((l) => l.teamId === teamId) ? ls.filter((l) => l.teamId !== teamId) : ls));
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refresh();
  }
  function handleFinish() {
    if (!confirm("Terminer le WOD ? Les évaluations en cours seront closes (fiabilité calculée) et la séance clôturée.")) return;
    setError("");
    startTransition(async () => {
      try {
        await finishRaceAction(sessionId);
        void setRaceStatus(sessionId, "TERMINATED"); // diffusion live, jamais bloquante
        refresh();
      } catch (e) {
        setError("Impossible de terminer la course : " + (e instanceof Error ? e.message : String(e)));
      }
    });
  }
  // Course lancee ou terminee par erreur : tout remettre a zero sans passer par la console (double confirmation).
  function handleReset() {
    if (!confirm("Remettre cette course à zéro ? Chrono, tours, cartes jaunes, tirs et évaluations du Touché-Coulé seront effacés. Les équipes, les arbitres, leurs flottes et les réglages restent, et la séance est rouverte.")) return;
    if (!confirm("Vraiment ? Les résultats de cette course seront perdus, sans retour en arrière.")) return;
    setError("");
    startTransition(async () => {
      const res = await resetSessionAction(sessionId);
      if ("error" in res) setError(res.error);
      else { void setRaceStatus(sessionId, "PREPARATION"); refresh(); }
    });
  }

  function exportCsv() {
    const L: string[] = [];
    const p = pyramid(ctx.settings);
    const st = standings(ctx, phase === "post");
    L.push("Classement");
    L.push(["Rang", "Equipe", "Tours", "Temps final", "Temps supplementaire", "Depart", "Total reps", "Cartes jaunes"].join(";"));
    st.forEach((s, i) => {
      const startEx = startOf(ctx, s.team);
      L.push(
        [
          i + 1,
          teamNames[s.team.id] ?? s.team.id,
          Math.min(s.n, T),
          s.done ? fmt(s.finishAt) : "",
          tl.late[s.team.id] != null ? fmt(tl.late[s.team.id]) : "",
          exerciseLabels[startEx.id] ?? "",
          s.reps,
          s.yellowCards,
        ].join(";")
      );
    });
    L.push("");
    L.push("Journal");
    L.push(["Temps", "Equipe", "Tour"].join(";"));
    const cnt: Record<string, number> = {};
    [...ctx.laps].sort((a, b) => a.at - b.at).forEach((l) => {
      cnt[l.teamId] = (cnt[l.teamId] || 0) + 1;
      L.push([fmt(l.at), teamNames[l.teamId] ?? l.teamId, cnt[l.teamId]].join(";"));
    });
    L.push("");
    L.push("Cartes");
    L.push(["Temps", "Equipe"].join(";"));
    [...ctx.cards].sort((a, b) => a.at - b.at).forEach((c) => {
      L.push([fmt(c.at), teamNames[c.teamId] ?? c.teamId].join(";"));
    });
    L.push("");
    L.push("Reglages");
    L.push(["Cle", "Valeur"].join(";"));
    L.push(["Reps depart", ctx.settings.rep0].join(";"));
    L.push(["Sommet", ctx.settings.peak].join(";"));
    L.push(["Pas", ctx.settings.step].join(";"));
    L.push(["Duree max (min)", ctx.settings.capMin].join(";"));
    L.push(["Apres 1re arrivee (min)", ctx.settings.afterMin].join(";"));
    L.push(["Retrait par arrivee (min)", ctx.settings.penMin].join(";"));
    L.push(["Temps ecoule", fmt(liveMs)].join(";"));
    L.push(["Etat", phase === "post" ? "terminee" : isPaused ? "en pause" : phase === "run" ? "en cours" : "pas commencee"].join(";"));

    const blob = new Blob(["﻿" + L.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Wod Pyramide.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const rest = tl.end - liveMs;
  const overtime = phase === "run" && rest <= 0;
  // Le compte a rebours ne s'affiche qu'une fois qu'une equipe est arrivee (la fin se rapproche alors a
  // chaque arrivee) OU dans les 3 dernieres minutes. Avant, il n'apporte rien et stresse pour rien.
  // Dix dernieres minutes : le chronometre passe au rouge et le decompte s'affiche en grand a cote.
  // Sur le temps limite de 40 min, cela commence donc a 30 min de course.
  const COUNTDOWN_MS = 10 * 60000;
  const redZone = phase === "run" && !overtime && rest <= COUNTDOWN_MS;
  const URGENT_MS = 3 * 60000;
  const LAST_MS = 60000;
  const showCountdown = phase === "post" || overtime || tl.count > 0 || rest <= COUNTDOWN_MS;
  const urgent = phase === "run" && !overtime && rest <= URGENT_MS;
  const lastMinute = phase === "run" && !overtime && rest <= LAST_MS;
  const tabBtn = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg transition", on ? ui.segOn : ui.segOff);

  return (
    <div className={`${ui.page} pb-24`}>
      <RefereeRequestsPopup sessionId={sessionId} initial={pendingRequests} />
      {/* Haut de l'ecran projete : la seance a gauche, le CHRONOMETRE au centre, le temps limite a droite.
          Pas de marque ici : sur un ecran projete devant une classe, seule la course compte. */}
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Navigation entre seances : revenir a celle qui vient de se terminer (revoir les scores,
              finir d'encoder) ou passer a la suivante, sans repasser par la console. */}
          <div className="min-w-0 justify-self-start flex items-center gap-2">
            <SessionStep to={olderSession} dir="older" />
            <div className="min-w-0">
              {sessionOptions.length > 1 ? (
                <select
                  value={sessionId}
                  onChange={(e) => router.push(`/greffier?session=${e.target.value}`)}
                  className={`${ui.input} w-auto max-w-[280px] py-1.5 font-bold`}
                >
                  {sessionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}{o.classes.length ? ` · ${o.classes.join(", ")}` : ""}{o.open ? " — ouverte" : ` — ${sessionDay(o.dateMs)}`}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-bold leading-tight">
                  {sessionLabel}
                  {classes.length > 0 && <span className="text-ink-2 font-semibold"> · {classes.join(", ")}</span>}
                  {sessionOptions[0] && !sessionOptions[0].open && <span className="text-ink-3 font-normal"> (fermée)</span>}
                </p>
              )}
            </div>
            <SessionStep to={newerSession} dir="newer" />
          </div>

          <p className={cx("justify-self-center font-display text-[3.4rem] font-extrabold leading-none tracking-tight tabular-nums", phase === "pre" ? "text-line-2" : isPaused ? "text-accent" : redZone || overtime ? "text-danger" : "text-ink")}>
            {fmt(liveMs)}
          </p>

          <div className="justify-self-end">
            {phase !== "pre" && (
              <div
                className={cx(
                  "border rounded-xl px-3 py-1.5 text-right min-w-[130px]",
                  overtime || redZone ? "border-danger bg-danger-soft" : "border-line bg-paper",
                  lastMinute && "pyr-blink"
                )}
              >
                <div className={ui.eyebrow}>
                  {phase === "post" ? "WOD" : overtime ? "Temps supp." : showCountdown ? "Fin dans" : "Temps limite"}
                </div>
                <div className={cx("font-display font-extrabold leading-tight tabular-nums", overtime || redZone ? "text-[2.6rem] text-danger" : "text-2xl text-ink")}>
                  {phase === "post" ? "terminé" : overtime ? `−${fmtUp(-rest)}` : showCountdown ? fmtDown(rest) : `${ctx.settings.capMin} min`}
                </div>
                <div className="text-[11px] text-ink-2">{finishedCount}/{ctx.teams.length} arrivées</div>
              </div>
            )}
          </div>
        </div>
        {error && <p className={`${ui.alertErr} mt-2`}>{error}</p>}
      </header>

      <main className="max-w-[1800px] mx-auto p-4">
        {view === "grid" ? (
          <div className="pyr">
            <style>{PYR_STYLES}</style>
            {/* Piste « course de chevaux » : 7 couloirs, compacte, au-dessus de la grille. */}
            <RaceStrip ctx={ctx} phase={phase} tl={tl} teamNames={teamNames} T={T} />
            {ctx.teams.map((team) => {
              const n = lapsOf(ctx, team.id);
              const fa = finishAt(ctx, team.id);
              const level = levelOf(ctx, team.id);
              const tier = tierOf(ctx.settings, n);
              const yc = cardsOf(ctx, team.id);
              const isDone = fa !== null;
              const who = (membersByTeam.get(team.id) ?? []).map((m) => m.firstName + cake(m.birthday)).join(", ");
              // drawGrid() du fichier d'origine : grand chiffre + libelle selon la phase.
              let cls = "tile";
              let big: string | number;
              let lbl: string;
              if (phase === "pre") {
                const st = startOf(ctx, team);
                big = st.number;
                lbl = `départ · ${exerciseLabels[st.id] ?? ""}`;
              } else if (isDone) {
                cls += " done";
                big = fmt(fa);
                lbl = `🏁 ${ordinal(arrivalRank(ctx, team.id))} arrivée${tl.late[team.id] != null ? ` · +${fmt(tl.late[team.id])}` : ""}`;
              } else if (phase === "run") {
                big = level ?? n;
                lbl = `reps ${dirLabel(ctx.settings, n)}`;
              } else {
                big = n;
                const e = ctx.endOverride.get(team.id);
                lbl = e == null ? "dernier atelier ?" : e === "NONE" ? "fin : aucun" : `fin : ex. ${ctx.exercises.find((x) => x.id === e)?.number ?? "?"}`;
                if (e == null) cls += " unset";
              }
              if (hitTeam === team.id) cls += " hit";
              // En course, la tuile se souleve pendant la montee et s'affaisse pendant la descente.
              const dir = phase === "run" && !isDone ? dirLabel(ctx.settings, n) : null;
              const slope = dir === "↑" ? " up" : dir === "↓" ? " down" : "";
              return (
                <div key={team.id} className={`cell${tier ? ` tier t${tier}` : ""}${slope}`}>
                  <button
                    type="button"
                    onClick={() => handleLap(team.id)}
                    className={cls}
                    data-team={team.id}
                    title={`${teamNames[team.id] ?? team.id}${who ? ` · ${who}` : ""}${phase === "pre" ? "" : ` · ${n} tour${n > 1 ? "s" : ""} sur ${T}${phase === "run" && !isDone ? ` (${dirLabel(ctx.settings, n)})` : ""}`}`}
                  >
                    <span className="tnum">{teamNames[team.id] ?? team.id}</span>
                    {phase !== "pre" && <Medals settings={ctx.settings} n={n} ord={ord[team.id]} />}
                    <span className="reps">{big}</span>
                    <span className="lbl">{lbl}</span>
                    {who && <span className="who">{who}</span>}
                  </button>
                  {phase !== "pre" && (
                    <button type="button" onClick={(e) => handleCard(team.id, e)} className={`ycard${yc ? " has" : ""}`} aria-label={`Carte jaune pour ${teamNames[team.id] ?? team.id}`}>
                      {yc ? (
                        <>
                          {Array.from({ length: Math.min(yc, 3) }).map((_, i) => <span key={i} className="yc" />)}
                          {yc > 3 ? ` ×${yc}` : ""}
                          <span className="yplus">+</span>
                        </>
                      ) : (
                        <span className="yplus">+ carte jaune</span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : view === "results" ? (
          <ResultsTable ctx={ctx} phase={phase} teamNames={teamNames} exerciseLabels={exerciseLabels} tl={tl} membersByTeam={membersByTeam} />
        ) : view === "score" ? (
          <ScoreTable ctx={ctx} phase={phase} teamNames={teamNames} tl={tl} ord={ord} membersByTeam={membersByTeam} />
        ) : view === "records" ? (
          <RecordsTab isMaster={isMaster} sessionId={sessionId} />
        ) : view === "arbitrage" && board ? (
          <ArbitrageTab board={board} />
        ) : (
          <TeamsManager sessionId={sessionId} teams={teamsWithMembers} classes={classes} allClasses={allClasses} referees={referees} phase={phase} startByTeam={startByTeam} picker={picker} />
        )}
      </main>

      {/* Barre basse : la navigation et les commandes sont sous le contenu, hors du champ de lecture.
          Le haut de l'ecran reste consacre au chronometre et au classement. */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 bg-card/95 backdrop-blur border-t border-line px-4 py-2">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className={`${ui.segmented} flex-wrap`}>
            <button onClick={() => setView("grid")} className={tabBtn(view === "grid")}>Grille</button>
            <button onClick={() => setView("results")} className={tabBtn(view === "results")}>Résultats</button>
            <button onClick={() => setView("score")} className={tabBtn(view === "score")}>Score final</button>
            <button onClick={() => setView("records")} className={tabBtn(view === "records")}>🏆 Records</button>
            <button onClick={() => setView("teams")} className={tabBtn(view === "teams")}>
              Équipes &amp; arbitres <span className={cx(ui.chip, "ml-1", memberCount ? ui.chipOk : ui.chipWarn)}>{memberCount}</span>
              {referees.length > 0 && <span className={`${ui.chip} ${ui.chipSea} ml-1`}>🏴‍☠️ {referees.length}</span>}
            </button>
            {board && (
              <button onClick={() => setView("arbitrage")} className={tabBtn(view === "arbitrage")}>
                Arbitrage <span className={`${ui.chip} ${ui.chipAccent} ml-1`}>{board.evaluationsCount}</span>
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {phase === "pre" && (
              <>
                <button onClick={() => setSettingsOpen(true)} disabled={pending} className={btn.lgGhost}>⚙️ Réglages</button>
                <button onClick={handleStart} disabled={pending} className={btn.lgSuccess}>Début de course</button>
              </>
            )}
            {phase === "run" && (
              <>
                <button onClick={handlePause} disabled={pending} className={isPaused ? btn.lgSuccess : btn.lgAccent}>
                  {isPaused ? "Reprendre" : "Pause"}
                </button>
                <button onClick={handleUndo} disabled={pending} className={btn.lgGhost}>Annuler le dernier</button>
                {canCorrect && <button onClick={() => setFixOpen(true)} disabled={pending} className={btn.lgGhost}>Annuler un tour…</button>}
                <button onClick={handleFinish} disabled={pending} className={btn.lgDanger}>Fin de course</button>
                <button onClick={handleReset} disabled={pending} className={btn.lgGhost} title="Course lancée par erreur : tout remettre à zéro (double confirmation)">↺ Remettre à zéro</button>
              </>
            )}
            {phase === "post" && (
              <>
                <span className={`${ui.btnLg} bg-success-soft text-success-ink`}>🏁 WOD terminé</span>
                {/* Un tour frauduleux se corrige aussi apres coup : classement, medailles et records se recalculent. */}
                {canCorrect && <button onClick={() => setFixOpen(true)} disabled={pending} className={btn.lgGhost}>Annuler un tour…</button>}
                <button onClick={handleReset} disabled={pending} className={btn.lgGhost} title="Terminée par erreur : tout remettre à zéro et repartir (double confirmation)">↺ Remettre à zéro</button>
              </>
            )}
            {board && <a href={`/touche-coule?session=${sessionId}`} className={btn.lgGhost} title="Arbitrer cette séance (Touché-Coulé) sans quitter le greffier à quelqu'un d'autre">🏴‍☠️ Arbitrer</a>}
              <LogoutButton />
            <button onClick={exportCsv} className={btn.lgDark}>Exporter CSV</button>
          </div>
        </div>
      </footer>

      {settingsOpen && (
        <SettingsPanel
          sessionId={sessionId}
          settings={ctx.settings}
          noStartExerciseIds={[...ctx.noStartExerciseIds]}
          exercises={ctx.exercises.map((e) => ({ id: e.id, number: e.number, label: exerciseLabels[e.id] ?? e.id }))}
          numTeams={ctx.teams.length}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {openTeamId && (
        <TeamPanel
          teamId={openTeamId}
          ctxSessionId={sessionId}
          ctx={ctx}
          exerciseLabels={exerciseLabels}
          teamName={teamNames[openTeamId] ?? openTeamId}
          startedAtMs={startedAtMs}
          pauses={pauses}
          onLapDeleted={handleLapDeleted}
          onClose={() => {
            setOpenTeamId(null);
            refresh();
          }}
        />
      )}

      {fixOpen && (
        <CancelLapDialog
          sessionId={sessionId}
          ctx={ctx}
          teamNames={teamNames}
          startedAtMs={startedAtMs}
          pauses={pauses}
          onDeleted={handleLapDeleted}
          onClose={() => setFixOpen(false)}
        />
      )}
    </div>
  );
}

function ResultsTable({
  ctx, phase, teamNames, exerciseLabels, tl, membersByTeam,
}: {
  ctx: import("@/lib/wod-engines/templates/pyramide-engine").RaceContext;
  phase: "pre" | "run" | "post";
  teamNames: Record<string, string>;
  exerciseLabels: Record<string, string>;
  tl: ReturnType<typeof timeline>;
  membersByTeam: Map<string, TeamMemberView[]>;
}) {
  const st: Standing[] = standings(ctx, phase === "post");
  const T = total(ctx.settings);
  return (
    <div className={`${ui.card} overflow-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={ui.th}>#</th>
            {/* Le classement parle des ELEVES : leurs noms d'abord, le numero d'equipe en second. */}
            <th className={ui.th}>Participants</th>
            <th className={ui.th}>Tours</th>
            <th className={ui.th}>Temps</th>
            <th className={ui.th}>Temps sup.</th>
            <th className={ui.th}>Départ</th>
            <th className={ui.th}>Total reps</th>
            <th className={ui.th}>Cartes</th>
          </tr>
        </thead>
        <tbody>
          {st.map((s, i) => {
            const members = membersByTeam.get(s.team.id) ?? [];
            return (
              <motion.tr key={s.team.id} layout transition={{ type: "spring", stiffness: 350, damping: 30 }} className={ui.tr}>
                <td className="p-2 font-display font-bold">{i + 1}</td>
                <td className="p-2">
                  {members.length ? (
                    <>
                      <div className="font-bold leading-tight">{members.map((m) => `${m.firstName} ${m.lastName}`).join(" · ")}</div>
                      <div className="text-[11px] text-ink-3">{teamNames[s.team.id] ?? s.team.id}{members[0]?.className ? ` · ${members[0].className}` : ""}</div>
                    </>
                  ) : (
                    <span className="font-bold text-ink-3">{teamNames[s.team.id] ?? s.team.id} <span className="font-normal italic">(personne encodé)</span></span>
                  )}
                </td>
                <td className="p-2">{Math.min(s.n, T)} / {T}</td>
                <td className="p-2 tabular-nums">{s.done ? `🏁 ${fmt(s.finishAt)}` : "—"}</td>
                <td className="p-2 tabular-nums">{tl.late[s.team.id] != null ? `+${fmt(tl.late[s.team.id])}` : ""}</td>
                <td className="p-2">{exerciseLabels[startOf(ctx, s.team).id]}</td>
                <td className="p-2 font-bold">{s.reps}</td>
                <td className="p-2">{s.yellowCards}</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Score final : le detail du calcul est visible colonne par colonne, pour que le bareme soit verifiable.
function ScoreTable({
  ctx, phase, teamNames, tl, ord, membersByTeam,
}: {
  ctx: import("@/lib/wod-engines/templates/pyramide-engine").RaceContext;
  phase: "pre" | "run" | "post";
  teamNames: Record<string, string>;
  tl: ReturnType<typeof timeline>;
  ord: Record<string, { pos: number; at: number }[]>;
  membersByTeam: Map<string, TeamMemberView[]>;
}) {
  const rows = finalScores(ctx, tl, ord, phase === "post");
  return (
    <div className="space-y-3">
      <p className={ui.hint}>
        Score = temps du WOD (ou jusqu&apos;à l&apos;arrêt) <b>+ 1 min</b> par carte jaune <b>− 1 s</b> par répétition
        <b> + le temps supplémentaire</b> éventuel <b>− le bonus des médailles</b> (1<sup>re</sup> équipe d&apos;un tour : −10 s,
        2<sup>e</sup> : −8 s, 3<sup>e</sup> : −6 s, 4<sup>e</sup> : −4 s, 5<sup>e</sup> : −2 s). Le plus petit score gagne.
        {phase !== "post" && " Provisoire tant que la course n'est pas terminée."}
      </p>
      <div className={`${ui.card} overflow-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={ui.th}>#</th>
              <th className={ui.th}>Participants</th>
              <th className={ui.th}>Temps WOD</th>
              <th className={ui.th}>🟨 +</th>
              <th className={ui.th}>Reps −</th>
              <th className={ui.th}>Temps sup. +</th>
              <th className={ui.th}>Médailles −</th>
              <th className={ui.th}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const members = membersByTeam.get(r.teamId) ?? [];
              return (
                <motion.tr key={r.teamId} layout transition={{ type: "spring", stiffness: 350, damping: 30 }} className={ui.tr}>
                  <td className="p-2 font-display font-bold">{i + 1}</td>
                  <td className="p-2">
                    {members.length ? (
                      <>
                        <div className="font-bold leading-tight">{members.map((m) => `${m.firstName} ${m.lastName}`).join(" · ")}</div>
                        <div className="text-[11px] text-ink-3">{teamNames[r.teamId] ?? r.teamId}</div>
                      </>
                    ) : (
                      <span className="font-bold text-ink-3">{teamNames[r.teamId] ?? r.teamId}</span>
                    )}
                  </td>
                  <td className="p-2 tabular-nums">{r.done ? `🏁 ${fmt(r.baseMs)}` : fmt(r.baseMs)}</td>
                  <td className="p-2 tabular-nums">{r.cardsMs ? `+${fmt(r.cardsMs)}` : ""}</td>
                  <td className="p-2 tabular-nums text-success-ink">{r.repsMs ? `−${fmt(r.repsMs)}` : ""}</td>
                  <td className="p-2 tabular-nums text-danger-ink">{r.lateMs ? `+${fmt(r.lateMs)}` : ""}</td>
                  <td className="p-2 tabular-nums text-success-ink">{r.medalMs ? `−${fmt(r.medalMs)} (${r.medalCount})` : ""}</td>
                  <td className="p-2 font-display font-extrabold tabular-nums">{fmtSigned(r.totalMs)}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamPanel({
  teamId, ctxSessionId, ctx, exerciseLabels, teamName, startedAtMs, pauses, onLapDeleted, onClose,
}: {
  teamId: string;
  ctxSessionId: string;
  ctx: PyrCtx;
  exerciseLabels: Record<string, string>;
  teamName: string;
  startedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  onLapDeleted: (teamId: string) => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const team = ctx.teams.find((t) => t.id === teamId)!;
  const startEx = startOf(ctx, team);
  const finished = finishAt(ctx, teamId) !== null;
  const partial = partialOf(ctx, team);

  function setStart(exerciseId: string) {
    startTransition(async () => {
      await setTeamStartAction(teamId, exerciseId);
      onClose();
    });
  }
  function setEnd(value: string | null) {
    startTransition(async () => {
      await setTeamEndAction(teamId, value);
      onClose();
    });
  }

  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className={ui.h2}>{teamName}</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>

        {!finished ? (
          <>
            <p className="text-sm font-bold mb-2">Dernier exercice entièrement terminé ?</p>
            <p className={`${ui.hint} mb-3`}>Départ : {exerciseLabels[startEx.id]}{partial != null ? ` · actuellement ${partial} exercice(s) du dernier tour` : ""}</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setEnd(null)} disabled={pending} className={CHOICE}>aucun</button>
              {ctx.exercises.map((ex) => (
                <button key={ex.id} onClick={() => setEnd(ex.id)} disabled={pending} className={CHOICE}>
                  {ex.number} · {exerciseLabels[ex.id]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-success-ink font-bold mb-4">🏁 Équipe arrivée.</p>
        )}

        <TeamLapList sessionId={ctxSessionId} teamId={teamId} teamName={teamName} settings={ctx.settings} startedAtMs={startedAtMs} pauses={pauses} onDeleted={onLapDeleted} />

        <p className="text-sm font-bold mb-2">Changer le départ</p>
        <div className="grid grid-cols-2 gap-2">
          {ctx.exercises.map((ex) => (
            <button
              key={ex.id}
              onClick={() => setStart(ex.id)}
              disabled={pending}
              className={cx(CHOICE, startEx.id === ex.id && "border-brand bg-brand text-white hover:bg-brand-hover")}
            >
              {ex.number} · {exerciseLabels[ex.id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Tours d'une equipe : heure de course, heure reelle, ecart avec le precedent, retrait d'UN tour =====
// Partage par le panneau d'equipe et par « Annuler un tour ». La liste vient du serveur (identifiants des tours),
// jamais de l'etat optimiste : on ne retire que ce qui existe vraiment en base. Deux tours a moins d'une minute
// sont signales en rouge : c'est presque toujours un double clic.
function TeamLapList({
  sessionId, teamId, teamName, settings, startedAtMs, pauses, onDeleted,
}: {
  sessionId: string;
  teamId: string;
  teamName: string;
  settings: RaceSettings;
  startedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  onDeleted: (teamId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  // Liste chargee, etiquetee par (seance, equipe) : une liste d'une autre equipe ne s'affiche jamais par erreur.
  const key = `${sessionId}|${teamId}`;
  const [loaded, setLoaded] = useState<{ key: string; laps: TeamLap[]; error: string } | null>(null);
  const laps = loaded?.key === key ? loaded.laps : null;
  const loadError = loaded?.key === key ? loaded.error : "";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let on = true;
    teamLapsAction(sessionId, teamId)
      .then((l) => { if (on) setLoaded({ key, laps: l, error: "" }); })
      .catch(() => { if (on) setLoaded({ key, laps: [], error: "Impossible de charger les tours de cette équipe." }); });
    return () => { on = false; };
  }, [sessionId, teamId, key]);
  const p = pyramid(settings);

  function remove(lap: TeamLap, index: number) {
    const when = new Date(lap.atMs).toLocaleTimeString("fr-BE");
    if (!confirm(`Retirer le tour n°${index + 1} de ${teamName} (validé à ${when}) ?\n\nL'équipe perd ce tour ; classement, médailles et records sont recalculés.`)) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      const res = await settle(() => deleteLapAction(sessionId, lap.id));
      if ("error" in res) { setError(res.error); return; }
      // On relit la liste au serveur ; s'il ne repond pas, on retire au moins la ligne supprimee.
      const fresh = await teamLapsAction(sessionId, teamId).catch(() => null);
      const next = fresh ?? (laps ?? []).filter((l) => l.id !== lap.id);
      setLoaded({ key, laps: next, error: "" });
      setNotice(`Tour n°${index + 1} retiré. ${teamName} compte maintenant ${next.length} tour${next.length > 1 ? "s" : ""}.`);
      onDeleted(teamId);
    });
  }

  return (
    <div className="mb-4">
      <p className="text-sm font-bold mb-1">Tours validés{laps ? ` (${laps.length})` : ""}</p>
      <p className={`${ui.hint} mb-2`}>Deux tours à moins d&apos;une minute d&apos;écart sont signalés en rouge : c&apos;est presque toujours un double clic.</p>
      {laps === null ? (
        <p className={ui.hint}>Chargement…</p>
      ) : laps.length === 0 ? (
        <p className={ui.hint}>Aucun tour validé.</p>
      ) : (
        <ul className="space-y-1">
          {laps.map((lap, i) => {
            const gap = i > 0 ? lap.atMs - laps[i - 1].atMs : null;
            const suspect = gap !== null && gap < MIN_LAP_GAP_MS;
            const race = elapsed(startedAtMs, pauses, lap.atMs);
            return (
              <li key={lap.id} className={cx("flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm", suspect ? "bg-danger-soft border-danger/40" : "bg-paper border-line")}>
                <span className="min-w-0">
                  <b>Tour {i + 1}</b>
                  {i < p.length && <span className="text-ink-2"> · {p[i]} reps</span>}
                  <span className="text-ink-2"> · {race !== null ? `${fmt(race)} de course · ` : ""}{new Date(lap.atMs).toLocaleTimeString("fr-BE")}</span>
                  {gap !== null && <span className={suspect ? "text-danger-ink font-bold" : "text-ink-3"}> · +{fmtGap(gap)} après le précédent</span>}
                </span>
                <button type="button" onClick={() => remove(lap, i)} disabled={pending} className={btn.smDanger}>Retirer</button>
              </li>
            );
          })}
        </ul>
      )}
      {notice && <p className={`${ui.alertOk} mt-2`}>{notice}</p>}
      {(error || loadError) && <p className={`${ui.alertErr} mt-2`}>{error || loadError}</p>}
    </div>
  );
}

// ===== « Annuler un tour » : choisir l'equipe, voir l'heure de chacun de ses tours, retirer le frauduleux =====
// Complement de « Annuler le dernier » (qui ne retire que la toute derniere saisie, toutes equipes confondues).
function CancelLapDialog({
  sessionId, ctx, teamNames, startedAtMs, pauses, onDeleted, onClose,
}: {
  sessionId: string;
  ctx: PyrCtx;
  teamNames: Record<string, string>;
  startedAtMs: number | null;
  pauses: { from: number; to: number | null }[];
  onDeleted: (teamId: string) => void;
  onClose: () => void;
}) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const T = total(ctx.settings);
  return (
    <div className={ui.backdrop} onClick={onClose}>
      <div className={`${ui.sheet} sm:max-w-lg`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className={ui.h2}>{teamId ? `Tours de ${teamNames[teamId] ?? teamId}` : "Annuler un tour"}</h3>
          <button onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
        </div>
        {teamId === null ? (
          <>
            <p className={`${ui.hint} mb-3`}>Choisis l&apos;équipe, puis le tour à retirer. Les équipes sans tour validé sont grisées.</p>
            {ctx.teams.length === 0 ? (
              <p className={ui.hint}>Aucune équipe.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {ctx.teams.map((t) => {
                  const n = lapsOf(ctx, t.id);
                  return (
                    <button key={t.id} type="button" disabled={n === 0} onClick={() => setTeamId(t.id)} className={cx(CHOICE, "flex flex-col items-center leading-tight")}>
                      <span className="font-extrabold">{teamNames[t.id] ?? t.id}</span>
                      <span className={ui.hint}>{n}/{T} tour{n > 1 ? "s" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setTeamId(null)} className={`${btn.smGhost} mb-3`}>‹ Autre équipe</button>
            <TeamLapList sessionId={sessionId} teamId={teamId} teamName={teamNames[teamId] ?? teamId} settings={ctx.settings} startedAtMs={startedAtMs} pauses={pauses} onDeleted={onDeleted} />
          </>
        )}
      </div>
    </div>
  );
}
