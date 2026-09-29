"use client";

import { softDeleteSessionAction } from "./cycles-actions";

// Tete de mort en haut a gauche d'une fiche de seance (DAMZER) : suppression DOUCE apres confirmation. La
// seance disparait de partout mais reste en base : « Annuler » juste apres, ou Nettoyage > Corbeille.
export function SessionDeleteButton({ id, label, detail, back }: { id: string; label: string; detail: string; back?: string }) {
  return (
    <form
      action={softDeleteSessionAction}
      onSubmit={(e) => {
        const ok = confirm(
          `💀 Supprimer la séance « ${label} » ?\n\n${detail}\n\nElle disparaît de la console, des résultats, des records, du carnet, des auto-évaluations et de l'espace des élèves.\nRien n'est effacé pour de bon : tu peux annuler tout de suite, ou la restaurer plus tard dans Nettoyage > Corbeille.`
        );
        if (!ok) e.preventDefault();
      }}
      className="flex-shrink-0"
    >
      <input type="hidden" name="id" value={id} />
      {back && <input type="hidden" name="back" value={back} />}
      <button
        type="submit"
        title="Supprimer cette séance (restaurable depuis Nettoyage > Corbeille)"
        aria-label="Supprimer cette séance"
        className="w-7 h-7 rounded-full text-base leading-none flex items-center justify-center bg-card border border-line hover:bg-danger-soft hover:border-danger/40 transition"
      >
        💀
      </button>
    </form>
  );
}
