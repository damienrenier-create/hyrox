"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSlotGroupAction } from "./journal/actions";
import { fmtMin, WEEKDAYS } from "@/lib/journal";

// Petite croix de la vue semaine : retire un creneau du journal de classe (il revient chaque semaine,
// donc c'est bien le creneau recurrent qui part). Les seances deja ouvertes ou jouees ne bougent pas.
export function SlotDeleteButton({ teacherId, weekday, startMin, endMin, classes }: { teacherId: string; weekday: number; startMin: number; endMin: number; classes: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function remove() {
    if (
      !confirm(
        `Retirer le créneau du ${WEEKDAYS[weekday].toLowerCase()} ${fmtMin(startMin)}–${fmtMin(endMin)} (${classes.join(", ") || "sans classe"}) du journal de classe ?\n\nIl disparaît pour TOUTES les semaines, pas seulement cette date. Les séances déjà ouvertes ou jouées ne sont pas touchées.`
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteSlotGroupAction({ teacherId, weekday, startMin, endMin });
      if ("error" in res) alert(res.error);
      else router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      title="Retirer ce créneau du journal (toutes les semaines)"
      aria-label="Retirer ce créneau"
      className="w-6 h-6 rounded-full text-ink-3 hover:bg-danger-soft hover:text-danger-ink font-bold leading-none flex items-center justify-center flex-shrink-0 disabled:opacity-50"
    >
      ✕
    </button>
  );
}
