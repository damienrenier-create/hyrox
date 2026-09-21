import { loginAction } from "./actions";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-white italic tracking-tighter">
            HYROX <span className="text-yellow-500">WOD</span>
          </h1>
          <p className="text-neutral-400 mt-2">Identifiez-vous pour entrer dans l'arène</p>
        </div>

        <form action={loginAction} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Je suis...</label>
            <select 
              name="role" 
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none transition-colors"
            >
              <option value="STUDENT">Élève (Arbitre)</option>
              <option value="ADMIN">Coach (Arbitre Vétéran)</option>
              <option value="GREFFIER">Le Greffier (Projecteur)</option>
              <option value="MASTER_ADMIN">DAMZER (Master Admin)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Prénom ou Pseudo</label>
            <input 
              type="text" 
              name="name" 
              required
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none transition-colors"
              placeholder="Ex: Thomas"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Mot de passe (si requis)</label>
            <input 
              type="password" 
              name="password" 
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none transition-colors"
              placeholder="Laisser vide si Élève"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-lg transition-transform active:scale-95"
          >
            ENTRER DANS LA COMPÉTITION
          </button>
        </form>
      </div>
    </div>
  );
}
