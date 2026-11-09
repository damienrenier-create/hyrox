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
// - LIVE (03/11) : arbitrage en direct, un appui sur + ou − = une photo du score ; le match est « en direct » jusqu'au
//   SCORE de fin (« Fin du match ») de l'arbitre, valide d'office.
// - MATCH LIBRE (03/11, Sartay : « les eleves doivent pouvoir s'affronter en inter-classes en dehors de leurs heures
//   officielles, en allant chercher dans une liste d'eleves » ; « pour devenir officiel, les matchs pourraient etre signes
//   par 2 autres eleves ou par un prof ») : match sans seance (sessionId null). WITNESS_ASK = on demande a un eleve
//   d'attester le match (targetId) ; WITNESS = il atteste le score en vigueur ; WITNESS_NO = « je n'ai pas vu ce match ».
//   Une correction du score efface les attestations (elles portaient sur l'ancien score). Officiel = 2 temoins (l'arbitre
//   qui a encode le score en est un) ou un prof. Seuls les matchs officiels comptent au classement ELO.
// - REMATCH (06/11, Sartay : « encode quoi qu'il arrive une revanche mais signale a l'arbitre en lui demandant s'il est
//   sur et exige dans ce cas une seconde signature ») : un arbitre qui encode (ou arbitre en direct) un duel deja joue il y
//   a moins de 20 min confirme ; le match est marque REMATCH et son score d'arbitre n'est plus valide d'office : un des
//   deux joueurs (ou un prof) doit le signer. En attendant, il ne compte pas au classement.

export type BmSet = [number, number]; // points de A, points de B
export type BmRole = "PLAYER" | "REFEREE" | "STAFF" | "WITNESS";
export type BmKind = "SCORE" | "VALIDATE" | "DISPUTE" | "CANCEL" | "LIVE" | "WITNESS_ASK" | "WITNESS" | "WITNESS_NO" | "REMATCH";
export type BmEvent = { id: string; kind: BmKind; sets: BmSet[] | null; authorId: string; role: BmRole; at: number; targetId?: string | null };
export type BmMatch = { id: string; sessionId: string | null; playerAId: string; playerBId: string; createdById: string; createdAt: number; events: BmEvent[]; tournamentId?: string | null };
// Identifiant des matchs libres dans les liens et les actions (/eleve/badminton/libre, /admin/badminton?session=libre).
export const BM_FREE = "libre";
export const BM_WITNESSES_NEEDED = 2;
export type BmStatus = "PENDING" | "VALIDATED" | "DISPUTED" | "CANCELLED" | "LIVE";

export const BM_MAX_SETS = 3;
export const BM_MAX_POINTS = 99;
// Deux saisies du meme duel a moins de ce delai : sans doute le meme match (l'adversaire ou l'arbitre l'a deja encode).
export const BM_DUPLICATE_MS = 20 * 60_000;

const isRole = (v: unknown): v is BmRole => v === "PLAYER" || v === "REFEREE" || v === "STAFF" || v === "WITNESS";
const isKind = (v: unknown): v is BmKind => v === "SCORE" || v === "VALIDATE" || v === "DISPUTE" || v === "CANCEL" || v === "LIVE" || v === "WITNESS_ASK" || v === "WITNESS" || v === "WITNESS_NO" || v === "REMATCH";
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
// Score en direct : 1 a 3 sets, points de 0 a 99 (un set a 0-0 est permis : il vient de commencer).
export function checkLiveSets(sets: BmSet[]): string | null {
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > BM_MAX_SETS) return `De 1 à ${BM_MAX_SETS} sets.`;
  for (const [a, b] of sets) if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > BM_MAX_POINTS || b > BM_MAX_POINTS) return `Les points vont de 0 à ${BM_MAX_POINTS}.`;
  return null;
}
// Fin d'un match en direct : les sets restes a 0-0 (set suivant ouvert, pas joue) ne comptent pas.
export const trimLiveSets = (sets: BmSet[]): BmSet[] => { const out = sets.filter(([a, b], i) => a + b > 0 || i === 0); return out.length ? out : [[0, 0]]; };
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
  asked: string[]; // match libre : eleves a qui on a demande d'attester le match
  attested: BmSign[]; // ... ceux qui ont atteste le score en vigueur
  declined: string[]; // ... ceux qui disent ne pas l'avoir vu (score en vigueur)
  needsSecond: boolean; // revanche encodee par un arbitre : un des deux joueurs (ou un prof) doit encore la signer
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
  const asked: string[] = [];
  let attested: BmSign[] = [];
  let declined: string[] = [];
  let rematch = false;
  const players = [m.playerAId, m.playerBId];
  for (const e of events) {
    const sign = { id: e.authorId, role: e.role, at: e.at };
    if (e.kind === "REMATCH") {
      // Revanche confirmee par l'arbitre : son score attend une seconde signature.
      rematch = true;
      if (status === "VALIDATED" && validatedBy?.role === "REFEREE") {
        validatedBy = null;
        status = "PENDING";
      }
      continue;
    }
    if (e.kind === "WITNESS_ASK") {
      if (e.targetId && !players.includes(e.targetId) && !asked.includes(e.targetId)) asked.push(e.targetId);
      continue;
    }
    if (e.kind === "WITNESS" || e.kind === "WITNESS_NO") {
      if (players.includes(e.authorId) || !asked.includes(e.authorId)) continue;
      attested = attested.filter((s) => s.id !== e.authorId);
      declined = declined.filter((id) => id !== e.authorId);
      if (e.kind === "WITNESS") attested.push(sign);
      else declined.push(e.authorId);
      continue;
    }
    if ((e.kind === "LIVE" || e.kind === "SCORE") && e.sets) {
      // Nouveau score : les attestations portaient sur l'ancien.
      attested = [];
      declined = [];
    }
    if (e.kind === "LIVE" && e.sets && status !== "CANCELLED") {
      sets = e.sets;
      scoreBy = sign;
      validatedBy = null;
      disputedBy = null;
      status = "LIVE";
    } else if (e.kind === "SCORE" && e.sets) {
      scores++;
      sets = e.sets;
      scoreBy = sign;
      disputedBy = null;
      cancelledBy = null;
      const toSign = e.role === "PLAYER" || (rematch && e.role === "REFEREE");
      validatedBy = toSign ? null : sign;
      status = toSign ? "PENDING" : "VALIDATED";
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
  const needsSecond = status === "PENDING" && rematch && scoreBy?.role === "REFEREE";
  return { status, sets, scoreBy, validatedBy, disputedBy, cancelledBy, waitingFor, result: sets ? resultOf(sets) : null, corrections: Math.max(0, scores - 1), asked, attested, declined, needsSecond };
}

// L'eleve doit-il signer ce match ? Le joueur qui n'a pas encode le score, ou (revanche d'un arbitre) l'un des deux.
export const mustSign = (m: BmMatch, st: BmState, userId: string): boolean =>
  st.status === "PENDING" && (st.waitingFor === userId || (st.needsSecond && (m.playerAId === userId || m.playerBId === userId)));

// Doublon probable d'un nouveau match entre a et b : leur dernier duel, encode il y a moins de BM_DUPLICATE_MS et non
// annule. Sauf REVANCHE (Sartay 06/11 : « des joueurs peuvent rejouer rapidement l'un contre l'autre ; si un match avec
// un autre adversaire a ete encode pour l'un des deux, alors il s'agit d'une revanche ») : alors rien a signaler.
export function recentTwin(matches: BmMatch[], a: string, b: string, now: number): BmMatch | null {
  const twin = recentDuel(matches, a, b, now);
  if (!twin) return null;
  const samePair = (m: BmMatch) => (m.playerAId === a && m.playerBId === b) || (m.playerAId === b && m.playerBId === a);
  const alive = (m: BmMatch) => matchState(m).status !== "CANCELLED";
  const rematch = matches.some((m) => m.createdAt > twin.createdAt && !samePair(m) && (m.playerAId === a || m.playerBId === a || m.playerAId === b || m.playerBId === b) && alive(m));
  return rematch ? null : twin;
}
// Dernier duel entre a et b encode il y a moins de BM_DUPLICATE_MS et non annule (revanche ou pas).
export function recentDuel(matches: BmMatch[], a: string, b: string, now: number): BmMatch | null {
  const samePair = (m: BmMatch) => (m.playerAId === a && m.playerBId === b) || (m.playerAId === b && m.playerBId === a);
  return [...matches].sort((x, y) => y.createdAt - x.createdAt).find((m) => samePair(m) && now - m.createdAt < BM_DUPLICATE_MS && matchState(m).status !== "CANCELLED") ?? null;
}

// Temoins d'un match libre : ceux qui ont atteste le score en vigueur, plus l'arbitre qui l'a encode.
export function witnessesOf(st: BmState): string[] {
  const ids = st.attested.map((s) => s.id);
  if (st.scoreBy?.role === "REFEREE" && !ids.includes(st.scoreBy.id)) ids.push(st.scoreBy.id);
  return ids;
}
// Match officiel (il compte au classement ELO) : un score, ni conteste, ni annule, ni en direct ; en seance, rien de plus
// (« un match non conteste compte, pas la peine qu'il soit signe ») ; match libre : 2 temoins, ou un prof.
export function isOfficial(m: BmMatch, st: BmState): boolean {
  if ((st.status !== "VALIDATED" && st.status !== "PENDING") || !st.sets || !st.result || st.needsSecond) return false;
  if (m.sessionId !== null) return true;
  return st.scoreBy?.role === "STAFF" || st.validatedBy?.role === "STAFF" || witnessesOf(st).length >= BM_WITNESSES_NEEDED;
}

export const STATUS_TEXT: Record<BmStatus, string> = { PENDING: "à signer", VALIDATED: "validé", DISPUTED: "contesté", CANCELLED: "annulé", LIVE: "en direct" };
export const ROLE_TEXT: Record<BmRole, string> = { PLAYER: "joueur", REFEREE: "arbitre", STAFF: "prof", WITNESS: "témoin" };

// Historique lisible, ligne par ligne : qui a fait quoi, et quand. `nameOf` donne le nom a afficher d'un identifiant.
export type BmHistoryLine = { at: number; icon: string; text: string };
export function historyOf(m: BmMatch, nameOf: (id: string) => string): BmHistoryLine[] {
  const events = [...m.events].sort((x, y) => x.at - y.at);
  let first = true;
  let afterLive = false;
  const out: BmHistoryLine[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const who = `${nameOf(e.authorId)} (${ROLE_TEXT[e.role]})`;
    if (e.kind === "LIVE") {
      // Une suite de photos du direct = UNE ligne : qui a arbitre, combien d'appuis, de quand a quand.
      let j = i;
      while (j + 1 < events.length && events[j + 1].kind === "LIVE") j++;
      // (les appuis rapides partent groupes : on donne la duree, pas un nombre d'appuis)
      out.push({ at: e.at, icon: "🎯", text: `Arbitré en direct par ${who}${j > i ? ` jusqu'à ${new Date(events[j].at).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })}` : ""} · ${setsText(events[j].sets)}` });
      i = j;
      first = false;
      afterLive = true;
      continue;
    }
    if (e.kind === "SCORE") {
      out.push({ at: e.at, icon: afterLive ? "🏁" : "✏️", text: `${afterLive ? "Fin du match" : first ? "Encodé" : "Corrigé"} par ${who} : ${setsText(e.sets)}` });
      first = false;
      afterLive = false;
      continue;
    }
    out.push(lineOf(e, who, nameOf));
  }
  return out;
}
function lineOf(e: BmEvent, who: string, nameOf: (id: string) => string): BmHistoryLine {
  if (e.kind === "REMATCH") return { at: e.at, icon: "🔁", text: `Revanche rapide confirmée par ${who} : un des deux joueurs doit la signer` };
  if (e.kind === "WITNESS_ASK") {
    const by = nameOf(e.authorId);
    const to = e.targetId ? nameOf(e.targetId) : "?";
    return { at: e.at, icon: "👀", text: by === "toi" ? `Tu as demandé à ${to} d'attester le match` : to === "toi" ? `${by} te demande d'attester le match` : `${by} demande à ${to} d'attester le match` };
  }
  if (e.kind === "WITNESS") return { at: e.at, icon: "🖊️", text: `Attesté par ${who}` };
  if (e.kind === "WITNESS_NO") return { at: e.at, icon: "🙈", text: `${who} : « je n'ai pas vu ce match »` };
  if (e.kind === "VALIDATE") return { at: e.at, icon: "✅", text: `Signé par ${who}` };
  if (e.kind === "DISPUTE") return { at: e.at, icon: "⚠️", text: `Contesté par ${who} : « je n'ai pas joué ce match »` };
  return { at: e.at, icon: "✖", text: `Annulé par ${who}` };
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
  needsSecond: boolean; // revanche d'un arbitre : un des deux joueurs doit encore la signer
  free: boolean; // match libre (hors seance)
  official: boolean; // compte au classement ELO
  witnesses: { count: number; needed: number; asked: BmPersonRef[]; attested: BmPersonRef[]; declined: BmPersonRef[] };
  // referee : reprendre l'arbitrage en direct ; attest / decline : temoin d'un match libre ; askWitness : demander un temoin
  can: { validate: boolean; correct: boolean; dispute: boolean; cancel: boolean; referee: boolean; attest: boolean; decline: boolean; askWitness: boolean };
};

export function viewOf(m: BmMatch, viewerId: string, staff: boolean, ref: (id: string) => BmPersonRef): BmView {
  const st = matchState(m);
  const meSide = viewerId === m.playerAId ? "A" : viewerId === m.playerBId ? "B" : null;
  const player = meSide !== null;
  const creatorRole = [...m.events].sort((x, y) => x.at - y.at).find((e) => e.kind === "SCORE" || e.kind === "LIVE")?.role ?? "PLAYER";
  const live = st.status !== "CANCELLED";
  const free = m.sessionId === null;
  const official = isOfficial(m, st);
  const witnessIds = witnessesOf(st);
  const askedMe = free && !staff && !player && st.asked.includes(viewerId);
  const scored = live && st.status !== "LIVE" && !!st.sets;
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
    needsSecond: st.needsSecond,
    free,
    official,
    witnesses: { count: witnessIds.length, needed: BM_WITNESSES_NEEDED, asked: st.asked.map(ref), attested: st.attested.map((s) => ref(s.id)), declined: st.declined.map(ref) },
    can: {
      // Prof : valider un match a signer, conteste, ou encore en direct (il le termine avec le score du moment) ; match libre :
      // aussi un match signe mais pas encore officiel (sa validation le rend officiel).
      validate: staff ? st.status === "PENDING" || st.status === "DISPUTED" || st.status === "LIVE" || (free && scored && !official) : mustSign(m, st, viewerId),
      correct: staff || (live && st.status !== "LIVE" && (player || viewerId === m.createdById)),
      dispute: !staff && player && live && st.status !== "DISPUTED" && st.scoreBy?.id !== viewerId,
      cancel: live && (staff || (viewerId === m.createdById && st.status !== "VALIDATED")),
      referee: st.status === "LIVE" && (staff || viewerId === m.createdById),
      attest: askedMe && scored && !st.attested.some((s) => s.id === viewerId),
      decline: askedMe && scored && !st.declined.includes(viewerId) && !st.attested.some((s) => s.id === viewerId),
      askWitness: free && !staff && live && !official && (player || viewerId === m.createdById),
    },
  };
}
