// Orthographe d'une classe tapee dans la console (Sartay 08/10 : « les eleves pensent que la classe en majuscule est en A et
// ils n'arrivent pas a se connecter ») : le formulaire « Nouveau profil » mettait la classe en MAJUSCULES (« 5GTA »,
// « 3GTE »), une classe de plus dans la liste de connexion. Desormais une classe tapee « 5GTA » ou « 5gta » reprend
// l'orthographe de la classe qui existe deja (« 5GTa »), la plus nombreuse s'il y en a plusieurs ; une classe nouvelle
// reste telle que tapee, sans espaces. Module pur.
export function canonicalClassName(typed: string, classCounts: Map<string, number>): string {
  const t = typed.replace(/\s+/g, "");
  if (!t) return "";
  let best: string | null = null;
  for (const [name, n] of classCounts) {
    if (name.toLowerCase() !== t.toLowerCase()) continue;
    if (best === null || n > (classCounts.get(best) ?? 0)) best = name;
  }
  return best ?? t;
}

// Effectif par classe d'une liste d'eleves.
export function classCountsOf(students: { className: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of students) if (s.className) m.set(s.className, (m.get(s.className) ?? 0) + 1);
  return m;
}
