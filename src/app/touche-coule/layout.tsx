import type { ReactNode } from "react";
import { PreviewBanner } from "../_components/PreviewBanner";

// Bandeau « aperçu du compte de … » quand un admin regarde ce compte (se connecter en tant que, 29/09 nuit).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <PreviewBanner />
      {children}
    </>
  );
}
