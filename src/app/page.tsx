"use client";

import { useEffect, useState, useTransition, useActionState } from "react";
import {
  loginAction,
  listClassesAction,
  searchStudentsAction,
  studentLoginAction,
  StudentMatch,
} from "./actions";

export default function LoginPage() {
  const [tab, setTab] = useState<"eleve" | "admin">("eleve");

  return (
    <div className="min-h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl my-auto">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-black text-white italic tracking-tighter">
            HYROX <span className="text-yellow-500">WOD</span>
          </h1>
        </div>

        <div className="flex mb-6 border border-neutral-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setTab("eleve")}
            className={`flex-1 py-2 text-sm font-bold transition-colors ${
              tab === "eleve" ? "bg-yellow-500 text-black" : "text-neutral-400"
            }`}
          >
            Élève
          </button>
          <button
            onClick={() => setTab("admin")}
            className={`flex-1 py-2 text-sm font-bold transition-colors ${
              tab === "admin" ? "bg-yellow-500 text-black" : "text-neutral-400"
            }`}
          >
            Coach / Greffier / Admin
          </button>
        </div>

        {tab === "eleve" ? <StudentLogin /> : <AdminLogin />}
      </div>
    </div>
  );
}

function AdminLogin() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-2">Pseudo</label>
        <input
          type="text"
          name="name"
          required
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none transition-colors"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-2">Mot de passe</label>
        <input
          type="password"
          name="password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none transition-colors"
        />
      </div>
      {state?.error && <p className="text-red-400 text-sm">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-transform active:scale-95"
      >
        {pending ? "…" : "ENTRER"}
      </button>
    </form>
  );
}

function scrollIntoViewOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
}

function StudentLogin() {
  const [step, setStep] = useState<"classe" | "nom" | "pin">("classe");
  const [classes, setClasses] = useState<string[]>([]);
  const [className, setClassName] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [selected, setSelected] = useState<StudentMatch | null>(null);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    listClassesAction().then(setClasses);
  }, []);

  useEffect(() => {
    if (!className || query.trim().length < 1) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      searchStudentsAction(className, query).then(setMatches);
    }, 150);
    return () => clearTimeout(t);
  }, [className, query]);

  function pickStudent(s: StudentMatch) {
    setSelected(s);
    setPin("");
    setPinConfirm("");
    setError("");
    setStep("pin");
  }

  function submitPin() {
    if (!selected) return;
    if (!selected.hasPin && pin !== pinConfirm) {
      setError("Les deux codes ne correspondent pas.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await studentLoginAction(selected.id, pin);
      if (res && "error" in res) setError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      {step === "classe" && (
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">Ta classe</label>
          <select
            value={className}
            onChange={(e) => {
              setClassName(e.target.value);
              if (e.target.value) setStep("nom");
            }}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white outline-none focus:border-yellow-500"
          >
            <option value="">Choisis ta classe…</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {step === "nom" && (
        <div>
          <button
            onClick={() => {
              setStep("classe");
              setQuery("");
              setMatches([]);
            }}
            className="text-xs text-neutral-500 mb-3"
          >
            ← {className}
          </button>
          <label className="block text-sm font-medium text-neutral-300 mb-2">Ton prénom ou nom</label>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Commence à taper…"
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white outline-none focus:border-yellow-500"
          />
          <div className="mt-3 space-y-2">
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => pickStudent(m)}
                className="w-full text-left bg-neutral-800 hover:bg-neutral-700 rounded-lg p-3 text-white transition-colors"
              >
                {m.firstName} {m.lastName}
              </button>
            ))}
            {query.trim().length > 0 && matches.length === 0 && (
              <p className="text-sm text-neutral-500">Personne trouvé — vérifie l'orthographe ou demande à ton prof.</p>
            )}
          </div>
        </div>
      )}

      {step === "pin" && selected && (
        <div>
          <button
            onClick={() => {
              setStep("nom");
              setSelected(null);
              setError("");
            }}
            className="text-xs text-neutral-500 mb-3"
          >
            ← {selected.firstName} {selected.lastName}
          </button>
          <p className="text-white font-bold mb-3">
            {selected.firstName} {selected.lastName}
          </p>

          {selected.hasPin ? (
            <>
              <label className="block text-sm font-medium text-neutral-300 mb-2">Ton code PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onFocus={scrollIntoViewOnFocus}
                autoFocus
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white outline-none focus:border-yellow-500 tracking-[0.5em] text-center text-xl"
              />
            </>
          ) : (
            <>
              <p className="text-xs text-neutral-500 mb-3">
                Première connexion — crée un code PIN à 4 chiffres que tu garderas pour la suite.
              </p>
              <label className="block text-sm font-medium text-neutral-300 mb-2">Nouveau code PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onFocus={scrollIntoViewOnFocus}
                autoFocus
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white outline-none focus:border-yellow-500 tracking-[0.5em] text-center text-xl mb-3"
              />
              <label className="block text-sm font-medium text-neutral-300 mb-2">Confirme le code</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                onFocus={scrollIntoViewOnFocus}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white outline-none focus:border-yellow-500 tracking-[0.5em] text-center text-xl"
              />
            </>
          )}

          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

          <button
            onClick={submitPin}
            disabled={pending || pin.length < 4}
            className="w-full mt-4 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-transform active:scale-95"
          >
            {pending ? "…" : "ENTRER"}
          </button>
        </div>
      )}
    </div>
  );
}
