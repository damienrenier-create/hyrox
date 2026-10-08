// Dias du WOD AMRAP (Sartay 08/10 : « n'hesite pas a creer une dias avec les explications »). Module pur : servi par
// /admin/amrap/dias (a projeter, ou Imprimer -> PDF), 16:9. Tout vient des reglages de la seance (circuit, quantites,
// duree, depart decale) ; les conseils d'execution viennent des criteres des WOD Level et Eval quand l'exercice y existe.

import { SLIDE_BASE_CSS } from "@/lib/eval-slides";
import { SHORT_CRITERIA } from "@/lib/level-criteria";
import { amountWords, startIndexOf, type AmrapSettings } from "@/lib/wod-engines/templates/amrap-engine";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nb = (s: string) => esc(s).replace(/-/g, "&#8209;");
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// Conseils d'execution (3 par exercice). Exercices connus des autres WOD : leurs criteres courts ; les autres sont ecrits ici.
const OWN_TIPS: Record<string, { emoji: string; tips: string[] }> = {
  RUN: { emoji: "🏃", tips: ["Ligne franchie à chaque bout", "Toute l'équipe court", "Vraie course, sans marcher"] },
  CRAWLING: { emoji: "🐻", tips: ["À 4 pattes, genoux décollés", "Dos plat, bassin bas", "Main et pied opposés avancent ensemble"] },
  FENTES: { emoji: "🦵", tips: ["Genou arrière frôle le sol", "Genou avant au-dessus du pied", "Retour debout complet, jambes alternées"] },
};
const ALIASES: Record<string, string> = {
  "JUMP SQUATS": "SQUATS JUMP", "JUMP SQUAT": "SQUATS JUMP", POMPAGES: "POMPES", POMPAGE: "POMPES", COMMANDO: "COMMANDO BRAS",
  CORDES: "CORDE", "HÉLICO": "HELICO", HELICOS: "HELICO", "HÉLICOS": "HELICO", "MONKEY SLIDES": "MONKEY SLIDE", BURPEE: "BURPEES",
};
const EMOJI: Record<string, string> = { BURPEES: "🔥", "SQUATS JUMP": "🦘", POMPES: "💪", "COMMANDO BRAS": "🧱", "MONKEY SLIDE": "🐒", HELICO: "🚁", CORDE: "🪢" };
function tipsFor(label: string): { emoji: string; tips: string[] } {
  const k0 = label.trim().toUpperCase();
  const k = ALIASES[k0] ?? k0;
  if (OWN_TIPS[k]) return OWN_TIPS[k];
  const short = SHORT_CRITERIA[k];
  if (short) return { emoji: EMOJI[k] ?? "✅", tips: short.slice(0, 3) };
  return { emoji: "✅", tips: ["Amplitude complète", "Mouvement contrôlé", "Dos droit, gainé"] };
}

const CSS = `
.cols { flex: 1; display: grid; grid-template-columns: 640px 1fr; gap: 20px; min-height: 0; }
.course { display: flex; flex-direction: column; }
.course ol { list-style: none; margin: 4px 0 0; padding: 0; flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.course li { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 700; padding: 4px 0; border-bottom: 2px solid #f0eee8; }
.course li:last-child { border-bottom: 0; }
.n { flex: none; width: 52px; height: 52px; border-radius: 14px; background: #2d55d8; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800; }
.name { flex: 1; }
.qty { color: #555; font-weight: 600; font-size: 26px; white-space: nowrap; }
.loop { margin-top: 8px; background: #e9eefc; border-radius: 16px; padding: 10px 16px; font-size: 25px; line-height: 1.25; }
.grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 16px; min-height: 0; }
.grid .card h2 { font-size: 34px; }
.grid .card p { font-size: 28px; line-height: 1.27; }
.hero { grid-column: 1 / -1; display: flex; align-items: center; gap: 30px; }
.big { flex: none; font-size: 120px; font-weight: 900; color: #2d55d8; line-height: 0.9; letter-spacing: -4px; }
.big small { display: block; font-size: 26px; letter-spacing: 0; color: #7a5a00; text-transform: uppercase; font-weight: 800; margin-top: 8px; }
.hero p { font-size: 31px; line-height: 1.28; }
.ex { flex: 1; display: grid; grid-template-columns: repeat(5, 1fr); grid-auto-rows: 1fr; gap: 16px; min-height: 0; }
.ex .card { display: flex; flex-direction: column; gap: 8px; }
.ex .head { display: flex; align-items: center; gap: 10px; }
.ex .head .n { width: 46px; height: 46px; font-size: 24px; }
.ex .emo { font-size: 44px; margin-left: auto; }
.ex h2 { font-size: 33px; margin: 0; }
.ex .q { font-size: 26px; font-weight: 700; color: #7a5a00; }
.ex ul { margin: 0; padding-left: 28px; font-size: 28px; line-height: 1.25; }
.ex li + li { margin-top: 6px; }
.starts { flex: 1; display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; min-height: 0; }
.starts .card { display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 10px 18px; }
.starts .t { font-size: 24px; font-weight: 800; color: #555; text-transform: uppercase; letter-spacing: 1px; }
.starts .s { display: flex; align-items: center; gap: 12px; font-size: 32px; font-weight: 800; }
.starts .s .n { width: 48px; height: 48px; }
`;

// Dias du WOD : 1. le principe et le circuit ; 2. bien faire chaque exercice ; 3. (seance avec equipes) les departs.
export function renderAmrapSlides(s: AmrapSettings, teams: { order: number; name: string }[] = []): string {
  const n = s.exercises.length;
  // Circuit « en echelle » (Sartay 08/10 : 1 run, 2 burpees … 10 cordes) : le numero de l'exercice = ses repetitions.
  const ladder = n >= 2 && s.exercises.every((e, i) => e.unit === "rép." && e.reps === i + 1);
  const list = s.exercises.map((e, i) => `<li><span class="n">${i + 1}</span><span class="name">${esc(e.label)}</span><span class="qty">${nb(amountWords(e))}</span></li>`).join("");
  const rules = `<section class="slide">
  <div class="top"><h1>🔁 AMRAP ${s.capMin}′</h1><span class="sub">As Many Rounds As Possible · le plus de tours possible en ${s.capMin} minutes · par équipe</span></div>
  <div class="cols">
    <div class="card course">
      <h2>Un tour = ${plural(n, "exercice", "exercices")}</h2>
      <ol>${list}</ol>
      <div class="loop">🔁 Après le ${n}, on revient au 1 : <b>un tour de plus</b>. Et on recommence jusqu'à la fin du temps.</div>
    </div>
    <div class="grid">
      <div class="card hero gold">
        <div class="big">${s.capMin}′<small>top chrono</small></div>
        <p><b>Le plus de tours possible</b> en ${s.capMin} minutes. Pas de pause imposée : à vous de <b>gérer votre effort</b> pour tenir jusqu'au bout.</p>
      </div>
      <div class="card"><h2>🖥️ Fin du tour : à l'ordi</h2><p>À la fin de <b>chaque tour</b>, l'équipe vient à l'ordi : le greffier clique, <b>le tour est compté</b>. Pas de clic, pas de tour !</p></div>
      <div class="card"><h2>💪 Les répétitions</h2><p>${ladder ? `<b>Le numéro de l'exercice = son nombre de répétitions</b> : 1 ${esc(s.exercises[0].label.toLowerCase())}, 2 ${esc(s.exercises[1]?.label.toLowerCase() ?? "")}… jusqu'à ${n} ${esc(s.exercises[n - 1].label.toLowerCase())}. ` : ""}Chaque répétition se fait <b>en entier et proprement</b>.</p></div>
      <div class="card"><h2>📍 Le départ</h2><p>${s.staggered ? `Chaque équipe commence à <b>SON exercice</b>, donné par le greffier, puis suit l'ordre : après le ${n}, le 1.` : "Toutes les équipes commencent au <b>1</b>, puis suivent l'ordre."}</p></div>
      <div class="card"><h2>🏆 Le classement</h2><p>Le <b>plus de tours</b>. À égalité, l'équipe qui les a bouclés <b>le plus tôt</b>. À <b>${s.capMin}:00</b>, tout s'arrête : le tour en cours <b>ne compte pas</b>.</p></div>
    </div>
  </div>
</section>`;
  const cards = s.exercises.map((e, i) => {
    const t = tipsFor(e.label);
    return `<div class="card"><div class="head"><span class="n">${i + 1}</span><h2>${esc(e.label)}</h2><span class="emo">${t.emoji}</span></div><div class="q">${nb(amountWords(e))}</div><ul>${t.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  }).join("");
  const exercises = `<section class="slide">
  <div class="top"><h1>✅ Bien faire chaque exercice</h1><span class="sub">Une répétition bâclée ne compte pas</span></div>
  <div class="ex">${cards}</div>
  <div class="foot">Fin du tour = passage à l'ordi · le tour en cours à la fin du temps ne compte pas</div>
</section>`;
  const slides = [rules, exercises];
  if (teams.length) {
    const starts = [...teams].sort((a, b) => a.order - b.order).map((t) => {
      const i = startIndexOf(s, t);
      return `<div class="card"><span class="t">${esc(t.name)}</span><span class="s"><span class="n">${i + 1}</span>${esc(s.exercises[i]?.label ?? "")}</span></div>`;
    }).join("");
    slides.push(`<section class="slide">
  <div class="top"><h1>📍 Les départs</h1><span class="sub">Chaque équipe commence à son exercice, puis suit l'ordre du circuit</span></div>
  <div class="starts" style="grid-template-rows: repeat(${Math.max(4, Math.ceil(teams.length / 5))}, 1fr)">${starts}</div>
</section>`);
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>AMRAP ${s.capMin} min</title><style>${SLIDE_BASE_CSS}${CSS}</style></head><body>${slides.join("\n")}</body></html>`;
}
