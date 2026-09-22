"use client";

import { useTransition } from "react";
import { logoutAction } from "./logout-action";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => logoutAction())}
      disabled={pending}
      className="text-xs font-bold text-slate-500 border border-slate-300 rounded-lg px-3 py-2 disabled:opacity-50"
    >
      Déconnexion
    </button>
  );
}
