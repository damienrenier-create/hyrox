// Anniversaire du jour, en heure de Bruxelles. La date de naissance est stockee a minuit UTC
// ("2009-05-25T00:00:00Z") : on compare simplement le mois-jour.
export function isBirthdayToday(dateOfBirth: unknown, now = new Date()): boolean {
  if (!dateOfBirth) return false;
  const md = String(dateOfBirth).slice(5, 10);
  if (!/^\d{2}-\d{2}$/.test(md)) return false;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }).slice(5, 10);
  return md === today;
}

// « 🎂 » a coller derriere un prenom le jour J, sinon rien.
export const cake = (birthday?: boolean | null) => (birthday ? " 🎂" : "");
