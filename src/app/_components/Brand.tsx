import { cx } from "@/lib/ui";

// Marque « HYROX WOD » : titre display + point orange. `size` = compact (barres) ou grand (login).
export function Brand({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  return (
    <span className={cx("font-display font-extrabold tracking-tight leading-none text-ink select-none", size === "lg" ? "text-4xl sm:text-5xl" : "text-lg", className)}>
      HYROX
      <span className="text-accent">.</span>
      <span className={cx("font-bold text-brand", size === "lg" ? "ml-2" : "ml-1")}>WOD</span>
    </span>
  );
}
