// Dias du WOD Eval (Sartay 04/10 : « deux pdf : 1. les regles de l'eval pour les participants ; 2. les infos dont les
// dispenses ont besoin pour arbitrer »). Module pur : servi par /admin/eval/dias (Imprimer -> PDF), 16:9, a projeter
// en debut de seance. Tout vient des reglages de la seance (stations, run, tours, temps, niveaux), des grilles de l'Eval
// (EVAL_CRITERIA) et du bareme (eval-bareme.ts) : quand un critere, une station ou le bareme change, la dia change avec.
// 05/10 au soir : 10 stations, fin officielle + prolongation, et une 2e dia pour les participants : les niveaux
// « etoiles » et la note d'intensite.

import { RUN_CRITERIA_KEY, evalShortFor } from "@/lib/level-criteria";
import { OBS_MINUTES, OBS_PREVIEW_MS } from "@/lib/observation-types";
import { EVAL_GROUPS, EVAL_NOTE_MAX, evalMaxNote, noteText } from "@/lib/eval-bareme";
import { HX_LEVELS, hxStationReps, starsText, type HXSettings } from "@/lib/wod-engines/templates/hyrox-engine";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Trait d'union insecable : « allers-retours » ne se coupe pas en fin de ligne sur une dia.
const nb = (s: string) => esc(s).replace(/-/g, "&#8209;");
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
// « 2 allers-retours », « 60 répétitions » : la consigne en toutes lettres.
const amount = (reps: number, unit: string) => (unit === "A/R" ? plural(reps, "aller-retour", "allers-retours") : unit === "rép." ? plural(reps, "répétition", "répétitions") : `${reps} ${unit}`);
const minutes = (sec: number) => (sec % 60 === 0 ? plural(sec / 60, "minute", "minutes") : `${sec} secondes`);

const BASE = `
@page { size: 1920px 1080px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #141414; background: #ddd; }
.slide { width: 1920px; height: 1080px; background: #fbfaf6; padding: 34px 44px 26px; page-break-after: always; break-after: page; overflow: hidden; margin: 0 auto 12px; display: flex; flex-direction: column; gap: 18px; }
.top { display: flex; align-items: baseline; gap: 26px; }
h1 { font-size: 60px; margin: 0; letter-spacing: -1px; white-space: nowrap; }
.sub { font-size: 27px; color: #555; font-weight: 600; }
.card { background: #fff; border: 3px solid #e2e2e2; border-radius: 22px; padding: 16px 22px; }
.card h2 { font-size: 30px; margin: 0 0 6px; color: #2446b8; line-height: 1.1; }
.card p { font-size: 25px; line-height: 1.28; margin: 0; }
.card p + p { margin-top: 6px; }
b { font-weight: 800; }
.foot { font-size: 22px; color: #444; text-align: center; }
@media print { body { background: #fbfaf6; } .slide { margin: 0; } }
`;
const page = (title: string, css: string, slides: string[]) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE}${css}</style></head><body>${slides.join("\n")}</body></html>`;

// ===== 1. Les regles du WOD, pour les participants =====
export function renderEvalRules(s: HXSettings): string {
  const laps = Math.max(1, s.laps);
  const run = s.runParts.join(" + ");
  const lowest = HX_LEVELS[0];
  const highest = HX_LEVELS[HX_LEVELS.length - 1];
  const end = s.capMin + s.extraMin;
  // Avec les niveaux, une station en repetitions s'annonce par sa fourchette : « 40 à 65 répétitions ».
  const qty = (st: HXSettings["stations"][number]) => (s.levels && st.unit === "rép." ? `${hxStationReps(st, lowest.stars)} à ${amount(hxStationReps(st, highest.stars), st.unit)}` : amount(st.reps, st.unit));
  const stations = s.stations.map((st, i) => `<li><span class="n">${i + 1}</span><span class="name">${esc(st.label)}</span><span class="qty">${esc(qty(st))}</span></li>`).join("");
  const css = `
.cols { flex: 1; display: grid; grid-template-columns: 700px 1fr; gap: 20px; min-height: 0; }
.course { display: flex; flex-direction: column; }
.course ol { list-style: none; margin: 4px 0 0; padding: 0; flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.course li { display: flex; align-items: center; gap: 14px; font-size: 29px; font-weight: 700; padding: 5px 0; border-bottom: 2px solid #f0eee8; }
.course li:last-child { border-bottom: 0; }
.n { flex: none; width: 50px; height: 50px; border-radius: 14px; background: #2d55d8; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800; }
.name { flex: 1; }
.qty { color: #555; font-weight: 600; font-size: 25px; white-space: nowrap; }
.runbox { margin-top: 10px; background: #e9eefc; border-radius: 16px; padding: 10px 16px; font-size: 25px; line-height: 1.25; }
.grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 16px; min-height: 0; }
.grid .card h2 { font-size: 33px; }
.grid .card p { font-size: 28px; line-height: 1.26; }
.lv { flex: 1; display: grid; grid-template-columns: 1fr 520px; gap: 20px; min-height: 0; }
.lv table { width: 100%; height: 100%; border-collapse: separate; border-spacing: 0 8px; font-size: 38px; text-align: center; }
.lv th { font-size: 25px; line-height: 1.15; color: #555; font-weight: 700; padding: 0 8px 4px; vertical-align: bottom; }
.lv th b { display: block; font-size: 30px; color: #141414; }
.lv th.grp { border-left: 3px solid #e2e2e2; }
.lv td { background: #f4f2ec; padding: 0 10px; font-weight: 800; }
.lv td:first-child { border-radius: 16px 0 0 16px; text-align: left; padding-left: 22px; color: #b76a00; letter-spacing: 3px; white-space: nowrap; }
.lv td:last-child { border-radius: 0 16px 16px 0; }
.lv td.rp { font-size: 44px; }
.lv td.rp small { font-size: 24px; font-weight: 600; color: #555; }
.lv td.nt small { font-size: 22px; font-weight: 600; color: #777; }
.lv td.max { background: #dff3e3; color: #0f6b2f; }
.lv .side { display: flex; flex-direction: column; gap: 16px; }
.lv .side .card { flex: 1; }
.lv .side .card h2 { font-size: 31px; }
.lv .side .card p { font-size: 26px; line-height: 1.27; }
`;
  const slide = `<section class="slide">
  <div class="top"><h1>🏁 WOD EVAL</h1><span class="sub">${plural(s.stations.length, "station", "stations")} · un run après chaque station · ${plural(laps, "tour", "tours")} · par équipe de 3 · ${s.capMin} minutes</span></div>
  <div class="cols">
    <div class="card course">
      <h2>Le parcours</h2>
      <ol>${stations}</ol>
      <div class="runbox">🏃 <b>Après chaque station : ${esc(s.runLabel.toLowerCase())} de ${esc(run)}.</b><br>Puis la station suivante. Après la ${s.stations.length}, on revient à la 1.${laps > 1 ? ` <b>${laps} tours complets.</b>` : ""}</div>
    </div>
    <div class="grid">
      <div class="card"><h2>👥 Ton équipe</h2><p>Équipes de <b>3</b>. Le greffier vous donne un <b>numéro d'équipe</b> et une <b>station de départ</b> : chaque équipe commence à SA station, puis suit l'ordre.</p></div>
      ${s.levels
        ? `<div class="card"><h2>⭐ Votre niveau</h2><p>Avant le départ, l'équipe choisit son niveau : de <b>${lowest.stars}★ = ${lowest.reps}</b> à <b>${highest.stars}★ = ${highest.reps} répétitions</b> par station (dia suivante).</p><p>À vous de vous répartir le travail : chaque répétition <b>en entier et proprement</b>.</p></div>`
        : `<div class="card"><h2>💪 Les quantités</h2><p>Elles comptent pour <b>toute l'équipe</b> : à vous de vous répartir le travail. Chaque répétition se fait <b>en entier et proprement</b>.</p></div>`}
      <div class="card"><h2>✅ Valider à l'ordi</h2><p>Après <b>chaque station</b> et après <b>chaque run</b>, venez le dire au greffier : il clique sur votre fiche, qui affiche votre prochain exercice. C'est l'heure du clic qui fait votre temps.</p></div>
      <div class="card"><h2>🏃 Le run</h2><p>À trois, <b>groupés</b>. La ligne est franchie à chaque extrémité. On ne part pas, et on ne commence pas la station suivante, tant que <b>l'équipe n'est pas complète</b>.</p></div>
      <div class="card"><h2>⏱️ Le classement</h2><p>Au <b>temps</b> : la première équipe qui boucle ${laps > 1 ? `ses ${laps} tours` : "son tour"} gagne. ${s.extraMin > 0 ? "Fin officielle" : "Limite"} : <b>${s.capMin} minutes</b> ; les autres sont classées à l'avancement.</p><p>🟨 Triche ou répétitions bâclées : <b>carte jaune, + ${minutes(s.penSec)}</b>.</p></div>
      <div class="card"><h2>👁 Vous êtes observés</h2><p>Des arbitres (élèves dispensés et profs) suivent un élève pendant ${OBS_MINUTES} minutes : ils <b>comptent ses répétitions</b> et <b>notent sa technique</b>.</p><p>📱 Après : QCM bonus sur ton téléphone, puis ton auto-évaluation.</p></div>
    </div>
  </div>
</section>`;
  if (!s.levels) return page("WOD Eval · les règles", css, [slide]);

  // 2e dia : les niveaux et la note d'intensite (une ligne par niveau, une colonne par groupe du bareme).
  const head = EVAL_GROUPS.map((g) => `<th class="grp"><b>${esc(g.years)}</b>${esc(g.team)}</th>`).join("");
  const rows = [...HX_LEVELS].reverse().map((l) => `<tr><td>${starsText(l.stars)}</td><td class="rp">${l.reps} <small>rép.</small></td>${EVAL_GROUPS.map((g) => { const n = evalMaxNote(g.key, l.reps); return `<td class="nt${n >= EVAL_NOTE_MAX ? " max" : ""}">${noteText(n)}<small>/${EVAL_NOTE_MAX}</small></td>`; }).join("")}</tr>`).join("");
  const levelsSlide = `<section class="slide">
  <div class="top"><h1>⭐ CHOISIS TON NIVEAU</h1><span class="sub">Le niveau = le nombre de répétitions à chaque station · la note d'intensité va avec</span></div>
  <div class="lv">
    <div class="card"><table>
      <thead><tr><th>Niveau</th><th>À chaque<br>station</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="side">
      <div class="card"><h2>🎯 La note d'intensité</h2><p>C'est la note de l'équipe qui <b>boucle le WOD</b> (${plural(laps, "tour", "tours")}) avant la fin officielle : <b>${s.capMin}:00</b>.</p><p>Un niveau de plus = 5 répétitions de plus = <b>1 point de plus</b>.</p></div>
      <div class="card"><h2>⏱️ Pas fini à ${s.capMin}:00 ?</h2><p>La note part de ce maximum et <b>baisse</b> selon ce qu'il restait à faire. Choisissez un niveau que l'équipe peut <b>finir</b>.</p>${s.extraMin > 0 ? `<p>S'il reste du temps, le chrono continue jusqu'à <b>${end}:00</b> pour finir son parcours : c'est hors classement.</p>` : ""}</div>
      <div class="card"><h2>👥 Quelle colonne ?</h2><p><b>Filles</b> = une équipe de filles uniquement. Une équipe mixte lit « garçons ou mixte ».</p><p>Burpees, fentes, farmer : mêmes allers&#8209;retours pour tous.</p></div>
    </div>
  </div>
  <div class="foot">Annoncez votre niveau au greffier avant le départ · la technique est notée à part, par les arbitres et les profs.</div>
</section>`;
  return page("WOD Eval · les règles", css, [slide, levelsSlide]);
}

// ===== 2. Le guide des arbitres (eleves dispenses) =====
export function renderEvalReferee(s: HXSettings): string {
  const preview = Math.round(OBS_PREVIEW_MS / 60_000);
  const exercises = [...s.stations.map((st) => ({ label: st.label, key: st.label })), { label: s.runLabel, key: RUN_CRITERIA_KEY }];
  const cols = exercises.length > 10 ? 6 : exercises.length > 8 ? 5 : 4;
  const cells = exercises.map((e) => `<div class="c"><h3>${esc(e.label)}</h3><ul>${evalShortFor(e.key, "STUDENT").map((c) => `<li><span class="e">${c.emoji ?? "•"}</span>${nb(c.short)}</li>`).join("")}</ul></div>`).join("");
  const css = `
.steps { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; gap: 18px; min-height: 0; }
.step h2 { display: flex; align-items: center; gap: 14px; color: #141414; font-size: 37px; margin-bottom: 12px; }
.num { flex: none; width: 52px; height: 52px; border-radius: 50%; background: #1b6fb8; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 800; }
.step p { font-size: 32px; line-height: 1.3; }
.step p + p { margin-top: 12px; }
.warn { background: #fff7d6; border-color: #f2b600; }
.warn h2 { color: #7a5a00; }
.grid { flex: 1; display: grid; grid-template-columns: repeat(${cols}, 1fr); grid-auto-rows: 1fr; gap: 14px; min-height: 0; }
.c { background: #fff; border: 3px solid #e2e2e2; border-radius: 20px; padding: 14px 18px; display: flex; flex-direction: column; min-height: 0; }
.c h3 { font-size: ${cols > 5 ? 30 : 33}px; margin: 0 0 8px; color: #155c9a; line-height: 1.1; }
.c ul { list-style: none; margin: 0; padding: 0; flex: 1; display: flex; flex-direction: column; justify-content: space-around; }
.c li { font-size: ${cols > 5 ? 25 : 28}px; line-height: 1.2; font-weight: 700; display: flex; gap: ${cols > 5 ? 8 : 10}px; align-items: flex-start; }
.e { flex: none; width: ${cols > 5 ? 34 : 38}px; text-align: center; }
`;
  const how = `<section class="slide">
  <div class="top"><h1>👁 ARBITRE · WOD EVAL</h1><span class="sub">Tu ne joues pas aujourd'hui : tu observes un élève à la fois, pendant ${OBS_MINUTES} minutes.</span></div>
  <div class="steps">
    <div class="card step"><h2><span class="num">1</span>Connecte-toi</h2><p>Sur ton téléphone : <b>reps&#8209;eps.vercel.app</b>, ta classe, ton nom, ton code PIN.</p><p>Dans « WOD en cours », appuie sur <b>👁 Arbitre</b>, puis <b>▶ Commencer</b>.</p></div>
    <div class="card step"><h2><span class="num">2</span>${plural(preview, "minute", "minutes")} : repère ton élève</h2><p>L'appli affiche son <b>prénom</b>, son <b>nom</b>, sa <b>classe</b> et son <b>équipe</b>. Trouve-le dans la salle.</p><p>Pas sûr que ce soit lui ? Demande-lui son prénom.</p></div>
    <div class="card step"><h2><span class="num">3</span>${OBS_MINUTES} minutes : compte</h2><p>L'écran s'ouvre tout seul. Choisis <b>l'exercice qu'il fait</b>. Dès qu'il s'arrête, tape le nombre de répétitions de sa <b>série</b> : 5, puis 10, puis 3…</p><p>Run, burpees, fentes, farmer : compte les <b>allers-retours</b>.</p></div>
    <div class="card step"><h2><span class="num">4</span>Coche ce que tu as VU</h2><p><b>4 critères</b> par exercice : chaque coche est enregistrée tout de suite.</p><p>Rien n'est respecté ? Coche <b>« Aucun critère n'est respecté »</b>.</p></div>
    <div class="card step"><h2><span class="num">5</span>À 0:00, élève suivant</h2><p>L'écran se ferme tout seul : <b>ce qui n'est pas noté est perdu</b>.</p><p>Ton prochain élève s'affiche, et ainsi de suite jusqu'à la fin du WOD.</p></div>
    <div class="card step warn"><h2>⚠️ À retenir</h2><p>Garde la page ouverte et <b>l'écran allumé</b>. Une série fausse ? <b>« Annuler la dernière série »</b>.</p><p>Chaque série garde son heure, comparée aux validations du greffier : sois <b>honnête et précis</b>.</p></div>
  </div>
</section>`;
  const grid = `<section class="slide">
  <div class="top"><h1>👁 Ce que tu regardes</h1><span class="sub">4 critères par exercice · coche seulement ce que tu as vraiment vu</span></div>
  <div class="grid">${cells}</div>
  <div class="foot">Sur ton téléphone, chaque critère est écrit en entier · rien n'est respecté ? « Aucun critère n'est respecté » · tu n'observes jamais un élève de ta propre équipe.</div>
</section>`;
  return page("WOD Eval · guide des arbitres", css, [how, grid]);
}
