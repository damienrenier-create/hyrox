import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createSessionAction } from "./actions";
import { db } from "@/lib/db";

export default async function AdminDashboard() {
  const user = await getSession();
  if (!user || user.role !== "MASTER_ADMIN") {
    redirect("/");
  }

  const activeSession = await db.orm.public.Session.where({ isActive: true }).first();

  return (
    <div className="min-h-screen bg-slate-950 text-cyan-50 font-mono p-8">
      <h1 className="text-3xl font-black text-cyan-400 mb-8 uppercase tracking-widest">Master Admin - Console</h1>
      
      <div className="bg-slate-900 border border-cyan-900 rounded-xl p-6 max-w-2xl shadow-xl">
        <h2 className="text-xl font-bold mb-4">Création de Session</h2>
        
        {activeSession && (
          <div className="bg-orange-900/50 border border-orange-500/50 text-orange-200 p-4 rounded mb-6 text-sm">
            ⚠️ Une session est déjà active. En créer une nouvelle clôturera la précédente sans sauvegarder son historique.
          </div>
        )}

        <p className="text-slate-400 mb-6 text-sm">
          Créer une nouvelle session va générer 24 équipes vides et préparer la base de données pour une nouvelle course de type Pyramide Classique.
        </p>

        <form action={createSessionAction} className="flex flex-col gap-6">
          <div>
            <label className="block text-sm font-medium text-cyan-300 mb-2">Nombre d'Équipes</label>
            <input 
              type="number" 
              name="numTeams" 
              defaultValue={24}
              min={1}
              max={50}
              className="w-full bg-slate-950 border border-cyan-800 rounded-lg p-3 text-white focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none transition-colors"
            />
            <p className="text-xs text-slate-500 mt-1">Par défaut : 24. Le greffier et les arbitres s'adapteront à ce nombre.</p>
          </div>

          <button 
            type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-black tracking-widest py-4 px-8 rounded shadow-[0_0_15px_rgba(8,145,178,0.5)] transition-transform active:scale-95"
          >
            LANCER UNE NOUVELLE COURSE
          </button>
        </form>
      </div>
    </div>
  );
}
