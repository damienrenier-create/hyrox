import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ensureRaceStateAction, buildRaceContext } from "./race-actions";
import { GreffierClient } from "./client";

export default async function GreffierPage() {
  const evaluator = await getSession();
  if (!evaluator || !["MASTER_ADMIN", "GREFFIER"].includes(evaluator.role)) {
    redirect("/");
  }

  // Pas de filtre isActive : le greffier doit pouvoir revoir les resultats finaux juste apres
  // avoir clos la course, meme si l'admin en a ouvert une autre entre-temps.
  const session = await db.orm.public.Session.where({}).orderBy((s) => s.createdAt.desc()).first();

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-cyan-50 font-mono text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Aucune session</h1>
        </div>
      </div>
    );
  }

  await ensureRaceStateAction(session.id);
  const bundle = await buildRaceContext(session.id);

  return <GreffierClient sessionId={session.id} bundle={bundle} />;
}
