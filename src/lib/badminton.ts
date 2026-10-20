// Badminton (Sartay 20/10) : matchs en simple encodes par les eleves. Module PUR (importable cote client).
// « Les eleves encodent les resultats de leurs matchs et contre qui ils ont joue ; l'adversaire peut signer / valider le
// score et le modifier si necessaire ; un arbitre peut aussi indiquer le score entre deux eleves ; quoi qu'il arrive on
// voit toujours qui a encode les points. »
//
// Un match = deux joueurs (A, B) et un JOURNAL en ajout seul (jamais rien d'efface). Son etat se lit sur le journal :
// - SCORE (saisie ou correction) d'un JOUEUR : « a signer » par l'autre joueur ;
// - SCORE d'un ARBITRE ou d'un PROF : valide d'office (un joueur peut encore corriger : l'autre devra alors signer) ;
// - VALIDATE (signature) par le joueur qui n'a pas encode la version en vigueur, ou par un prof : valide ;
// - DISPUTE (« je n'ai pas joue ce match ») : conteste, le prof tranche ; une nouvelle saisie leve la contestation ;
// - CANCEL : annule (encode par erreur), garde dans l'historique.

export type BmSet = [number, number]; // points de A, points de B
export type BmRole = "PLAYER" | "REFEREE" | "STAFF";
export type BmKind = "SCORE" | "VALIDATE" | "DISPUTE" | "CANCEL";
export type BmEvent = { id: string; kind: BmKind; sets: BmSet[] | null; authorId: string; role: BmRole; at: number };
export type BmMatch = { id: string; sessionId: string; playerAId: string; playerBId: string; createdById: string; createdAt: number; events: BmEvent[] };
export type BmStatus = "PENDING" | "VALIDATED" | "DISPUTED" | "CANCELLED";

export const BM_MAX_SETS = 3;
export const BM_MAX_POINTS = 99;
// Deux saisies du meme duel a moins de ce delai : sans doute le meme match (l'adversaire ou l'arbitre l'a deja encode).
export const BM_DUPLICATE_MS = 20 * 60_000;

const isRole = (v: unknown): v is BmRole => v === "PLAYER" || v === "REFEREE" || v === "STAFF";
const isKind = (v: unknown): v is BmKind => v === "SCORE" || v === "VALIDATE" || v === "DISPUTE" || v === "CANCEL";
export const readRole = (v: unknown): BmRole => (isRole(v) ? v : "PLAYER");
export const readKind = (v: unknown): BmKind | null => (isKind(v) ? v : null);

// Sets lus en base (JSON) : [[a, b], …] entiers ; null si illisible.
export function readSets(raw: unknown): BmSet[] | null {
  if (!Array.isArray(raw)) return null;
  const out: BmSet[] = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length !== 2) return null;
    const [a, b] = s.map((x) => Number(x));
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    out.push([a, b]);
  }
  return out;
}

// Controle d'une saisie : 1 a 3 sets, points de 0 a 99, au moins un point par set. Message d'erreur, ou null si c'est bon.
export function checkSets(sets: BmSet[]): string | null {
  if (!Array.isArray(sets) || sets.length < 1) return "Indique au moins un set.";
  if (sets.length > BM_MAX_SETS) return `Au plus ${BM_MAX_SETS} sets.`;
  for (const [a, b] of sets) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > BM_MAX_POINTS || b > BM_MAX_POINTS) return `Les points vont de 0 à ${BM_MAX_POINTS}.`;
    if (a + b === 0) return "Un set à 0 – 0 ne compte pas : corrige-le ou retire-le.";
  }
  return null;
}
export const sameSets = (x: BmSet[] | null, y: BmSet[] | null) => !!x && !!y && x.length === y.length && x.every((s, i) => s[0] === y[i][0] && s[1] === y[i][1]);
export const swapSets = (sets: BmSet[]): BmSet[] => sets.map(([a, b]) => [b, a]);
export const setsText = (sets: BmSet[] | null) => (sets ? sets.map(([a, b]) => `${a}-${b}`).join(" · ") : "—");

export type BmResult = { winner: "A" | "B" | "DRAW"; setsWon: [number, number]; points: [number, number] };
// Vainqueur : le plus de sets gagnes ; a egalite de sets (match au temps, un set chacun), le plus de points ; sinon egalite.
export function resultOf(sets: BmSet[]): BmResult {
  const setsWon: [number, number] = [0, 0];
  const points: [number, number] = [0, 0];
  for (const [a, b] of sets) {
    points[0] += a;
    points[1] += b;
    if (a > b) setsWon[0]++;
    else if (b > a) setsWon[1]++;
  }
  const winner = setsWon[0] !== setsWon[1] ? (setsWon[0] > setsWon[1] ? "A" : "B") : points[0] !== points[1] ? (points[0] > points[1] ? "A" : "B") : "DRAW";
  return { winner, setsWon, points };
}

export type BmSign = { id: string; role: BmRole; at: number };
export type BmState = {
  status: BmStatus;
  sets: BmSet[] | null; // score en vigueur (dernier SCORE)
  scoreBy: BmSign | null; // auteur de la version en vigueur
  validatedBy: BmSign | null; // signature (ou saisie d'un arbitre / d'un prof, valide d'office)
  disputedBy: BmSign | null;
  cancelledBy: BmSign | null;
  waitingFor: string | null; // joueur qui doit encore signer (statut PENDING)
  result: BmResult | null;
  corrections: number; // saisies apres la premiere
};

export function matchState(m: BmMatch): BmState {
  const events = [...m.events].sort((x, y) => x.at - y.at);
  let sets: BmSet[] | null = null;
  let scoreBy: BmSign | null = null;
  let validatedBy: BmSign | null = null;
  let disputedBy: BmSign | null = null;
  let cancelledBy: BmSign | null = null;
  let status: BmStatus = "PENDING";
  let scores = 0;
  for (const e of events) {
    const sign = { id: e.authorId, role: e.role, at: e.at };
    if (e.kind === "SCORE" && e.sets) {
      scores++;
      sets = e.sets;
      scoreBy = sign;
      disputedBy = null;
      cancelledBy = null;
      validatedBy = e.role === "PLAYER" ? null : sign;
      status = e.role === "PLAYER" ? "PENDING" : "VALIDATED";
    } else if (e.kind === "VALIDATE" && sets && status !== "CANCELLED") {
      // Un joueur ne signe pas sa propre saisie ; un prof peut tout valider.
      if (e.role === "STAFF" || e.authorId !== scoreBy?.id) {
        validatedBy = sign;
        disputedBy = null;
        status = "VALIDATED";
      }
    } else if (e.kind === "DISPUTE" && status !== "CANCELLED") {
      disputedBy = sign;
      status = "DISPUTED";
    } else if (e.kind === "CANCEL") {
      cancelledBy = sign;
      status = "CANCELLED";
    }
  }
  const waitingFor = status === "PENDING" && scoreBy ? (scoreBy.id === m.playerAId ? m.playerBId : scoreBy.id === m.playerBId ? m.playerAId : null) : null;
  return { status, sets, scoreBy, validatedBy, disputedBy, cancelledBy, waitingFor, result: sets ? resultOf(sets) : null, corrections: Math.max(0, scores - 1) };
}

export const STATUS_TEXT: Record<BmStatus, string> = { PENDING: "à signer", VALIDATED: "validé", DISPUTED: "contesté", CANCELLED: "annulé" };
export const ROLE_TEXT: Record<BmRole, string> = { PLAYER: "joueur", REFEREE: "arbitre", STAFF: "prof" };

// Historique lisible, ligne par ligne : qui a fait quoi, et quand. `nameOf` donne le nom a afficher d'un identifiant.
export type BmHistoryLine = { at: number; icon: string; text: string };
export function historyOf(m: BmMatch, nameOf: (id: string) => string): BmHistoryLine[] {
  const events = [...m.events].sort((x, y) => x.at - y.at);
  let first = true;
  return events.map((e) => {
    const who = `${nameOf(e.authorId)} (${ROLE_TEXT[e.role]})`;
    if (e.kind === "SCORE") {
      const line = { at: e.at, icon: "✏️", text: `${first ? "Encodé" : "Corrigé"} par ${who} : ${setsText(e.sets)}` };
      first = false;
      return line;
    }
    if (e.kind === "VALIDATE") return { at: e.at, icon: "✅", text: `Signé par ${who}` };
    if (e.kind === "DISPUTE") return { at: e.at, icon: "⚠️", text: `Contesté par ${who} : « je n'ai pas joué ce match »` };
    return { at: e.at, icon: "✖", text: `Annulé par ${who}` };
  });
}

// Bilan d'un eleve sur des matchs : seuls les matchs VALIDES comptent ; les autres sont comptes a part.
export type BmPupilStats = { played: number; won: number; lost: number; draws: number; setsFor: number; setsAgainst: number; pointsFor: number; pointsAgainst: number; pending: number; disputed: number; refereed: number };
export function pupilStats(userId: string, list: { match: BmMatch; state: BmState }[]): BmPupilStats {
  const s: BmPupilStats = { played: 0, won: 0, lost: 0, draws: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0, pending: 0, disputed: 0, refereed: 0 };
  for (const { match: m, state: st } of list) {
    const sideOf = m.playerAId === userId ? 0 : m.playerBId === userId ? 1 : -1;
    if (sideOf < 0) {
      if (m.createdById === userId && st.status !== "CANCELLED") s.refereed++;
      continue;
    }
    if (st.status === "PENDING") s.pending++;
    if (st.status === "DISPUTED") s.disputed++;
    if (st.status !== "VALIDATED" || !st.result) continue;
    const r = st.result;
    const side = sideOf as 0 | 1;
    const other = (1 - side) as 0 | 1;
    s.played++;
    if (r.winner === "DRAW") s.draws++;
    else if ((r.winner === "A") === (side === 0)) s.won++;
    else s.lost++;
    s.setsFor += r.setsWon[side];
    s.setsAgainst += r.setsWon[other];
    s.pointsFor += r.points[side];
    s.pointsAgainst += r.points[other];
  }
  return s;
}

// ===== Vue d'un match pour un lecteur (eleve ou prof) : ce qu'il voit et ce qu'il peut faire =====
// Memes regles que les actions serveur (src/app/eleve/badminton-actions.ts), qui les reverifient.
export type BmPersonRef = { id: string; name: string; className: string | null };
export type BmView = {
  id: string;
  createdAt: number;
  a: BmPersonRef;
  b: BmPersonRef;
  meSide: "A" | "B" | null; // le lecteur joue ce match (cote A ou B), sinon null
  status: BmStatus;
  sets: BmSet[] | null; // toujours points de A puis de B
  result: BmResult | null;
  waitingFor: BmPersonRef | null;
  createdBy: BmPersonRef & { role: BmRole };
  history: BmHistoryLine[];
  can: { validate: boolean; correct: boolean; dispute: boolean; cancel: boolean };
};

export function viewOf(m: BmMatch, viewerId: string, staff: boolean, ref: (id: string) => BmPersonRef): BmView {
  const st = matchState(m);
  const meSide = viewerId === m.playerAId ? "A" : viewerId === m.playerBId ? "B" : null;
  const player = meSide !== null;
  const creatorRole = [...m.events].sort((x, y) => x.at - y.at).find((e) => e.kind === "SCORE")?.role ?? "PLAYER";
  const live = st.status !== "CANCELLED";
  return {
    id: m.id,
    createdAt: m.createdAt,
    a: ref(m.playerAId),
    b: ref(m.playerBId),
    meSide,
    status: st.status,
    sets: st.sets,
    result: st.result,
    waitingFor: st.waitingFor ? ref(st.waitingFor) : null,
    createdBy: { ...ref(m.createdById), role: creatorRole },
    history: historyOf(m, (id) => (id === viewerId && !staff ? "toi" : ref(id).name)),
    can: {
      validate: staff ? st.status === "PENDING" || st.status === "DISPUTED" : st.status === "PENDING" && st.waitingFor === viewerId,
      correct: staff || (live && (player || viewerId === m.createdById)),
      dispute: !staff && player && live && st.status !== "DISPUTED" && st.scoreBy?.id !== viewerId,
      cancel: live && (staff || (viewerId === m.createdById && st.status !== "VALIDATED")),
    },
  };
}
