import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { LEVEL_STAFF, listExercises, listLevels } from "@/lib/level";
import { TopBar } from "../../_components/TopBar";
import { LevelStudio } from "./LevelStudio";
import { ui } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Atelier du WOD Level : catalogue d'exercices ponderes + echelle des niveaux. Ouvert aux profs, aux coachs
// et au greffier (ils construisent la seance ensemble) ; seul DAMZER supprime.
export default async function LevelAdminPage() {
  const user = await getSession();
  if (!user || !(LEVEL_STAFF as readonly string[]).includes(user.role)) redirect("/");
  const [exercises, levels] = await Promise.all([listExercises(), listLevels()]);
  return (
    <div className={ui.page}>
      <TopBar
        title="WOD Level"
        subtitle="Catalogue d'exercices pondérés et échelle des niveaux, communs à toutes les classes"
        back={{ href: user.role === "GREFFIER" ? "/greffier" : "/admin", label: "Retour" }}
      />
      <main className={`${ui.container} py-4`}>
        <LevelStudio exercises={exercises} levels={levels} isMaster={user.role === "MASTER_ADMIN"} />
      </main>
    </div>
  );
}
