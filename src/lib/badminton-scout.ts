// SCOUTING du badminton (Sartay 24/11). Module PUR (importable cote client).
//
// 1. IMPACTS (« l'arbitre clique sur son ecran pour notifier l'impact du volant ; dessiner un terrain : simple, double,
//    demi-terrain sans couloir (par defaut) ; voir ou et comment les joueurs gagnent et perdent des points ») : a la fin de
//    chaque echange, l'arbitre en direct touche le terrain dessine la ou le volant est tombe. Ligne RALLY du journal du
//    match (parametres dans la colonne JSON). Coordonnees en metres, terrain vu du dessus, joueur A en haut, B en bas :
//    x = travers (0 = bord gauche du terrain dessine), y = long (0 = fond de A, 13,40 = fond de B), filet a 6,70.
// 2. COUCHES (« parametrer en couches : par defaut le plus rapide, puis rajouter du scouting couche par couche pour que les
//    eleves prennent le scouting en main petit a petit ; ajouter ou enlever des couches a certains eleves ») :
//    1 = impact + COMMENT le point finit (26/11 soir, voir HOWS : gagne, ou concede par service rate, filet, dehors, rate ;
//        le choix le plus probable d'apres l'impact est propose en premier) ; 2 = + le coup qui finit l'echange ;
//    3 = + ou etait le frappeur ; 4 = + faute provoquee ou directe. Reglage de la seance (settings.scout.level) et, par eleve, le
//    dernier reglage du prof dans n'importe quelle seance (settings.scout.students[id] = { level, at }).
// 3. FICHE TECHNIQUE (« eval simplifiee des mouvements de base : service court, service long, clear, smash, drop, lob, que
//    les joueurs rempliraient lors d'un scouting d'un autre eleve ; comme en Hyrox, les 4 criteres les plus importants +
//    emoji ») : un eleve (scout) observe un joueur pendant un match et coche, pour chaque coup vu, les 4 criteres reussis ;
//    bareme du Hyrox / Level : 0 critere = TI, 1 = I, 2 = S, 3 = B, 4 = TB, 4 + ❤️ (« vraiment tres bien fait ») = E.
//    Ligne SCOUT du journal du match (targetId = le joueur observe ; la plus recente d'un scout pour un joueur compte).
//    Les criteres ci-dessous ont ete rediges par Claude le 24/11 : ⏳ a valider par Sartay.

// ===== Terrains =====
export type CourtKind = "HALF" | "SINGLE" | "DOUBLE";
export const COURT_LENGTH = 13.4;
export const NET_Y = 6.7;
export const SHORT_SERVICE = 1.98; // ligne de service court, depuis le filet
export const DOUBLE_LONG_SERVICE = 0.76; // ligne de service long en double, depuis le fond
export const COURT_MARGIN = 1.2; // zone autour du terrain ou l'on peut toucher (volant dehors)
export const COURTS: { id: CourtKind; name: string; width: number }[] = [
  { id: "HALF", name: "Demi-terrain (sans couloir)", width: 2.59 },
  { id: "SINGLE", name: "Terrain de simple", width: 5.18 },
  { id: "DOUBLE", name: "Terrain de double", width: 6.1 },
];
export const courtWidth = (k: CourtKind) => COURTS.find((c) => c.id === k)?.width ?? 2.59;
export const readCourt = (v: unknown): CourtKind => (v === "SINGLE" || v === "DOUBLE" ? v : "HALF");

// Ou est tombe le volant : camp (0 = A en haut, 1 = B en bas), dans les lignes ou pas, sur le filet.
export function zoneOf(kind: CourtKind, x: number, y: number): { side: 0 | 1; inBounds: boolean; net: boolean } {
  const w = courtWidth(kind);
  return { side: y < NET_Y ? 0 : 1, inBounds: x >= 0 && x <= w && y >= 0 && y <= COURT_LENGTH, net: Math.abs(y - NET_Y) < 0.3 };
}
// Qui marque, d'apres l'impact : dans les lignes = l'adversaire du camp touche ; dehors = le joueur de ce camp (c'est
// l'autre qui a envoye le volant dehors) ; filet = on ne sait pas.
export function guessWinner(kind: CourtKind, x: number, y: number): 0 | 1 | null {
  const z = zoneOf(kind, x, y);
  if (z.net) return null;
  return z.inBounds ? ((1 - z.side) as 0 | 1) : z.side;
}

// ===== Couches =====
export const SCOUT_LAYERS: { level: number; name: string; hint: string }[] = [
  { level: 1, name: "📍 Impact + comment le point finit", hint: "Un toucher là où le volant est tombé, puis : gagné, ou concédé (service raté, filet, dehors, raté)." },
  { level: 2, name: "🏸 + le coup", hint: "Le coup qui a fini l'échange." },
  { level: 3, name: "🧍 + le frappeur", hint: "Un 2e toucher : où était le joueur qui a frappé." },
  { level: 4, name: "🎯 + faute provoquée ou directe", hint: "Pour un point concédé : l'adversaire l'a-t-il mis en difficulté, ou est-ce une faute directe ?" },
];
export const MAX_LAYER = 4;
// VERROU (Sartay 26/11 : « les scoutings doivent etre des options que le prof deverrouille ou pas au cours ; il peut
// deverrouiller pour tout le monde, ou pour certains eleves (pour le cours) en cliquant sur leur profil ») : verrouille
// par defaut ; `on` = deverrouille pour toute la classe pendant ce cours, `unlocked` = les eleves deverrouilles un par un
// pour ce cours (leur nom, n'importe ou sur la page badminton du prof). Deverrouille = noter les impacts quand il arbitre
// en direct, et « Scouter un joueur » (fiche technique). Recevoir l'analyse de son scouting ne depend pas du verrou.
export type ScoutConfig = { on: boolean; court: CourtKind; level: number; students: Record<string, { level: number; at: number }>; unlocked: string[] };
export const scoutUnlocked = (c: ScoutConfig, studentId: string) => c.on || c.unlocked.includes(studentId);
export function readScoutConfig(settings: unknown): ScoutConfig {
  const o = ((settings as { scout?: unknown } | null)?.scout ?? {}) as Record<string, unknown>;
  const lvl = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= MAX_LAYER ? Number(v) : null);
  const st = o.students && typeof o.students === "object" ? (o.students as Record<string, unknown>) : {};
  // level 0 = « comme la séance » (le prof a retiré le réglage particulier de cet élève).
  const students = Object.fromEntries(Object.entries(st).flatMap(([id, v]) => {
    const x = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    const l = x ? (Number(x.level) === 0 ? 0 : lvl(x.level)) : null;
    return l !== null && Number(x!.at) > 0 ? [[id, { level: l, at: Number(x!.at) }]] : [];
  }));
  const unlocked = Array.isArray(o.unlocked) ? [...new Set(o.unlocked.filter((x): x is string => typeof x === "string"))] : [];
  return { on: o.on === true, court: readCourt(o.court), level: lvl(o.level) ?? 1, students, unlocked };
}
// Couches d'un eleve : le dernier reglage du prof pour lui (toutes seances), sinon celui de la seance.
export function studentLayer(studentId: string, session: ScoutConfig, all: ScoutConfig[]): number {
  let best: { level: number; at: number } | null = null;
  for (const c of [session, ...all]) { const s = c.students[studentId]; if (s && (!best || s.at > best.at)) best = s; }
  return best && best.level > 0 ? best.level : session.level;
}
// Reglage particulier en vigueur pour un eleve (null = comme la seance).
export function studentOwnLayer(studentId: string, session: ScoutConfig, all: ScoutConfig[]): number | null {
  let best: { level: number; at: number } | null = null;
  for (const c of [session, ...all]) { const s = c.students[studentId]; if (s && (!best || s.at > best.at)) best = s; }
  return best && best.level > 0 ? best.level : null;
}

// ===== Les coups =====
export type StrokeId = "SS" | "SL" | "CL" | "SM" | "DR" | "LO";
export const STROKES: { id: StrokeId; name: string; emoji: string; criteria: string[] }[] = [
  { id: "SS", name: "Service court", emoji: "🎯", criteria: [
    "Volant frappé sous la taille, tête de raquette vers le bas (service réglementaire).",
    "Geste court et poussé, sans élan : le volant est guidé, pas frappé.",
    "Le volant passe juste au-dessus du filet (trajectoire rasante).",
    "Il tombe juste derrière la ligne de service court adverse.",
  ] },
  { id: "SL", name: "Service long", emoji: "🚀", criteria: [
    "Volant frappé sous la taille (service réglementaire).",
    "Bras armé et poids du corps transféré de l'arrière vers l'avant.",
    "Trajectoire haute : le volant passe au-dessus de la raquette de l'adversaire.",
    "Il retombe au fond du terrain, près de la ligne de fond.",
  ] },
  { id: "CL", name: "Clear", emoji: "🌈", criteria: [
    "Placé sous et derrière le volant (pas de frappe en reculant).",
    "Frappe haute, bras tendu, au-dessus et devant la tête.",
    "Trajectoire haute et longue, au-dessus de l'adversaire.",
    "Le volant retombe au fond du terrain adverse.",
  ] },
  { id: "SM", name: "Smash", emoji: "⚡", criteria: [
    "Placé derrière le volant, de profil (épaule vers le filet).",
    "Frappe au point le plus haut, devant le corps, poignet fouetté.",
    "Trajectoire descendante et rapide, vers le sol adverse.",
    "Visé loin de l'adversaire, ou sur son corps.",
  ] },
  { id: "DR", name: "Drop (amorti)", emoji: "🪶", criteria: [
    "Même préparation qu'un clear : le coup ne se devine pas.",
    "Frappe freinée au dernier moment : le volant part lentement.",
    "Le volant passe juste au-dessus du filet et retombe vite.",
    "Il tombe devant la ligne de service court adverse.",
  ] },
  { id: "LO", name: "Lob", emoji: "🛡️", criteria: [
    "Fente avant, pied du côté de la raquette devant.",
    "Frappe sous le volant, de bas en haut, le bras accompagne.",
    "Trajectoire haute, au-dessus de la raquette de l'adversaire.",
    "Le volant retombe au fond du terrain adverse.",
  ] },
];
// Coup qui finit un echange (couche 2) : les 6 coups, plus le jeu au filet et « autre ».
export type EndStroke = StrokeId | "NE" | "OT";
export const END_STROKES: { id: EndStroke; name: string; emoji: string }[] = [...STROKES.map((s) => ({ id: s.id as EndStroke, name: s.name, emoji: s.emoji })), { id: "NE", name: "Jeu au filet", emoji: "🕸️" }, { id: "OT", name: "Autre", emoji: "❔" }];
export type EndKind = "WIN" | "FORCED" | "UNFORCED";
export const END_KINDS: { id: EndKind; name: string }[] = [{ id: "WIN", name: "Point gagnant" }, { id: "FORCED", name: "Faute provoquée" }, { id: "UNFORCED", name: "Faute directe" }];

// ===== Comment le point s'est fini : ETAPE 1 du scouting (Sartay 26/11 soir) =====
// « Quand le point est termine, expliquer pourquoi : le scout indique sur le terrain ou le volant est tombe et la maniere
// dont le point a ete marque. A. le point a ete gagne : il tombe dans le terrain adverse. B. le point est concede : le
// joueur a rate son service, ou dans le jeu il tape dans le filet, envoie hors du terrain adverse, ou tape a cote. »
// WIN = point GAGNE par w ; les quatre autres = point CONCEDE par l'autre joueur (1 - w).
export type RallyHow = "WIN" | "SERVE" | "NET" | "OUT" | "MISS";
export const HOWS: { id: RallyHow; name: string; emoji: string; hint: string }[] = [
  { id: "WIN", name: "Gagné", emoji: "✅", hint: "le volant tombe dans le terrain adverse" },
  { id: "SERVE", name: "Service raté", emoji: "🏸", hint: "faute au service" },
  { id: "NET", name: "Filet", emoji: "🕸️", hint: "le volant va dans le filet" },
  { id: "OUT", name: "Dehors", emoji: "↗️", hint: "envoyé hors du terrain adverse" },
  { id: "MISS", name: "Raté", emoji: "💨", hint: "tapé à côté du volant" },
];
export const CONCEDED: RallyHow[] = ["SERVE", "NET", "OUT", "MISS"];
// « Filet d'Arthur », « Raté de Stefano ».
export const deName = (n: string) => (/^[aeiouyhàâäéèêëîïôöûü]/i.test(n) ? `d'${n}` : `de ${n}`);
export const howInfo = (h: RallyHow) => HOWS.find((x) => x.id === h)!;
const readHow = (v: unknown): RallyHow | undefined => (HOWS.some((h) => h.id === v) ? (v as RallyHow) : undefined);
// Echanges notes avant le 26/11 soir (sans maniere) : devinee d'apres l'endroit (dans les lignes = gagne, dehors, filet).
export function howOf(r: { court: CourtKind; x: number; y: number; how?: RallyHow }): RallyHow {
  if (r.how) return r.how;
  const z = zoneOf(r.court, r.x, r.y);
  return z.net ? "NET" : z.inBounds ? "WIN" : "OUT";
}
// Les manieres possibles d'apres l'endroit touche, la plus probable d'abord. by = qui GAGNE (WIN) ou qui CONCEDE ; w = qui
// marque. X = le camp ou le volant est tombe, O = l'autre joueur. server = qui servait, si on le sait (sinon : au filet,
// le serveur est du cote ou le volant retombe ; ailleurs, il l'a envoye dans le camp adverse).
// - Dans le terrain de X : gagne par O · rate par X (tape a cote) · service rate.
// - Dehors, du cote de X : dehors, envoye par O · service rate.
// - Au filet : filet de l'un ou de l'autre · service rate.
export type HowOption = { how: RallyHow; by: 0 | 1; w: 0 | 1 };
export function howOptions(kind: CourtKind, x: number, y: number, server: 0 | 1 | null = null): HowOption[] {
  const z = zoneOf(kind, x, y);
  const X = z.side, O = (1 - X) as 0 | 1;
  const opt = (how: RallyHow, by: 0 | 1): HowOption => ({ how, by, w: how === "WIN" ? by : ((1 - by) as 0 | 1) });
  if (z.net) return [opt("NET", X), opt("NET", O), ...(server === null ? [opt("SERVE", X), opt("SERVE", O)] : [opt("SERVE", server)])];
  const serve = opt("SERVE", server ?? O);
  if (z.inBounds) return [opt("WIN", O), opt("MISS", X), serve];
  return [opt("OUT", O), serve];
}
// Le coup qui finit l'echange (couche 2) : joue par le gagnant si le point est gagne ou si l'autre a tape a cote ; par
// celui qui concede s'il a mis le volant dehors, dans le filet ou rate son service.
export const strokeByWinner = (how: RallyHow) => how === "WIN" || how === "MISS";

// ===== Un echange note (ligne RALLY) =====
// w = qui marque (0 = A, 1 = B) ; stroke = coup qui finit l'echange ; hx/hy = position du frappeur ; end = gagnant / faute.
// how (26/11 soir) = comment le point s'est fini (voir HOWS) ; absent sur les echanges notes avant : howOf le devine.
export type Rally = { court: CourtKind; x: number; y: number; w: 0 | 1; how?: RallyHow; stroke?: EndStroke; hx?: number; hy?: number; end?: EndKind; layer: number };
const num = (v: unknown, lo: number, hi: number) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Math.round(Number(v) * 100) / 100 : null);
export function readRally(raw: unknown): Rally | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const court = readCourt(o.court);
  const w = courtWidth(court);
  const x = num(o.x, -COURT_MARGIN, w + COURT_MARGIN), y = num(o.y, -COURT_MARGIN, COURT_LENGTH + COURT_MARGIN);
  if (x === null || y === null || (o.w !== 0 && o.w !== 1)) return null;
  const stroke = END_STROKES.some((s) => s.id === o.stroke) ? (o.stroke as EndStroke) : undefined;
  const hx = num(o.hx, -COURT_MARGIN, w + COURT_MARGIN), hy = num(o.hy, -COURT_MARGIN, COURT_LENGTH + COURT_MARGIN);
  const end = END_KINDS.some((k) => k.id === o.end) ? (o.end as EndKind) : undefined;
  const layer = Number.isInteger(Number(o.layer)) ? Math.max(1, Math.min(MAX_LAYER, Number(o.layer))) : 1;
  const how = readHow(o.how);
  return { court, x, y, w: o.w, ...(how ? { how } : {}), ...(stroke ? { stroke } : {}), ...(hx !== null && hy !== null ? { hx, hy } : {}), ...(end ? { end } : {}), layer };
}

// Les echanges d'un joueur, vus de SON cote : son camp en bas (on retourne le terrain s'il etait A, en haut).
export type MyRally = Rally & { won: boolean; matchId: string; at: number };
export function myRallies(list: { matchId: string; at: number; rally: Rally; side: 0 | 1 }[]): MyRally[] {
  return list.map(({ matchId, at, rally: r, side }) => {
    const w = courtWidth(r.court);
    const flip = side === 0;
    const fx = (x: number) => (flip ? w - x : x), fy = (y: number) => (flip ? COURT_LENGTH - y : y);
    return { ...r, x: fx(r.x), y: fy(r.y), ...(r.hx !== undefined && r.hy !== undefined ? { hx: fx(r.hx), hy: fy(r.hy) } : {}), w: (flip ? 1 - r.w : r.w) as 0 | 1, won: r.w === side, matchId, at };
  });
}

// ===== Fiche technique (ligne SCOUT) =====
// strokes[id] = null (pas vu) ou { c: 4 criteres reussis ou pas, heart : ❤️ « vraiment tres bien fait » (si les 4) }.
export type StrokeMark = { c: [boolean, boolean, boolean, boolean]; heart: boolean };
export type StrokeSheet = Partial<Record<StrokeId, StrokeMark>>;
export function readStrokeSheet(raw: unknown): StrokeSheet | null {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? ((raw as { strokes?: unknown }).strokes as Record<string, unknown> | undefined) : undefined;
  if (!o || typeof o !== "object") return null;
  const out: StrokeSheet = {};
  for (const s of STROKES) {
    const v = o[s.id] as { c?: unknown; heart?: unknown } | null | undefined;
    if (!v || !Array.isArray(v.c) || v.c.length !== 4) continue;
    const c = v.c.map((x) => x === true) as [boolean, boolean, boolean, boolean];
    out[s.id] = { c, heart: v.heart === true && c.every(Boolean) };
  }
  return Object.keys(out).length ? out : null;
}
// Note d'un coup observe (bareme du Hyrox / Level) : 0..4 criteres = TI, I, S, B, TB ; 4 + ❤️ = E.
export const STROKE_LEVELS = ["TI", "I", "S", "B", "TB", "E"] as const;
export const strokeLevel = (m: StrokeMark) => STROKE_LEVELS[m.c.filter(Boolean).length + (m.heart ? 1 : 0)];
// Synthese de toutes les fiches d'un joueur : par coup, nombre d'observations, part de chaque critere reussi, niveau moyen.
export type StrokeSummary = { id: StrokeId; seen: number; criteria: number[]; mean: number | null; level: string | null };
export function strokeSummary(sheets: StrokeSheet[]): StrokeSummary[] {
  return STROKES.map((s) => {
    const marks = sheets.map((x) => x[s.id]).filter((m): m is StrokeMark => !!m);
    const crit = [0, 1, 2, 3].map((i) => (marks.length ? marks.filter((m) => m.c[i]).length / marks.length : 0));
    const mean = marks.length ? marks.reduce((t, m) => t + m.c.filter(Boolean).length + (m.heart ? 1 : 0), 0) / marks.length : null;
    return { id: s.id, seen: marks.length, criteria: crit, mean, level: mean === null ? null : STROKE_LEVELS[Math.round(mean)] };
  });
}

// ===== Analyse d'une seance, cote prof (Sartay 24/11 : « il faudra qu'on puisse analyser les stats de scouting ») =====
// Pour chaque eleve : ses echanges notes (gagnes, perdus, ses fautes dehors / au filet), ses fiches techniques recues
// (niveau moyen par coup), et ce qu'il a scoute lui-meme (impacts notes comme arbitre, fiches remplies).
// winners = ses points GAGNES (volant tombe chez l'adversaire) ; serve / net / out / miss = les points qu'il a CONCEDES.
export type ScoutRow = { id: string; rallies: number; won: number; lost: number; winners: number; serve: number; out: number; net: number; miss: number; sheets: number; levels: Partial<Record<StrokeId, string | null>>; gaveRallies: number; gaveSheets: number };
type EvLike = { id?: string; kind: string; authorId: string; at: number; targetId?: string | null; data?: unknown };
// Les impacts annules d'un match (lignes UNRALLY, 26/11) : l'analyse les ignore.
export const undoneRallies = (events: { kind: string; targetId?: string | null }[]): Set<string> => new Set(events.filter((e) => e.kind === "UNRALLY" && e.targetId).map((e) => e.targetId as string));
type MatchLike = { id: string; playerAId: string; playerBId: string; events: EvLike[]; cancelled: boolean };
export function sessionScoutRows(matches: MatchLike[], ids: string[]): ScoutRow[] {
  return ids.map((id) => {
    const raw: { matchId: string; at: number; rally: Rally; side: 0 | 1 }[] = [];
    const latest = new Map<string, { at: number; sheet: StrokeSheet }>();
    let gaveRallies = 0, gaveSheets = 0;
    for (const m of matches) {
      if (m.cancelled) continue;
      const side = m.playerAId === id ? 0 : m.playerBId === id ? 1 : null;
      const undone = undoneRallies(m.events);
      for (const e of m.events) {
        if (e.kind === "RALLY" && e.id && undone.has(e.id)) continue;
        if (e.kind === "RALLY" && e.authorId === id) gaveRallies++;
        if (e.kind === "SCOUT" && e.authorId === id) gaveSheets++;
        if (side === null) continue;
        if (e.kind === "RALLY") { const r = readRally(e.data); if (r) raw.push({ matchId: m.id, at: e.at, rally: r, side }); }
        if (e.kind === "SCOUT" && e.targetId === id) {
          const s = readStrokeSheet(e.data);
          const k = `${m.id}|${e.authorId}`;
          if (s && (!latest.has(k) || latest.get(k)!.at < e.at)) latest.set(k, { at: e.at, sheet: s });
        }
      }
    }
    const mine = myRallies(raw);
    const lost = mine.filter((r) => !r.won);
    const gave = (h: RallyHow) => lost.filter((r) => howOf(r) === h).length;
    const sum = strokeSummary([...latest.values()].map((x) => x.sheet));
    return {
      id, rallies: mine.length, won: mine.length - lost.length, lost: lost.length,
      winners: mine.filter((r) => r.won && howOf(r) === "WIN").length,
      serve: gave("SERVE"), out: gave("OUT"), net: gave("NET"), miss: gave("MISS"),
      sheets: latest.size, levels: Object.fromEntries(sum.map((s) => [s.id, s.level])), gaveRallies, gaveSheets,
    };
  });
}
