import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { GreffierClient } from "./client";

export default async function GreffierPage() {
  const evaluator = await getSession();
  if (!evaluator || !["MASTER_ADMIN", "GREFFIER"].includes(evaluator.role)) {
    redirect("/");
  }

  const session = await db.orm.public.Session.where({ isActive: true })
    .include('teams', (t) => t.include('members', (m) => m.include('user')))
    .first();

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-cyan-50 font-mono text-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">Aucune session active</h1>
        </div>
      </div>
    );
  }

  return (
    <GreffierClient 
      evaluator={evaluator}
      sessionId={session.id}
      initialTeams={session.teams}
    />
  );
}
