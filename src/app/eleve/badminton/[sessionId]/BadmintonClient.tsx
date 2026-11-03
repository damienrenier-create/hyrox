"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BmPersonRef, BmSet, BmView } from "@/lib/badminton";
import { badmintonPulseAction, recordMatchAction, startLiveMatchAction } from "../../badminton-actions";
import { LiveBoard, MatchCard, PersonPicker, SetsEditor, emptySets, resultText, setsReady } from "../../../_components/BadmintonParts";
import { usePulse } from "../../../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";

// Ecran eleve du badminton (telephone) : « à signer » en haut, puis « Encoder un match » (j'ai joue / j'ai arbitre),
// puis mes matchs et ceux que j'ai arbitres, chacun avec son historique (qui a encode quoi, qui a signe).
// Matchs libres (`free`, 03/11) : tous les eleves dans la liste, temoins a demander, « à attester » en haut.
export function BadmintonClient({ sessionId, meId, writable, roster, toSign, mine, refereed, free = false, toAttest = [], witnessed = [] }: { sessionId: string; meId: string; writable: boolean; roster: BmPersonRef[]; toSign: BmView[]; mine: BmView[]; refereed: BmView[]; free?: boolean; toAttest?: BmView[]; witnessed?: BmView[] }) {
  const router = useRouter();
  const pulse = useCallback(() => badmintonPulseAction(sessionId), [sessionId]);
  // Arbitrage en direct en cours sur ce telephone (tableau de score plein ecran).
  const [live, setLive] = useState<{ id: string; aName: string; bName: string; sets: BmSet[] | null } | null>(null);
  usePulse(pulse, 8000, !live);
  const [open, setOpen] = useState(toSign.length === 0 && toAttest.length === 0 && mine.length === 0 && writable);
  const witnessRoster = free ? roster : undefined;
  const resume = (v: BmView) => setLive({ id: v.id, aName: v.a.name, bName: v.b.name, sets: v.sets });
  return (
    <main className="max-w-xl mx-auto p-4 space-y-5">
      {live && <LiveBoard key={live.id} matchId={live.id} aName={live.aName} bName={live.bName} initialSets={live.sets} onClose={() => setLive(null)} />}
      {!writable && <p className={ui.alertInfo}>La séance est terminée depuis plus de 24 h : tu peux seulement consulter tes matchs.</p>}
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
          {open ? <NewMatch sessionId={sessionId} meId={meId} roster={roster} free={free} onDone={() => { setOpen(false); router.refresh(); }} onClose={() => setOpen(false)} onLive={(x) => { setOpen(false); setLive(x); }} /> : (
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

function NewMatch({ sessionId, meId, roster, free, onDone, onClose, onLive }: { sessionId: string; meId: string; roster: BmPersonRef[]; free: boolean; onDone: () => void; onClose: () => void; onLive: (x: { id: string; aName: string; bName: string; sets: BmSet[] | null }) => void }) {
  const [mode, setMode] = useState<"player" | "referee">("player");
  // Arbitre : en direct (+1 / −1 au fil du match, par defaut) ou score final tape a la fin.
  const [how, setHow] = useState<"live" | "final">("live");
  const [a, setA] = useState<string | null>(null); // arbitre : joueur 1
  const [b, setB] = useState<string | null>(null); // adversaire, ou joueur 2
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
      if (res.matchId) onLive({ id: res.matchId, aName: fullName(a), bName: fullName(b), sets: [[0, 0]] });
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
          <p className="text-sm">{mode === "player" ? "Regarde plutôt dans « À signer » en haut de la page : tu peux le signer ou le corriger." : "Les joueurs l'ont peut-être déjà encodé."}</p>
          <button type="button" disabled={pending} onClick={() => (isLive ? startLive(true) : save(true))} className={btn.smGhost}>C&apos;est un autre match : {isLive ? "l\u2019arbitrer" : "l\u2019encoder"} quand même</button>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || !ready} onClick={() => (isLive ? startLive(false) : save(false))} className={cx(btn.lgPrimary, "w-full")}>{pending ? "Un instant…" : isLive ? "🎯 Commencer l\u2019arbitrage" : "Enregistrer le match"}</button>
      <p className={ui.hint}>{mode === "player" ? "Ton adversaire recevra le match à signer sur son téléphone." : isLive ? "Tu comptes les points au fil du match : un appui sur +1 à chaque point. À la fin, ton score compte tout de suite ; les joueurs peuvent le corriger." : "En tant qu'arbitre, ton score compte tout de suite ; les joueurs peuvent le corriger."}</p>
    </div>
  );
}
