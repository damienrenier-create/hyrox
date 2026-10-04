// QCM bonus du WOD Hyrox (Sartay 01/10) : 5 questions sur les criteres de realisation. Pour chaque exercice, l'eleve
// coche les affirmations VRAIES (1 a 3 sur 4). Les vraies viennent des criteres de Sartay (level-criteria.ts) ; les
// fausses sont des formulations plausibles mais contraires a SES regles — y compris d'anciens criteres abandonnes —
// que ni un eleve qui n'a pas ecoute ni une IA generaliste ne reperent. Tirage deterministe par (seance, eleve) : chaque
// eleve a son QCM, la correction se recalcule cote serveur. Module PUR.

import { CRITERIA } from "@/lib/level-criteria";

export const QUIZ_QUESTIONS = 5;
export const QUIZ_STATEMENTS = 4;

// Affirmations FAUSSES par exercice (3 chacune), contraires aux criteres de Sartay.
export const DISTRACTORS: Record<string, string[]> = {
  POMPES: [
    "Les genoux peuvent se poser au sol pour garder le rythme.",
    "La poitrine descend à mi-hauteur, jamais jusqu'au sol, pour protéger les épaules.",
    "Les bras restent légèrement fléchis en haut pour garder la tension.",
  ],
  "SQUATS JUMP": [
    "Le bassin s'arrête au niveau des genoux, jamais plus bas, pour préserver les ligaments.",
    "L'atterrissage se fait talons d'abord, jambes tendues, pour gagner du temps.",
    "Le regard est dirigé vers le sol pour contrôler l'atterrissage.",
  ],
  BURPEES: [
    "Seules les mains et les genoux touchent le sol lors de la phase basse.",
    "Les mains restent le long du corps au moment du saut.",
    "Les pieds reviennent vers les mains un par un, en marchant.",
  ],
  "COMMANDO BRAS": [
    "L'élève monte toujours avec le même bras pour garder le rythme.",
    "Les coudes se posent plus en avant que les mains pour avancer.",
    "Un balancement des hanches aide à monter sur les mains.",
  ],
  "BREAK DANCE": [
    "La jambe qui passe sous le corps reste fléchie, genou près de la poitrine.",
    "Le bassin se pose au sol à chaque passage pour marquer la répétition.",
    "Les deux mains restent au sol pendant la rotation.",
  ],
  "ONE REP": [
    "L'élève démarre en planche, dos plat.",
    "Les touches se font du même côté (main droite / genou droit).",
    "Les pieds peuvent avancer d'un pas à chaque répétition.",
  ],
  CORDE: [
    "La corde est lancée avec de grands mouvements des bras entiers.",
    "Les sauts sont hauts, genoux tendus, pour passer la corde largement.",
    "Les épaules sont remontées vers les oreilles pour stabiliser les bras.",
  ],
  "SMASH DOWN": [
    "La balle est simplement lâchée depuis la hauteur de la tête, sans la propulser.",
    "L'élève ramasse la balle en se penchant, jambes tendues, pour aller plus vite.",
    "La balle part de la hauteur des épaules, coudes fléchis.",
  ],
  "WALL BALL SHOT": [
    "La balle est réceptionnée bras tendus, debout, avant de redescendre en squat.",
    "Le lancer se fait à la force des bras, les jambes restant tendues.",
    "Un quart de squat suffit, l'important est la hauteur du lancer.",
  ],
  "TIRE TAPIS": [
    "L'élève s'enroule vers l'avant pour mettre tout son poids dans la traction.",
    "La traction se fait par à-coups, avec une pause entre chaque tirage.",
    "L'élève tire avec les bras, jambes immobiles.",
  ],
  "FLIP TAPIS": [
    "Le tapis est soulevé dos rond, jambes tendues, pour utiliser le poids du corps.",
    "L'élève change de côté de regard à chaque bascule.",
    "Plus le tapis retombe loin, mieux c'est.",
  ],
  "KB SNATCH": [
    "La kettlebell tape l'avant-bras à la réception : c'est le signe d'un mouvement complet.",
    "Le mouvement est tiré par le bras, les hanches restent fixes.",
    "Le bras reste fléchi en haut pour amortir.",
  ],
  "KB SWING": [
    "Les bras tirent la kettlebell vers le haut, comme une élévation frontale.",
    "Le dos s'arrondit en bas pour aller chercher la kettlebell plus loin.",
    "L'élève inspire en montant le poids et expire en descendant.",
  ],
  "KB TOUR": [
    "Un léger balancement du bassin accompagne le passage de la kettlebell.",
    "La kettlebell tourne loin du corps, bras tendus.",
    "Le poids doit être léger pour tourner le plus vite possible.",
  ],
  "ALLER-RETOUR": [
    "L'élève freine en abaissant son centre de gravité avant la ligne.",
    "Il suffit d'approcher la ligne à un pas pour faire demi-tour.",
    "L'allure est un footing régulier pour tenir la durée.",
  ],
  "MONKEY SLIDE": [
    "Les pieds atterrissent l'un après l'autre pour plus d'équilibre.",
    "Les mains frôlent à peine le tapis pendant le passage.",
    "L'élève reste jambes tendues à la réception.",
  ],
  "PLANK SLIDE": [
    "Le poids est déposé au centre du tapis, entre les mains.",
    "La main droite tire le disque situé à droite (même côté).",
    "Le bassin se soulève pendant le glissement pour alléger les bras.",
  ],
  "FENTES DISK": [
    "Le genou arrière reste à mi-hauteur, sans jamais s'approcher du sol.",
    "Le genou avant dépasse largement la pointe du pied pour allonger le pas.",
    "Le buste se penche vers l'avant pour équilibrer le disque.",
  ],
  TRACTIONS: [
    "Les bras restent légèrement fléchis en bas pour enchaîner plus vite.",
    "Un balancement des jambes est autorisé pour aider la montée.",
    "Le front arrive au niveau de la barre.",
  ],
  "BOX JUMP": [
    "Le saut se fait un pied après l'autre, comme une montée de marche.",
    "L'élève reste fléchi sur la box et redescend aussitôt pour gagner du temps.",
    "Le retour au sol se fait en sautant jambes tendues.",
  ],
  SQUATS: [
    "Les talons décollent pour descendre plus bas.",
    "Le bassin s'arrête à la hauteur des genoux (cuisses parallèles au sol) : descendre plus bas ne compte pas.",
    "Les genoux rentrent vers l'intérieur à la remontée pour plus de force.",
    "En haut, les genoux restent légèrement fléchis pour enchaîner plus vite.",
  ],
  HELICO: [
    "L'élève se redresse en appui sur les coudes pour faire passer le poids.",
    "Le poids passe devant le ventre, jamais dans le dos.",
    "Les mains se posent au sol entre deux tours.",
  ],
  // Stations du WOD Eval (04/10) : le contraire des standards HYROX retenus dans level-criteria.ts.
  "BURPEES BROAD JUMP": [
    "Les mains se posent le plus loin possible devant les pieds pour gagner de la distance.",
    "Une fois les mains posées, on peut les avancer pour allonger le burpee.",
    "En se relevant, les pieds peuvent se poser devant les mains pour gagner du terrain.",
    "Un petit pas d'ajustement est autorisé entre la réception et le burpee suivant.",
    "Le saut part d'un pied et se réceptionne sur l'autre, comme une foulée bondissante.",
  ],
  "FENTES MARCHÉES": [
    "Le genou arrière s'arrête à quelques centimètres du sol, sans jamais le toucher.",
    "On enchaîne les fentes en restant fléchi : se redresser complètement fait perdre du temps.",
    "L'élève garde toujours la même jambe devant pour aller plus vite.",
    "Deux petits pas sont autorisés entre deux fentes pour se replacer.",
    "À l'extrémité, il suffit que le genou arrière atteigne la ligne avant de faire demi-tour.",
  ],
  "FARMER CARRY": [
    "Quand c'est trop lourd, on peut traîner la charge au sol sur quelques mètres.",
    "Il suffit que la charge dépasse la ligne : les pieds peuvent rester derrière.",
    "Les charges peuvent être portées sur les épaules ou contre le ventre pour soulager les mains.",
    "Pour se reposer, on fait glisser les charges vers l'avant en les posant : c'est toujours ça de gagné.",
    "Les charges sont lâchées au sol dès que la ligne est franchie.",
    "Les charges sont ramassées jambes tendues, en se penchant.",
  ],
  "TOUR DE POUTRE": [
    "Au-dessus, l'élève reste au ras de la poutre pour gagner du temps.",
    "En dessous, le dos glisse sur le sol pour passer plus vite.",
    "Une pause entre dessus et dessous est prévue pour se replacer.",
  ],
};

// Exercices qui ont a la fois des criteres et des faux : le vivier du QCM.
export const QUIZ_POOL = Object.keys(CRITERIA).filter((k) => (DISTRACTORS[k]?.length ?? 0) >= 3);

export type QuizStatement = { id: string; text: string };
export type QuizQuestion = { id: string; exercise: string; statements: QuizStatement[] };
export type QuizKey = Record<string, string[]>; // question -> ids des affirmations VRAIES

// Generateur deterministe (xmur3 + mulberry32).
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Le QCM d'un eleve pour une seance : `questions` (sans dire ce qui est vrai) et `key` (la correction, cote serveur).
export function buildQuiz(seed: string, n = QUIZ_QUESTIONS): { questions: QuizQuestion[]; key: QuizKey } {
  const rnd = seeded(seed);
  const exercises = shuffle(QUIZ_POOL, rnd).slice(0, n);
  const questions: QuizQuestion[] = [];
  const key: QuizKey = {};
  for (const ex of exercises) {
    const trues = CRITERIA[ex];
    const falses = DISTRACTORS[ex];
    // 1 a 3 vraies parmi les criteres techniques (les 5 premiers ; le 6e est souvent « il fait de son mieux »).
    const nTrue = 1 + Math.floor(rnd() * 3);
    const pickT = shuffle(trues.slice(0, Math.min(5, trues.length)).map((t, i) => ({ id: `v${i}`, text: t })), rnd).slice(0, nTrue);
    const pickF = shuffle(falses.map((t, i) => ({ id: `f${i}`, text: t })), rnd).slice(0, QUIZ_STATEMENTS - nTrue);
    const statements = shuffle([...pickT, ...pickF], rnd);
    questions.push({ id: ex, exercise: ex, statements });
    key[ex] = pickT.map((t) => t.id).sort();
  }
  return { questions, key };
}

export const quizSeed = (sessionId: string, studentId: string) => `qcm:${sessionId}:${studentId}`;

// Note : 1 point par question entierement juste (toutes les vraies cochees, aucune fausse).
export function gradeQuiz(key: QuizKey, checked: Record<string, string[]>): { score: number; total: number; perQuestion: Record<string, boolean> } {
  const perQuestion: Record<string, boolean> = {};
  let score = 0;
  for (const [q, truth] of Object.entries(key)) {
    const got = [...new Set(checked[q] ?? [])].sort();
    const ok = got.length === truth.length && got.every((v, i) => v === truth[i]);
    perQuestion[q] = ok;
    if (ok) score++;
  }
  return { score, total: Object.keys(key).length, perQuestion };
}

// Libelle lisible d'un exercice du catalogue (« WALL BALL SHOT » -> « Wall ball shot »).
export const exerciseTitle = (key: string) => key.charAt(0) + key.slice(1).toLowerCase();
