// Six propositions d'echelle pour le WOD Level (24-25/09/2026), 25 niveaux chacune, BOSS aux niveaux 5, 10,
// 15, 20 et 25 (un seul exercice, toute l'equipe dessus en simultane). Le cinquieme bloc (21-24 + BOSS 25) a
// ete ajoute le 25/09 (Sartay : « un dernier palier de 4, avec un dernier boss, toujours plus difficile »).
//
// MODELE DE TEMPS (Sartay) : les 5 membres travaillent en parallele sur le niveau, en relais sur les exos.
// Un niveau dure donc le temps de sa fiche la plus longue, pas la somme des fiches. Chaque proposition est
// donc decrite par une RAMPE de duree cible D par niveau et, pour chaque niveau, la liste des exercices :
// les reps de chaque fiche sont calculees pour que la fiche dure ~D (un membre par fiche), ou D x 5/6 quand
// il y a six fiches (le plus rapide en prend deux). Un BOSS = reps x ponderation / 5 (tous en meme temps).
//
// Contraintes communes : identites validees par Sartay, alternees entre les BOSS ; atelier d'un BOSS
// gourmand en materiel (barres, tapis, KB, cordes) au repos dans les niveaux juste avant ; SKILL (smash
// down, wall ball shot) a petites doses ; 3 a 6 fiches par niveau ; difficulte croissante.
// Module pur (pas de base) : sert a l'atelier /admin/level et au rapport PDF.

import { DEFAULT_EXERCISES } from "./level-catalog";

export type Identity = "cardio" | "jambes" | "bras" | "tronc" | "full";
export type ProposedLevel = { name: string; identity: Identity; cards: [label: string, reps: number][] };
type Spec =
  | { identity: Identity; name: string; exos: string[] }
  | { boss: true; identity: Identity; name: string; label: string; reps: number }
  | { fixed: true; identity: Identity; name: string; cards: [label: string, reps: number][] }; // fiches ecrites a la main (F)
export type Proposal = {
  key: "A" | "B" | "C" | "D" | "E" | "F";
  title: string;
  philosophy: string;
  strengths: string[];
  weaknesses: string[];
  ramp: number[]; // duree cible D (s) des 20 niveaux ordinaires, dans l'ordre (vide pour une echelle ecrite a la main)
  specs: Spec[];
};

export const IDENTITY_LABEL: Record<Identity, string> = { cardio: "Cardio", jambes: "Jambes", bras: "Bras", tronc: "Tronc", full: "Full body" };
export const IDENTITY_OF: Record<string, Identity[]> = {
  CORDE: ["cardio"], "ALLER-RETOUR": ["cardio"], "BOX JUMP": ["cardio", "jambes"], BURPEES: ["cardio", "full"],
  "SQUATS JUMP": ["jambes"], "FENTES DISK": ["jambes"], "MONKEY SLIDE": ["jambes"], "TIRE TAPIS AR": ["jambes"],
  POMPES: ["bras"], TRACTIONS: ["bras"], "COMMANDO BRAS": ["bras", "tronc"],
  "PLANK SLIDE": ["tronc"], "KB TOUR": ["tronc"],
  "KB SWING": ["full"], "KB SNATCH": ["full"], "SMASH DOWN": ["full"], "WALL BALL SHOT": ["full"],
  "FLIP TAPIS": ["full"], "BREAK DANCE": ["full"], "ONE REP": ["full"], "TOUR DE POUTRE": ["full"],
};
export const SKILL = new Set(["SMASH DOWN", "WALL BALL SHOT"]);
// Exercices qui immobilisent du materiel partage (une file possible si trop d'equipes dessus).
export const EQUIPMENT: Record<string, string> = {
  TRACTIONS: "barres", "KB SWING": "kettlebells", "KB SNATCH": "kettlebells", "KB TOUR": "kettlebells",
  "TIRE TAPIS AR": "tapis", "FLIP TAPIS": "tapis", "BOX JUMP": "box", "WALL BALL SHOT": "medecine balls",
  "SMASH DOWN": "slam balls", "FENTES DISK": "disques", CORDE: "cordes", "TOUR DE POUTRE": "poutre", "PLANK SLIDE": "sliders", "MONKEY SLIDE": "sliders",
};

const W = new Map(DEFAULT_EXERCISES.map((e) => [e.label, e.weight]));
export const weightOf = (label: string) => {
  const w = W.get(label);
  if (w === undefined) throw new Error(`Exercice inconnu : ${label}`);
  return w;
};
// Reps « rondes » pour une duree cible : dizaines au-dela de 100, multiples de 5 au-dela de 20, pairs au-dela de 8.
export function repsFor(label: string, seconds: number): number {
  const raw = seconds / weightOf(label);
  const step = raw >= 100 ? 10 : raw >= 20 ? 5 : raw >= 8 ? 2 : 1;
  return Math.max(1, Math.round(raw / step) * step);
}

const L = (identity: Identity, name: string, ...exos: string[]): Spec => ({ identity, name, exos });
const FX = (identity: Identity, name: string, ...cards: [string, number][]): Spec => ({ fixed: true, identity, name, cards });
const BOSS = (identity: Identity, name: string, label: string, reps: number): Spec => ({ boss: true, identity, name, label, reps });

// Rampe standard : 55 s au premier niveau, 205 s au dix-neuvieme, 245 s au vingt-quatrieme (les BOSS ont
// leur propre duree).
const STD = [55, 65, 80, 95, 100, 110, 120, 130, 140, 150, 160, 170, 175, 185, 195, 205, 215, 225, 235, 245];
const scale = (k: number) => STD.map((d) => Math.round((d * k) / 5) * 5);

// Fiche « ouverture » (Sartay, mode zombies) : un exercice tres facile, connu, au nom court et sans materiel,
// pour ecarter vite la premiere fiche du zombie. Tournante, jamais l'exercice du BOSS du bloc en cours.
export const OPENERS: [string, number][] = [["SQUATS JUMP", 20], ["POMPES", 20], ["CORDE", 20], ["ALLER-RETOUR", 2], ["TRACTIONS", 10], ["TIRE TAPIS AR", 1]];

export function materialize(p: Proposal): ProposedLevel[] {
  let i = 0;
  return p.specs.map((s, idx) => {
    if ("boss" in s) return { name: `BOSS · ${s.name}`, identity: s.identity, cards: [[s.label, s.reps]] };
    if ("fixed" in s) return { name: s.name, identity: s.identity, cards: s.cards.map((c) => [...c] as [string, number]) };
    const D = p.ramp[i++];
    const per = D * Math.min(1, 5 / s.exos.length); // six fiches : le plus rapide en prend deux
    const nextBoss = p.specs.slice(idx + 1).find((x) => "boss" in x);
    const bossLabel = nextBoss && "boss" in nextBoss ? nextBoss.label : null;
    let opener = OPENERS[idx % OPENERS.length];
    for (let k = 0; k < OPENERS.length && (opener[0] === bossLabel || s.exos.includes(opener[0])); k++) opener = OPENERS[(idx + k + 1) % OPENERS.length];
    return { name: s.name, identity: s.identity, cards: [opener, ...s.exos.map((x) => [x, repsFor(x, per)] as [string, number])] };
  });
}

export const PROPOSALS: Proposal[] = [
  {
    key: "A",
    title: "Rotation classique",
    philosophy:
      "Une identite par niveau qui tourne toujours dans le meme ordre (cardio, jambes, bras, tronc, puis full body en tete du bloc suivant), une montee reguliere de 55 s a 205 s par niveau, quatre a six fiches, des BOSS sans materiel sauf les barres du 15.",
    strengths: [
      "Lisible pour les eleves : ils savent ce qui vient apres chaque niveau.",
      "Montee tres reguliere (+10 a +15 s par niveau) : aucune marche brutale.",
      "Les groupes musculaires se relaient : peu de fatigue locale, peu de blessures.",
      "Materiel bien reparti : jamais deux exercices KB dans un niveau, barres au repos aux niveaux 11 a 14.",
    ],
    weaknesses: [
      "Plusieurs niveaux n'ont que quatre fiches : un membre sur cinq attend ou se contente de relayer.",
      "La corde revient dans 13 niveaux sur 20 : il faut au moins une corde par equipe.",
      "Peu de surprises : l'ordre se devine, la tension retombe apres le BOSS 10.",
    ],
    ramp: scale(1),
    specs: [
      L("cardio", "Mise en route", "CORDE", "ALLER-RETOUR", "BOX JUMP", "SQUATS JUMP"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "MONKEY SLIDE", "BOX JUMP", "CORDE"),
      L("bras", "Bras", "POMPES", "COMMANDO BRAS", "TRACTIONS", "CORDE"),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE"),
      BOSS("full", "Burpees", "BURPEES", 75),
      L("full", "Full body", "KB SWING", "FLIP TAPIS", "SMASH DOWN", "BREAK DANCE", "CORDE"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "MONKEY SLIDE"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "TIRE TAPIS AR"),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "CORDE", "KB TOUR"),
      BOSS("cardio", "ALLER-RETOUR", "ALLER-RETOUR", 50),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE"),
      L("full", "Full body", "KB SNATCH", "BREAK DANCE", "FLIP TAPIS", "WALL BALL SHOT", "ONE REP"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "MONKEY SLIDE"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "TIRE TAPIS AR"),
      BOSS("bras", "Tractions", "TRACTIONS", 100),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "CORDE"),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE"),
      L("full", "Full body", "KB SWING", "KB SNATCH", "SMASH DOWN", "BREAK DANCE", "FLIP TAPIS", "TOUR DE POUTRE"),
      L("jambes", "Jambes & cardio", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "TIRE TAPIS AR", "CORDE", "ALLER-RETOUR"),
      BOSS("jambes", "Squats jump", "SQUATS JUMP", 500),
      L("full", "Full body", "KB SWING", "FLIP TAPIS", "SMASH DOWN", "ONE REP", "TOUR DE POUTRE"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "MONKEY SLIDE"),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "CORDE", "KB TOUR"),
      L("tronc", "Tronc & full body", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "TIRE TAPIS AR", "WALL BALL SHOT", "BURPEES"),
      BOSS("full", "Break dance", "BREAK DANCE", 150),
    ],
  },
  {
    key: "B",
    title: "Blocs thematiques",
    philosophy:
      "Chaque bloc de quatre niveaux a une seule identite qui monte en puissance jusqu'a son BOSS : cardio et jambes pour s'echauffer, puis bras et tronc, puis full body, puis un bloc final qui melange tout. Les eleves vivent quatre « chapitres » bien distincts.",
    strengths: [
      "Forte identite par chapitre : on annonce « le bloc des bras », l'histoire se raconte facilement.",
      "Le BOSS conclut logiquement son bloc (le bloc bras et tronc finit sur 100 tractions).",
      "Le bloc final melange tout : les equipes qui y arrivent ont une vraie recompense.",
      "Facile a expliquer aux arbitres : dans un bloc, ils savent quels ateliers surveiller.",
    ],
    weaknesses: [
      "Congestion : toutes les equipes d'un meme bloc se disputent les memes ateliers (barres et KB du bloc 2, tapis et balles du bloc 3).",
      "Fatigue locale : quatre niveaux de bras et de tronc d'affilee avant le BOSS tractions.",
      "Les equipes lentes ne quittent jamais le bloc 1 : elles ne font que du cardio et des jambes de toute la seance.",
      "Le bloc 3 concentre les exercices SKILL et le materiel : plus difficile a arbitrer.",
    ],
    ramp: scale(1),
    specs: [
      L("cardio", "Cardio & jambes I", "CORDE", "BOX JUMP", "SQUATS JUMP", "FENTES DISK"),
      L("jambes", "Cardio & jambes II", "CORDE", "ALLER-RETOUR", "MONKEY SLIDE", "FENTES DISK", "SQUATS JUMP"),
      L("cardio", "Cardio & jambes III", "BOX JUMP", "SQUATS JUMP", "CORDE", "BURPEES", "MONKEY SLIDE"),
      L("jambes", "Cardio & jambes IV", "MONKEY SLIDE", "FENTES DISK", "CORDE", "BOX JUMP", "SQUATS JUMP"),
      BOSS("cardio", "ALLER-RETOUR", "ALLER-RETOUR", 40),
      L("bras", "Bras & tronc I", "POMPES", "COMMANDO BRAS", "KB TOUR", "PLANK SLIDE"),
      L("tronc", "Bras & tronc II", "PLANK SLIDE", "COMMANDO BRAS", "POMPES", "KB TOUR", "CORDE"),
      L("bras", "Bras & tronc III", "POMPES", "PLANK SLIDE", "COMMANDO BRAS", "KB TOUR"),
      L("tronc", "Bras & tronc IV", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "POMPES", "CORDE"),
      BOSS("bras", "Tractions", "TRACTIONS", 100),
      L("full", "Full body I", "KB SWING", "KB SNATCH", "FLIP TAPIS", "SMASH DOWN", "CORDE"),
      L("full", "Full body II", "BREAK DANCE", "WALL BALL SHOT", "FLIP TAPIS", "KB SWING", "TOUR DE POUTRE"),
      L("full", "Full body III", "KB SNATCH", "ONE REP", "TOUR DE POUTRE", "FLIP TAPIS", "BREAK DANCE"),
      L("full", "Full body IV", "KB SWING", "BREAK DANCE", "WALL BALL SHOT", "ONE REP", "SMASH DOWN"),
      BOSS("full", "Burpees", "BURPEES", 100),
      L("cardio", "Finale I", "CORDE", "POMPES", "FENTES DISK", "PLANK SLIDE", "ALLER-RETOUR"),
      L("bras", "Finale II", "BOX JUMP", "TRACTIONS", "KB SWING", "COMMANDO BRAS", "CORDE"),
      L("tronc", "Finale III", "MONKEY SLIDE", "POMPES", "KB SNATCH", "PLANK SLIDE", "ALLER-RETOUR"),
      L("full", "Finale IV", "BURPEES", "TIRE TAPIS AR", "FENTES DISK", "COMMANDO BRAS", "ONE REP"),
      BOSS("jambes", "Squats jump", "SQUATS JUMP", 500),
      L("cardio", "Ultime I", "CORDE", "TRACTIONS", "FENTES DISK", "KB SNATCH", "BURPEES"),
      L("bras", "Ultime II", "BOX JUMP", "POMPES", "MONKEY SLIDE", "SMASH DOWN", "ONE REP"),
      L("tronc", "Ultime III", "ALLER-RETOUR", "COMMANDO BRAS", "TIRE TAPIS AR", "PLANK SLIDE", "WALL BALL SHOT"),
      L("full", "Ultime IV", "BURPEES", "TRACTIONS", "SQUATS JUMP", "KB SWING", "FLIP TAPIS", "TOUR DE POUTRE"),
      BOSS("full", "Break dance", "BREAK DANCE", 150),
    ],
  },
  {
    key: "C",
    title: "Volume & endurance",
    philosophy:
      "Des niveaux 15 % plus longs que la rampe standard, faits d'exercices peu couteux (corde, KB tour, commando, squats, fentes, monkey slide) : l'intensite reste basse (1,5 a 2,5) mais le compteur de reps s'envole. Les BOSS sont des marathons : 600 cordes, 400 squats, 800 KB tour, 80 AR.",
    strengths: [
      "Accessible : tout le monde avance, meme les equipes faibles, la seance ne bloque personne.",
      "Peu de technique et peu de risque : les exercices sont connus de tous.",
      "Le compteur de reps explose (jusqu'a 900 reps par niveau) : tres gratifiant pour le recap et les records de reps.",
      "Bon pour l'endurance et la cooperation : le relais entre membres compte plus que la force.",
    ],
    weaknesses: [
      "Monotone : la corde est presque partout, les memes gestes reviennent sans cesse.",
      "Peu de force et peu de haut du corps : une seule fiche de tractions dans toute l'echelle.",
      "Le materiel corde et KB sature (BOSS 5 aux cordes, BOSS 15 aux kettlebells : cinq de chaque par equipe).",
      "Arbitrage difficile : compter 600 cordes est peu fiable, et le demineur a moins de gestes techniques a juger.",
      "L'ecart entre bonnes et mauvaises equipes se reduit : le classement est moins parlant.",
    ],
    ramp: scale(1.15),
    specs: [
      L("cardio", "Mise en route", "CORDE", "KB TOUR", "SQUATS JUMP"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "CORDE", "KB TOUR"),
      L("bras", "Bras", "COMMANDO BRAS", "POMPES", "KB TOUR", "SQUATS JUMP"),
      L("tronc", "Tronc", "KB TOUR", "PLANK SLIDE", "COMMANDO BRAS", "FENTES DISK"),
      BOSS("cardio", "Corde marathon", "CORDE", 600),
      L("jambes", "Jambes", "MONKEY SLIDE", "BOX JUMP", "FENTES DISK", "CORDE"),
      L("bras", "Bras", "POMPES", "COMMANDO BRAS", "KB TOUR", "CORDE"),
      L("cardio", "Cardio", "CORDE", "BOX JUMP", "ALLER-RETOUR", "MONKEY SLIDE"),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE"),
      BOSS("jambes", "Squats jump", "SQUATS JUMP", 400),
      L("full", "Full body", "FLIP TAPIS", "WALL BALL SHOT", "CORDE", "SMASH DOWN", "MONKEY SLIDE"),
      L("jambes", "Jambes", "FENTES DISK", "MONKEY SLIDE", "BOX JUMP", "CORDE", "SQUATS JUMP"),
      L("bras", "Bras", "POMPES", "COMMANDO BRAS", "TRACTIONS", "CORDE", "PLANK SLIDE"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "MONKEY SLIDE"),
      BOSS("tronc", "KB tour", "KB TOUR", 800),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE"),
      L("full", "Full body", "KB SWING", "KB SNATCH", "FLIP TAPIS", "WALL BALL SHOT", "CORDE"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "MONKEY SLIDE", "TIRE TAPIS AR", "CORDE"),
      L("bras", "Bras & tronc", "POMPES", "COMMANDO BRAS", "PLANK SLIDE", "KB TOUR", "CORDE"),
      BOSS("cardio", "ALLER-RETOUR", "ALLER-RETOUR", 80),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "MONKEY SLIDE", "CORDE", "BOX JUMP"),
      L("bras", "Bras", "POMPES", "COMMANDO BRAS", "TRACTIONS", "CORDE", "PLANK SLIDE"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "MONKEY SLIDE"),
      L("full", "Full body", "FLIP TAPIS", "WALL BALL SHOT", "SMASH DOWN", "BREAK DANCE", "CORDE"),
      BOSS("tronc", "KB tour marathon", "KB TOUR", 1500),
    ],
  },
  {
    key: "D",
    title: "Intensite & force",
    philosophy:
      "Des niveaux 15 % plus courts que la rampe standard mais faits d'exercices qui coutent cher (burpees, tractions, break dance, one rep, tire tapis, flip tapis, KB snatch) : l'intensite tourne entre 3 et 6. Les BOSS sont des epreuves de force : 75 burpees, 20 tire tapis, 120 tractions, 50 one rep.",
    strengths: [
      "Stimulus fort : vrai travail de force et de puissance, les progres se voient.",
      "Niveaux courts : les equipes changent souvent de niveau, le tableau bouge, la dynamique est excellente.",
      "Les BOSS font peur et tranchent le classement : les bonnes equipes se detachent nettement.",
      "Beaucoup de gestes techniques a juger : le demineur des arbitres a du grain a moudre.",
    ],
    weaknesses: [
      "Trop dur pour les equipes faibles : elles plafonnent tot et peuvent se decourager.",
      "Fatigue et risque de blessure : burpees, break dance et tire tapis reviennent souvent, la qualite d'execution chute.",
      "Le materiel lourd est sollicite partout (KB, tapis, barres, balles) : files d'attente probables.",
      "Le BOSS 20 repose sur ONE REP, dont le cout reel reste a verifier ; la corde disparait presque (peu de recuperation active).",
    ],
    ramp: scale(0.85),
    specs: [
      L("cardio", "Mise en route", "BURPEES", "BOX JUMP", "POMPES", "KB SWING"),
      L("jambes", "Jambes", "TIRE TAPIS AR", "BOX JUMP", "SQUATS JUMP", "MONKEY SLIDE"),
      L("bras", "Bras", "TRACTIONS", "POMPES", "COMMANDO BRAS", "SMASH DOWN"),
      L("full", "Full body", "KB SNATCH", "FLIP TAPIS", "BREAK DANCE", "KB SWING"),
      BOSS("full", "Burpees", "BURPEES", 75),
      L("tronc", "Tronc", "PLANK SLIDE", "COMMANDO BRAS", "KB TOUR", "BREAK DANCE"),
      L("cardio", "Cardio", "BURPEES", "ALLER-RETOUR", "BOX JUMP", "MONKEY SLIDE"),
      L("bras", "Bras", "TRACTIONS", "POMPES", "COMMANDO BRAS", "SMASH DOWN", "WALL BALL SHOT"),
      L("full", "Full body", "KB SNATCH", "BREAK DANCE", "FLIP TAPIS", "ONE REP", "KB SWING"),
      BOSS("jambes", "Tire tapis", "TIRE TAPIS AR", 20),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "TIRE TAPIS AR"),
      L("cardio", "Cardio", "BURPEES", "ALLER-RETOUR", "BOX JUMP", "KB SWING"),
      L("full", "Full body", "KB SWING", "KB SNATCH", "BREAK DANCE", "FLIP TAPIS", "ONE REP"),
      L("tronc", "Tronc", "PLANK SLIDE", "COMMANDO BRAS", "KB TOUR", "BREAK DANCE", "WALL BALL SHOT"),
      BOSS("bras", "Tractions", "TRACTIONS", 120),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "SMASH DOWN", "BURPEES"),
      L("jambes", "Jambes", "TIRE TAPIS AR", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE"),
      L("cardio", "Cardio", "BURPEES", "ALLER-RETOUR", "BOX JUMP", "KB SNATCH", "BREAK DANCE"),
      L("full", "Full body", "KB SNATCH", "KB SWING", "BREAK DANCE", "FLIP TAPIS", "TOUR DE POUTRE", "SMASH DOWN"),
      BOSS("full", "One rep", "ONE REP", 50),
      L("jambes", "Jambes", "TIRE TAPIS AR", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE"),
      L("bras", "Bras", "TRACTIONS", "POMPES", "COMMANDO BRAS", "SMASH DOWN", "WALL BALL SHOT"),
      L("full", "Full body", "KB SNATCH", "KB SWING", "BREAK DANCE", "FLIP TAPIS", "ONE REP", "TOUR DE POUTRE"),
      L("cardio", "Cardio & tronc", "ALLER-RETOUR", "BOX JUMP", "PLANK SLIDE", "KB TOUR", "BREAK DANCE"),
      BOSS("cardio", "Burpees", "BURPEES", 150),
    ],
  },
  {
    key: "E",
    title: "Ultime : rotation calibree",
    philosophy:
      "La rotation d'identites de A, avec quatre reglages en plus : (1) cinq fiches par niveau, une par membre, de duree egale : personne n'attend ; (2) les niveaux alternent intensite haute et basse pour etaler les equipes sur les ateliers ; (3) un seul exercice KB par niveau, une seule fiche de tractions par niveau, une seule dose SKILL par bloc ; (4) les BOSS alternent full body, cardio, bras, jambes, sans materiel sauf les barres du 15, laissees au repos aux niveaux 11 a 14.",
    strengths: [
      "Garde la lisibilite et la securite de A et corrige son defaut principal : cinq fiches equilibrees, aucun membre ne regarde les autres travailler.",
      "Calibree sur le modele de temps reel : 55 s au premier niveau, 205 s au dix-neuvieme, une cinquantaine de minutes pour tout boucler, donc le 20 reste rare et merite.",
      "Materiel etale : jamais deux exercices KB dans le meme niveau, jamais deux SKILL dans le meme bloc, une corde par equipe suffit.",
      "Les BOSS pesent vraiment (75 burpees, 50 AR, 100 tractions, 500 squats) tout en restant sans file d'attente.",
    ],
    weaknesses: [
      "Moins spectaculaire que D : les equipes fortes ne sont pas terrorisees par les niveaux 16 a 19.",
      "Le tronc n'a jamais de BOSS (rien de comptable en gainage) : il pese moins dans l'histoire.",
      "Cinq fiches par niveau = cinq ateliers par equipe : il faut la salle et le materiel pour que 8 a 10 equipes tournent sans se gener.",
    ],
    ramp: scale(1),
    specs: [
      L("cardio", "Mise en route", "CORDE", "ALLER-RETOUR", "BOX JUMP", "SQUATS JUMP", "COMMANDO BRAS"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "MONKEY SLIDE", "BOX JUMP", "CORDE"),
      L("bras", "Bras", "POMPES", "COMMANDO BRAS", "TRACTIONS", "CORDE", "KB TOUR"),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE", "MONKEY SLIDE"),
      BOSS("full", "Burpees", "BURPEES", 75),
      L("full", "Full body", "KB SWING", "FLIP TAPIS", "SMASH DOWN", "TOUR DE POUTRE", "CORDE"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "FENTES DISK"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "CORDE"),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "CORDE", "PLANK SLIDE"),
      BOSS("cardio", "ALLER-RETOUR", "ALLER-RETOUR", 50),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE", "MONKEY SLIDE"),
      L("full", "Full body", "KB SNATCH", "BREAK DANCE", "FLIP TAPIS", "WALL BALL SHOT", "ONE REP"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "SQUATS JUMP"),
      L("jambes", "Jambes", "SQUATS JUMP", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "TIRE TAPIS AR"),
      BOSS("bras", "Tractions", "TRACTIONS", 100),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "CORDE", "KB SWING"),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "CORDE", "BOX JUMP"),
      L("full", "Full body", "KB SNATCH", "BREAK DANCE", "FLIP TAPIS", "SMASH DOWN", "TOUR DE POUTRE", "ONE REP"),
      L("jambes", "Jambes & cardio", "FENTES DISK", "BOX JUMP", "MONKEY SLIDE", "TIRE TAPIS AR", "CORDE", "ALLER-RETOUR"),
      BOSS("jambes", "Squats jump", "SQUATS JUMP", 500),
      L("full", "Full body", "KB SWING", "FLIP TAPIS", "SMASH DOWN", "TOUR DE POUTRE", "ONE REP"),
      L("cardio", "Cardio", "CORDE", "ALLER-RETOUR", "BOX JUMP", "BURPEES", "FENTES DISK"),
      L("bras", "Bras", "POMPES", "TRACTIONS", "COMMANDO BRAS", "CORDE", "KB SNATCH"),
      L("tronc", "Tronc", "PLANK SLIDE", "KB TOUR", "COMMANDO BRAS", "TIRE TAPIS AR", "WALL BALL SHOT"),
      BOSS("full", "Break dance", "BREAK DANCE", 150),
    ],
  },
];

// Familles de points (Sartay, 25/09) : deux fiches de meme famille (reps x ponderation voisines) sont
// interchangeables au sein d'un niveau. Reps rondes : dizaines (ponderation <= 3), multiples de 5 (4 a 8),
// unites pour les trois exercices lourds (aller-retour, one rep, tire tapis).
export function roundReps(label: string, seconds: number): number {
  const w = weightOf(label);
  const step = w <= 3 ? 10 : w <= 8 ? 5 : 1;
  return Math.max(step, Math.round(seconds / w / step) * step);
}
export const POINT_FAMILIES = [30, 60, 90, 120, 150, 180, 240] as const;

// Proposition F (25/09/2026, sur les remarques de Sartay apres A-E) : fiches ecrites a la main, reps rondes,
// 3 a 8 fiches par niveau, un SOCLE bras + jambes + cardio dans chaque niveau ordinaire, et, entre deux BOSS,
// les niveaux tournent sur les familles de points (le niveau 6 met les bras au commando, le 7 aux tractions,
// le 8 aux pompes...) pour que les equipes, etalees sur les niveaux d'un bloc, ne se marchent pas dessus.
// Les 21 exercices sont tous en jeu avant le BOSS 10 ; niveaux courts a peu de fiches (3-4) faits de fiches
// courtes et egales (le relais de toute l'equipe sur une seule longue fiche est evite) ; le temps de la fiche
// la plus longue et le temps total montent a chaque niveau.
PROPOSALS.push({
  key: "F",
  title: "Socle & rotation",
  philosophy:
    "Chaque niveau ordinaire tient sur un socle bras + jambes + cardio, complete par 0 a 5 fiches de tronc, full body ou exercices lourds, pour 3 a 8 fiches au total. Dans un bloc, les niveaux sont des variantes d'un meme squelette : les memes roles, mais des exercices differents d'un niveau a l'autre (familles de points interchangeables), pour etaler les equipes sur les ateliers. Reps rondes, tout le catalogue en jeu des le bloc 2, montee continue du temps total et de la fiche la plus longue.",
  strengths: [
    "Un socle bras + jambes + cardio a chaque niveau : personne ne fait quatre niveaux de suite sans haut du corps ni sans cardio.",
    "Les niveaux voisins n'utilisent pas les memes ateliers : les equipes etalees sur un bloc ne se disputent ni les barres, ni les tapis, ni les kettlebells.",
    "Reps rondes (dizaines, multiples de 5, unites pour les exercices lourds) : lisibles sur la fiche, faciles a compter, faciles a arbitrer.",
    "Les 21 exercices sont tous utilises avant le BOSS 10, et chacun revient au moins trois fois : la seance montre tout le catalogue, meme aux equipes lentes.",
    "Nombre de fiches variable (3 a 8) : niveaux courts et compacts pour lancer la seance, gros niveaux a 7-8 ateliers en fin de bloc ou chacun a sa fiche.",
    "Les fiches d'un meme niveau court sont courtes et egales : l'equipe ne s'entasse jamais en relais sur une seule longue fiche.",
  ],
  weaknesses: [
    "L'intensite (ponderation moyenne d'une rep) monte par bloc mais zigzague d'un niveau a l'autre : une fiche de corde de 60 a 90 reps fait mecaniquement baisser le chiffre du niveau, sans que le niveau soit plus facile.",
    "Les niveaux a 3-4 fiches laissent un ou deux membres en relais : l'equilibre affiche (52 a 80 %) est plus bas que dans E, c'est le prix des petits niveaux voulus.",
    "Neuf fiches SKILL (smash down, wall ball) sur 20 niveaux : une par niveau au plus, mais plus que dans E ; a surveiller si les balles manquent.",
    "Les trois exercices lourds (aller-retour, one rep, tire tapis) pesent lourd dans l'intensite des niveaux 9, 14, 18 et 19 : si ONE REP se revele plus long que 15 s, ces niveaux s'allongent.",
  ],
  ramp: [],
  specs: [
    FX("cardio", "Premiers pas", ["CORDE", 50], ["SQUATS JUMP", 20], ["COMMANDO BRAS", 20]),
    FX("jambes", "Tour de chauffe", ["ALLER-RETOUR", 4], ["FENTES DISK", 30], ["POMPES", 20], ["KB TOUR", 60]),
    FX("bras", "Cadence", ["BOX JUMP", 20], ["MONKEY SLIDE", 20], ["TRACTIONS", 15], ["KB SWING", 40]),
    FX("tronc", "Plein régime", ["CORDE", 60], ["SQUATS JUMP", 40], ["POMPES", 30], ["PLANK SLIDE", 30], ["SMASH DOWN", 30]),
    BOSS("full", "Burpees", "BURPEES", 75),
    FX("full", "Reprise", ["ALLER-RETOUR", 6], ["FENTES DISK", 50], ["COMMANDO BRAS", 50], ["WALL BALL SHOT", 30]),
    FX("cardio", "Éventail", ["BOX JUMP", 30], ["MONKEY SLIDE", 30], ["TRACTIONS", 20], ["CORDE", 90], ["KB SNATCH", 30], ["TOUR DE POUTRE", 20]),
    FX("jambes", "Du lourd", ["BURPEES", 15], ["SQUATS JUMP", 60], ["POMPES", 40], ["FLIP TAPIS", 30], ["BREAK DANCE", 15]),
    FX("bras", "Grand huit", ["CORDE", 60], ["TIRE TAPIS AR", 3], ["COMMANDO BRAS", 60], ["POMPES", 30], ["ONE REP", 6], ["SMASH DOWN", 30], ["FENTES DISK", 60]),
    BOSS("cardio", "ALLER-RETOUR", "ALLER-RETOUR", 50),
    FX("bras", "Relance", ["SQUATS JUMP", 70], ["POMPES", 50], ["KB SNATCH", 50], ["BURPEES", 20]),
    FX("jambes", "Cinq ateliers", ["KB TOUR", 100], ["ALLER-RETOUR", 10], ["FENTES DISK", 70], ["COMMANDO BRAS", 70], ["FLIP TAPIS", 40]),
    FX("tronc", "Marathon des ateliers", ["CORDE", 60], ["MONKEY SLIDE", 30], ["POMPES", 40], ["PLANK SLIDE", 30], ["WALL BALL SHOT", 30], ["TOUR DE POUTRE", 20], ["BREAK DANCE", 20], ["KB SWING", 60]),
    FX("full", "Dernière ligne droite", ["POMPES", 30], ["TIRE TAPIS AR", 4], ["COMMANDO BRAS", 60], ["BURPEES", 25], ["SQUATS JUMP", 60], ["ONE REP", 8], ["SMASH DOWN", 40]),
    BOSS("bras", "Tractions", "TRACTIONS", 100),
    FX("bras", "Retour de flamme", ["COMMANDO BRAS", 40], ["TRACTIONS", 30], ["FENTES DISK", 90], ["BURPEES", 25], ["KB SNATCH", 50], ["PLANK SLIDE", 50]),
    FX("full", "Tour du gymnase", ["KB TOUR", 80], ["MONKEY SLIDE", 40], ["POMPES", 40], ["BOX JUMP", 40], ["SMASH DOWN", 40], ["FLIP TAPIS", 45], ["ONE REP", 8], ["TOUR DE POUTRE", 25]),
    FX("cardio", "Cinq costauds", ["ALLER-RETOUR", 12], ["TIRE TAPIS AR", 6], ["TRACTIONS", 40], ["BREAK DANCE", 25], ["KB SWING", 100]),
    FX("tronc", "Apothéose", ["WALL BALL SHOT", 40], ["FENTES DISK", 60], ["COMMANDO BRAS", 60], ["BURPEES", 30], ["KB SNATCH", 40], ["PLANK SLIDE", 40], ["TIRE TAPIS AR", 4], ["ONE REP", 8]),
    BOSS("jambes", "Squats jump", "SQUATS JUMP", 500),
    // Bloc 5 (25/09) : toujours plus difficile — 225 s -> 270 s, fiches de 3 a 4,5 min, exercices lourds.
    FX("bras", "Cinquième étage", ["BURPEES", 25], ["TIRE TAPIS AR", 6], ["TRACTIONS", 45], ["KB SNATCH", 60], ["WALL BALL SHOT", 60], ["COMMANDO BRAS", 90]),
    FX("full", "Le grand tour", ["ALLER-RETOUR", 8], ["FENTES DISK", 60], ["POMPES", 40], ["PLANK SLIDE", 40], ["SMASH DOWN", 40], ["BOX JUMP", 40], ["ONE REP", 16], ["TOUR DE POUTRE", 25]),
    FX("jambes", "Cinq géants", ["SQUATS JUMP", 90], ["COMMANDO BRAS", 90], ["KB SNATCH", 60], ["BURPEES", 35], ["TIRE TAPIS AR", 6]),
    FX("cardio", "Dernier rempart", ["BOX JUMP", 40], ["FENTES DISK", 80], ["TRACTIONS", 40], ["POMPES", 50], ["WALL BALL SHOT", 50], ["ONE REP", 12], ["ALLER-RETOUR", 18]),
    BOSS("full", "Break dance", "BREAK DANCE", 150),
  ],
});

export const proposalByKey = (key: string) => PROPOSALS.find((p) => p.key === key) ?? null;
