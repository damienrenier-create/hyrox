import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { TopBar } from "../../_components/TopBar";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// QR de connexion a projeter (Sartay 08/10 : « un onglet sur la console admin pour afficher le QR pour que les eleves
// puissent se connecter a l'app »). L'image est celle de Sartay (public/qr-connexion.png) : elle ouvre
// hyrox-delta.vercel.app, un domaine de production du meme projet que reps-eps.vercel.app.
export default async function QrPage() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) redirect("/");
  return (
    <div className={ui.page}>
      <TopBar title="QR de connexion" subtitle="À projeter : les élèves scannent le code pour ouvrir REPS" back={{ href: "/admin", label: "Console" }} />
      <main className="mx-auto max-w-6xl px-4 py-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-center">
        {/* Fond blanc dans tous les themes : un QR doit rester sombre sur clair pour se scanner. */}
        <div className="mx-auto w-full max-w-[min(78vh,680px)] rounded-3xl bg-white p-4 shadow-lg">
          <Image src="/qr-connexion.png" alt="QR code qui ouvre REPS (hyrox-delta.vercel.app)" width={1000} height={1000} priority unoptimized className="w-full h-auto" />
        </div>
        <div className="space-y-5">
          <p className="font-display text-4xl font-extrabold leading-tight">📱 Scanne le code</p>
          <ol className="space-y-3 text-xl leading-snug">
            <li><b>1.</b> Ouvre l&apos;appareil photo et vise le code.</li>
            <li><b>2.</b> Choisis ta classe, puis ton nom.</li>
            <li><b>3.</b> Tape ton code PIN. La première fois : ta date de naissance, puis tu crées ton code.</li>
          </ol>
          <p className="text-lg text-ink-2">Pas de QR ? Tape l&apos;adresse : <b className="text-ink">hyrox-delta.vercel.app</b></p>
        </div>
      </main>
    </div>
  );
}
