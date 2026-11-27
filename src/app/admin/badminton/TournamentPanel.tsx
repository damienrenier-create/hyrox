"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COURT_COUNTS } from "@/lib/badminton-courts";
import { HANDICAP_ELO_PER_POINT, POOL_NAMES, autoHandicap, TEAM_COUNTS, TEAM_GROUPS, TEAM_MINUTES, TOUR_CAPS, TOUR_ELO_PER_POINT, TOUR_KINDS, TOUR_POINTS, TOUR_POOL_COUNTS, TOUR_POOL_SIZES, bracketSize, calibrationText, groupsOfPlayers, handicapOf, makePlayers, pairKey, readTourSettings, reconcileGroups, seedOrder, type Bracket, type BracketPairing, type HandicapCalibration, type TeamDraw, type TeamFormat, type TeamMode, type TourKind, type TourPairing, type TourPlayer, type TourPool, type TourSettings } from "@/lib/badminton-tournament";
import { makeTeams, readyState, reconcileTeams, subCandidates, type Rencontre, type TeamPairing, type TeamsState } from "@/lib/badminton-teams";
import { addLatePlayerAction, closeTournamentAction, createTournamentAction, moveTournamentAction, setPlayerGoneAction, setPlayersGoneAction, setTeamSubAction, setTournamentRuleAction, teamTimerAction } from "@/app/eleve/badminton-actions";
import { btn, cx, ui } from "@/lib/ui";
import { StudentName } from "../../_components/StudentName";
import { Countdown } from "../../_components/BadmintonParts";
import { fold } from "@/lib/staff-names";

// Tournois de badminton, cote prof (Sartay 09/11) : choisir le format (poules de niveau, grand tableau, championnat a
// handicap), les participants (coches d'office : ceux qui ont deja joue ou arbitre dans la seance) et les reglages, voir
// le tournoi avant de lancer ; puis le suivre et le clore. Regles : src/lib/badminton-tournament.ts.

// staff : un prof de la seance (16/11), propose en tete de liste mais pas coche d'office.
export type TourEntrantRow = { id: string; name: string; className: string | null; elo: number; present: boolean; staff?: boolean };
// teams : tournoi par equipes (24/11) ; now : heure du serveur a l'affichage (chrono).
export type TourView = { id: string; kind: TourKind; label: string; format: string; pools: TourPool[] | null; bracket: Bracket | null; teams: TeamsState | null; now: number; names: Record<string, { name: string; className: string | null }>; gone: string[]; settings: TourSettings; players: TourPlayer[]; lesson?: { handicap: boolean; bet: boolean; theme: boolean }; courts?: Record<string, string | null> };
export type TourElsewhere = { id: string; label: string; players: number; when: string };

export type TourCandidate = { id: string; name: string; className: string | null };
// calibrations : le bareme du handicap calcule sur les matchs joues, par longueur de set (apercu ; le serveur le recalcule au lancement).
export function TournamentPanel({ sessionId, entrants, active, previous, elsewhere, candidates, calibrations = {} }: { sessionId: string; entrants: TourEntrantRow[]; active: TourView | null; previous: TourView | null; elsewhere: TourElsewhere[]; candidates: TourCandidate[]; calibrations?: Record<number, HandicapCalibration | null> }) {
  if (active) return <TournamentBoard t={active} candidates={candidates} />;
  return (
    <div className="space-y-4">
      {elsewhere.length > 0 && <Elsewhere sessionId={sessionId} list={elsewhere} />}
      <NewTournament sessionId={sessionId} entrants={entrants} calibrations={calibrations} />
      {previous && (
        <details className={`${ui.cardPad}`}>
          <summary className="cursor-pointer font-bold">Dernier tournoi clos : {previous.label}</summary>
          <div className="mt-3"><TournamentBoard t={previous} closed /></div>
        </details>
      )}
    </div>
  );
}

// Tournois pas encore clos, lances a un cours precedent avec ces eleves : on peut les continuer ici.
function Elsewhere({ sessionId, list }: { sessionId: string; list: TourElsewhere[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <section className={`${ui.cardPad} space-y-2 border-accent`}>
      <h3 className={ui.h3}>Tournoi en cours d&apos;un cours précédent</h3>
      {list.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span><b>{t.label}</b> · {t.players} participants · lancé {t.when}</span>
          <button type="button" disabled={pending} onClick={() => start(async () => { const r = await moveTournamentAction(t.id, sessionId); if ("error" in r) setError(r.error); else router.refresh(); })} className={btn.smPrimary}>Continuer ici</button>
        </div>
      ))}
      {error && <p className={ui.alertErr}>{error}</p>}
    </section>
  );
}

function NewTournament({ sessionId, entrants, calibrations }: { sessionId: string; entrants: TourEntrantRow[]; calibrations: Record<number, HandicapCalibration | null> }) {
  const router = useRouter();
  const [kind, setKind] = useState<TourKind>("POOLS");
  // Toute la classe par defaut (Sartay 10/11 : « je decoche ceux qui n'y participent pas, ou qui arbitrent, et pas le contraire »).
  // Le prof de la seance (16/11) : propose, a cocher soi-meme (« je dois pouvoir selectionner le prof titulaire »).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entrants.filter((e) => !e.staff).map((e) => e.id)));
  const [poolSizes, setPoolSizes] = useState<Record<TourKind, number>>({ POOLS: 4, BRACKET: 0, HANDICAP: 0, TEAMS: 0 });
  // Nombre de poules (12/11) : s'il est choisi, il remplace « joueurs par poule » (0 = pas choisi).
  const [poolCounts, setPoolCounts] = useState<Record<TourKind, number>>({ POOLS: 0, BRACKET: 0, HANDICAP: 0, TEAMS: 0 });
  // Tournoi par equipes (24/11) : nombre d'equipes (= de coachs), championnat ou tableau entre equipes, poules d'equipes,
  // au score ou au temps (duree des matchs), regle de l'egalite ; equipes modifiees a la main (null = automatiques) et
  // coachs choisis a la main (sinon la tete de serie de chaque equipe).
  const [teamCount, setTeamCount] = useState(4);
  const [teamFormat, setTeamFormat] = useState<TeamFormat>("LEAGUE");
  const [teamGroups, setTeamGroups] = useState(1);
  const [teamMode, setTeamMode] = useState<TeamMode>("POINTS");
  const [minutes, setMinutes] = useState(6);
  const [draw, setDraw] = useState<TeamDraw>("HALF");
  const [teamLayout, setTeamLayout] = useState<string[][] | null>(null);
  const [coachPicks, setCoachPicks] = useState<string[]>([]);
  const [sets, setSets] = useState<1 | 2 | 3>(1);
  const [points, setPoints] = useState(15);
  // Bareme du handicap (13/11) : 0 = automatique, calcule au lancement sur les matchs joues de la meme longueur de set.
  const [eloPerPoint, setEloPerPoint] = useState(0);
  // Fin du set (12/11) : par defaut le premier a l'objectif gagne ; option 2 points d'ecart, plafond facultatif.
  const [deuce, setDeuce] = useState(false);
  const [cap, setCap] = useState(0);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  // Poules arrangees a la main (20/11) : null = les poules automatiques (ELO). Changer la taille ou le nombre de poules
  // repart des poules automatiques ; cocher / decocher un participant garde le reste de l'arrangement.
  const [layout, setLayout] = useState<string[][] | null>(null);
  const poolSize = poolSizes[kind];
  const poolCount = poolCounts[kind];
  const cal = calibrations[points] ?? null;
  const isTeams = kind === "TEAMS";
  const timed = isTeams && teamMode === "TIME";
  const settings = readTourSettings({ sets, points, poolSize, poolCount, eloPerPoint: eloPerPoint || cal?.eloPerPoint || HANDICAP_ELO_PER_POINT, deuce, cap, team: { mode: teamMode } }, kind);
  const hc = (gap: number) => handicapOf(1000 + gap, 1000, settings)[1];
  const byId = useMemo(() => new Map(entrants.map((e) => [e.id, e])), [entrants]);
  const chosen = useMemo(() => entrants.filter((e) => selected.has(e.id)).map((e) => ({ id: e.id, elo: e.elo })), [entrants, selected]);
  const preview = makePlayers(kind, chosen, settings);
  const groups = kind === "BRACKET" || isTeams ? [] : layout ? reconcileGroups(layout, chosen) : groupsOfPlayers(preview);
  const tooSmall = kind !== "BRACKET" && !isTeams && groups.some((p) => p.length === 1);
  // Equipes : automatiques (les meilleurs ELO = les coachs, totaux equilibres), ou arrangees a la main.
  const autoTeams = useMemo(() => (isTeams ? makeTeams(chosen, teamCount) : []), [isTeams, chosen, teamCount]);
  const teamGroupsList = isTeams ? (teamLayout ? reconcileTeams(teamLayout, chosen) : autoTeams) : [];
  const nTeams = teamGroupsList.filter((g) => g.length).length;
  const eloOfId = (id: string) => byId.get(id)?.elo ?? 1000;
  const coachOfGroup = (g: string[]) => g.find((id) => coachPicks.includes(id)) ?? [...g].sort((x, y) => eloOfId(y) - eloOfId(x) || x.localeCompare(y))[0] ?? "";
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Cocher / decocher toute une classe (16/11 : classes invitees, ou relancer un tournoi sans elles).
  const classList = [...new Set(entrants.filter((e) => !e.staff && e.className).map((e) => e.className as string))].sort((x, y) => x.localeCompare(y, "fr", { numeric: true }));
  const classIds = (c: string) => entrants.filter((e) => !e.staff && e.className === c).map((e) => e.id);
  const classOn = (c: string) => classIds(c).every((id) => selected.has(id));
  const toggleClass = (c: string) => setSelected((s) => {
    const n = new Set(s);
    const ids = classIds(c);
    const on = ids.every((id) => n.has(id));
    for (const id of ids) { if (on) n.delete(id); else n.add(id); }
    return n;
  });
  const seg = (on: boolean) => cx("text-sm font-bold px-3 py-1.5 rounded-lg whitespace-nowrap", on ? ui.segOn : ui.segOff);
  const nm = (id: string | undefined) => (id ? byId.get(id)?.name ?? "?" : "");
  function launch() {
    setError("");
    start(async () => {
      const pools = kind !== "BRACKET" && !isTeams && layout ? groups.filter((p) => p.length) : undefined;
      const teams = isTeams ? teamGroupsList.filter((g) => g.length) : undefined;
      const res = await createTournamentAction(sessionId, { kind, playerIds: [...selected], poolSize, poolCount, sets: settings.sets, points, eloPerPoint, deuce, cap: settings.cap, pools, ...(teams ? { teams, coaches: teams.map(coachOfGroup), team: { count: teams.length, format: teamFormat, groups: teamGroups, mode: teamMode, minutes, draw } } : {}) });
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
    });
  }
  const size = bracketSize(Math.max(2, chosen.length));
  return (
    <section className={`${ui.cardPad} space-y-4`}>
      <h3 className={ui.h3}>🏆 Nouveau tournoi</h3>
      <div className={cx(ui.segmented, "flex-wrap")}>
        {TOUR_KINDS.map((k) => <button key={k.id} type="button" onClick={() => setKind(k.id)} className={seg(kind === k.id)}>{k.name}</button>)}
      </div>
      <p className={ui.hint}>
        {kind === "POOLS" && "Poules par niveau (A = les meilleurs ELO) : chacun contre chacun dans sa poule, ronde par ronde."}
        {kind === "BRACKET" && "Tableau à têtes de série (selon l'ELO) : à chaque tour, les gagnants jouent les places du haut, les perdants celles du bas. Chacun joue tous les tours : classement final de 1 à N."}
        {kind === "HANDICAP" && "Chacun contre chacun ; le moins bien classé commence chaque set avec des points d'avance pour rendre les matchs serrés. À l'ELO, ces matchs comptent comme entre deux joueurs de même niveau. L'avance se recalcule après chaque match joué, avec l'ELO du moment."}
        {isTeams && "Les meilleurs ELO sont les coachs (un par équipe) ; les équipes ont le même nombre de joueurs (à un près) et des totaux d'ELO les plus proches possible. À chaque rencontre, les têtes de série s'affrontent (1er contre 1er, 2e contre 2e…) ; un joueur en trop affronte le plus proche de son ELO. Chaque victoire rapporte à l'équipe les points ELO gagnés ; une défaite ne rapporte rien."}
      </p>
      {/* Reglages : ils passent a la ligne au lieu de se chevaucher (12/11 : « l onglet pour regler le nombre de sets se chevauche »). */}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {isTeams && (
          <div>
            <span className={ui.label}>Nombre d&apos;équipes (= de coachs)</span>
            <div className={ui.segmented}>{TEAM_COUNTS.map((n) => <button key={n} type="button" onClick={() => { setTeamCount(n); setTeamLayout(null); setCoachPicks([]); }} className={seg(teamCount === n)}>{n}</button>)}</div>
          </div>
        )}
        {isTeams && (
          <div>
            <span className={ui.label}>Rencontres entre équipes</span>
            <div className={ui.segmented}>
              <button type="button" onClick={() => setTeamFormat("LEAGUE")} className={seg(teamFormat === "LEAGUE")}>Championnat</button>
              <button type="button" onClick={() => setTeamFormat("BRACKET")} className={seg(teamFormat === "BRACKET")}>Tableau (1/4, 1/2, finale…)</button>
            </div>
          </div>
        )}
        {isTeams && teamFormat === "LEAGUE" && nTeams >= 4 && (
          <div>
            <span className={ui.label}>Poules d&apos;équipes</span>
            <div className={ui.segmented}>{TEAM_GROUPS.filter((g) => g <= Math.floor(nTeams / 2)).map((g) => <button key={g} type="button" onClick={() => setTeamGroups(g)} className={seg(Math.min(teamGroups, Math.floor(nTeams / 2)) === g)}>{g === 1 ? "Toutes ensemble" : `${g} poules`}</button>)}</div>
          </div>
        )}
        {isTeams && (
          <div>
            <span className={ui.label}>Jeu</span>
            <div className={ui.segmented}>
              <button type="button" onClick={() => setTeamMode("POINTS")} className={seg(teamMode === "POINTS")}>Au score</button>
              <button type="button" onClick={() => setTeamMode("TIME")} className={seg(teamMode === "TIME")}>⏱️ Au temps</button>
            </div>
            {timed && (
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${ui.input} mt-1`} aria-label="Durée des matchs">
                {TEAM_MINUTES.map((m) => <option key={m} value={m}>{m} min par match</option>)}
              </select>
            )}
          </div>
        )}
        {isTeams && (timed || settings.sets === 2) && (
          <div>
            <span className={ui.label}>Égalité</span>
            <div className={ui.segmented}>
              <button type="button" onClick={() => setDraw("HALF")} className={seg(draw === "HALF")}>½ victoire chacun</button>
              <button type="button" onClick={() => setDraw("ELO")} className={seg(draw === "ELO")}>ELO strict</button>
            </div>
            <span className={ui.hint}>{draw === "HALF" ? "Chacun rapporte la moitié de ce qu'une victoire lui aurait rapporté." : "Ce que l'ELO donne : le moins bien classé gagne un peu, l'autre rien."}</span>
          </div>
        )}
        {kind !== "BRACKET" && !isTeams && (
          <div>
            <span className={ui.label}>Joueurs par poule</span>
            <div className={ui.segmented}>{TOUR_POOL_SIZES.map((n) => <button key={n} type="button" onClick={() => { setPoolSizes((s) => ({ ...s, [kind]: n })); setPoolCounts((s) => ({ ...s, [kind]: 0 })); setLayout(null); }} className={seg(!poolCount && poolSize === n)}>{n || "Tous"}</button>)}</div>
          </div>
        )}
        {kind !== "BRACKET" && !isTeams && (
          <div>
            <span className={ui.label}>… ou nombre de poules</span>
            <div className={ui.segmented}>{TOUR_POOL_COUNTS.map((n) => <button key={n} type="button" onClick={() => { setPoolCounts((s) => ({ ...s, [kind]: s[kind] === n ? 0 : n })); setLayout(null); }} className={seg(poolCount === n)}>{n}</button>)}</div>
          </div>
        )}
        {!timed && <div>
          <span className={ui.label}>Sets par match</span>
          <div className={ui.segmented}>
            <button type="button" onClick={() => setSets(1)} className={seg(settings.sets === 1)}>1 set</button>
            {kind !== "BRACKET" && <button type="button" onClick={() => setSets(2)} className={seg(settings.sets === 2)}>2 sets</button>}
            <button type="button" onClick={() => setSets(3)} className={seg(settings.sets === 3)}>Au meilleur des 3</button>
          </div>
        </div>}
        {!timed && <div>
          <span className={ui.label}>Points par set</span>
          <div className={ui.segmented}>{TOUR_POINTS.map((n) => <button key={n} type="button" onClick={() => setPoints(n)} className={seg(points === n)}>{n}</button>)}</div>
        </div>}
        {!timed && <div>
          <span className={ui.label}>Fin du set</span>
          <div className={ui.segmented}>
            <button type="button" onClick={() => setDeuce(false)} className={seg(!deuce)}>Premier à {points}</button>
            <button type="button" onClick={() => setDeuce(true)} className={seg(deuce)}>2 points d&apos;écart</button>
          </div>
          {deuce && (
            <select value={settings.cap} onChange={(e) => setCap(Number(e.target.value))} className={`${ui.input} mt-1`} aria-label="Plafond">
              <option value={0}>sans plafond</option>
              {TOUR_CAPS.filter((c) => c > points).map((c) => <option key={c} value={c}>max {c}</option>)}
            </select>
          )}
        </div>}
        {kind === "HANDICAP" && (
          <div>
            <span className={ui.label}>1 point d&apos;avance pour … d&apos;ELO d&apos;écart</span>
            <select value={eloPerPoint} onChange={(e) => setEloPerPoint(Number(e.target.value))} className={ui.input}>
              <option value={0}>Automatique{cal ? ` : ${cal.eloPerPoint}` : ""}</option>
              {TOUR_ELO_PER_POINT.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className={ui.hint}>
              {eloPerPoint === 0 && (cal ? `Calculé sur les matchs joués, ${calibrationText(cal, points)} ; recalculé au lancement puis figé pour le tournoi. ` : "Calculé au lancement sur les matchs joués. ")}
              Valeur pour un set de 15. En {points} points : écart de 50 d&apos;ELO → +{hc(50)}, 100 → +{hc(100)}, 200 → +{hc(200)} (au plus la moitié du set).
            </span>
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className={ui.label}>Participants · {selected.size} coché{selected.size > 1 ? "s" : ""} sur {entrants.length} · décochez les absents et ceux qui arbitrent</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSelected(new Set(entrants.filter((e) => e.present).map((e) => e.id)))} className={btn.smGhost}>Ceux qui ont joué aujourd&apos;hui</button>
            <button type="button" onClick={() => setSelected(new Set(entrants.map((e) => e.id)))} className={btn.smGhost}>Tout cocher</button>
            <button type="button" onClick={() => setSelected(new Set())} className={btn.smGhost}>Tout décocher</button>
          </div>
        </div>
        {classList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className={ui.hint}>Par classe :</span>
            {classList.map((c) => <button key={c} type="button" aria-pressed={classOn(c)} onClick={() => toggleClass(c)} className={cx(ui.chip, classOn(c) ? ui.chipBrand : ui.chipMuted, "text-sm py-1")}>{classOn(c) ? "✓ " : ""}{c} ({classIds(c).length})</button>)}
          </div>
        )}
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 max-h-80 overflow-auto rounded-xl border border-line p-2">
          {entrants.map((e) => (
            <label key={e.id} className={cx("flex items-center gap-2 rounded-lg px-2 py-1 text-sm cursor-pointer", selected.has(e.id) ? "bg-brand-soft" : "hover:bg-paper")}>
              <input type="checkbox" className={ui.check} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="flex-1 min-w-0 truncate">{e.name} <span className="text-ink-3 text-xs">{e.className}</span></span>
              <span className="tabular-nums text-xs text-ink-2">{e.elo}</span>
            </label>
          ))}
        </div>
      </div>

      {preview.length > 1 && kind !== "BRACKET" && !isTeams && (
        <PoolEditor groups={groups} manual={!!layout} onChange={setLayout} onReset={() => setLayout(null)} nm={nm} eloOf={(id) => byId.get(id)?.elo ?? 1000} handicap={kind === "HANDICAP" ? (top, me) => handicapOf(top, me, settings)[1] : null} />
      )}
      {isTeams && chosen.length >= 2 && (
        <PoolEditor
          groups={teamGroupsList}
          manual={!!teamLayout}
          onChange={setTeamLayout}
          onReset={() => { setTeamLayout(null); setCoachPicks([]); }}
          nm={nm}
          eloOf={eloOfId}
          handicap={null}
          team={{ coachOf: coachOfGroup, onCoach: (i, id) => setCoachPicks((p) => [...p.filter((x) => !teamGroupsList[i]?.includes(x)), id]) }}
        />
      )}
      {preview.length > 1 && kind === "BRACKET" && (
        <div>
          <span className={ui.label}>Aperçu : tableau de {size} places, {Math.log2(size)} tours, {size - preview.length} exempt{size - preview.length > 1 ? "s" : ""} (pour les meilleures têtes de série)</span>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            {seedOrder(size).reduce<[number, number][]>((acc, s, i, arr) => (i % 2 ? acc : [...acc, [s, arr[i + 1]]]), []).map(([x, y], i) => {
              const px = preview.find((p) => p.seed === x);
              const py = preview.find((p) => p.seed === y);
              return <p key={i} className="rounded-lg bg-paper px-2 py-1"><span className="text-ink-3 tabular-nums">{x}.</span> {nm(px?.studentId)} – {py ? <><span className="text-ink-3 tabular-nums">{y}.</span> {nm(py.studentId)}</> : <span className="text-ink-3">exempt</span>}</p>;
            })}
          </div>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      {tooSmall && <p className={ui.alertWarn}>Une poule n&apos;a qu&apos;un joueur : ajoutez-lui un adversaire, ou mettez ce joueur dans une autre poule.</p>}
      {isTeams && chosen.length >= 2 && nTeams < 2 && <p className={ui.alertWarn}>Il faut au moins 2 équipes.</p>}
      <button type="button" disabled={pending || selected.size < 2 || tooSmall || (isTeams && nTeams < 2)} onClick={launch} className={btn.primary}>{pending ? "Lancement…" : "🏆 Lancer le tournoi"}</button>
      <p className={ui.hint}>Chaque élève voit son prochain adversaire sur son téléphone{isTeams ? " (et son équipe, son coach, le chrono)" : ""}. Les élèves encodent leurs matchs comme d&apos;habitude (ou un arbitre) ; ils comptent aussi au classement ELO.</p>
    </section>
  );
}

// Poules modifiables avant le lancement (Sartay 20/11 : « deplacer certains noms dans d'autres poules, pour que la poule
// la plus nombreuse soit une autre, intervertir deux joueurs… modifier les poules a mon bon vouloir avant de lancer »).
// Souris : glisser un nom sur une autre poule = le deplacer ; sur un autre nom = les echanger. Au doigt (le glisser-deposer
// ne marche pas sur telephone) : toucher un nom, puis un autre nom (echange) ou « ↓ Ici » (deplacement).
// Equipes (24/11, Sartay : « il faut a nouveau pouvoir parametrer les groupes, drag and drop etc. ») : le meme editeur ;
// `team` : le coach de chaque equipe (👑) et « 👑 Coach » pour nommer le nom touche ; total et moyenne d'ELO par equipe.
function PoolEditor({ groups, manual, onChange, onReset, nm, eloOf, handicap, team }: { groups: string[][]; manual: boolean; onChange: (g: string[][]) => void; onReset: () => void; nm: (id: string) => string; eloOf: (id: string) => number; handicap: ((topElo: number, myElo: number) => number) | null; team?: { coachOf: (g: string[]) => string; onCoach: (index: number, id: string) => void } }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const poolOf = (id: string) => groups.findIndex((p) => p.includes(id));
  const pick = picked && poolOf(picked) >= 0 ? picked : null;
  const move = (id: string, to: number) => {
    const from = poolOf(id);
    if (from < 0 || from === to) return;
    onChange(groups.map((p, i) => (i === from ? p.filter((x) => x !== id) : i === to ? [...p, id] : p)));
  };
  const swap = (a: string, b: string) => {
    const pa = poolOf(a), pb = poolOf(b);
    if (pa < 0 || pb < 0 || pa === pb) return;
    onChange(groups.map((p, i) => (i === pa ? p.map((x) => (x === a ? b : x)) : i === pb ? p.map((x) => (x === b ? a : x)) : p)));
  };
  const tap = (id: string) => {
    if (!pick || pick === id) return setPicked(pick === id ? null : id);
    if (poolOf(pick) === poolOf(id)) return setPicked(id); // meme poule : on change simplement de nom choisi
    swap(pick, id);
    setPicked(null);
  };
  const dropped = (e: React.DragEvent) => e.dataTransfer.getData("text/plain") || dragId;
  const endDrag = () => { setDragId(null); setOver(null); };
  const sizes = groups.map((p) => p.length).filter(Boolean);
  const unit = team ? "équipe" : "poule";
  const totals = groups.filter((g) => g.length).map((g) => g.reduce((s, id) => s + eloOf(id), 0));
  const avgs = groups.filter((g) => g.length).map((g) => g.reduce((s, id) => s + eloOf(id), 0) / g.length);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={ui.label}>
          Aperçu : {sizes.length} {unit}{sizes.length > 1 ? "s" : ""}
          {manual ? <span className={cx(ui.chip, ui.chipAccent, "ml-2")}>✋ modifiées à la main</span> : team ? " (👑 coachs = les meilleurs ELO)" : sizes.length > 1 ? " (A = les meilleurs ELO)" : ""}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onChange([...groups, []])} className={btn.smGhost}>＋ Nouvelle {unit}</button>
          {manual && <button type="button" onClick={() => { setPicked(null); onReset(); }} className={btn.smGhost}>↺ {team ? "Équipes automatiques" : "Poules automatiques (ELO)"}</button>}
        </div>
      </div>
      {team && totals.length > 1 && <p className={ui.hint}>Totaux d&apos;ELO de {Math.min(...totals)} à {Math.max(...totals)} (écart {Math.max(...totals) - Math.min(...totals)}) · moyennes de {Math.round(Math.min(...avgs))} à {Math.round(Math.max(...avgs))}{new Set(sizes).size > 1 ? " · les équipes n'ont pas toutes le même nombre de joueurs : comparez les moyennes" : ""}.</p>}
      <p className={ui.hint}>Pour modifier : glissez un nom vers une autre {unit} pour le <b>déplacer</b>, ou sur un autre nom pour les <b>échanger</b>. Au doigt : touchez un nom, puis un autre nom (échange) ou « ↓ Ici » sur une {unit} (déplacement).{team ? " Pour changer de coach : touchez un nom, puis « 👑 Coach »." : ""}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g, i) => {
          const members = [...g].sort((a, b) => eloOf(b) - eloOf(a) || a.localeCompare(b));
          const top = members[0];
          const n = members.length;
          const zone = `p${i}`;
          const coach = team && n ? team.coachOf(g) : null;
          return (
            <div
              key={i}
              onDragOver={(e) => { e.preventDefault(); if (over !== zone) setOver(zone); }}
              onDrop={(e) => { e.preventDefault(); const id = dropped(e); if (id) move(id, i); endDrag(); }}
              className={cx("rounded-xl border-2 p-2 text-sm transition-colors", over === zone ? "border-brand bg-brand-soft" : n === 1 && !team ? "border-danger/60" : "border-line")}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                {team ? (
                  <p className="font-display font-extrabold">Équipe {POOL_NAMES[i] ?? i + 1} · {n} joueur{n > 1 ? "s" : ""}{n ? <span className="font-sans font-normal text-xs text-ink-3"> · total {g.reduce((s, id) => s + eloOf(id), 0)} · moy. {Math.round(g.reduce((s, id) => s + eloOf(id), 0) / n)}</span> : null}</p>
                ) : (
                  <p className="font-display font-extrabold">Poule {POOL_NAMES[i] ?? i + 1} · {n} joueur{n > 1 ? "s" : ""}{n >= 2 ? `, ${n - 1 + (n % 2)} rondes` : ""}</p>
                )}
                {team && pick && poolOf(pick) === i && pick !== coach && <button type="button" onClick={() => { team.onCoach(i, pick); setPicked(null); }} className={btn.smPrimary}>👑 Coach</button>}
                {pick && poolOf(pick) !== i && <button type="button" onClick={() => { move(pick, i); setPicked(null); }} className={btn.smPrimary}>↓ Ici</button>}
                {!n && !pick && <button type="button" onClick={() => onChange(groups.filter((_, j) => j !== i))} className={btn.smGhost} title="Retirer cette poule vide">✕</button>}
              </div>
              {members.map((id) => (
                <button
                  type="button"
                  key={id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; setDragId(id); setPicked(null); }}
                  onDragEnd={endDrag}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (over !== `j${id}`) setOver(`j${id}`); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const from = dropped(e); if (from && from !== id) { if (poolOf(from) === i) move(from, i); else swap(from, id); } endDrag(); }}
                  onClick={() => tap(id)}
                  className={cx("w-full flex justify-between gap-2 rounded-lg px-1.5 py-1 text-left cursor-grab select-none", pick === id ? "bg-brand text-white" : over === `j${id}` && dragId && poolOf(dragId) !== i ? "bg-accent-soft ring-2 ring-accent" : dragId === id ? "opacity-40" : "hover:bg-paper")}
                  title="Glisser vers une autre poule, ou sur un autre nom pour échanger"
                >
                  <span className="truncate"><span className={pick === id ? "text-white/70" : "text-ink-3"} aria-hidden>⠿ </span>{coach === id && <span title="Coach">👑 </span>}{nm(id)}</span>
                  <span className={cx("tabular-nums", pick === id ? "text-white/80" : "text-ink-3")}>{Math.round(eloOf(id))}{handicap && id !== top ? ` · +${handicap(eloOf(top), eloOf(id))} contre ${nm(top).split(" ")[0]}` : ""}</span>
                </button>
              ))}
              {(dragId || pick) && poolOf(dragId ?? pick ?? "") !== i && <p className="mt-1 rounded-lg border border-dashed border-line-2 px-2 py-1 text-center text-xs text-ink-3">{dragId ? `Lâchez ici pour déplacer dans cette ${unit}` : `« ↓ Ici » pour déplacer dans cette ${unit}`}</p>}
              {n === 0 && !dragId && !pick && <p className={ui.hint}>{team ? "Équipe vide" : "Poule vide"} : glissez des noms ici. Restée vide, elle est ignorée au lancement.</p>}
              {n === 1 && !team && <p className="text-xs text-danger-ink mt-1">Un seul joueur : il en faut au moins 2.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TournamentBoard({ t, closed = false, candidates = [] }: { t: TourView; closed?: boolean; candidates?: TourCandidate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [lateId, setLateId] = useState("");
  function addLate() {
    if (!lateId) return;
    setError("");
    start(async () => {
      const res = await addLatePlayerAction(t.id, lateId);
      if ("error" in res) setError(res.error);
      else { setLateId(""); router.refresh(); }
    });
  }
  const [goneId, setGoneId] = useState("");
  // Score final (12/11) : regle par defaut du tournoi, objectif d'une poule ou d'un match.
  function setRule(patch: Parameters<typeof setTournamentRuleAction>[1]) {
    setError("");
    start(async () => {
      const res = await setTournamentRuleAction(t.id, patch);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  function setGone(id: string, gone: boolean) {
    if (!id) return;
    if (gone && !confirm(`${t.names[id]?.name ?? "Ce joueur"} quitte le tournoi ? Ses matchs pas encore joués sortent de l'ordre ; ses matchs joués restent. Vous pourrez le remettre s'il revient.`)) return;
    setError("");
    start(async () => {
      const res = await setPlayerGoneAction(t.id, id, gone);
      if ("error" in res) setError(res.error);
      else { setGoneId(""); router.refresh(); }
    });
  }
  // Toute une classe part, ou revient (16/11 : des classes invitees seulement pour une partie du cours).
  const classesIn = [...new Set(Object.values(t.names).map((n) => n.className).filter((c): c is string => !!c && c !== "prof"))].sort((x, y) => x.localeCompare(y, "fr", { numeric: true }));
  const idsOfClass = (c: string) => Object.entries(t.names).filter(([, n]) => n.className === c).map(([id]) => id);
  function setClassGone(c: string, gone: boolean) {
    const ids = idsOfClass(c).filter((id) => t.gone.includes(id) !== gone);
    if (!ids.length) return;
    if (gone && !confirm(`Les ${ids.length} joueurs de ${c} quittent le tournoi ? Leurs matchs pas encore joués sortent de l'ordre ; leurs matchs joués restent. Vous pourrez les remettre.`)) return;
    setError("");
    start(async () => {
      const res = await setPlayersGoneAction(t.id, ids, gone);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  function close() {
    if (!confirm("Clore le tournoi ? Il restera consultable et ses matchs restent comptés ; vous pourrez en lancer un autre.")) return;
    setError("");
    start(async () => {
      const res = await closeTournamentAction(t.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  const pools = t.pools ?? [];
  const timed = t.kind === "TEAMS" && t.settings.team?.mode === "TIME";
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={ui.h3}>🏆 {t.label}</h3>
          <p className={ui.hint}>
            {t.format}
            {t.teams ? ` · ${t.teams.done ? "terminé" : "en cours"}` : t.bracket ? ` · tableau de ${t.bracket.size} places · ${t.bracket.done ? "terminé" : "en cours"}` : ` · ${pools.filter((p) => p.done).length}/${pools.length} poule${pools.length > 1 ? "s" : ""} terminée${pools.length > 1 ? "s" : ""}`}
          </p>
          {t.kind === "HANDICAP" && (
            <p className={ui.hint}>
              ⚖️ Handicap : 1 point d&apos;avance pour {t.settings.eloPerPoint} d&apos;ELO d&apos;écart (pour un set de 15)
              {t.settings.calibration ? `, calculé ${calibrationText(t.settings.calibration, t.settings.points)}` : ", choisi à la main"}
              {" "}· avec l&apos;ELO du moment, recalculé après chaque match joué
            </p>
          )}
        </div>
        {!closed && <button type="button" disabled={pending} onClick={close} className={btn.smGhost}>Clore le tournoi</button>}
      </div>
      {!closed && timed && t.teams && <TeamTimerPanel t={t} />}
      {!closed && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">🏟️ Terrains :</span>
            <select value={t.settings.courts} disabled={pending} onChange={(e) => setRule({ courts: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Nombre de terrains">
              {[...new Set([...COURT_COUNTS, t.settings.courts])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n} terrains</option>)}
            </select>
            <select value={t.settings.perCourt} disabled={pending} onChange={(e) => setRule({ perCourt: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Matchs par terrain">
              <option value={1}>1 match par terrain</option>
              <option value={2}>2 matchs par terrain (demi-terrains A et B)</option>
            </select>
          </div>
          <p className={ui.hint}>L&apos;app donne un terrain à chaque match : les joueurs d&apos;une même poule (ou d&apos;une même rencontre) côte à côte. Un match garde son terrain ; s&apos;il n&apos;y en a pas assez, les matchs attendent et prennent le premier qui se libère dans leur bloc.</p>
        </div>
      )}
      {!closed && !timed && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">🎯 Score final :</span>
            <select value={t.settings.points} disabled={pending} onChange={(e) => setRule({ points: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Score final par défaut">
              {TOUR_POINTS.map((n) => <option key={n} value={n}>{n} points</option>)}
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" className={ui.check} checked={t.settings.deuce} disabled={pending} onChange={(e) => setRule({ deuce: e.target.checked })} /> 2 points d&apos;écart</label>
            {t.settings.deuce && (
              <select value={t.settings.cap} disabled={pending} onChange={(e) => setRule({ cap: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Plafond du tournoi">
                <option value={0}>sans plafond</option>
                {TOUR_CAPS.filter((c) => c > t.settings.points).map((c) => <option key={c} value={c}>max {c}</option>)}
              </select>
            )}
          </div>
          <p className={ui.hint}>Pour tous les matchs du tournoi ; {t.teams ? "un match" : "une poule ou un match"} peut avoir son propre score (menus « pts » ci-dessous). Les matchs déjà joués ne changent pas.</p>
        </div>
      )}
      {!closed && t.kind === "HANDICAP" && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">⚖️ Barème :</span>
            <span>1 point d&apos;avance pour</span>
            <select value={t.settings.eloPerPoint} disabled={pending} onChange={(e) => setRule({ eloPerPoint: Number(e.target.value) })} className={`${ui.input} w-auto`} aria-label="Barème du handicap">
              {[...new Set([t.settings.eloPerPoint, ...TOUR_ELO_PER_POINT])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}</option>)}
              <option value={0}>↻ recalculer sur les matchs joués</option>
            </select>
            <span>d&apos;ELO d&apos;écart (pour un set de 15)</span>
          </div>
          <p className={ui.hint}>Pour tous les matchs pas encore commencés (un barème plus petit = plus d&apos;avance). Un match peut avoir son avance imposée (menus « ⚖️ » ci-dessous).</p>
        </div>
      )}
      {!closed && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm">🚪 Joueur parti :</span>
            <select value={goneId} onChange={(e) => setGoneId(e.target.value)} className={`${ui.input} w-auto`} aria-label="Joueur parti">
              <option value="">Choisir un joueur…</option>
              {Object.entries(t.names).filter(([id]) => !t.gone.includes(id)).sort((a, b) => a[1].name.localeCompare(b[1].name, "fr")).map(([id, n]) => <option key={id} value={id}>{n.name}{n.className ? ` (${n.className})` : ""}</option>)}
            </select>
            <button type="button" disabled={pending || !goneId} onClick={() => setGone(goneId, true)} className={btn.smGhost}>Retirer du tournoi</button>
          </div>
          {classesIn.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="font-bold">🚪 Toute une classe :</span>
              {classesIn.map((c) => {
                const ids = idsOfClass(c);
                const left = ids.filter((id) => !t.gone.includes(id)).length;
                return (
                  <span key={c} className="inline-flex gap-1">
                    {left > 0 && <button type="button" disabled={pending} onClick={() => setClassGone(c, true)} className={btn.smGhost}>Les {c} partent ({left})</button>}
                    {left < ids.length && <button type="button" disabled={pending} onClick={() => setClassGone(c, false)} className={btn.smGhost}>↩ Remettre les {c}</button>}
                  </span>
                );
              })}
            </div>
          )}
          {t.gone.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className={ui.hint}>Partis :</span>
              {t.gone.map((id) => <span key={id} className="inline-flex flex-wrap items-center gap-1"><span className={cx(ui.chip, ui.chipMuted)}>{t.names[id]?.name ?? "?"} <button type="button" disabled={pending} onClick={() => setGone(id, false)} className="underline ml-1">↩ remettre</button></span>{t.teams && t.settings.team && <SubPicker t={t} outId={id} />}</span>)}
            </div>
          )}
          <p className={ui.hint}>{t.teams ? "Pour un élève qui doit partir avant la fin : il sort des rencontres pas encore commencées (les matchs sont refaits sans lui) ; dans la rencontre en cours, ses matchs pas encore joués ne rapportent rien. « 🔁 Remplaçant » : un joueur d'une autre partie du tableau (ou d'une autre poule), de préférence qui a déjà joué son match et du même niveau, joue à sa place ; ses points vont à l'équipe du joueur parti. Rien n'est effacé." : <>Pour un élève qui doit partir avant la fin (blessé, rendez-vous…) : ses matchs pas encore joués sortent de l&apos;ordre, plus personne ne l&apos;attend{t.bracket ? " (au tableau, son adversaire passe)" : ""}. Rien n&apos;est effacé.</>}</p>
        </div>
      )}
      {!closed && candidates.length > 0 && (
        <div className={`${ui.cardPad} space-y-1`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm">＋ Retardataire :</span>
            <select value={lateId} onChange={(e) => setLateId(e.target.value)} className={`${ui.input} w-auto`} aria-label="Retardataire">
              <option value="">Choisir un élève…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.className ? ` (${c.className})` : ""}</option>)}
            </select>
            <button type="button" disabled={pending || !lateId} onClick={addLate} className={btn.smPrimary}>Ajouter au tournoi</button>
          </div>
          <p className={ui.hint}>{t.teams ? "Il rejoint l'équipe qui a le moins de joueurs présents et joue à partir de la prochaine rencontre de son équipe pas encore commencée." : t.bracket ? "Il prend la dernière tête de série, à la place d'un exempt (possible tant que le joueur qu'il affronte n'a pas encore joué)." : "Il rejoint la poule la plus proche de son ELO et joue des matchs de rattrapage contre chacun, quand ils sont libres ; les rondes des autres ne changent pas."}</p>
        </div>
      )}
      {error && <p className={ui.alertErr}>{error}</p>}
      <PlayerSearch t={t} />
      {t.teams ? <TeamsBoard st={t.teams} t={t} onRule={closed || timed ? undefined : setRule} /> : t.bracket ? <BracketBoard b={t.bracket} names={t.names} t={t} onRule={closed ? undefined : setRule} /> : <PoolsBoard pools={pools} names={t.names} t={t} onRule={closed ? undefined : setRule} />}
    </section>
  );
}

// Remplacant d'un joueur parti (26/11, Sartay : « un joueur d'une autre poule, du meme niveau, qui n'est pas dans la meme
// partie du tableau et qui a deja joue son match ») : la liste vient de subCandidates (meilleurs choix d'abord).
function SubPicker({ t, outId }: { t: TourView; outId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const c = subCandidates(t.teams!, t.players, t.settings.team!.subs, outId);
  if (c.round === null) return null;
  const pick = (v: string) => {
    setError("");
    start(async () => {
      const r = await setTeamSubAction(t.id, outId, v || null);
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select value={c.current ?? ""} disabled={pending} onChange={(e) => pick(e.target.value)} className="text-xs rounded border border-line px-1 py-0.5 max-w-[16rem]" aria-label={`Remplaçant de ${t.names[outId]?.name ?? "?"}`}>
        <option value="">🔁 Remplaçant (ronde {c.round})…</option>
        {c.list.map((x) => <option key={x.id} value={x.id}>{t.names[x.id]?.name ?? "?"} · équipe {x.team} · {x.elo}{x.played ? " · a joué" : " · joue encore"}</option>)}
      </select>
      {error && <span className="text-xs text-danger-ink">{error}</span>}
    </span>
  );
}

// Recherche par joueur (17/11, Sartay : « dans un tournoi, quand on consulte les matchs joues, il faudrait pouvoir faire
// une recherche par joueur pour voir tous ses scores ») : tous ses matchs du tournoi, dans l'ordre, score de SON cote.
type PlayerRow = { label: string; opp: string | null | undefined; status: string; sets: [number, number][] | null; result: "V" | "D" | "N" | null };
function PlayerSearch({ t }: { t: TourView }) {
  const [q, setQ] = useState("");
  const f = fold(q.trim());
  const hits = f.length < 2 ? [] : Object.entries(t.names).filter(([, n]) => fold(n.name).includes(f)).sort((a, b) => a[1].name.localeCompare(b[1].name, "fr")).slice(0, 6);
  const nm = (id: string | null | undefined) => (id ? t.names[id]?.name ?? "?" : id === null ? "exempt" : "…");
  const rowOf = (label: string, x: { a: string | null | undefined; b: string | null | undefined; status: string; sets: [number, number][] | null; winner: "A" | "B" | "DRAW" | null }, id: string): PlayerRow => {
    const meA = x.a === id;
    const sets = x.sets ? (meA ? x.sets : x.sets.map(([p, q2]) => [q2, p] as [number, number])) : null;
    const played = x.status === "played" || x.status === "tie";
    const result = !played ? null : x.winner === "DRAW" || x.winner === null ? "N" : (x.winner === "A") === meA ? "V" : "D";
    return { label, opp: meA ? x.b : x.a, status: x.status, sets, result };
  };
  const rowsOf = (id: string): PlayerRow[] => {
    const out: PlayerRow[] = [];
    for (const p of t.pools ?? []) {
      for (const r of p.rounds) for (const x of r.pairings) if (x.a === id || x.b === id) out.push(rowOf(`R${r.n}`, x, id));
      for (const x of p.catchUp) if (x.a === id || x.b === id) out.push(rowOf("Ratt.", x, id));
    }
    for (const r of t.bracket?.rounds ?? []) for (const g of r.groups) for (const x of g.pairings) if (x.a === id || x.b === id) out.push(rowOf(`Tour ${r.n}`, { ...x, winner: x.winner }, id));
    for (const r of t.teams?.rounds ?? []) for (const x of r.rencontres) for (const m of x.matches) if (m.a === id || m.b === id) out.push(rowOf(`${t.teams!.format === "BRACKET" ? "Tour " : "R"}${r.n}`, m, id));
    return out;
  };
  const rankOf = (id: string) => {
    const team = t.teams?.teams.find((x) => x.members.some((m) => m.id === id));
    if (team) { const me = team.members.find((m) => m.id === id)!; return `équipe ${team.letter}${team.coach === id ? " (coach)" : ""} · +${me.pts} pour l'équipe`; }
    const pool = t.pools?.find((p) => p.players.includes(id));
    if (pool) { const s = pool.standings.find((x) => x.id === id); return s ? `${t.pools!.length > 1 ? `poule ${pool.name} · ` : ""}${s.rank}e sur ${pool.standings.length}` : ""; }
    const r = t.bracket?.ranks.find((x) => x.id === id);
    return r ? (r.rank ? `${r.rank}e` : r.lo === r.hi ? `place ${r.lo}` : `places ${r.lo} à ${r.hi}`) : "";
  };
  return (
    <div className={`${ui.cardPad} space-y-2`}>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">🔎 Les matchs d&apos;un joueur :</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou prénom…" className={`${ui.input} w-auto min-w-[12rem]`} aria-label="Rechercher les matchs d'un joueur" />
      </label>
      {f.length >= 2 && hits.length === 0 && <p className={ui.hint}>Aucun joueur du tournoi ne correspond.</p>}
      {hits.map(([id, n]) => {
        const rows = rowsOf(id).filter((r) => r.status !== "bye" || r.opp);
        const won = rows.filter((r) => r.result === "V").length;
        const lost = rows.filter((r) => r.result === "D").length;
        const drawn = rows.filter((r) => r.result === "N").length;
        return (
          <div key={id} className="rounded-lg bg-paper px-2 py-1.5 text-sm" data-player={id}>
            <p className="font-bold">{n.name} <span className="text-ink-3 text-xs font-normal">{n.className} · {rankOf(id)} · {won} V – {drawn ? `${drawn} N – ` : ""}{lost} D</span></p>
            <ol className="mt-1 space-y-0.5">
              {rows.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-ink-3 text-xs tabular-nums w-12">{r.label}</span>
                  <span>contre <b>{nm(r.opp)}</b></span>
                  <span className="tabular-nums font-bold">{r.sets ? r.sets.map(([a, b]) => `${a}-${b}`).join(" ") : ""}</span>
                  <span className="text-xs">{r.result === "V" ? "✅ gagné" : r.result === "D" ? "❌ perdu" : r.result === "N" ? "🤝 égalité" : tagOf(r.status)}</span>
                </li>
              ))}
              {rows.length === 0 && <li className={ui.hint}>Aucun match pour l&apos;instant.</li>}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

const tagOf = (status: string) => (status === "gone" ? "🚪 parti" : status === "played" ? "✅" : status === "live" ? "🔴 en direct" : status === "disputed" ? "⚠️ contesté" : status === "tie" ? "⚖️ égalité : à départager" : status === "wait" ? "" : "⏳");

// Objectif d'un match a part : menu « pts » (valeur vide = celui de la poule ou du tournoi).
type OnRule = (patch: Parameters<typeof setTournamentRuleAction>[1]) => void;
function MatchPoints({ t, a, b, onRule }: { t: TourView; a: string; b: string; onRule?: OnRule }) {
  const own = t.settings.matchPoints[pairKey(a, b)];
  const pool = t.players.find((p) => p.studentId === a)?.pool;
  const base = (pool && t.settings.poolPoints[pool]) || t.settings.points;
  if (!onRule) return own ? <span className="text-xs text-accent-ink"> · {own} pts</span> : null;
  return (
    <select value={own ?? ""} onChange={(e) => onRule({ match: { a, b, points: e.target.value ? Number(e.target.value) : null } })} className={cx("ml-1 text-xs rounded border px-1 py-0", own ? "border-accent text-accent-ink font-bold" : "border-line text-ink-3")} aria-label="Score final de ce match">
      <option value="">{base} pts</option>
      {TOUR_POINTS.filter((n) => n !== base).map((n) => <option key={n} value={n}>{n} pts</option>)}
    </select>
  );
}

// Contraintes d'UN match (Sartay 26/11 soir : « pour la lecon ou pour des matchs en particulier ») : ⚖️ handicap, 🎯 mises,
// 🎲 theme. Pastille pleine = oui pour ce match ; un toucher inverse ; cerclee = imposee pour ce match (sinon : comme la lecon).
// Terrain d'une rencontre en cours ou a jouer (27/11) : « 🏟️ 3 », ou « ⏳ terrain » s'il faut attendre qu'un se libere.
function CourtTag({ t, a, b }: { t: TourView; a: string | null | undefined; b: string | null | undefined }) {
  if (!a || !b || !t.courts) return null;
  const k = pairKey(a, b);
  if (!(k in t.courts)) return null;
  const c = t.courts[k];
  return <span className={cx("ml-1 text-xs rounded px-1 font-bold whitespace-nowrap", c ? "bg-brand-soft text-brand-ink" : "bg-line text-ink-2")} title={c ? `Terrain ${c}` : "En attente d'un terrain libre"}>{c ? `🏟️ ${c}` : "⏳ terrain"}</span>;
}
function PairRulePick({ t, a, b, onRule }: { t: TourView; a: string; b: string; onRule: OnRule }) {
  const r = t.settings.pairRules[pairKey(a, b)] ?? {};
  const chip = (key: "handicap" | "bet" | "theme", emoji: string, name: string) => {
    const base = !!t.lesson?.[key];
    if (key === "theme" && !base && r.theme === undefined) return null; // pas de theme dans la lecon : rien a retirer
    if (key === "handicap" && t.kind === "HANDICAP") return null; // le championnat a handicap a deja le sien
    const own = r[key];
    const on = own ?? base;
    const flip = () => onRule({ pairRule: { a, b, key, value: !on === base ? null : !on } });
    return <button key={key} type="button" onClick={flip} title={`${name} : ${on ? "oui" : "non"} pour ce match ${own !== undefined ? "(imposé ici)" : "(comme la leçon)"} · toucher pour changer`} aria-label={`${name} de ce match : ${on ? "oui" : "non"}`} className={cx("ml-1 text-xs rounded border px-1 py-0", on ? "border-accent bg-accent-soft" : "border-line opacity-40 grayscale", own !== undefined && "ring-2 ring-accent")}>{emoji}</button>;
  };
  return <>{chip("handicap", "⚖️", "Handicap")}{chip("bet", "🎯", "Mises")}{chip("theme", "🎲", "Thème")}</>;
}

// Avance d'un match du championnat a handicap (13/11) : celle du bareme par defaut, ou imposee (aucune, +n pour l'un).
function MatchHandicapPick({ t, a, b, nm, onRule }: { t: TourView; a: string; b: string; nm: (id: string | null) => string; onRule: OnRule }) {
  const o = t.settings.matchHandicap[pairKey(a, b)];
  const auto = autoHandicap(t.settings, t.players, a, b);
  const max = Math.max(1, (t.settings.matchPoints[pairKey(a, b)] ?? t.settings.points) - 1);
  const first = (id: string) => nm(id).split(" ")[0];
  const label = (x: number, y: number) => (x ? `+${x} pour ${first(a)}` : y ? `+${y} pour ${first(b)}` : "sans avance");
  const value = o ? `${o.id === a ? "a" : "b"}:${o.pts}` : "";
  const pick = (v: string) => {
    if (!v) return onRule({ handicap: { a, b, to: null, pts: 0 } });
    const [side, n] = v.split(":");
    onRule({ handicap: { a, b, to: side === "a" ? a : b, pts: Number(n) } });
  };
  const range = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <select value={value} onChange={(e) => pick(e.target.value)} className={cx("ml-1 text-xs rounded border px-1 py-0", o ? "border-accent text-accent-ink font-bold" : "border-line text-ink-3")} aria-label="Avance de ce match">
      <option value="">⚖️ {label(auto[0], auto[1])} (barème)</option>
      <option value="a:0">⚖️ sans avance</option>
      {range.map((n) => <option key={`a${n}`} value={`a:${n}`}>⚖️ +{n} pour {first(a)}</option>)}
      {range.map((n) => <option key={`b${n}`} value={`b:${n}`}>⚖️ +{n} pour {first(b)}</option>)}
    </select>
  );
}

function PoolsBoard({ pools, names, t, onRule }: { pools: TourPool[]; names: TourView["names"]; t: TourView; onRule?: OnRule }) {
  const nm = (id: string | null) => (id ? names[id]?.name ?? "?" : "");
  const who = (id: string | null) => (id && names[id] && names[id].className !== "prof" ? <StudentName id={id} name={names[id].name} /> : nm(id)); // nom cliquable (15/11) ; un prof : son nom seul
  const editable = (p: TourPairing) => !!p.b && p.status !== "played" && p.status !== "bye" && p.status !== "gone";
  const line = (p: TourPairing) => {
    if (p.status === "bye") return <><b>{who(p.a)}</b> <span className="text-ink-3">· repos</span></>;
    const score = p.sets ? p.sets.map(([x, y]) => `${x}-${y}`).join(" ") : "–";
    const h = t.kind === "HANDICAP" && p.b && onRule && (p.status === "todo" || p.status === "disputed") ? <MatchHandicapPick t={t} a={p.a} b={p.b} nm={nm} onRule={onRule} /> : p.handicap && (p.handicap[0] || p.handicap[1]) ? <span className="text-xs text-accent-ink"> (+{p.handicap[0] || p.handicap[1]} pour {nm(p.handicap[0] ? p.a : p.b).split(" ")[0]}{p.handicapForced ? ", imposé" : ""})</span> : p.handicapForced ? <span className="text-xs text-accent-ink"> (sans avance, imposé)</span> : null;
    return <><span className={cx(p.winner === "A" && "font-bold")}>{who(p.a)}</span> <span className="tabular-nums font-bold">{score}</span> <span className={cx(p.winner === "B" && "font-bold")}>{who(p.b)}</span>{h} <span className="text-xs">{tagOf(p.status)}</span>{p.b && <MatchPoints t={t} a={p.a} b={p.b} onRule={editable(p) ? onRule : undefined} />}{p.b && onRule && (p.status === "todo" || p.status === "disputed") && <PairRulePick t={t} a={p.a} b={p.b} onRule={onRule} />}<CourtTag t={t} a={p.a} b={p.b} /></>;
  };
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {pools.map((p) => (
          <div key={p.name} className={`${ui.cardPad} space-y-2`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-lg font-extrabold">{pools.length > 1 ? `Poule ${p.name}` : "Tous les joueurs"}
                {onRule ? (
                  <select value={t.settings.poolPoints[p.name] ?? ""} onChange={(e) => onRule({ pool: { name: p.name, points: e.target.value ? Number(e.target.value) : null } })} className={cx("ml-2 text-xs font-sans font-normal rounded border px-1 py-0.5 align-middle", t.settings.poolPoints[p.name] ? "border-accent text-accent-ink font-bold" : "border-line text-ink-3")} aria-label={`Score final de la poule ${p.name}`}>
                    <option value="">{t.settings.points} pts (tournoi)</option>
                    {TOUR_POINTS.filter((n) => n !== t.settings.points).map((n) => <option key={n} value={n}>{n} pts</option>)}
                  </select>
                ) : t.settings.poolPoints[p.name] ? <span className="ml-2 text-xs font-sans text-accent-ink">{t.settings.poolPoints[p.name]} pts</span> : null}
                {p.twice && <span className="ml-2 text-xs font-sans font-bold text-accent-ink">{p.auto ? "🔁 revanches (poule finie)" : "🔁 aller-retour"}</span>}
                {onRule && (
                  <button type="button" onClick={() => { const on = p.twice; if (confirm(on ? `Revenir à un seul match par paire dans la poule ${p.name} (pas de revanche) ?` : `Ajouter les matchs RETOUR dans la poule ${p.name} dès maintenant ? Chaque paire se rencontre une 2e fois (les joueurs partis sont exclus). Sinon, ils s'ouvrent d'eux-mêmes quand la poule a fini.`)) onRule({ poolLegs: { name: p.name, legs: on ? 1 : 2 } }); }} className="ml-2 text-xs font-sans font-normal rounded border border-line px-1.5 py-0.5 align-middle text-ink-2 hover:bg-paper">
                    {p.twice ? "↩︎ un seul match" : "🔁 Matchs retour"}
                  </button>
                )}
              </p>
              <span className={cx(ui.chip, p.done ? ui.chipOk : ui.chipWarn)}>{p.done ? "terminée" : `ronde ${p.current}/${p.rounds.length}`}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left"><th className={ui.th}>#</th><th className={ui.th}>Élève</th><th className={`${ui.th} text-right`}>Pts</th><th className={`${ui.th} text-right`}>V-N-D</th><th className={`${ui.th} text-right`}>Sets</th><th className={`${ui.th} text-right`}>Points</th></tr>
              </thead>
              <tbody>
                {p.standings.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="p-1.5 tabular-nums text-ink-3">{s.rank}</td>
                    <td className={cx("p-1.5 font-bold", s.gone && "text-ink-3")}>{who(s.id)}{s.gone && <span className={cx(ui.chip, ui.chipMuted, "ml-1 text-[10px]")}>parti</span>} <span className="text-ink-3 text-xs font-normal">{names[s.id]?.className} · {s.elo}</span></td>
                    <td className="p-1.5 text-right tabular-nums font-bold">{String(s.score).replace(".", ",")}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.won}-{s.drawn}-{s.lost}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.setsFor}-{s.setsAgainst}</td>
                    <td className="p-1.5 text-right tabular-nums">{s.pointsFor}-{s.pointsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.catchUp.length > 0 && (
              <div className="rounded-lg px-2 py-1 bg-sky-50 border border-sky-200 text-sm">
                <span className="text-xs font-bold text-ink-2">Rattrapages (arrivé en retard, à jouer quand les deux sont libres)</span>
                {p.catchUp.map((x, i) => <p key={i}>{line(x)}</p>)}
              </div>
            )}
            <ol className="space-y-1.5 text-sm">
              {p.rounds.map((r) => (
                <li key={r.n} className={cx("rounded-lg px-2 py-1", r.n === p.current ? "bg-accent-soft/50 border border-accent/40" : "bg-paper")}>
                  <span className="text-xs font-bold text-ink-2">Ronde {r.n}</span>
                  {r.pairings.map((x, i) => <p key={i}>{line(x)}</p>)}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className={ui.hint}>Classement de poule : victoires (égalité = ½), puis différence de sets, puis différence de points, puis ELO de départ.</p>
    </>
  );
}

function BracketBoard({ b, names, t, onRule }: { b: Bracket; names: TourView["names"]; t: TourView; onRule?: OnRule }) {
  const nm = (id: string | null | undefined) => (id ? names[id]?.name ?? "?" : id === null ? "exempt" : "…");
  const who = (id: string | null | undefined) => (id && names[id] && names[id].className !== "prof" ? <StudentName id={id} name={names[id].name} /> : nm(id)); // nom cliquable (15/11) ; un prof : son nom seul
  const line = (p: BracketPairing) => {
    const score = p.sets ? p.sets.map(([x, y]) => `${x}-${y}`).join(" ") : "–";
    if (p.status === "bye") return <span className="text-ink-3">{p.a === null && p.b === null ? "—" : <><b className="text-ink">{who(p.a ?? p.b)}</b> passe (exempt)</>}</span>;
    return <><span className={cx(p.winner === "A" && "font-bold", p.a === undefined && "text-ink-3")}>{who(p.a)}</span> <span className="tabular-nums font-bold">{p.status === "wait" ? "" : score}</span> <span className={cx(p.winner === "B" && "font-bold", p.b === undefined && "text-ink-3")}>{nm(p.b)}</span> <span className="text-xs">{tagOf(p.status)}</span>{p.a && p.b && <MatchPoints t={t} a={p.a} b={p.b} onRule={p.status === "todo" || p.status === "live" || p.status === "disputed" || p.status === "tie" ? onRule : undefined} />}{onRule && p.a && p.b && p.status === "todo" && <PairRulePick t={t} a={p.a} b={p.b} onRule={onRule} />}<CourtTag t={t} a={p.a} b={p.b} /></>;
  };
  return (
    <div className="space-y-3">
      <div className={`${ui.cardPad}`}>
        <p className="font-display text-lg font-extrabold mb-2">{b.done ? "Classement final" : "Classement (places encore en jeu)"}</p>
        <ol className="grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {b.ranks.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="truncate"><span className="tabular-nums text-ink-3">{r.rank ?? (r.lo === r.hi ? r.lo : `${r.lo}-${r.hi}`)}.</span> <b>{who(r.id)}</b> <span className="text-ink-3 text-xs">{names[r.id]?.className} · tête de série {r.seed}</span></span>
              <span className="tabular-nums text-xs text-ink-2 whitespace-nowrap">{r.won}/{r.played} gagnés</span>
            </li>
          ))}
        </ol>
      </div>
      {b.rounds.map((r) => (
        <div key={r.n} className={`${ui.cardPad} space-y-2`}>
          <p className="font-display font-extrabold">Tour {r.n}/{b.rounds.length}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {r.groups.filter((g) => g.pairings.some((p) => p.status !== "bye" || p.a || p.b)).map((g) => (
              <div key={g.lo} className="rounded-lg bg-paper px-2 py-1 text-sm">
                <span className="text-xs font-bold text-ink-2">Places {g.lo} à {g.hi}</span>
                {g.pairings.map((p, i) => <p key={i}>{line(p)}</p>)}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className={ui.hint}>Les places du classement comptent les places vides (exempts) du tableau ; le classement final, lui, va de 1 au nombre de joueurs.</p>
    </div>
  );
}

// ===== Tournoi par equipes (Sartay 24/11) =====
// Chrono (jeu au temps : « tous les matchs commencent en meme temps et finissent en meme temps ») : le prof lance le coup
// de sifflet de la ronde (vague 1 = tetes de serie, vague 2 = matchs en plus) ; tous les telephones affichent le chrono.
function TeamTimerPanel({ t }: { t: TourView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const tt = t.settings.team!;
  const st = t.teams!;
  const [minutes, setMinutes] = useState(tt.minutes);
  const [choice, setChoice] = useState("");
  const tm = tt.timer;
  const options = st.rounds.flatMap((r) => ([1, 2] as const).filter((w) => w === 1 || r.rencontres.some((x) => x.matches.some((m) => m.wave === 2))).map((w) => ({ v: `${r.n}:${w}`, label: `${r.label}${w === 2 ? " · matchs en plus" : ""}${r.rencontres.some((x) => x.status === "wait") ? " (pas encore connue)" : ""}` })));
  const nextV = st.next ? `${st.next.round}:${st.next.wave}` : "";
  const value = choice && options.some((o) => o.v === choice) ? choice : nextV || options[0]?.v || "";
  const running = !!tm && !tm.stoppedAt && tm.endsAt > t.now;
  function run(op: "start" | "stop") {
    if (op === "start" && running && !confirm("Un chrono tourne déjà : le relancer depuis le début ?")) return;
    const [round, wave] = value.split(":").map(Number);
    setError("");
    start(async () => {
      const res = await teamTimerAction(t.id, op, op === "start" ? { round, wave, minutes } : undefined);
      if ("error" in res) setError(res.error);
      else { setChoice(""); router.refresh(); }
    });
  }
  return (
    <div className={`${ui.cardPad} space-y-2`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">⏱️ Chrono</span>
        {tm ? <Countdown endsAt={tm.endsAt} stoppedAt={tm.stoppedAt} serverNow={t.now} big /> : <span className={ui.hint}>pas encore lancé</span>}
        {tm && <span className={ui.hint}>Ronde {tm.round}{tm.wave === 2 ? " · matchs en plus" : ""}</span>}
        {running && <button type="button" disabled={pending} onClick={() => run("stop")} className={btn.smGhost}>⏹ Arrêter</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={value} onChange={(e) => setChoice(e.target.value)} className={`${ui.input} w-auto`} aria-label="Ronde à lancer">
          {options.map((o) => <option key={o.v} value={o.v}>{o.label}{o.v === nextV ? " ← à jouer" : ""}</option>)}
        </select>
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${ui.input} w-auto`} aria-label="Durée">
          {[...new Set([...TEAM_MINUTES, minutes])].sort((x, y) => x - y).map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
        <button type="button" disabled={pending || !value} onClick={() => run("start")} className={btn.smPrimary}>▶ Coup de sifflet</button>
      </div>
      {(() => {
        // « Pret » (26/11) : le chrono part tout seul quand tous les joueurs de la vague sont prets ; le coup de sifflet passe toujours.
        const rs = readyState(st, tt, t.now);
        if (!rs) return null;
        const missing = rs.expected.filter((id) => !rs.ready.includes(id));
        return <p className="text-sm">✋ Prêts pour la ronde {rs.round}{rs.wave === 2 ? " (matchs en plus)" : ""} : <b>{rs.ready.length}/{rs.expected.length}</b>{missing.length && missing.length <= 12 ? <span className={ui.hint}> · pas encore : {missing.map((id) => t.names[id]?.name.split(" ")[0] ?? "?").join(", ")}</span> : null}</p>;
      })()}
      {error && <p className={ui.alertErr}>{error}</p>}
      <p className={ui.hint}>
        {st.next ? `À jouer : ${st.rounds.find((r) => r.n === st.next!.round)?.label ?? ""}${st.next.wave === 2 ? " · matchs en plus" : ""} (${st.next.matches} match${st.next.matches > 1 ? "s" : ""} pas encore encodé${st.next.matches > 1 ? "s" : ""}). ` : "Toutes les rencontres sont jouées. "}
        Tous les téléphones affichent le chrono ; au coup de sifflet final, les joueurs encodent le score du moment (égalité possible).
      </p>
    </div>
  );
}

function TeamsBoard({ st, t, onRule }: { st: TeamsState; t: TourView; onRule?: OnRule }) {
  const names = t.names;
  const nm = (id: string | null | undefined) => (id ? names[id]?.name ?? "?" : "");
  const who = (id: string) => (names[id] && names[id].className !== "prof" ? <StudentName id={id} name={names[id].name} /> : nm(id));
  const coach = (l: string | null | undefined) => nm(st.teams.find((x) => x.letter === l)?.coach);
  const bracket = st.format === "BRACKET";
  const draw = t.settings.team?.draw === "ELO" ? "ce que l'ELO donne (le moins bien classé gagne un peu)" : "chacun rapporte la moitié de ce qu'une victoire lui aurait rapporté";
  const tableOf = (rows: TeamsState["teams"]) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left"><th className={ui.th}>#</th><th className={ui.th}>Équipe</th><th className={`${ui.th} text-right`}>Pts</th>{!bracket && <th className={`${ui.th} text-right`}>Rencontres</th>}<th className={`${ui.th} text-right`}>Matchs gagnés</th><th className={`${ui.th} text-right`}>Joueurs</th><th className={`${ui.th} text-right`}>ELO moy.</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.letter} className="border-t border-line">
            <td className="p-1.5 tabular-nums text-ink-3">{r.rank ?? `${r.lo}-${r.hi}`}</td>
            <td className="p-1.5 font-bold">Équipe {r.letter} <span className="text-ink-3 text-xs font-normal">👑 {coach(r.letter)}</span></td>
            <td className="p-1.5 text-right tabular-nums font-bold">{r.pts}</td>
            {!bracket && <td className="p-1.5 text-right tabular-nums">{r.won}-{r.drawn}-{r.lost}</td>}
            <td className="p-1.5 text-right tabular-nums">{r.matchesWon}</td>
            <td className="p-1.5 text-right tabular-nums">{r.members.filter((m) => !m.away).length}</td>
            <td className="p-1.5 text-right tabular-nums text-ink-2">{r.avg}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const line = (p: TeamPairing) => {
    const score = p.sets ? p.sets.map(([x, y]) => `${x}-${y}`).join(" ") : "–";
    return (
      <p className="flex flex-wrap items-baseline gap-x-1">
        {p.wave === 2 && <span className="text-xs text-accent-ink">en plus ·</span>}
        <span className={cx(p.winner === "A" && "font-bold")}>{who(p.a)}</span>
        <span className="tabular-nums font-bold">{score}</span>
        <span className={cx(p.winner === "B" && "font-bold")}>{who(p.b)}</span>
        {p.status === "played" && (p.pts[0] || p.pts[1]) ? <span className="text-xs text-success-ink font-bold">{p.pts[0] ? `+${p.pts[0]}` : ""}{p.pts[0] && p.pts[1] ? " / " : ""}{p.pts[1] ? `+${p.pts[1]}` : ""}</span> : null}
        <span className="text-xs">{p.status === "played" ? "" : tagOf(p.status)}</span>
        {onRule && (p.status === "todo" || p.status === "disputed") && <MatchPoints t={t} a={p.a} b={p.b} onRule={onRule} />}
        {onRule && p.status === "todo" && <PairRulePick t={t} a={p.a} b={p.b} onRule={onRule} />}
        <CourtTag t={t} a={p.a} b={p.b} />
      </p>
    );
  };
  const card = (x: Rencontre) => {
    if (x.status === "bye") return <div key={x.key} className="rounded-lg bg-paper px-2 py-1 text-sm text-ink-3"><b className="text-ink">Équipe {x.x ?? x.y}</b> {bracket ? "passe (exempt)" : "au repos"}</div>;
    if (x.status === "wait") return <div key={x.key} className="rounded-lg bg-paper px-2 py-1 text-sm text-ink-3">{x.stage} : {x.x ? `Équipe ${x.x}` : "…"} – {x.y ? `Équipe ${x.y}` : "…"} (en attente)</div>;
    const chip = x.status === "done" ? (x.winner === "DRAW" ? "égalité" : `Équipe ${x.winner === "X" ? x.x : x.y} gagne`) : x.status === "live" ? "en cours" : "à jouer";
    return (
      <div key={x.key} className={cx("rounded-lg px-2 py-1.5 text-sm space-y-0.5", x.status === "done" ? "bg-paper" : "bg-accent-soft/40 border border-accent/40")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p><b className={cx(x.winner === "X" && "text-success-ink")}>Équipe {x.x}</b> <span className="text-ink-3 text-xs">👑 {coach(x.x)}</span> <span className="font-display text-lg font-extrabold tabular-nums">{x.pts[0]} – {x.pts[1]}</span> <b className={cx(x.winner === "Y" && "text-success-ink")}>Équipe {x.y}</b> <span className="text-ink-3 text-xs">👑 {coach(x.y)}</span></p>
          <span className={cx(ui.chip, x.status === "done" ? ui.chipOk : ui.chipWarn)}>{x.stage ? `${x.stage} · ` : ""}{chip}</span>
        </div>
        {x.matches.map((p, i) => <div key={i}>{line(p)}</div>)}
        {!x.matches.length && <p className={ui.hint}>Forfait : une équipe n&apos;a plus de joueur présent.</p>}
      </div>
    );
  };
  return (
    <div className="space-y-3">
      <div className={`${ui.cardPad} space-y-3`}>
        {bracket ? (
          <><p className="font-display text-lg font-extrabold">{st.done ? "Classement final" : "Classement (places encore en jeu)"}</p>{tableOf([...st.teams].sort((x, y) => x.lo - y.lo || (x.rank ?? 99) - (y.rank ?? 99)))}</>
        ) : (
          Array.from({ length: st.groups }, (_, g) => (
            <div key={g}>
              <p className="font-display text-lg font-extrabold">{st.groups > 1 ? `Poule ${g + 1}` : "Classement des équipes"}</p>
              {tableOf(st.teams.filter((x) => x.group === g).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99)))}
            </div>
          ))
        )}
      </div>
      {st.rounds.map((r) => {
        const current = st.next?.round === r.n;
        return (
          <div key={r.n} className={`${ui.cardPad} space-y-2`}>
            <p className="font-display font-extrabold">{r.label}/{st.rounds.length} {current && <span className={cx(ui.chip, ui.chipWarn, "ml-1 font-sans")}>en cours</span>}</p>
            <div className="grid gap-2 lg:grid-cols-2">{r.rencontres.map(card)}</div>
          </div>
        );
      })}
      <details className={ui.cardPad}>
        <summary className="cursor-pointer font-bold">Les équipes : joueurs et points rapportés</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {st.teams.map((tr) => (
            <div key={tr.letter} className="rounded-lg bg-paper px-2 py-1.5 text-sm">
              <p className="font-bold">Équipe {tr.letter} · {tr.pts} pts</p>
              <ol>
                {tr.members.map((m) => (
                  <li key={m.id} className={cx("flex justify-between gap-2", m.away && "text-ink-3")}>
                    <span className="truncate">{tr.coach === m.id ? "👑 " : ""}{who(m.id)} <span className="text-ink-3 text-xs">{m.elo}{m.late ? " · arrivé en retard" : ""}{m.away ? " · parti" : ""}</span></span>
                    <span className="tabular-nums whitespace-nowrap">+{m.pts} <span className="text-ink-3 text-xs">({m.won}-{m.drawn}-{m.lost})</span></span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </details>
      <p className={ui.hint}>Points : une victoire rapporte à l&apos;équipe les points ELO gagnés par le joueur (ELO du moment dans le tournoi) ; une défaite ne rapporte rien ; égalité : {draw}. {bracket ? "Une rencontre se gagne aux points, puis aux matchs gagnés ; à égalité parfaite, la plus grande différence de points joués, puis l'équipe la moins bien classée." : "Classement : points, puis rencontres gagnées, puis matchs gagnés."}</p>
    </div>
  );
}
