import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { TopBar } from "../../_components/TopBar";
import { ui } from "@/lib/ui";
import { currentSchool, ORIGIN_SCHOOL, schoolById } from "@/lib/school";

export const dynamic = "force-dynamic";

// QR de connexion a projeter (Sartay 08/10 : « un onglet sur la console admin pour afficher le QR pour que les eleves
// puissent se connecter a l'app »). Elle ouvre hyrox-delta.vercel.app, un domaine de production du meme projet que
// reps-eps.vercel.app. 18/11 (Sartay : « le QR est perime, genere un nouveau qui ne perime jamais ») : l'ancienne image
// (public/qr-connexion.png, gardee) encodait https://qrco.de/bh1gJQ, un QR « dynamique » de QR Code Generator qui expire
// avec l'essai gratuit. public/qr-connexion-statique.svg encode DIRECTEMENT https://hyrox-delta.vercel.app : aucun
// service intermediaire, il ne perime jamais (genere avec le paquet qrcode, correction Q, relu par jsQR).
// Une autre ecole (18/11, lib/school.ts) projette le QR de SON lien d'ecole (public/qr-ecole-<id>.svg, statique lui
// aussi) : le telephone retient l'ecole, et la page de connexion ne montre que ses classes.
export default async function QrPage() {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) redirect("/");
  const school = schoolById(await currentSchool());
  const other = school && school.id !== ORIGIN_SCHOOL && school.link ? school : null;
  const address = other ? `hyrox-delta.vercel.app/e/${other.link}` : "hyrox-delta.vercel.app";
  const image = other ? `/qr-ecole-${other.id}.svg` : "/qr-connexion-statique.svg";
  return (
    <div className={ui.page}>
      <TopBar title="QR de connexion" subtitle="À projeter : les élèves scannent le code pour ouvrir REPS" back={{ href: "/admin", label: "Console" }} />
      <main className="mx-auto max-w-6xl px-4 py-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-center">
        {/* Fond blanc dans tous les themes : un QR doit rester sombre sur clair pour se scanner. */}
        <div className="mx-auto w-full max-w-[min(78vh,680px)] rounded-3xl bg-white p-4 shadow-lg">
          <Image src={image} alt={`QR code qui ouvre REPS (${address})`} width={1000} height={1000} priority unoptimized className="w-full h-auto" />
        </div>
        <div className="space-y-5">
          <p className="font-display text-4xl font-extrabold leading-tight">📱 Scanne le code</p>
          <ol className="space-y-3 text-xl leading-snug">
            <li><b>1.</b> Ouvre l&apos;appareil photo et vise le code.</li>
            <li><b>2.</b> Choisis ta classe, puis ton nom.</li>
            <li><b>3.</b> Tape ton code PIN. La première fois : ta date de naissance, puis tu crées ton code.</li>
          </ol>
          <p className="text-lg text-ink-2">Pas de QR ? Tape l&apos;adresse : <b className="text-ink">{address}</b></p>
        </div>
      </main>
    </div>
  );
}
