"use client";

import { useEffect, useState, useTransition, useActionState } from "react";
import {
  loginAction,
  listClassesAction,
  searchStudentsAction,
  studentLoginAction,
  firstLoginAction,
  verifyBirthDateAction,
  StudentMatch,
} from "./actions";
import { Brand } from "./_components/Brand";
import { btn, cx, ui } from "@/lib/ui";

export default function LoginPage() {
  const [tab, setTab] = useState<"eleve" | "admin">("eleve");

  return (
    <div className="min-h-[100dvh] bg-paper flex flex-col items-center justify-center p-4 overflow-y-auto relative">
      {/* halos doux, jamais de neon */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-brand-soft blur-3xl opacity-80" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 w-[460px] h-[460px] rounded-full bg-accent-soft blur-3xl opacity-90" />

      <div className="relative w-full max-w-md my-auto">
        <div className="text-center mb-6">
          <Brand size="lg" />
          <p className="text-sm text-ink-2 mt-2">Cours d&apos;éducation physique · séances, arbitrage, résultats</p>
        </div>

        <div className={`${ui.card} p-6 sm:p-8`}>
          <div className={`${ui.segmented} w-full mb-6`}>
            <button
              onClick={() => setTab("eleve")}
              className={cx("flex-1 py-2 text-sm font-bold rounded-lg transition", tab === "eleve" ? ui.segOn : ui.segOff)}
            >
              Élève
            </button>
            <button
              onClick={() => setTab("admin")}
              className={cx("flex-1 py-2 text-sm font-bold rounded-lg transition", tab === "admin" ? ui.segOn : ui.segOff)}
            >
              Coach / Greffier / Admin
            </button>
          </div>

          {tab === "eleve" ? <StudentLogin /> : <AdminLogin />}
        </div>
      </div>
    </div>
  );
}

function AdminLogin() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className={ui.label}>Pseudo</label>
        <input
          type="text"
          name="name"
          required
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>Mot de passe</label>
        <input
          type="password"
          name="password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={ui.input}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="remember" className={ui.check} />
        Se souvenir de moi (30 jours)
      </label>
      {state?.error && <p className={ui.alertErr}>{state.error}</p>}
      <button type="submit" disabled={pending} className={`${btn.lgPrimary} w-full`}>
        {pending ? "…" : "Entrer"}
      </button>
    </form>
  );
}

function scrollIntoViewOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
}

const pinInput = `${ui.input} tracking-[0.5em] text-center text-xl py-3`;

function StudentLogin() {
  const [step, setStep] = useState<"classe" | "nom" | "pin">("classe");
  const [classes, setClasses] = useState<string[]>([]);
  const [className, setClassName] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [selected, setSelected] = useState<StudentMatch | null>(null);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  // Premiere connexion en trois temps : date de naissance verifiee, engagement sur l'honneur, code PIN.
  const [first, setFirst] = useState<"dob" | "oath" | "pin">("dob");
  const [dob, setDob] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [remember, setRemember] = useState(true);
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
    setDob("");
    setAgreed(false);
    setFirst("dob");
    setError("");
    setStep("pin");
  }

  function checkBirthDate() {
    if (!selected || !dob) return;
    setError("");
    startTransition(async () => {
      const res = await verifyBirthDateAction(selected.id, dob);
      if ("error" in res) setError(res.error);
      else setFirst("oath");
    });
  }

  function submitPin() {
    if (!selected) return;
    if (!selected.hasPin && pin !== pinConfirm) {
      setError("Les deux codes ne correspondent pas.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = selected.hasPin
        ? await studentLoginAction(selected.id, pin, remember)
        : await firstLoginAction(selected.id, dob, agreed, pin, remember);
      if (res && "error" in res) setError(res.error);
    });
  }

  const backLink = "text-xs font-bold text-ink-2 hover:text-ink mb-3 inline-flex items-center gap-1";

  return (
    <div className="space-y-5">
      {step === "classe" && (
        <div>
          <label className={ui.label}>Ta classe</label>
          <select
            value={className}
            onChange={(e) => {
              setClassName(e.target.value);
              if (e.target.value) setStep("nom");
            }}
            className={`${ui.input} py-3`}
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
            className={backLink}
          >
            ← {className}
          </button>
          <label className={ui.label}>Ton prénom ou nom</label>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Commence à taper…"
            className={`${ui.input} py-3`}
          />
          <div className="mt-3 space-y-2">
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => pickStudent(m)}
                className="w-full text-left bg-paper hover:bg-brand-soft hover:text-brand-ink border border-line rounded-xl p-3 font-semibold transition"
              >
                {m.firstName} {m.lastName}
              </button>
            ))}
            {query.trim().length > 0 && matches.length === 0 && (
              <p className={ui.muted}>Personne trouvé — vérifie l&apos;orthographe ou demande à ton prof.</p>
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
            className={backLink}
          >
            ← {selected.firstName} {selected.lastName}
          </button>
          <p className="font-display font-bold text-lg mb-3">
            {selected.firstName} {selected.lastName}
          </p>

          {selected.hasPin ? (
            <>
              <label className={ui.label}>Ton code PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onFocus={scrollIntoViewOnFocus}
                autoFocus
                className={pinInput}
              />
            </>
          ) : first === "dob" ? (
            <>
              <p className={`${ui.alertInfo} mb-3`}>Première connexion. Commence par confirmer ta date de naissance.</p>
              <label className={ui.label}>Ta date de naissance</label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                onFocus={scrollIntoViewOnFocus}
                autoFocus
                className={`${ui.input} py-3 text-center text-lg`}
              />
              {error && <p className={`${ui.alertErr} mt-3`}>{error}</p>}
              <button onClick={checkBirthDate} disabled={pending || !dob} className={`${btn.lgPrimary} w-full mt-4`}>
                {pending ? "…" : "Vérifier"}
              </button>
            </>
          ) : first === "oath" ? (
            <>
              <div className={`${ui.alertWarn} mb-3 text-sm leading-snug`}>
                <b className="block mb-1">⚠️ Avant d&apos;aller plus loin</b>
                Ce compte portera tes résultats, tes arbitrages et tes auto-évaluations toute l&apos;année. Se
                connecter à la place de quelqu&apos;un d&apos;autre est une usurpation d&apos;identité et sera
                <b> lourdement sanctionné</b>.
              </div>
              <label className="flex items-start gap-3 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className={`${ui.check} mt-0.5`} />
                <span>
                  Je confirme que je suis bien <b>{selected.firstName} {selected.lastName}</b> et j&apos;ai compris
                  que toute usurpation sera sanctionnée.
                </span>
              </label>
              {error && <p className={`${ui.alertErr} mt-3`}>{error}</p>}
              <button onClick={() => { setError(""); setFirst("pin"); }} disabled={!agreed} className={`${btn.lgPrimary} w-full mt-4`}>
                Continuer
              </button>
            </>
          ) : (
            <>
              <p className={`${ui.alertOk} mb-3`}>✅ C&apos;est bien toi. Choisis un code PIN de 4 à 8 chiffres, que tu garderas toute l&apos;année.</p>
              <label className={ui.label}>Nouveau code PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onFocus={scrollIntoViewOnFocus}
                autoFocus
                className={`${pinInput} mb-3`}
              />
              <label className={ui.label}>Confirme le code</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                onFocus={scrollIntoViewOnFocus}
                className={pinInput}
              />
            </>
          )}

          {(selected.hasPin || first === "pin") && (
            <>
              <label className="flex items-center gap-2 text-sm text-ink-2 mt-4">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className={ui.check} />
                Se souvenir de moi (30 jours)
              </label>

              {error && <p className={`${ui.alertErr} mt-3`}>{error}</p>}

              <button onClick={submitPin} disabled={pending || pin.length < 4} className={`${btn.lgPrimary} w-full mt-4`}>
                {pending ? "…" : "Entrer"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
