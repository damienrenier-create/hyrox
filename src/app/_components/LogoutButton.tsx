"use client";

import { useTransition } from "react";
import { logoutAction } from "./logout-action";
import { btn } from "@/lib/ui";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button onClick={() => startTransition(() => logoutAction())} disabled={pending} className={btn.smGhost}>
      Déconnexion
    </button>
  );
}
