"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BmPersonRef, BmSet, BmView } from "@/lib/badminton";
import type { PairingStatus, TourKind } from "@/lib/badminton-tournament";
import { badmintonPulseAction, recordMatchAction, startLiveMatchAction } from "../../badminton-actions";
import { LiveBoard, MatchCard, type LiveRule, PersonPicker, SetsEditor, emptySets, resultText, setsReady } from "../../../_components/BadmintonParts";
import { usePulse } from "../../../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";

// Ecran eleve du badminton (telephone) : « à signer » en haut, puis « Encoder un match » (j'ai joue / j'ai arbitre),
// puis mes matchs et ceux que j'ai arbitres, chacun avec son historique (qui a encode quoi, qui a signe).
// Matchs libres (`free`, 03/11) : tous les eleves dans la liste, temoins a demander, « à attester » en haut.
// Tournoi par poules (`tour`, 09/11) : en tete, mon adversaire de la ronde en cours et « Encoder ce match ».
export type TourCardData = { kind: TourKind; label: string; format: string; where: string; round: number | null; rounds: number; status: PairingStatus | "done"; opponent: BmPersonRef | null; sets: BmSet[] | null; rank: number | null; of: number; table: { name: string; score: number; rank: number; me: boolean }[] | null; headStart: { mine: number; theirs: number } | null; late: boolean; extra: BmPersonRef[]; poolDone: boolean; order: { round: number | null; a: string; b: string | null; status: PairingStatus; score: string | null; mine: boolean; points: number | null }[] | null };
export function BadmintonClient({ sessionId, meId, writable, roster, toSign, mine, refereed, free = false, toAttest = [], witnessed = [], tour = null, liveRules = {} }: { sessionId: string; meId: string; writable: boolean; roster: BmPersonRef[]; toSign: BmView[]; mine: BmView[]; refereed: BmView[]; free?: boolean; toAttest?: BmView[]; witnessed?: BmView[]; tour?: TourCardData | null; liveRules?: Record<string, LiveRule & { target: number }> }) {
  const router = useRouter();
  const pulse = useCallback(() => badmintonPulseAction(sessionId), [sessionId]);
  // Arbitrage en direct en cours sur ce telephone (tableau de score plein ecran).
  const [live, setLive] = useState<{ id: string; aName: string; bName: string; sets: BmSet[] | null; target?: number; rule?: LiveRule } | null>(null);
  usePulse(pulse, 8000, !live);
  const [open, setOpen] = useState(toSign.length === 0 && toAttest.length === 0 && mine.length === 0 && writable);
  const witnessRoster = free ? roster : undefined;
  const [preset, setPreset] = useState<string | null>(null); // adversaire du tournoi, pre-rempli
  // Reprendre un direct de tournoi : avec l'objectif et la regle de ce match.
  const resume = (v: BmView) => setLive({ id: v.id, aName: v.a.name, bName: v.b.name, sets: v.sets, target: liveRules[v.id]?.target, rule: liveRules[v.id] });
  return (
    <main className="max-w-xl mx-auto p-4 space-y-5">
      {live && <LiveBoard key={live.id} matchId={live.id} aName={live.aName} bName={live.bName} initialSets={live.sets} initialTarget={live.target} rule={live.rule} onClose={() => setLive(null)} />}
      {!writable && <p className={ui.alertInfo}>La séance est terminée depuis plus de 24 h : tu peux seulement consulter tes matchs.</p>}
      {tour && <TourCard t={tour} canPlay={writable} onPlay={(id) => { setPreset(id); setOpen(true); }} />}
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
          {open ? <NewMatch key={preset ?? "nouveau"} initialB={preset} sessionId={sessionId} meId={meId} roster={roster} free={free} onDone={() => { setOpen(false); router.refresh(); }} onClose={() => setOpen(false)} onLive={(x) => { setOpen(false); setLive(x); }} /> : (
            <button type="button" onClick={() => setOpen(true)} className={cx(btn.lgPrimary, "w-full")}>＋ Encoder un match{free ? " libre" : ""}</button>
          )}
        </section>
      )}

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

function NewMatch({ sessionId, meId, roster, free, initialB = null, onDone, onClose, onLive }: { sessionId: string; meId: string; roster: BmPersonRef[]; free: boolean; initialB?: string | null; onDone: () => void; onClose: () => void; onLive: (x: { id: string; aName: string; bName: string; sets: BmSet[] | null; target?: number; rule?: LiveRule }) => void }) {
  const [mode, setMode] = useState<"player" | "referee">("player");
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
  const nameOf = (id: string | null) => roster.find((p) => p.id === id)?.name.split(" ")[0] ?? "";
  const left = mode === "player" ? "Toi" : nameOf(a) || "Joueur 1";
  const right = mode === "player" ? nameOf(b) || "Adversaire" : nameOf(b) || "Joueur 2";
  const isLive = mode === "referee" && how === "live";
  const ready = isLive ? !!a && !!b : setsReady(sets) && !!b && (mode === "player" || !!a);
  const fullName = (id: string | null) => roster.find((p) => p.id === id)?.name ?? "";
  function startLive(force = false) {
    setError("");
    start(async () => {
      const res = await startLiveMatchAction(sessionId, { playerAId: a ?? "", playerBId: b ?? "", force, witnessIds });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setTwin(res.duplicate.text); return; }
      if (res.matchId) onLive({ id: res.matchId, aName: fullName(a), bName: fullName(b), sets: res.sets ?? [[0, 0]], target: res.target, rule: res.rule });
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
          {h && h.mine > 0 && <p className="text-sm rounded-lg bg-card px-2 py-1">⚖️ Handicap : <b>tu commences chaque set avec {h.mine} point{h.mine > 1 ? "s" : ""} d&apos;avance</b> ({h.mine}-0). Compte-les dans le score final.</p>}
          {h && h.theirs > 0 && <p className="text-sm rounded-lg bg-card px-2 py-1">⚖️ Handicap : <b>{t.opponent.name.split(" ")[0]} commence chaque set avec {h.theirs} point{h.theirs > 1 ? "s" : ""} d&apos;avance</b> (0-{h.theirs}). Comptez-les dans le score final.</p>}
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
