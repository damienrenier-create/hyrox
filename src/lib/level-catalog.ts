// Le listing de Sartay (« listing exos.xlsx », 24/09/2026) : ponderation = temps theorique d'une rep, en s.
// Module pur (pas de base) : importable cote client, par les propositions d'echelle et par les rapports.
export const DEFAULT_EXERCISES: { label: string; weight: number }[] = [
  { label: "CORDE", weight: 1 },
  { label: "KB TOUR", weight: 1 },
  { label: "COMMANDO BRAS", weight: 2 },
  { label: "SQUATS JUMP", weight: 2 },
  { label: "KB SWING", weight: 2 },
  { label: "FENTES DISK", weight: 2 },
  { label: "SMASH DOWN", weight: 3 },
  { label: "BOX JUMP", weight: 3 },
  { label: "POMPES", weight: 3 },
  { label: "KB SNATCH", weight: 3 },
  { label: "MONKEY SLIDE", weight: 3 },
  { label: "PLANK SLIDE", weight: 3 },
  { label: "WALL BALL SHOT", weight: 3 },
  { label: "FLIP TAPIS", weight: 4 },
  { label: "TRACTIONS", weight: 5 },
  { label: "TOUR DE POUTRE", weight: 5 },
  { label: "BURPEES", weight: 7 },
  { label: "BREAK DANCE", weight: 8 },
  { label: "ALLER-RETOUR", weight: 15 },
  // ONE REP (full body, Sartay 24/09) : debout, crawling jusqu a la position de pompe, toucher epaule G, epaule D,
  // genou G, genou D, cheville G, cheville D, puis se relever sans bouger les pieds. ~15 s la rep.
  { label: "ONE REP", weight: 15 },
  { label: "TIRE TAPIS AR", weight: 30 },
];
