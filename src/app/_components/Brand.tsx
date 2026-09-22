import Image from "next/image";
import { cx } from "@/lib/ui";

// Marque REPS : logo detoure a partir du fichier d'origine (fond supprime par diffusion depuis les bords,
// ce qui preserve le blanc des yeux a l'interieur des lettres). Deux fichiers sont disponibles dans
// `public/` : `logo-reps-red.png` (oeil du R en rouge) et `logo-reps.png` (oeil d'origine, tout bleu).
// Passer de l'un a l'autre = changer la constante ci-dessous, rien d'autre.
const LOGO = "/logo-reps-red.png";
const RATIO = 1455 / 409; // proportions du fichier detoure

export function Brand({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  const h = size === "lg" ? 68 : 22;
  return (
    <Image
      src={LOGO}
      alt="REPS"
      width={Math.round(RATIO * h)}
      height={h}
      priority={size === "lg"}
      className={cx("select-none", className)}
    />
  );
}
