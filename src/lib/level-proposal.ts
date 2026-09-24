// Proposition de depart pour l'echelle du WOD Level (24/09/2026) : 20 niveaux pour des equipes de 5, de plus
// en plus durs, avec une identite par niveau (cardio, jambes, bras, tronc, full body) qui tourne entre les
// BOSS (5, 10, 15, 20 : un seul exercice, toute l'equipe dessus). Les exercices SKILL (smash down, wall ball
// shot) n'apparaissent qu'a petites doses. Chargeable depuis /admin/level quand l'echelle est vide, puis
// librement modifiable : ce n'est qu'un point de depart.
//
// Dimensionnement : une equipe de 5 se partage le travail, donc temps reel ~ temps theorique / 5. L'echelle
// entiere fait ~11 900 s theoriques, soit ~40 min de travail sans pause pour une equipe qui ne s'arrete
// jamais : les meilleures bouclent les 20 niveaux, les autres s'arretent entre 12 et 16.

export type ProposedLevel = { name: string; cards: [label: string, reps: number][] };

export const PROPOSED_LEVELS: ProposedLevel[] = [
  // ----- Bloc 1 : mise en route -> BOSS 5 -----
  { name: "Cardio · Mise en route", cards: [["CORDE", 100], ["AR", 2], ["SQUATS JUMP", 10]] },
  { name: "Jambes", cards: [["SQUATS JUMP", 30], ["FENTES DISK", 30], ["BOX JUMP", 20], ["CORDE", 50]] },
  { name: "Bras", cards: [["POMPES", 30], ["COMMANDO BRAS", 30], ["TRACTIONS", 10], ["KB TOUR", 50]] },
  { name: "Tronc", cards: [["PLANK SLIDE", 30], ["KB TOUR", 60], ["MONKEY SLIDE", 20], ["COMMANDO BRAS", 25], ["CORDE", 50]] },
  { name: "BOSS · Full body : burpees", cards: [["BURPEES", 50]] },
  // ----- Bloc 2 -> BOSS 10 -----
  { name: "Full body", cards: [["KB SWING", 50], ["KB SNATCH", 30], ["FLIP TAPIS", 20], ["BURPEES", 10], ["CORDE", 60]] },
  { name: "Cardio", cards: [["CORDE", 200], ["AR", 6], ["BOX JUMP", 30], ["BURPEES", 10]] },
  { name: "Jambes", cards: [["SQUATS JUMP", 60], ["FENTES DISK", 60], ["BOX JUMP", 40], ["KB SWING", 40], ["TIRE TAPIS AR", 2]] },
  { name: "Bras", cards: [["POMPES", 60], ["TRACTIONS", 20], ["COMMANDO BRAS", 50], ["SMASH DOWN", 30], ["KB TOUR", 80]] },
  { name: "BOSS · Jambes : tire tapis", cards: [["TIRE TAPIS AR", 20]] },
  // ----- Bloc 3 -> BOSS 15 -----
  { name: "Tronc", cards: [["PLANK SLIDE", 50], ["MONKEY SLIDE", 40], ["BREAK DANCE", 15], ["KB TOUR", 100], ["COMMANDO BRAS", 50], ["CORDE", 60]] },
  { name: "Full body", cards: [["KB SNATCH", 50], ["FLIP TAPIS", 25], ["KB SWING", 60], ["WALL BALL SHOT", 40], ["TOUR DE POUTRE", 10], ["BURPEES", 20]] },
  { name: "Cardio", cards: [["CORDE", 250], ["AR", 10], ["BOX JUMP", 50], ["BURPEES", 20], ["SQUATS JUMP", 30]] },
  { name: "Jambes", cards: [["SQUATS JUMP", 100], ["FENTES DISK", 80], ["BOX JUMP", 50], ["KB SWING", 60], ["TIRE TAPIS AR", 4], ["CORDE", 50]] },
  { name: "BOSS · Bras : pompes", cards: [["POMPES", 250]] },
  // ----- Bloc 4 -> BOSS 20 -----
  { name: "Bras", cards: [["POMPES", 80], ["TRACTIONS", 30], ["COMMANDO BRAS", 80], ["SMASH DOWN", 40], ["KB TOUR", 100], ["CORDE", 80]] },
  { name: "Tronc", cards: [["PLANK SLIDE", 70], ["MONKEY SLIDE", 50], ["BREAK DANCE", 30], ["KB TOUR", 120], ["COMMANDO BRAS", 60], ["AR", 4]] },
  { name: "Full body", cards: [["KB SNATCH", 60], ["KB SWING", 80], ["FLIP TAPIS", 30], ["WALL BALL SHOT", 50], ["TOUR DE POUTRE", 16], ["BURPEES", 30]] },
  { name: "Jambes & cardio", cards: [["SQUATS JUMP", 100], ["FENTES DISK", 100], ["BOX JUMP", 60], ["TIRE TAPIS AR", 6], ["CORDE", 100], ["AR", 6]] },
  { name: "BOSS FINAL · Cardio : AR", cards: [["AR", 60]] },
];
