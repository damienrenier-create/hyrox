"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BmPersonRef, BmSet, BmView } from "@/lib/badminton";
import { badmintonPulseAction, recordMatchAction } from "../../badminton-actions";
import { MatchCard, PersonPicker, SetsEditor, emptySets, resultText, setsReady } from "../../../_components/BadmintonParts";
import { usePulse } from "../../../_components/usePulse";
import { btn, cx, ui } from "@/lib/ui";

// Ecran eleve du badminton (telephone) : « à signer » en haut, puis « Encoder un match » (j'ai joue / j'ai arbitre),
// puis mes matchs et ceux que j'ai arbitres, chacun avec son historique (qui a encode quoi, qui a signe).
export function BadmintonClient({ sessionId, meId, writable, roster, toSign, mine, refereed }: { sessionId: string; meId: string; writable: boolean; roster: BmPersonRef[]; toSign: BmView[]; mine: BmView[]; refereed: BmView[] }) {
  const router = useRouter();
  const pulse = useCallback(() => badmintonPulseAction(sessionId), [sessionId]);
  usePulse(pulse, 8000, true);
  const [open, setOpen] = useState(toSign.length === 0 && mine.length === 0 && writable);
  return (
    <main className="max-w-xl mx-auto p-4 space-y-5">
      {!writable && <p className={ui.alertInfo}>La séance est terminée depuis plus de 24 h : tu peux seulement consulter tes matchs.</p>}

      {toSign.length > 0 && (
        <section className="space-y-2">
          <h2 className={ui.eyebrow}>✍️ À signer · {toSign.length}</h2>
          <p className={ui.hint}>Ton adversaire a encodé votre match. Si le score est juste, signe-le ; sinon corrige-le (il devra signer ta correction).</p>
          {toSign.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} />)}
        </section>
      )}

      {writable && (
        <section>
          {open ? <NewMatch sessionId={sessionId} meId={meId} roster={roster} onDone={() => { setOpen(false); router.refresh(); }} onClose={() => setOpen(false)} /> : (
            <button type="button" onClick={() => setOpen(true)} className={cx(btn.lgPrimary, "w-full")}>＋ Encoder un match</button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className={ui.eyebrow}>Mes matchs · {mine.length}</h2>
        {mine.length === 0 ? <p className={`${ui.cardPad} ${ui.muted}`}>Aucun match pour l&apos;instant.</p> : mine.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} />)}
      </section>

      {refereed.length > 0 && (
        <section className="space-y-2">
          <h2 className={ui.eyebrow}>Matchs que j&apos;ai arbitrés · {refereed.length}</h2>
          {refereed.map((v) => <MatchCard key={v.id} v={v} viewerId={meId} />)}
        </section>
      )}
    </main>
  );
}

function NewMatch({ sessionId, meId, roster, onDone, onClose }: { sessionId: string; meId: string; roster: BmPersonRef[]; onDone: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<"player" | "referee">("player");
  const [a, setA] = useState<string | null>(null); // arbitre : joueur 1
  const [b, setB] = useState<string | null>(null); // adversaire, ou joueur 2
  const [sets, setSets] = useState<BmSet[]>(emptySets);
  const [error, setError] = useState("");
  const [twin, setTwin] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nameOf = (id: string | null) => roster.find((p) => p.id === id)?.name.split(" ")[0] ?? "";
  const left = mode === "player" ? "Toi" : nameOf(a) || "Joueur 1";
  const right = mode === "player" ? nameOf(b) || "Adversaire" : nameOf(b) || "Joueur 2";
  const ready = setsReady(sets) && !!b && (mode === "player" || !!a);
  function save(force = false) {
    setError("");
    start(async () => {
      const res = await recordMatchAction(sessionId, { playerAId: mode === "player" ? meId : a, playerBId: b ?? "", sets, force });
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
      <div>
        <span className={ui.label}>Le score</span>
        <SetsEditor sets={sets} onChange={setSets} left={left} right={right} />
        {setsReady(sets) && b && <p className={`${ui.hint} mt-2`}>{resultText(sets, left, right)}</p>}
      </div>
      {twin && (
        <div className={`${ui.alertWarn} space-y-2`}>
          <p>{twin}</p>
          <p className="text-sm">{mode === "player" ? "Regarde plutôt dans « À signer » en haut de la page : tu peux le signer ou le corriger." : "Les joueurs l'ont peut-être déjà encodé."}</p>
          <button type="button" disabled={pending} onClick={() => save(true)} className={btn.smGhost}>C&apos;est un autre match : l&apos;encoder quand même</button>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <button type="button" disabled={pending || !ready} onClick={() => save(false)} className={cx(btn.lgPrimary, "w-full")}>{pending ? "Enregistrement…" : "Enregistrer le match"}</button>
      <p className={ui.hint}>{mode === "player" ? "Ton adversaire recevra le match à signer sur son téléphone." : "En tant qu'arbitre, ton score compte tout de suite ; les joueurs peuvent le corriger."}</p>
    </div>
  );
}
