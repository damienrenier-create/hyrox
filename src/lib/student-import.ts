// Import d'une liste d'eleves depuis la console (Sartay 18/11 : J. Piret doit pouvoir le faire seule, « je ne peux pas
// m'occuper de ça en permanence »). La prof colle les colonnes copiees depuis son tableur (ou donne un fichier .csv) ;
// la page devine les colonnes (en-tetes ou contenu), montre ce qu'elle a compris, puis le serveur verifie les doublons
// et cree seulement les nouveaux eleves. Rien n'est jamais modifie ni efface chez un eleve deja inscrit.
// Module PUR (importable cote client et cote serveur).

export type ImportField = "lastName" | "firstName" | "fullName" | "className" | "dateOfBirth" | "sex" | "skip";

export const FIELD_LABELS: Record<ImportField, string> = {
  lastName: "Nom",
  firstName: "Prénom",
  fullName: "Nom + prénom (une seule colonne)",
  className: "Classe",
  dateOfBirth: "Date de naissance",
  sex: "Sexe",
  skip: "— ignorer —",
};

export type ImportRow = {
  line: number; // ligne de la liste collee (1 = premiere ligne)
  firstName: string;
  lastName: string;
  className: string;
  sex: "M" | "F" | null;
  dateOfBirth: string | null; // AAAA-MM-JJ
  problem?: string; // ligne inutilisable (nom ou prenom manquant...)
  dobRaw?: string; // date illisible telle que tapee (la ligne reste importable, sans date)
};

export const MAX_IMPORT_ROWS = 1500;

// Comparaison sans accents, majuscules ni ponctuation : « Lëa  DUPONT-Durand » = « lea dupont durand ».
export const foldName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

// ----- Lecture des cellules -----

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};

function isoDate(y: number, m: number, d: number, nowYear: number): string | null {
  if (y < 1940 || y > nowYear || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null; // 31/02...
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Date de naissance : 12/03/2010, 12-03-2010, 12.03.2010, 12/3/10, 2010-03-12, « 12 mars 2010 », ou le numero de
// serie d'Excel (40249) quand la cellule a perdu son format. Resultat AAAA-MM-JJ, ou null si illisible.
export function parseBirthDate(raw: string, nowYear = new Date().getUTCFullYear()): string | null {
  const s = clean(raw);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return isoDate(+m[1], +m[2], +m[3], nowYear);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y = 2000 + y <= nowYear ? 2000 + y : 1900 + y;
    return isoDate(y, +m[2], +m[1], nowYear);
  }
  m = foldName(s).match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m && MONTHS[m[2]]) return isoDate(+m[3], MONTHS[m[2]], +m[1], nowYear);
  if (/^\d{5}$/.test(s)) {
    const n = +s;
    if (n > 14000 && n < 60000) {
      const t = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), nowYear);
    }
  }
  return null;
}

export function parseSex(raw: string): "M" | "F" | null {
  const s = foldName(raw);
  if (["m", "g", "h", "garcon", "masculin", "homme", "male", "boy"].includes(s)) return "M";
  if (["f", "fille", "feminin", "femme", "female", "girl"].includes(s)) return "F";
  return null;
}

// « DUPONT Jean », « VAN DEN BERGHE Marie-Lou », « Dupont, Jean » : les mots en MAJUSCULES forment le nom. Sans
// majuscules pour trancher, l'ordre des listes d'ecole : le nom d'abord, puis le prenom.
export function splitFullName(raw: string): { firstName: string; lastName: string } {
  const s = clean(raw);
  if (s.includes(",")) {
    const [last, ...rest] = s.split(",");
    return { lastName: clean(last), firstName: clean(rest.join(" ")) };
  }
  const words = s.split(" ").filter(Boolean);
  const upper = (w: string) => /\p{L}/u.test(w) && w === w.toUpperCase() && w.replace(/[^\p{L}]/gu, "").length >= 2;
  const ups = words.filter(upper);
  if (ups.length > 0 && ups.length < words.length) {
    return { lastName: ups.join(" "), firstName: words.filter((w) => !upper(w)).join(" ") };
  }
  if (words.length < 2) return { lastName: s, firstName: "" };
  return { lastName: words[0], firstName: words.slice(1).join(" ") };
}

// ----- Colonnes -----

// En-tete reconnu ? (« Nom Elève », « Prénom », « Date de naissance », « Classe », « Sexe »...)
export function fieldOfHeader(raw: string): ImportField | null {
  const h = foldName(raw);
  if (!h) return null;
  const withoutPrenom = h.replace(/prenoms?/g, " ");
  if (/prenom/.test(h) && /\bnom\b/.test(withoutPrenom)) return "fullName";
  if (/prenom|first ?name|given/.test(h)) return "firstName";
  if (/naiss|birth|\bne le\b|\bnee le\b|\bdob\b|\bdate\b/.test(h)) return "dateOfBirth";
  if (/\bsexe?\b|\bgenre\b|gender|\bm ?f\b/.test(h)) return "sex";
  if (/classe|\bclass\b|\bgroupe\b/.test(h)) return "className";
  if (/nom complet|identite|^eleves?$|^etudiants?$/.test(h)) return "fullName";
  if (/\bnom\b|last ?name|famille|surname/.test(h)) return "lastName";
  return null;
}

const looksDate = (c: string) => parseBirthDate(c) !== null;
const looksSex = (c: string) => parseSex(c) !== null;
const looksClass = (c: string) => /^\d[\p{L}\d]{0,9}$/u.test(clean(c).replace(/\s+/g, ""));

// Devine la colonne de chaque champ : par les en-tetes s'il y en a, sinon par le contenu des premieres lignes.
export function guessMapping(rows: string[][]): { mapping: ImportField[]; hasHeader: boolean } {
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const first = rows[0] ?? [];
  const fromHeader = Array.from({ length: width }, (_, i) => fieldOfHeader(first[i] ?? ""));
  const headerHits = fromHeader.filter((f) => f !== null).length;
  if (headerHits >= 1 && !first.some((c) => looksDate(c))) {
    const used = new Set<ImportField>();
    const mapping = fromHeader.map((f) => {
      if (!f || used.has(f)) return "skip" as ImportField;
      used.add(f);
      return f;
    });
    return { mapping, hasHeader: true };
  }
  // Sans en-tete : la colonne des dates, du sexe, de la classe ; les colonnes de texte restantes = nom puis prenom.
  const sample = rows.slice(0, 40);
  const share = (i: number, test: (c: string) => boolean) => {
    const cells = sample.map((r) => clean(r[i] ?? "")).filter(Boolean);
    return cells.length ? cells.filter(test).length / cells.length : 0;
  };
  const mapping: ImportField[] = Array.from({ length: width }, () => "skip");
  const free = new Set(Array.from({ length: width }, (_, i) => i));
  const take = (field: ImportField, test: (c: string) => boolean) => {
    let best = -1, bestShare = 0.6;
    for (const i of free) { const s = share(i, test); if (s > bestShare) { best = i; bestShare = s; } }
    if (best >= 0) { mapping[best] = field; free.delete(best); }
  };
  take("dateOfBirth", looksDate);
  take("sex", looksSex);
  take("className", looksClass);
  const text = [...free].filter((i) => share(i, (c) => /\p{L}/u.test(c)) > 0.6);
  if (text.length === 1) mapping[text[0]] = "fullName";
  else if (text.length >= 2) { mapping[text[0]] = "lastName"; mapping[text[1]] = "firstName"; }
  return { mapping, hasHeader: false };
}

// Ligne inutilisable : sans prenom, sans nom, ou sans classe (l'eleve se connecte en choisissant sa classe).
function problemOf(r: Pick<ImportRow, "firstName" | "lastName" | "className">): string | null {
  const miss = [!r.lastName && "nom", !r.firstName && "prénom", !r.className && "classe"].filter(Boolean) as string[];
  if (!miss.length) return null;
  return miss.length === 1 ? `${miss[0]} manquant${miss[0] === "classe" ? "e" : ""}` : `${miss.join(", ")} manquants`;
}

// Lignes du tableau -> eleves, selon les colonnes choisies. defaultClass : classe de toute la liste (liste d'une seule
// classe sans colonne « Classe », ou cellule vide).
export function buildRows(rows: string[][], mapping: ImportField[], hasHeader: boolean, defaultClass = ""): ImportRow[] {
  const col = (f: ImportField) => mapping.indexOf(f);
  const out: ImportRow[] = [];
  rows.forEach((r, idx) => {
    if (hasHeader && idx === 0) return;
    const get = (f: ImportField) => (col(f) >= 0 ? clean(r[col(f)] ?? "") : "");
    if (r.every((c) => !clean(c))) return;
    let firstName = get("firstName");
    let lastName = get("lastName");
    const full = get("fullName");
    if (full && (!firstName || !lastName)) {
      const sp = splitFullName(full);
      firstName ||= sp.firstName;
      lastName ||= sp.lastName;
    }
    const dobRaw = get("dateOfBirth");
    const dateOfBirth = dobRaw ? parseBirthDate(dobRaw) : null;
    const row: ImportRow = {
      line: idx + 1,
      firstName,
      lastName,
      className: (get("className") || clean(defaultClass)).replace(/\s+/g, ""),
      sex: parseSex(get("sex")),
      dateOfBirth,
      ...(dobRaw && !dateOfBirth ? { dobRaw } : {}),
    };
    const problem = problemOf(row);
    if (problem) row.problem = problem;
    out.push(row);
  });
  return out;
}

// Le serveur ne croit pas le navigateur : chaque ligne recue est relue et bornee.
export function sanitizeRow(r: unknown, i: number): ImportRow {
  const o = (r ?? {}) as Record<string, unknown>;
  const cut = (v: unknown, n: number) => clean(v).slice(0, n);
  const dob = typeof o.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dateOfBirth) ? parseBirthDate(o.dateOfBirth) : null;
  const row: ImportRow = {
    line: Number.isInteger(o.line) ? (o.line as number) : i + 1,
    firstName: cut(o.firstName, 60),
    lastName: cut(o.lastName, 60),
    className: cut(o.className, 20).replace(/\s+/g, ""),
    sex: o.sex === "M" || o.sex === "F" ? o.sex : null,
    dateOfBirth: dob,
    ...(typeof o.dobRaw === "string" && o.dobRaw.trim() && !dob ? { dobRaw: cut(o.dobRaw, 30) } : {}),
  };
  const problem = problemOf(row);
  if (problem) row.problem = problem;
  return row;
}

// ----- Doublons -----

export type PlanStatus = "new" | "exists" | "dupInList" | "invalid";
export type PlannedRow = ImportRow & { status: PlanStatus; note?: string };
export type ExistingStudent = { id: string; firstName: string | null; lastName: string | null; className: string | null; dateOfBirth: string | null };

// Meme prenom + meme nom = le meme eleve, quelle que soit la classe (un eleve qui a change de classe n'est pas recree),
// SAUF si les deux dates de naissance sont connues et differentes : deux homonymes, le nouveau est cree.
export function planImport(rows: ImportRow[], existing: ExistingStudent[]): PlannedRow[] {
  const key = (f: string | null, l: string | null) => `${foldName(f ?? "")}|${foldName(l ?? "")}`;
  const sameDob = (a: string | null, b: string | null) => !a || !b || a === b;
  const byKey = new Map<string, ExistingStudent[]>();
  for (const s of existing) {
    const k = key(s.firstName, s.lastName);
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const seen = new Map<string, ImportRow[]>();
  return rows.map((r) => {
    if (r.problem) return { ...r, status: "invalid", note: r.problem };
    const k = key(r.firstName, r.lastName);
    const twin = (seen.get(k) ?? []).find((p) => sameDob(p.dateOfBirth, r.dateOfBirth));
    seen.set(k, [...(seen.get(k) ?? []), r]);
    if (twin) return { ...r, status: "dupInList", note: `déjà plus haut dans la liste (ligne ${twin.line})` };
    const match = (byKey.get(k) ?? []).find((s) => sameDob(s.dateOfBirth, r.dateOfBirth));
    if (match) return { ...r, status: "exists", note: `déjà inscrit${match.className ? ` (${match.className})` : ""}` };
    return { ...r, status: "new" };
  });
}
