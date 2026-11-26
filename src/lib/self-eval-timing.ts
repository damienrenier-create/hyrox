// Auto-evaluation de BADMINTON : QUAND elle est envoyee, et le petit mot que l'eleve recoit (Sartay 26/11 : « on sait
// quand l'auto-eval a ete faite et il recoit un petit commentaire bienveillant ou une remarque s'il la fait trop tard
// apres la fin du cours »). Module PUR.
//
// Paliers (heure de l'envoi - fin du cours ; jours = jours du calendrier a Bruxelles) :
//   TOP       jusqu'a 10 min apres la fin (« entre -5 et +10 minutes c'est tres bien » ; pendant le cours aussi :
//             « apres chaque match, veux-tu t'auto-evaluer maintenant ? »)
//   SUPER     de 10 a 30 min (« super »)
//   HOMEWORK  plus tard le meme jour (« +1 a +6 h : cool, il a bien fait ses devoirs, bravo, mais est-il sur d'etre juste ? »)
//   NEXT_DAY  le lendemain (« mieux vaut tard que jamais »)
//   LATE      apres le lendemain, jusqu'a 3 jours apres la fin (« c'est tard !! pas content »)
//   CLOSED    plus de 3 jours : l'auto-evaluation est FERMEE (« on dirait qu'il veut simplement son classement ; sorry,
//             plus dispo ; attends ton prochain cours et remplis plus vite la prochaine fois »).
// Le mot est tire au sort parmi 6, toujours le meme pour un eleve et un cours.

export const BM_SELF_EVAL_DAYS = 3;
export const BM_SELF_EVAL_WINDOW_MS = BM_SELF_EVAL_DAYS * 24 * 3600_000;

export type SelfEvalTiming = "TOP" | "SUPER" | "HOMEWORK" | "NEXT_DAY" | "LATE" | "CLOSED";

// Jour du calendrier a Bruxelles (nombre de jours depuis 1970), pour « le meme jour » / « le lendemain ».
function brusselsDay(ms: number): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Math.round(Date.UTC(v("year"), v("month") - 1, v("day")) / 86_400_000);
}

export function selfEvalTiming(submittedMs: number, endMs: number): SelfEvalTiming {
  const d = submittedMs - endMs;
  if (d <= 10 * 60_000) return "TOP";
  if (d <= 30 * 60_000) return "SUPER";
  if (d > BM_SELF_EVAL_WINDOW_MS) return "CLOSED";
  const days = brusselsDay(submittedMs) - brusselsDay(endMs);
  if (days <= 0) return "HOMEWORK";
  if (days === 1) return "NEXT_DAY";
  return "LATE";
}

// Etiquette courte (tableau du prof).
export const TIMING_LABEL: Record<SelfEvalTiming, string> = {
  TOP: "✅ à chaud",
  SUPER: "👍 juste après",
  HOMEWORK: "📚 plus tard le jour même",
  NEXT_DAY: "⏰ le lendemain",
  LATE: "😕 en retard",
  CLOSED: "🔒 trop tard",
};

export const TIMING_COMMENTS: Record<SelfEvalTiming, string[]> = {
  TOP: [
    "Bravo, auto-évaluation remplie dans la foulée du cours : c'est exactement le bon réflexe ! 👏",
    "Pile au bon moment : tout est encore frais dans ta tête, ton auto-évaluation n'en sera que plus juste. 💪",
    "Rapide et efficace ! Remplie à chaud, c'est comme ça qu'on progresse. 🔥",
    "Top ! Remplie avant même de quitter la salle : ton prof apprécie. 🏸",
    "Très bien : tu prends le temps de regarder ton cours juste après l'avoir vécu. Continue comme ça ! ⭐",
    "Réflexe de champion : on joue, on s'analyse, on progresse. Merci ! 🙌",
  ],
  SUPER: [
    "Super, tu n'as pas traîné : ton auto-évaluation est arrivée peu après la fin du cours. 👍",
    "Bien joué ! Remplie juste après le cours, quand les souvenirs sont encore précis. 😊",
    "Merci d'avoir pris ces quelques minutes juste après le cours : c'est super. 🏸",
    "Super réactivité ! La prochaine fois, tu peux même la remplir avant la sonnerie. ⏱️",
    "Chouette : auto-évaluation envoyée dans la demi-heure. Tu es dans les bons ! ✅",
    "Super ! Un petit effort tout de suite après le cours, et c'est réglé. 💪",
  ],
  HOMEWORK: [
    "Cool, tu as fait tes devoirs, bravo ! Mais quelques heures après, es-tu sûr que tes souvenirs sont encore justes ? 🤔",
    "Merci pour ton auto-évaluation ! Avec un peu de recul, c'est bien… à condition d'avoir été honnête sur chaque ligne. 😉",
    "Devoir rendu ✅ Bravo ! Relis quand même tes réponses : correspondent-elles vraiment à ce que tu as fait au cours ?",
    "C'est fait, bravo ! La prochaine fois, essaie de la remplir à la fin du cours : ce sera plus facile d'être juste. 🏸",
    "Bien d'y avoir pensé ! Mais avec le temps, on a vite tendance à s'embellir un peu… tu es sûr de toi ? 😄",
    "Cool, remplie le jour même ! Est-ce que ton prof aurait coché les mêmes cases que toi ? 🤔",
  ],
  NEXT_DAY: [
    "Mieux vaut tard que jamais ! Mais la prochaine fois, remplis-la à la fin du cours. ⏰",
    "Merci, elle est bien arrivée… le lendemain. Le cours est déjà un peu loin : sois sûr d'être juste. 😉",
    "Mieux vaut tard que jamais 🙂 Essaie de ne pas attendre le lendemain la prochaine fois.",
    "Auto-évaluation reçue, avec un jour de retard. Le bon moment, c'est juste après le cours ! 🏸",
    "Tu y as pensé, c'est l'essentiel… mais un jour après, les souvenirs s'effacent vite. Plus tôt la prochaine fois ! ⏱️",
    "Mieux vaut tard que jamais ! Ton prof préfère quand même la recevoir le jour du cours. 😊",
  ],
  LATE: [
    "C'est tard ! Ton auto-évaluation arrive plusieurs jours après le cours : ton prof n'est pas content. 😕",
    "Plusieurs jours après le cours ? Ce n'est pas sérieux : la prochaine fois, remplis-la tout de suite. 😠",
    "Bien trop tard pour une auto-évaluation fiable : tu te souviens vraiment de ce que tu as fait au cours ? 🤨",
    "Reçue, mais ton prof n'est pas content : une auto-évaluation se remplit à la fin du cours, pas des jours après. ⏰",
    "C'est tard, vraiment tard. Ne recommence pas : à la fin du prochain cours, c'est tout de suite ! 😤",
    "Tu as failli la rater… et ton prof l'a remarqué. Prends l'habitude de la remplir à la fin du cours. 😕",
  ],
  CLOSED: [
    "Trop tard ! Plus de 3 jours après le cours, l'auto-évaluation est fermée. On dirait que tu voulais juste voir ton classement… Attends ton prochain cours et remplis-la plus vite ! 😠",
    "Désolé, plus disponible : le délai de 3 jours est passé. Le classement attendra ton prochain cours, et cette fois remplis vite ton auto-évaluation ! ⏰",
    "Tu reviens seulement pour le classement ? L'auto-évaluation de ce cours est fermée. Rendez-vous au prochain cours, et remplis-la tout de suite ! 😤",
    "Sorry, c'est fermé ! Une auto-évaluation se remplit à la fin du cours, pas des jours après. Ton classement se débloquera avec ta prochaine auto-évaluation. 🔒",
    "Ton prof n'est pas content : plus de 3 jours sans auto-évaluation. Attends ton prochain cours, et cette fois, remplis-la avant de partir ! 😕",
    "Trop tard pour celle-ci… Le classement, ce sera après ta prochaine auto-évaluation : remplis-la plus vite la prochaine fois ! 🔒",
  ],
};

// Toujours le meme mot pour un eleve et un cours (pas un nouveau tirage a chaque affichage).
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function timingComment(t: SelfEvalTiming, studentId: string, sessionId: string): string {
  const list = TIMING_COMMENTS[t];
  return list[seedOf(`${studentId}|${sessionId}`) % list.length];
}
