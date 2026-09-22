import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/ui";
import { Brand } from "./Brand";

// Barre haute commune (blanche, collante) : retour optionnel, marque ou titre, sous-titre, actions a droite.
export function TopBar({
  title,
  subtitle,
  back,
  right,
  children,
  wide,
  brand = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label?: string };
  right?: ReactNode;
  children?: ReactNode; // ligne secondaire (onglets, filtres)
  wide?: boolean;
  brand?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 bg-card/90 backdrop-blur border-b border-line">
      <div className={cx("mx-auto px-4 sm:px-6 py-3", wide ? "max-w-[1800px]" : "max-w-5xl")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {back && (
              <Link href={back.href} aria-label={back.label ?? "Retour"} className="w-9 h-9 rounded-full bg-paper hover:bg-line text-ink-2 flex items-center justify-center font-bold text-lg flex-shrink-0">
                ‹
              </Link>
            )}
            {brand && !title && <Brand />}
            {title && (
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {brand && <Brand className="hidden sm:inline-block" />}
                  {brand && <span className="hidden sm:inline text-line-2">/</span>}
                  <h1 className="font-display font-extrabold tracking-tight text-lg leading-tight truncate">{title}</h1>
                </div>
                {subtitle && <p className="text-xs text-ink-2 truncate">{subtitle}</p>}
              </div>
            )}
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </div>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </header>
  );
}
