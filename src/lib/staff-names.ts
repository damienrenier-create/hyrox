// Les pseudos de connexion (DAMZER, GUIZER…) ne doivent JAMAIS apparaitre dans le jeu : ils servent a se
// connecter. Partout ou un nom est montre aux eleves (classement des arbitres, carte, grille, arbitrage),
// on affiche le nom d'usage du prof.
const STAFF_DISPLAY: Record<string, string> = {
  DAMZER: "D. Renier",
  "DAMIEN RENIER": "D. Renier", // le compte DAMZER pointe sur la ligne PROF importee « Damien Renier »
  GUIZER: "G. Tasquin",
  AXEZER: "A. Pirlot",
  SIMZER: "S. Baugnée",
  RACZER: "R. Delsa", // Rachelle Delsa (Sartay 26/11 : « elle peut apparaitre non plus en Mme mais comme R. Delsa »)
  JUSZER: "J. Piret", // 17/11 apres-midi (Sartay : « J. Piret, JUSZER, coach ») : son pseudo de connexion
  PIRZER: "J. Piret", // 17/11 midi, premier pseudo : il ouvre toujours le meme compte (voir SAME_ACCOUNT, app/actions.ts)
};

// Nom a afficher pour n'importe quel utilisateur : eleve = prenom + nom, prof = nom d'usage.
export function displayName(user: { name?: string | null; firstName?: string | null; lastName?: string | null; role?: string | null }): string {
  const staff = STAFF_DISPLAY[(user.name ?? "").trim().toUpperCase()];
  if (staff) return staff;
  const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return full || user.name || "?";
}

// Nom d'usage a partir du seul pseudo (session JWT, en-tetes d'ecran).
export function displayPseudo(pseudo: string): string {
  return STAFF_DISPLAY[pseudo.trim().toUpperCase()] ?? pseudo;
}

// Les profs peuvent etre encodes dans une equipe comme n'importe quel eleve, par leur NOM DE FAMILLE et
// quelle que soit la classe : DAMZER = Renier, GUIZER = Tasquin, SIMZER = Baugnee, AXEZER = Pirlot, RACZER = Delsa,
// JUSZER (ou PIRZER) = Piret.
const STAFF_PERSON: Record<string, { firstName: string; lastName: string }> = {
  DAMZER: { firstName: "D.", lastName: "Renier" },
  "DAMIEN RENIER": { firstName: "D.", lastName: "Renier" },
  GUIZER: { firstName: "G.", lastName: "Tasquin" },
  AXEZER: { firstName: "A.", lastName: "Pirlot" },
  SIMZER: { firstName: "S.", lastName: "Baugnée" },
  RACZER: { firstName: "R.", lastName: "Delsa" },
  JUSZER: { firstName: "J.", lastName: "Piret" },
  PIRZER: { firstName: "J.", lastName: "Piret" },
};

export const STAFF_ROLES = ["ADMIN", "MASTER_ADMIN"];
export const STAFF_CLASS_LABEL = "prof";

// Prenom / nom tels qu'ils s'affichent dans une equipe : un eleve garde les siens, un prof prend son nom d'usage.
export function memberNames(user: { name?: string | null; firstName?: string | null; lastName?: string | null; role?: string | null }): { firstName: string; lastName: string } {
  const staff = STAFF_PERSON[(user.name ?? "").trim().toUpperCase()];
  if (staff) return staff;
  return { firstName: user.firstName ?? "", lastName: user.lastName ?? "" };
}

// Compare sans accents ni majuscules : « baugnee » trouve « Baugnée ».
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
