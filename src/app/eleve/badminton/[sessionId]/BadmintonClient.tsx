"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BmPersonRef, BmSet, BmView } from "@/lib/badminton";
import { THEME_KINDS, themeText, type BmTheme } from "@/lib/badminton-themes";
import type { PairingStatus, TourKind } from "@/lib/badminton-tournament";
import { badmintonPulseAction, recordMatchAction, startLiveMatchAction, startScoutingAction, startStrokeScoutAction, teamReadyAction } from "../../badminton-actions";
import { BM_ADVANCE, Countdown, LiveBoard, MatchCard, type LiveRule, type LiveScout, PersonPicker, SetsEditor, emptySets, resultText, setsReady } from "../../../_components/BadmintonParts";
import { StrokeSheetForm } from "../../../_components/StrokeSheetForm";
import { usePulse } from "../../../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";
import { BET_LEVELS, BET_TEXT, multText, type BmBets } from "@/lib/badminton-constraints";
import { BetBox, type BetData } from "./BetBox";
import { StrokeScoutBoard, type StrokeResume } from "../../../_components/StrokeScoutBoard";

// Ecran eleve du badminton (telephone) : « à signer » en haut, puis « Encoder un match » (j'ai joue / j'ai arbitre),
// puis mes matchs et ceux que j'ai arbitres, chacun avec son historique (qui a encode quoi, qui a signe).
// Matchs libres (`free`, 03/11) : tous les eleves dans la liste, temoins a demander, « à attester » en haut.
// Tournoi par poules (`tour`, 09/11) : en tete, mon adversaire de la ronde en cours et « Encoder ce match ».
// court (27/11) : terrain de mon prochain match (« 3 », « 3A »), null = attendre qu'un terrain se libere, absent = rien.
export type TourCardData = { court?: string | null; kind: TourKind; label: string; format: string; where: string; round: number | null; rounds: number; status: PairingStatus | "done"; opponent: BmPersonRef | null; sets: BmSet[] | null; rank: number | null; of: number; table: { name: string; score: number; rank: number; me: boolean }[] | null; headStart: { mine: number; theirs: number } | null; late: boolean; extra: BmPersonRef[]; poolDone: boolean; order: { round: number | null; a: string; b: string | null; status: PairingStatus; score: string | null; mine: boolean; points: number | null }[] | null; team?: TeamCardData };
// Tournoi par equipes (24/11) : vu du cote de l'eleve (« ours » = joueur de mon equipe, pts = [nous, eux]).
export type TeamCardData = {
  letter: string; coach: string; meCoach: boolean; pts: number; myPts: number; bracket: boolean; time: boolean; minutes: number;
  timer: { round: number; wave: number; startedAt: number; endsAt: number; stoppedAt: number | null } | null; now: number; wave: 1 | 2 | null; roundLabel: string;
  oppTeam: { letter: string; coach: string } | null;
  // Ce qui se joue dans mon prochain match (26/11) : points rapportes selon le score, chances, ce qu'il faut pour passer devant.
  sub: boolean; // remplacant d'un joueur parti d'une autre equipe (26/11)
  scoring: "ELO" | "POINTS"; // comment l'equipe marque (26/11)
  tourId: string;
  // « Pret » avant un match au temps (26/11) : moi, et combien sur combien.
  ready: { me: boolean; count: number; total: number } | null;
  stakes: { win: [number, number]; lose: [number, number]; draw: [number, number] | null; chance: number; need: string | null; scoring: "ELO" | "POINTS"; coef: number; target: number } | null;
  current: { pts: [number, number]; status: string; matches: { ours: string; theirs: string; wave: 1 | 2; status: PairingStatus; score: string | null; pts: [number, number]; me: boolean }[] } | null;
  table: { letter: string; coach: string; pts: number; rank: number | null; lo: number; hi: number; group: number; record: string; me: boolean }[]; groups: number;
};
// scout (24/11) : le terrain et les couches de cet eleve quand il arbitre en direct ; scoutable (null = scouting verrouille pour lui, 26/11) : les matchs de la seance
// qu'il peut observer pour remplir la fiche technique d'un joueur.
export function BadmintonClient({ sessionId, meId, writable, roster, toSign, mine, refereed, free = false, toAttest = [], witnessed = [], tour = null, liveRules = {}, theme = null, scout = null, scoutable = null, scoutPicks = null, scoutResume = [], strokesOn = false, bet = null, betTour = false, betLesson = false, handicapOn = false, strokeResume = [], strokeTaken = [] }: { strokesOn?: boolean; bet?: BetData | null; betTour?: boolean; betLesson?: boolean; handicapOn?: boolean; strokeResume?: StrokeResume[]; strokeTaken?: string[]; theme?: BmTheme | null; scout?: LiveScout | null; scoutable?: BmView[] | null; scoutPicks?: ScoutPickView[] | null; scoutResume?: { id: string; aName: string; bName: string; sets: BmSet[] }[]; sessionId: string; meId: string; writable: boolean; roster: BmPersonRef[]; toSign: BmView[]; mine: BmView[]; refereed: BmView[]; free?: boolean; toAttest?: BmView[]; witnessed?: BmView[]; tour?: TourCardData | null; liveRules?: Record<string, LiveRule & { target: number }> }) {
  const router = useRouter();
  const pulse = useCallback(() => badmintonPulseAction(sessionId), [sessionId]);
  // Arbitrage en direct en cours sur ce telephone (tableau de score plein ecran).
  const [live, setLive] = useState<{ id: string; aName: string; bName: string; sets: BmSet[] | null; target?: number; rule?: LiveRule; theme?: BmTheme | null; scouting?: boolean; head?: BmSet | null; bets?: BmBets | null } | null>(null);
  // Scouting des coups en cours sur ce telephone (26/11 soir).
  const [strokes, setStrokes] = useState<StrokeResume | null>(null);
  usePulse(pulse, 8000, !live && !strokes);
  const [open, setOpen] = useState(toSign.length === 0 && toAttest.length === 0 && mine.length === 0 && writable);
  const witnessRoster = free ? roster : undefined;
  const [preset, setPreset] = useState<string | null>(null); // adversaire du tournoi, pre-rempli
  const [openAs, setOpenAs] = useState<"player" | "referee">("player"); // scouting (26/11) : ouvrir directement « J'ai arbitre · en direct »
  // Reprendre un direct de tournoi : avec l'objectif et la regle de ce match.
  const resume = (v: BmView) => setLive({ id: v.id, aName: v.a.name, bName: v.b.name, sets: v.sets, target: liveRules[v.id]?.target, rule: liveRules[v.id], theme: v.theme, head: v.handicap, bets: v.bets });
  return (
    <main className="max-w-xl mx-auto p-4 space-y-5">
      {live && <LiveBoard key={live.id} matchId={live.id} aName={live.aName} bName={live.bName} initialSets={live.sets} initialTarget={live.target} rule={live.rule} theme={live.theme} headStart={live.head ?? null} bets={live.bets ?? null} scout={live.scouting ? scout : null} scouting={!!live.scouting} onClose={() => setLive(null)} />}
      {strokes && <StrokeScoutBoard key={strokes.id} obs={strokes} onClose={() => setStrokes(null)} />}
      {!writable && <p className={ui.alertInfo}>La séance est terminée depuis plus de 24 h : tu peux seulement consulter tes matchs.</p>}
      {theme && writable && <p className={ui.alertInfo}>🎲 <b>Matchs à thème aujourd&apos;hui : {themeText(theme)}.</b> {THEME_KINDS.find((k) => k.id === theme.kind)?.rule} Le mieux : un arbitre en direct (« J&apos;arbitre »), qui applique la règle à chaque échange.</p>}
      {handicapOn && writable && <p className={ui.alertInfo}>⚖️ <b>Matchs à handicap aujourd&apos;hui</b> : le moins bien classé commence chaque set avec des points d&apos;avance (selon l&apos;écart d&apos;ELO) ; comptez-les dans le score final.</p>}
      {tour && (tour.team ? <TeamCard t={tour} team={tour.team} canPlay={writable} onPlay={(id) => { setPreset(id); setOpen(true); }} /> : <TourCard t={tour} canPlay={writable} onPlay={(id) => { setPreset(id); setOpen(true); }} />)}
      {/* Mise de certitude (26/11 soir) : sur mon prochain match de tournoi, sinon contre l'adversaire que je choisis. */}
      {bet && writable && (tour && tour.opponent && tour.status === "todo" ? (betTour && <BetBox key={tour.opponent.id} sessionId={sessionId} data={bet} opponent={tour.opponent} />) : (betLesson && <BetBox sessionId={sessionId} data={bet} roster={roster} />))}
      {free && <p className={ui.alertInfo}>Un match libre compte au classement quand il est <b>officiel</b> : 2 autres élèves l&apos;attestent (l&apos;arbitre en est un), ou ton prof le valide.</p>}

      {toAttest.length > 0 && (
        <section className="space-y-2">
          <h2 className={ui.eyebrow}>🖊️ À attester · {toAttest.length}</h2>
          <p className={ui.hint}>On te demande de confirmer le score d&apos;un match que tu as vu. Si tu ne l&apos;as pas vu, dis-le.</p>
          {toAttest.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} />)}
        </section>
      )}

      {toSign.length > 0 && (
        <section className="space-y-2">
          <h2 className={ui.eyebrow}>✍️ À signer · {toSign.length}</h2>
          <p className={ui.hint}>Ton adversaire a encodé votre match. Si le score est juste, signe-le ; sinon corrige-le (il devra signer ta correction).</p>
          {toSign.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} roster={witnessRoster} />)}
        </section>
      )}

      {writable && (
        <section>
          {open ? <NewMatch key={`${preset ?? "nouveau"}|${openAs}`} initialB={preset} initialMode={openAs} sessionId={sessionId} meId={meId} roster={roster} free={free} onDone={() => { setOpen(false); router.refresh(); }} onClose={() => setOpen(false)} onLive={(x) => { setOpen(false); setLive(x); }} /> : (
            <button type="button" onClick={() => { setOpenAs("player"); setOpen(true); }} className={cx(btn.lgPrimary, "w-full")}>＋ Encoder un match{free ? " libre" : ""}</button>
          )}
        </section>
      )}

      {writable && !free && scoutable && <ScoutSection strokesOn={strokesOn} matches={scoutable} picks={scoutPicks} resume={scoutResume} strokeResume={strokeResume} strokeTaken={strokeTaken} onStrokes={setStrokes} roster={roster} sessionId={sessionId} onLive={(x) => { setLive({ ...x, scouting: true }); window.scrollTo({ top: 0 }); }} court={!!scout} onDone={() => router.refresh()} />}

      <section className="space-y-2">
        <h2 className={ui.eyebrow}>Mes matchs · {mine.length}</h2>
        {mine.length === 0 ? <p className={`${ui.cardPad} ${ui.muted}`}>Aucun match pour l&apos;instant.</p> : mine.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} roster={witnessRoster} />)}
      </section>

      {refereed.length > 0 && (
        <section className="space-y-2">
          <h2 className={ui.eyebrow}>Matchs que j&apos;ai arbitrés · {refereed.length}</h2>
          {refereed.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} onReferee={writable ? resume : undefined} roster={witnessRoster} />)}
        </section>
      )}

      {witnessed.length > 0 && (
        <section className="space-y-2">
          <h2 className={ui.eyebrow}>Matchs dont je suis témoin · {witnessed.length}</h2>
          {witnessed.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} />)}
        </section>
      )}
    </main>
  );
}

function NewMatch({ sessionId, meId, roster, free, initialB = null, initialMode = "player", onDone, onClose, onLive }: { sessionId: string; meId: string; roster: BmPersonRef[]; free: boolean; initialB?: string | null; initialMode?: "player" | "referee"; onDone: () => void; onClose: () => void; onLive: (x: { id: string; aName: string; bName: string; sets: BmSet[] | null; target?: number; rule?: LiveRule; theme?: BmTheme | null; head?: BmSet | null; bets?: BmBets | null }) => void }) {
  const [mode, setMode] = useState<"player" | "referee">(initialMode);
  // Arbitre : en direct (+1 / −1 au fil du match, par defaut) ou score final tape a la fin.
  const [how, setHow] = useState<"live" | "final">("live");
  const [a, setA] = useState<string | null>(null); // arbitre : joueur 1
  const [b, setB] = useState<string | null>(initialB); // adversaire, ou joueur 2
  const [sets, setSets] = useState<BmSet[]>(emptySets);
  const [error, setError] = useState("");
  const [twin, setTwin] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Match libre : jusqu'a 2 temoins demandes tout de suite (facultatif : on peut les demander plus tard sur la fiche).
  const [w1, setW1] = useState<string | null>(null);
  const [w2, setW2] = useState<string | null>(null);
  const witnessIds = free ? [w1, w2].filter((x): x is string => !!x) : undefined;
  // Match libre en direct (26/11 soir : « en match libre, ils peuvent cocher le handicap et le coef s'ils veulent ») :
  // handicap (selon l'ecart d'ELO) et mises des deux joueurs, annoncees avant le premier point.
  const [fHandicap, setFHandicap] = useState(false);
  const [fBets, setFBets] = useState<[number | null, number | null]>([null, null]);
  const nameOf = (id: string | null) => roster.find((p) => p.id === id)?.name.split(" ")[0] ?? "";
  const left = mode === "player" ? "Toi" : nameOf(a) || "Joueur 1";
  const right = mode === "player" ? nameOf(b) || "Adversaire" : nameOf(b) || "Joueur 2";
  const isLive = mode === "referee" && how === "live";
  const ready = isLive ? !!a && !!b : setsReady(sets) && !!b && (mode === "player" || !!a);
  const fullName = (id: string | null) => roster.find((p) => p.id === id)?.name ?? "";
  function startLive(force = false) {
    setError("");
    start(async () => {
      const res = await startLiveMatchAction(sessionId, { playerAId: a ?? "", playerBId: b ?? "", force, witnessIds, ...(free ? { options: { handicap: fHandicap, bets: fBets } } : {}) });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setTwin(res.duplicate.text); return; }
      if (res.matchId) onLive({ id: res.matchId, aName: fullName(a), bName: fullName(b), sets: res.sets ?? [[0, 0]], target: res.target, rule: res.rule, theme: res.theme, head: res.head ?? null, bets: res.bets ?? null });
    });
  }
  function save(force = false) {
    setError("");
    start(async () => {
      const res = await recordMatchAction(sessionId, { playerAId: mode === "player" ? meId : a, playerBId: b ?? "", sets, force, witnessIds });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setTwin(res.duplicate.text); return; }
      onDone();
    });
  }
  return (
    <div className={cx(ui.cardPad, "space-y-4 border-brand/40")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={ui.h3}>Encoder un match</h2>
        <button type="button" onClick={onClose} className={ui.close} aria-label="Fermer">✕</button>
      </div>
      <div className={cx(ui.segmented, "w-full grid grid-cols-2")}>
        <button type="button" onClick={() => { setMode("player"); setA(null); setTwin(null); }} className={cx("py-2 rounded-lg text-sm font-bold", mode === "player" ? ui.segOn : ui.segOff)}>🏸 J&apos;ai joué</button>
        <button type="button" onClick={() => { setMode("referee"); setTwin(null); }} className={cx("py-2 rounded-lg text-sm font-bold", mode === "referee" ? ui.segOn : ui.segOff)}>🧑‍⚖️ J&apos;ai arbitré</button>
      </div>
      {mode === "player" ? (
        <PersonPicker people={roster} value={b} onChange={(id) => { setB(id); setTwin(null); }} label="Contre qui ?" placeholder="Tape le nom de ton adversaire" />
      ) : (
        <div className="space-y-3">
          <PersonPicker people={roster} value={a} onChange={(id) => { setA(id); setTwin(null); }} exclude={b ? [b] : []} label="Joueur 1" placeholder="Tape un nom" />
          <PersonPicker people={roster} value={b} onChange={(id) => { setB(id); setTwin(null); }} exclude={a ? [a] : []} label="Joueur 2" placeholder="Tape un nom" />
        </div>
      )}
      {mode === "referee" && (
        <div className={cx(ui.segmented, "w-full grid grid-cols-2")}>
          <button type="button" onClick={() => setHow("live")} className={cx("py-2 rounded-lg text-sm font-bold", how === "live" ? ui.segOn : ui.segOff)}>🎯 En direct (+1 / −1)</button>
          <button type="button" onClick={() => setHow("final")} className={cx("py-2 rounded-lg text-sm font-bold", how === "final" ? ui.segOn : ui.segOff)}>✏️ Score final</button>
        </div>
      )}
      {free && isLive && (
        <div className="rounded-xl border border-line px-3 py-2 space-y-2 text-sm">
          <p className="font-bold">⚙️ Options du match (facultatif)</p>
          <label className="flex items-start gap-2"><input type="checkbox" className={cx(ui.check, "mt-0.5")} checked={fHandicap} onChange={(e) => setFHandicap(e.target.checked)} /> <span><b>⚖️ Handicap</b> : le moins bien classé commence chaque set avec des points d&apos;avance (selon l&apos;écart d&apos;ELO).</span></label>
          <div>
            <p><b>🎯 Mises de certitude</b> : chaque joueur mise de 0 à 5 sur sa victoire (ses points ELO gagnés ou perdus × 0,8 à 1,7) ; tu les annonces avant le premier point.</p>
            {([0, 1] as const).map((i) => (
              <label key={i} className="flex items-center gap-2 mt-1">
                <span className="w-24 truncate">{(i === 0 ? nameOf(a) : nameOf(b)) || `Joueur ${i + 1}`}</span>
                <select value={fBets[i] ?? ""} onChange={(e) => setFBets((x) => { const n = [...x] as [number | null, number | null]; n[i] = e.target.value === "" ? null : Number(e.target.value); return n; })} className={`${ui.input} w-auto`}>
                  <option value="">pas de mise</option>
                  {BET_LEVELS.map((v) => <option key={v} value={v}>{v} · {BET_TEXT[v]} ({multText(v)})</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      {!isLive && (
        <div>
          <span className={ui.label}>Le score</span>
          <SetsEditor sets={sets} onChange={setSets} left={left} right={right} />
          {setsReady(sets) && b && <p className={`${ui.hint} mt-2`}>{resultText(sets, left, right)}</p>}
        </div>
      )}
      {free && (
        <div className="space-y-2">
          <span className={ui.label}>Témoins (facultatif)</span>
          <PersonPicker people={roster} value={w1} onChange={setW1} exclude={[a, b, w2].filter((x): x is string => !!x)} label="Témoin 1" placeholder="Un élève qui a vu le match" />
          <PersonPicker people={roster} value={w2} onChange={setW2} exclude={[a, b, w1].filter((x): x is string => !!x)} label="Témoin 2" placeholder="Un autre élève qui a vu le match" />
          <p className={ui.hint}>Ils recevront le match à attester. Officiel (il compte au classement) avec 2 témoins{mode === "referee" ? " : en arbitrant, tu en es déjà un" : ""}, ou si ton prof le valide.</p>
        </div>
      )}
      {twin && (
        <div className={`${ui.alertWarn} space-y-2`}>
          <p>{twin}</p>
          <p className="text-sm">{mode === "player" ? "Regarde plutôt dans « À signer » en haut de la page : tu peux le signer ou le corriger." : <><b>Es-tu sûr ?</b> Si c&apos;est une revanche, encode-la : un des deux joueurs devra la signer (seconde signature).</>}</p>
          <button type="button" disabled={pending} onClick={() => (isLive ? startLive(true) : save(true))} className={btn.smGhost}>{mode === "player" ? <>C&apos;est un autre match (une revanche) : l&apos;encoder quand même</> : <>Oui, je suis sûr : c&apos;est une revanche, {isLive ? "l\u2019arbitrer" : "l\u2019encoder"}</>}</button>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || !ready} onClick={() => (isLive ? startLive(false) : save(false))} className={cx(btn.lgPrimary, "w-full")}>{pending ? "Un instant…" : isLive ? "🎯 Commencer l\u2019arbitrage" : "Enregistrer le match"}</button>
      <p className={ui.hint}>{mode === "player" ? "Ton adversaire recevra le match à signer sur son téléphone." : isLive ? "Tu comptes les points au fil du match : un appui sur +1 à chaque point. À la fin, ton score compte tout de suite ; les joueurs peuvent le corriger." : "En tant qu'arbitre, ton score compte tout de suite ; les joueurs peuvent le corriger."}</p>
    </div>
  );
}

// Carte du tournoi par poules (09/11) : ce que l'eleve doit faire maintenant dans sa poule.
function TourCard({ t, canPlay, onPlay }: { t: TourCardData; canPlay: boolean; onPlay: (opponentId: string) => void }) {
  const score = t.sets ? t.sets.map(([a, b]) => `${a}-${b}`).join(" ") : "";
  const bracket = t.kind === "BRACKET";
  const ronde = t.round ? `${bracket ? "Tour" : "Ronde"} ${t.round}/${t.rounds}` : "";
  const nth = (n: number) => `${n}${n === 1 ? "er" : "e"}`;
  const h = t.headStart;
  return (
    <section className={cx(ui.card, "p-3 space-y-2 border-accent bg-accent-soft/30")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-extrabold text-ink">🏆 {t.kind === "HANDICAP" ? "Championnat à handicap" : bracket ? "Grand tableau" : "Tournoi"} · {t.where}</p>
        <span className={ui.hint}>{t.format}</span>
      </div>
      {t.status === "done" ? (
        bracket ? (
          t.rank ? <p className="text-sm"><b>Tableau terminé !</b> Tu finis <b>{nth(t.rank)}</b> sur {t.of}.</p> : <p className="text-sm"><b>Tu as joué tous tes matchs !</b> Ton classement final s&apos;affichera quand tout le tableau sera joué.</p>
        ) : t.poolDone ? <p className="text-sm"><b>{t.where === "tous contre tous" ? "Championnat terminé !" : "Poule terminée !"}</b> Tu finis <b>{nth(t.rank ?? 0)}</b> sur {t.of}.</p> : <p className="text-sm"><b>Tu as joué tous tes matchs !</b> Tu es {nth(t.rank ?? 0)} pour l&apos;instant ; il reste des matchs dans ta poule.</p>
      ) : t.status === "wait" ? (
        <p className="text-sm">{ronde} : <b>en attente de ton prochain adversaire</b> (un match du tour précédent n&apos;est pas encore fini).</p>
      ) : t.status === "tie" ? (
        <p className="text-sm">{ronde} : <b>égalité</b> contre <b>{t.opponent?.name}</b>. Au tableau il faut un vainqueur : jouez un point décisif, puis corrigez le score de votre match (« Corriger »).</p>
      ) : t.status === "bye" ? (
        <p className="text-sm">{ronde} : <b>tu es au repos.</b> Profites-en pour arbitrer un match de ta poule !</p>
      ) : t.status === "todo" && t.opponent ? (
        <div className="space-y-2">
          {t.late && <p className="text-sm">Tu es arrivé en cours de tournoi : joue tes <b>matchs de rattrapage</b> contre chacun, quand ton adversaire est libre.</p>}
          <p className="text-sm">{t.late ? "Rattrapage" : bracket ? ronde : `Ton prochain match (${ronde.toLowerCase()})`} : ton adversaire est <b className="text-base">{t.opponent.name}</b>{t.opponent.className ? <span className="text-ink-3 text-xs"> {t.opponent.className}</span> : null}.</p>
          {t.court !== undefined && <p className={cx("text-sm rounded-lg px-2 py-1 font-bold", t.court ? "bg-brand-soft text-brand-ink" : "bg-card text-ink-2")}>{t.court ? <>🏟️ Terrain <span className="text-base">{t.court}</span></> : "⏳ Attends qu'un terrain se libère (le premier de ta poule qui finit)."}</p>}
          {h && h.mine > 0 && <p className="text-sm rounded-lg bg-card px-2 py-1">⚖️ Handicap : <b>tu commences chaque set avec <span className={BM_ADVANCE}>{h.mine} point{h.mine > 1 ? "s" : ""} d&apos;avance</span></b> <b className={BM_ADVANCE}>({h.mine}-0)</b>. Compte-les dans le score final. L&apos;avance change après chaque match joué.</p>}
          {h && h.theirs > 0 && <p className="text-sm rounded-lg bg-card px-2 py-1">⚖️ Handicap : <b>{t.opponent.name.split(" ")[0]} commence chaque set avec <span className={BM_ADVANCE}>{h.theirs} point{h.theirs > 1 ? "s" : ""} d&apos;avance</span></b> <b className={BM_ADVANCE}>(0-{h.theirs})</b>. Comptez-les dans le score final. L&apos;avance change après chaque match joué.</p>}
          {/* Sans avance, on le DIT (Sartay 16/11 : « si y a pas de point d'avance, signifie-le ! ») */}
          {h && h.mine === 0 && h.theirs === 0 && <p className="text-sm rounded-lg bg-card px-2 py-1">⚖️ Handicap : <b className={BM_ADVANCE}>aucun point d&apos;avance</b> dans ce match : <b>vous commencez tous les deux à <span className={BM_ADVANCE}>0-0</span></b>. L&apos;avance change après chaque match joué.</p>}
          {canPlay && <button type="button" onClick={() => onPlay(t.opponent!.id)} className={cx(btn.primary, "w-full")}>Encoder ce match</button>}
        </div>
      ) : t.status === "live" ? (
        <p className="text-sm">{ronde} : ton match contre <b>{t.opponent?.name}</b> est arbitré en direct.</p>
      ) : t.status === "disputed" ? (
        <p className="text-sm">{ronde} : ton match contre <b>{t.opponent?.name}</b> est contesté : ton prof va trancher.</p>
      ) : (
        <p className="text-sm">{ronde} : match joué contre <b>{t.opponent?.name}</b> ({score}). Attends que toute ta poule ait fini la ronde : ton prochain adversaire s&apos;affichera ici.</p>
      )}
      {t.extra.length > 0 && (
        <div className="text-sm rounded-lg bg-card px-2 py-1 space-y-1">
          <p>⏱️ Rattrapage : {t.extra.map((o) => o.name).join(", ")} (arrivé{t.extra.length > 1 ? "s" : ""} en retard) doi{t.extra.length > 1 ? "vent" : "t"} aussi jouer contre toi, quand vous êtes libres tous les deux.</p>
          {canPlay && <div className="flex flex-wrap gap-1.5">{t.extra.map((o) => <button key={o.id} type="button" onClick={() => onPlay(o.id)} className={btn.smGhost}>Encoder le match contre {o.name.split(" ")[0]}</button>)}</div>}
        </div>
      )}
      {t.order && t.order.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-xs font-bold text-ink-2">Ordre des matchs ({t.where}) : organisez-vous sur les terrains</summary>
          <ol className="mt-1 text-sm space-y-0.5">
            {t.order.map((o, i) => (
              <li key={i} className={cx("flex justify-between gap-2 px-1 rounded", o.mine && "bg-brand-soft font-bold", o.status === "played" && "text-ink-3")}>
                <span className="min-w-0 truncate"><span className="text-ink-3 text-xs tabular-nums">{o.round ? `R${o.round}` : "Ratt."}</span> {o.a}{o.b ? <> – {o.b}</> : <span className="text-ink-3"> · repos</span>}{o.points ? <span className="text-xs text-accent-ink"> · {o.points} pts</span> : null}</span>
                <span className="whitespace-nowrap text-xs">{o.status === "played" ? `✅ ${o.score ?? ""}` : o.status === "live" ? "🔴 en cours" : o.status === "disputed" ? "⚠️" : o.status === "bye" ? "" : o.status === "gone" ? "🚪 parti" : "⏳"}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {t.table && <details>
        <summary className="cursor-pointer text-xs font-bold text-ink-2">{t.where === "tous contre tous" ? "Classement" : "Classement de ma poule"}</summary>
        <ol className="mt-1 text-sm">
          {t.table.map((r) => <li key={r.rank} className={cx("flex justify-between gap-2 px-1 rounded", r.me && "bg-brand-soft font-bold")}><span>{r.rank}. {r.name}</span><span className="tabular-nums">{String(r.score).replace(".", ",")} pt{r.score > 1 ? "s" : ""}</span></li>)}
        </ol>
      </details>}
    </section>
  );
}

// « Je suis pret » (26/11, Sartay : « si tout le monde est pret alors ca lance ; quoi qu'il arrive, si je lance, ca lance »).
function ReadyBox({ tourId, ready }: { tourId: string; ready: { me: boolean; count: number; total: number } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  // Affiche tout de suite mon « pret » (le serveur confirme au rafraichissement suivant).
  const [local, setLocal] = useState<{ base: boolean; me: boolean } | null>(null);
  const me = local && local.base === ready.me ? local.me : ready.me;
  const count = ready.count + (me === ready.me ? 0 : me ? 1 : -1);
  const toggle = () => {
    setError("");
    const want = !me;
    start(async () => {
      const r = await teamReadyAction(tourId, want);
      if ("error" in r) setError(r.error);
      else setLocal({ base: ready.me, me: want });
      router.refresh();
    });
  };
  return (
    <div className="rounded-xl border-2 border-accent bg-card p-2 space-y-1 text-center">
      <button type="button" disabled={pending} onClick={toggle} className={cx(me ? btn.ghost : btn.lgPrimary, "w-full")}>{pending ? "…" : me ? "✓ Je suis prêt (annuler)" : "✋ Je suis prêt"}</button>
      <p className={ui.hint}>Prêts : <b>{count}/{ready.total}</b> · le chrono part tout seul quand tout le monde est prêt, ou au coup de sifflet du prof.</p>
      {error && <p className={ui.alertErr}>{error}</p>}
    </div>
  );
}

// Carte du tournoi PAR EQUIPES (Sartay 24/11) : mon equipe et son coach, mon prochain match (contre qui, dans quelle
// rencontre), le chrono quand on joue au temps, les matchs de la rencontre en cours et le classement des equipes.
function TeamCard({ t, team, canPlay, onPlay }: { t: TourCardData; team: TeamCardData; canPlay: boolean; onPlay: (opponentId: string) => void }) {
  const nth = (n: number) => `${n}${n === 1 ? "re" : "e"}`;
  const tm = team.timer;
  const timerHere = team.time && tm && t.round === tm.round;
  const sign = (n: number) => (n > 0 ? `+${n}` : "0");
  const place = (r: TeamCardData["table"][number]) => (r.rank ? `${r.rank}.` : `${r.lo}-${r.hi}.`);
  return (
    <section className={cx(ui.card, "p-3 space-y-2 border-accent bg-accent-soft/30")}>
      {team.ready && <ReadyBox tourId={team.tourId} ready={team.ready} />}
      {team.sub && <p className={ui.alertInfo}>🔁 Tu remplaces un joueur parti de l&apos;équipe <b>{team.letter}</b> : les points de ce match iront à l&apos;équipe {team.letter}.</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-extrabold text-ink">🏆 Tournoi par équipes · Équipe {team.letter}</p>
        <span className={ui.hint}>{t.format}</span>
      </div>
      <p className="text-sm">
        {team.meCoach ? <><b>👑 Tu es le coach de l&apos;équipe {team.letter}.</b> Encourage et conseille tes joueurs : chaque victoire rapporte des points à l&apos;équipe.</> : <>Ton coach : <b>👑 {team.coach}</b>.</>}
        {" "}Ton équipe : <b>{team.pts} pts</b>{t.rank ? <> · {nth(t.rank)} sur {t.of}</> : null} · toi : <b>{sign(team.myPts)}</b>.
      </p>
      {team.time && tm && (
        <div className="rounded-xl border-2 border-line bg-card px-3 py-2 text-center">
          <Countdown endsAt={tm.endsAt} stoppedAt={tm.stoppedAt} serverNow={team.now} big />
          <p className={ui.hint}>Ronde {tm.round}{tm.wave === 2 ? " · matchs en plus" : ""} : tous les matchs commencent et s&apos;arrêtent ensemble. Le score au coup de sifflet compte (égalité possible).</p>
        </div>
      )}
      {t.status === "done" ? (
        <p className="text-sm"><b>{team.table.length && t.poolDone ? "Tournoi terminé !" : "Tu as joué tous tes matchs !"}</b>{t.poolDone && t.rank ? <> Ton équipe finit <b>{nth(t.rank)}</b> sur {t.of}.</> : " Encourage tes coéquipiers, ou arbitre un match."}</p>
      ) : t.status === "wait" ? (
        <p className="text-sm">{team.roundLabel} : <b>en attente</b> de la prochaine équipe adverse (une rencontre du tour précédent n&apos;est pas finie).</p>
      ) : t.status === "bye" ? (
        <p className="text-sm">{team.roundLabel} : <b>ton équipe est au repos.</b> Profites-en pour arbitrer un match !</p>
      ) : t.opponent ? (
        <div className="space-y-2">
          <p className="text-sm">{team.roundLabel}{team.oppTeam ? <> · contre l&apos;équipe {team.oppTeam.letter} (👑 {team.oppTeam.coach})</> : null} : ton adversaire est <b className="text-base">{t.opponent.name}</b>{t.opponent.className ? <span className="text-ink-3 text-xs"> {t.opponent.className}</span> : null}.</p>
          {t.court !== undefined && <p className={cx("text-sm rounded-lg px-2 py-1 font-bold", t.court ? "bg-brand-soft text-brand-ink" : "bg-card text-ink-2")}>{t.court ? <>🏟️ Terrain <span className="text-base">{t.court}</span></> : "⏳ Attends qu'un terrain se libère."}</p>}
          {t.headStart && t.status === "todo" && <p className="text-sm rounded-lg bg-card px-2 py-1">⚖️ Handicap : {t.headStart.mine > 0 ? <b>tu commences chaque set avec <span className={BM_ADVANCE}>{t.headStart.mine} point{t.headStart.mine > 1 ? "s" : ""} d&apos;avance ({t.headStart.mine}-0)</span></b> : t.headStart.theirs > 0 ? <b>{t.opponent.name.split(" ")[0]} commence chaque set avec <span className={BM_ADVANCE}>{t.headStart.theirs} point{t.headStart.theirs > 1 ? "s" : ""} d&apos;avance (0-{t.headStart.theirs})</span></b> : <b className={BM_ADVANCE}>aucun point d&apos;avance (0-0)</b>}. Comptez-les dans le score final ; ils ne comptent pas dans les points de l&apos;équipe.</p>}
          {team.wave === 2 && <p className={ui.hint}>Match en plus : les deux équipes n&apos;ont pas le même nombre de joueurs, tu joues contre le joueur le plus proche de ton ELO{team.time ? " (au 2e coup de sifflet)" : ""}.</p>}
          {team.time && !timerHere && <p className={ui.hint}>⏱️ Matchs de {team.minutes} min : attends le coup de sifflet du prof.</p>}
          {t.status === "live" ? <p className="text-sm">Ton match est arbitré en direct.</p> : t.status === "disputed" ? <p className="text-sm">Ton match est contesté : ton prof va trancher.</p> : canPlay && <button type="button" onClick={() => onPlay(t.opponent!.id)} className={cx(btn.primary, "w-full")}>Encoder ce match</button>}
        </div>
      ) : null}
      {team.current && (
        <details open>
          <summary className="cursor-pointer text-xs font-bold text-ink-2">Rencontre en cours : équipe {team.letter} <b>{team.current.pts[0]}</b> – <b>{team.current.pts[1]}</b> équipe {team.oppTeam?.letter ?? "?"}</summary>
          <ol className="mt-1 text-sm space-y-0.5">
            {team.current.matches.map((m, i) => (
              <li key={i} className={cx("flex justify-between gap-2 px-1 rounded", m.me && "bg-brand-soft font-bold", m.status === "played" && "text-ink-2")}>
                <span className="min-w-0 truncate">{m.wave === 2 && <span className="text-xs text-accent-ink">en plus · </span>}{m.ours} – {m.theirs}</span>
                <span className="whitespace-nowrap text-xs tabular-nums">{m.status === "played" ? `${m.score ?? ""} · ${m.pts[0] ? `+${m.pts[0]} nous` : m.pts[1] ? `+${m.pts[1]} eux` : "0"}` : m.status === "live" ? "🔴 en cours" : m.status === "disputed" ? "⚠️" : m.status === "gone" ? "🚪 parti" : "⏳"}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-ink-2">Classement des équipes</summary>
        <ol className="mt-1 text-sm">
          {team.table.map((r) => (
            <li key={r.letter} className={cx("flex justify-between gap-2 px-1 rounded", r.me && "bg-brand-soft font-bold")}>
              <span>{team.groups > 1 ? <span className="text-ink-3 text-xs">P{r.group + 1} </span> : null}{place(r)} Équipe {r.letter} <span className="text-ink-3 text-xs">👑 {r.coach}</span></span>
              <span className="tabular-nums">{r.pts} pts{team.bracket ? "" : ` · ${r.record}`}</span>
            </li>
          ))}
        </ol>
      </details>
      {/* Sartay 26/11 : « expliquer, au bas de leur horaire, comment sont calcules les points rapportes a l'equipe, pour
          comprendre ce qui se joue et le score a atteindre pour sauver l'equipe ». */}
      <div className="rounded-xl bg-paper px-3 py-2 text-sm space-y-1">
        <p className="font-bold">🧮 Ce qui se joue{team.stakes ? " dans ton match" : ""}</p>
        {team.stakes && team.stakes.scoring === "POINTS" && (
          <>
            <p>Tes chances de gagner, d&apos;après l&apos;ELO : <b>{team.stakes.chance} %</b>. Chaque point que tu marques vaut <b>×{String(team.stakes.coef).replace(".", ",")}</b> pour ton équipe.</p>
            <p>✅ Si tu gagnes {team.stakes.target || 11}-{Math.max(0, (team.stakes.target || 11) - 3)} : <b>+{team.stakes.win[0]}</b> pour ton équipe, +{team.stakes.win[1]} pour la sienne.</p>
            <p>❌ Si tu perds {Math.max(0, (team.stakes.target || 11) - 3)}-{team.stakes.target || 11} : <b>+{team.stakes.lose[0]}</b> quand même pour ton équipe, +{team.stakes.lose[1]} pour la sienne.</p>
            {team.stakes.need && <p className="font-bold text-accent-ink">🎯 {team.stakes.need}</p>}
          </>
        )}
        {team.stakes && team.stakes.scoring !== "POINTS" && (
          <>
            <p>Tes chances de gagner, d&apos;après l&apos;ELO : <b>{team.stakes.chance} %</b>.</p>
            <p>✅ Si tu gagnes : <b>+{team.stakes.win[0]}</b> pour ton équipe{team.stakes.win[1] > team.stakes.win[0] ? <> (score serré) jusqu&apos;à <b>+{team.stakes.win[1]}</b> (16 points d&apos;écart ou plus)</> : null}.</p>
            {team.stakes.draw && <p>🤝 Égalité au coup de sifflet : <b>+{team.stakes.draw[0]}</b> pour toi, +{team.stakes.draw[1]} pour ton adversaire.</p>}
            <p>❌ Si tu perds : 0 pour ton équipe (rien n&apos;est enlevé), mais ton adversaire rapporte +{team.stakes.lose[0]}{team.stakes.lose[1] > team.stakes.lose[0] ? ` à +${team.stakes.lose[1]}` : ""} à la sienne.</p>
            {team.stakes.need && <p className="font-bold text-accent-ink">🎯 {team.stakes.need}</p>}
          </>
        )}
        {team.stakes?.scoring === "POINTS" || team.scoring === "POINTS" ? <p className={ui.hint}>Comment ça marche : chaque point que tu marques rapporte à ton équipe, même si tu perds. Il est multiplié par un coefficient qui dépend de l&apos;écart d&apos;ELO : ×1 à ELO égal, plus si ton adversaire est plus fort, moins s&apos;il est plus faible. Une victoire ajoute un bonus de 10 (multiplié de la même façon). Un exploit contre plus fort rapporte gros, même en perdant de peu. L&apos;équipe qui a le plus de points gagne la rencontre.</p> : <p className={ui.hint}>Comment ça marche : chaque victoire rapporte à l&apos;équipe les points ELO gagnés par le vainqueur. Battre un joueur mieux classé rapporte beaucoup, battre un joueur moins bien classé peu ; plus l&apos;écart au score est grand, plus ça rapporte (jusqu&apos;à ×1,5 à 16 points d&apos;écart). Une défaite ne rapporte rien et n&apos;enlève rien. L&apos;équipe qui a le plus de points gagne la rencontre.</p>}
      </div>
    </section>
  );
}

// Scouting (24/11) : choisir un match de la seance (en direct d'abord), puis le joueur a observer ; la fiche technique
// (6 coups, 4 criteres chacun) s'ouvre ici. Un eleve ne remplit jamais sa propre fiche.
// Pendant un tournoi, les prochains matchs a scouter (pas encore commences), donnes par le serveur (badminton-scout-queue.ts).
export type ScoutPickView = { a: { id: string; name: string }; b: { id: string; name: string }; label: string };
function ScoutSection({ strokesOn = false, matches, picks, resume, strokeResume = [], strokeTaken = [], onStrokes, roster, sessionId, onLive, court, onDone }: { strokesOn?: boolean; strokeResume?: StrokeResume[]; strokeTaken?: string[]; onStrokes: (x: StrokeResume) => void; matches: BmView[]; picks: ScoutPickView[] | null; resume: { id: string; aName: string; bName: string; sets: BmSet[] }[]; roster: BmPersonRef[]; sessionId: string; onLive: (x: { id: string; aName: string; bName: string; sets: BmSet[] | null }) => void; court: boolean; onDone: () => void }) {
  const [pa, setPa] = useState<string | null>(null);
  const [pb, setPb] = useState<string | null>(null);
  const who = (id: string | null) => roster.find((p) => p.id === id)?.name ?? "";
  const [starting, startScout] = useTransition();
  const [scoutErr, setScoutErr] = useState("");
  // Ouvre en direct le match choisi (le scout tient le score en touchant les impacts).
  const go = (p: ScoutPickView) => {
    setScoutErr("");
    startScout(async () => {
      // Une OBSERVATION (26/11) : pas un match, pas un arbitrage ; le score est indicatif (ni ELO, ni tournoi).
      const res = await startScoutingAction(sessionId, { playerAId: p.a.id, playerBId: p.b.id });
      if ("error" in res) { setScoutErr(res.error); onDone(); return; }
      if ("matchId" in res && res.matchId) onLive({ id: res.matchId, aName: p.a.name, bName: p.b.name, sets: res.sets ?? [[0, 0]] });
    });
  };
  // Scouting des COUPS (etape 2, 26/11 soir) : un scout par joueur ; un joueur deja suivi par un autre scout n'est pas propose.
  const goStrokes = (p: ScoutPickView, player: { id: string; name: string }) => {
    setScoutErr("");
    startScout(async () => {
      const res = await startStrokeScoutAction(sessionId, { playerAId: p.a.id, playerBId: p.b.id, playerId: player.id });
      if ("error" in res) { setScoutErr(res.error); onDone(); return; }
      if ("matchId" in res && res.matchId) onStrokes({ id: res.matchId, playerId: player.id, playerName: player.name, oppName: (player.id === p.a.id ? p.b : p.a).name, taps: [] });
    });
  };
  const taken = (p: ScoutPickView, id: string) => strokeTaken.includes(`${[p.a.id, p.b.id].sort().join("|")}|${id}`);
  const strokeButtons = (p: ScoutPickView) => !strokesOn ? null : (
    <div className="flex flex-wrap gap-1.5">
      {[p.a, p.b].filter((x) => !taken(p, x.id)).map((x) => <button key={x.id} type="button" disabled={starting} onClick={() => goStrokes(p, x)} className={cx(btn.ghost, "flex-1 border-2 border-accent")}>🏸 Coups de {x.name.split(" ")[0]}</button>)}
    </div>
  );
  const [pick, setPick] = useState<{ matchId: string; player: { id: string; name: string } } | null>(null);
  const [sent, setSent] = useState("");
  if (pick) return <StrokeSheetForm key={`${pick.matchId}|${pick.player.id}`} matchId={pick.matchId} player={pick.player} onClose={() => setPick(null)} onDone={() => { setSent(`Fiche de ${pick.player.name} envoyée, merci !`); setPick(null); onDone(); }} />;
  return (
    // Apres l'envoi d'une fiche : la section reste ouverte, avec la confirmation.
    // Ouverte d'office (26/11) : un eleve deverrouille doit voir tout de suite comment noter ou tombent les volants.
    <details open className={cx(ui.card, "p-3 border-accent")}>
      <summary className="cursor-pointer font-display font-extrabold text-ink">🔭 Scouting</summary>
      <div className="mt-2 space-y-2">
        {sent && <p className={ui.alertOk}>✅ {sent}</p>}
        {/* Sartay 26/11 : « le scouting le plus important, c'est d'abord ou tombent les volants » : le terrain est sur le tableau de l'arbitre en direct. */}
        {court && picks && (
          <div className="rounded-xl bg-accent-soft/40 p-2 space-y-1.5">
            {picks.length === 0 ? <p className={ui.muted}>📍 Aucun match du tournoi n&apos;attend de commencer pour l&apos;instant : reviens dans un moment.</p> : (
              <>
                <button type="button" disabled={starting} onClick={() => go(picks[0])} className={cx(btn.lgPrimary, "w-full")}>📍 Scouter le prochain match : {picks[0].a.name.split(" ")[0]} – {picks[0].b.name.split(" ")[0]}</button>
                <p className={ui.hint}>{picks[0].label} · pas encore commencé. Tu touches où tombe chaque volant. Ce n&apos;est pas un arbitrage : ton score est indicatif, il ne compte ni à l&apos;ELO ni au tournoi.</p>
                {strokeButtons(picks[0])}
                {strokesOn && <p className={ui.hint}>🏸 Ou suis UN joueur et note chacun de ses coups (un scout par joueur).</p>}
                {picks.length > 1 && <p className={ui.hint}>Ou : {picks.slice(1).map((p) => <button key={`${p.a.id}|${p.b.id}`} type="button" disabled={starting} onClick={() => go(p)} className="underline mr-2">{p.a.name.split(" ")[0]} – {p.b.name.split(" ")[0]}</button>)}</p>}
              </>
            )}
            {scoutErr && <p className={ui.alertErr}>{scoutErr}</p>}
          </div>
        )}
        {court && !picks && (
          <div className="rounded-xl bg-accent-soft/40 p-2 space-y-2">
            <p className="font-bold">📍 Noter où tombent les volants</p>
            <PersonPicker people={roster} value={pa} onChange={setPa} exclude={pb ? [pb] : []} label="Joueur 1" placeholder="Tape un nom" />
            <PersonPicker people={roster} value={pb} onChange={setPb} exclude={pa ? [pa] : []} label="Joueur 2" placeholder="Tape un nom" />
            <button type="button" disabled={starting || !pa || !pb} onClick={() => pa && pb && go({ a: { id: pa, name: who(pa) }, b: { id: pb, name: who(pb) }, label: "" })} className={cx(btn.lgPrimary, "w-full")}>🔭 Commencer le scouting</button>
            {pa && pb && strokeButtons({ a: { id: pa, name: who(pa) }, b: { id: pb, name: who(pb) }, label: "" })}
            <p className={ui.hint}>Choisis un match qui va commencer. Ce n&apos;est pas un arbitrage : ton score est indicatif, il ne compte pas à l&apos;ELO.</p>
            {scoutErr && <p className={ui.alertErr}>{scoutErr}</p>}
          </div>
        )}
        {strokeResume.length > 0 && (
          <div className="space-y-1">
            <p className="font-bold text-sm">Mes scoutings de coups en cours</p>
            {strokeResume.map((r) => <button key={r.id} type="button" onClick={() => onStrokes(r)} className={cx(btn.smGhost, "mr-1")}>↩ 🏸 coups de {r.playerName.split(" ")[0]} · reprendre</button>)}
          </div>
        )}
        {resume.length > 0 && (
          <div className="space-y-1">
            <p className="font-bold text-sm">Mes scoutings en cours</p>
            {resume.map((r) => <button key={r.id} type="button" onClick={() => onLive({ id: r.id, aName: r.aName, bName: r.bName, sets: r.sets })} className={cx(btn.smGhost, "mr-1")}>↩ {r.aName.split(" ")[0]} – {r.bName.split(" ")[0]} · reprendre</button>)}
          </div>
        )}
        {strokesOn && <>
        <p className="font-bold">📝 Fiche technique d&apos;un joueur</p>
        <p className={ui.hint}>Regarde un match et remplis la fiche technique d&apos;un des deux joueurs : service court, service long, clear, smash, drop, lob.</p>
        {matches.length === 0 ? <p className={ui.muted}>Aucun match à observer pour l&apos;instant : il apparaît ici dès qu&apos;un arbitre l&apos;ouvre en direct ou qu&apos;il est encodé.</p> : (
          <ul className="space-y-1.5">
            {matches.map((v) => (
              <li key={v.id} className="rounded-lg bg-paper px-2 py-1.5 text-sm">
                <p><b>{v.a.name}</b> – <b>{v.b.name}</b> <span className="text-ink-3 text-xs">{v.status === "LIVE" ? "🔴 en direct" : v.sets ? v.sets.map(([x, y]) => `${x}-${y}`).join(" ") : ""}</span></p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[v.a, v.b].map((p) => <button key={p.id} type="button" onClick={() => { setSent(""); setPick({ matchId: v.id, player: { id: p.id, name: p.name } }); }} className={btn.smGhost}>Fiche de {p.name.split(" ")[0]}</button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
        </>}
      </div>
    </details>
  );
}
