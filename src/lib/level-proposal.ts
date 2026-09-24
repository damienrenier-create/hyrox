// Proposition de depart pour l'echelle du WOD Level (24/09/2026, v3 apres les retours de Sartay) : 20 niveaux
// pour des equipes de 5, de plus en plus durs, avec une identite par niveau qui tourne entre les BOSS
// (5, 10, 15, 20 : un seul exercice, toute l'equipe dessus en meme temps).
//
// Identites (validees par Sartay) :
//   cardio    = corde, AR, box jump, burpees
//   jambes    = squats jump, fentes disk, monkey slide, box jump, tire tapis AR
//   bras      = pompes, tractions, commando bras
//   tronc     = plank slide, KB tour, commando bras
//   full body = KB swing, KB snatch, smash down (SKILL), wall ball shot (SKILL), flip tapis, break dance,
//               one rep, tour de poutre
// Regles : les SKILL a petites doses ; l'atelier d'un boss gourmand en materiel (tractions) est laisse au
// repos dans les niveaux juste avant, pour que les equipes en boss n'y trouvent pas la file.
//
// Calibrage : les exemples de Sartay (260 a 650 s theoriques) sont des niveaux d'echauffement. L'echelle
// part donc de 300 s et monte a 1 300 s. Une equipe de 5 se partage le travail (temps reel ~ theorique / 5,
// un boss se fait a cinq en simultane) : ~15 200 s theoriques au total, soit ~50 min sans pause pour tout
// boucler. Une bonne equipe atteint le niveau 17-18 en 45 min ; le 20 est pour les exceptionnelles.

export type ProposedLevel = { name: string; cards: [label: string, reps: number][] };

export const PROPOSED_LEVELS: ProposedLevel[] = [
  // ----- Bloc 1 : echauffement -> BOSS 5 -----
  { name: "Cardio · Mise en route", cards: [["CORDE", 180], ["AR", 4], ["BOX JUMP", 20]] },
  { name: "Jambes", cards: [["SQUATS JUMP", 50], ["FENTES DISK", 50], ["MONKEY SLIDE", 30], ["CORDE", 60]] },
  { name: "Bras", cards: [["POMPES", 50], ["COMMANDO BRAS", 50], ["TRACTIONS", 20], ["CORDE", 50]] },
  { name: "Tronc", cards: [["PLANK SLIDE", 60], ["KB TOUR", 120], ["COMMANDO BRAS", 50], ["CORDE", 50]] },
  { name: "BOSS · Full body : burpees", cards: [["BURPEES", 75]] },
  // ----- Bloc 2 -> BOSS 10 -----
  { name: "Full body", cards: [["KB SWING", 70], ["KB SNATCH", 40], ["FLIP TAPIS", 25], ["SMASH DOWN", 30], ["CORDE", 100]] },
  { name: "Cardio", cards: [["CORDE", 250], ["AR", 8], ["BOX JUMP", 40], ["BURPEES", 15]] },
  { name: "Jambes", cards: [["SQUATS JUMP", 80], ["FENTES DISK", 80], ["BOX JUMP", 50], ["MONKEY SLIDE", 40], ["CORDE", 60]] },
  { name: "Bras", cards: [["POMPES", 80], ["TRACTIONS", 30], ["COMMANDO BRAS", 80], ["CORDE", 150]] },
  { name: "BOSS · Cardio : AR", cards: [["AR", 50]] },
  // ----- Bloc 3 -> BOSS 15 (tractions : aucune traction aux niveaux 11 a 14) -----
  { name: "Tronc", cards: [["PLANK SLIDE", 100], ["KB TOUR", 200], ["COMMANDO BRAS", 100], ["CORDE", 150]] },
  { name: "Full body", cards: [["KB SNATCH", 60], ["KB SWING", 80], ["WALL BALL SHOT", 50], ["BREAK DANCE", 20], ["FLIP TAPIS", 30], ["ONE REP", 6], ["CORDE", 40]] },
  { name: "Cardio", cards: [["CORDE", 300], ["AR", 12], ["BOX JUMP", 60], ["BURPEES", 30], ["MONKEY SLIDE", 25]] },
  { name: "Jambes", cards: [["SQUATS JUMP", 120], ["FENTES DISK", 100], ["BOX JUMP", 60], ["MONKEY SLIDE", 50], ["TIRE TAPIS AR", 5], ["CORDE", 80]] },
  { name: "BOSS · Bras : tractions", cards: [["TRACTIONS", 100]] },
  // ----- Bloc 4 -> BOSS 20 -----
  { name: "Bras", cards: [["POMPES", 120], ["TRACTIONS", 40], ["COMMANDO BRAS", 120], ["CORDE", 300]] },
  { name: "Tronc", cards: [["PLANK SLIDE", 130], ["KB TOUR", 250], ["COMMANDO BRAS", 130], ["CORDE", 250]] },
  { name: "Full body", cards: [["KB SNATCH", 80], ["KB SWING", 100], ["SMASH DOWN", 50], ["BREAK DANCE", 25], ["FLIP TAPIS", 40], ["TOUR DE POUTRE", 16], ["ONE REP", 6], ["WALL BALL SHOT", 30]] },
  { name: "Jambes & cardio", cards: [["FENTES DISK", 130], ["BOX JUMP", 80], ["MONKEY SLIDE", 80], ["TIRE TAPIS AR", 8], ["CORDE", 170], ["AR", 10]] },
  { name: "BOSS FINAL · Jambes : squats jump", cards: [["SQUATS JUMP", 500]] },
];
