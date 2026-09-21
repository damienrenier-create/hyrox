import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ToucheCouleClient } from "./client";

export default async function ToucheCoulePage() {
  const evaluator = await getSession();
  if (!evaluator) {
    redirect("/");
  }

  // Trouver la session active
  const session = await db.orm.public.Session.where({ isActive: true })
    .include('teams', (t) => t.include('members', (m) => m.include('user')))
    .first();

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-cyan-50 font-mono text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Aucune session active</h1>
          <p className="text-slate-400">Attendez que le Master Admin lance la course.</p>
        </div>
      </div>
    );
  }

  return (
    <ToucheCouleClient 
      evaluator={evaluator}
      sessionId={session.id}
      teams={session.teams.map(t => ({ id: t.id, name: t.name }))}
    />
  );
}

