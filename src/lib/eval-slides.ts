// Dias du WOD Eval S.O.R.O (Sartay 04/10 : « deux pdf : 1. les regles de l'eval pour les participants ; 2. les infos
// dont les dispenses ont besoin pour arbitrer »). Module pur : servi par /admin/eval/dias (Imprimer -> PDF), 16:9, a
// projeter en debut de seance. Tout vient des reglages de la seance (stations, run, tours, temps, parcours), des grilles
// de l'Eval (EVAL_CRITERIA) et du bareme (eval-bareme.ts) : quand un critere, une station ou le bareme change, la dia
// change avec. 05/10 au soir (Sartay) : « les regles du WOD (son nom = EVAL S.O.R.O), l'organisation generale, les
// criteres d'evaluation avec le tableau des niveaux en fonction des etoiles » ; « parler de S.O.R.O. : station - ordi -
// run - ordi », de la repartition des points, du sport d'equipe, de la communication et des transitions.

import { RUN_CRITERIA_KEY, evalShortFor } from "@/lib/level-criteria";
import { OBS_MINUTES, OBS_PREVIEW_MS } from "@/lib/observation-types";
import { EVAL_DEFAULT_STARS, EVAL_GROUPS, EVAL_LEVELS, EVAL_NOTE_MAX, EVAL_WEIGHTS, evalLevelReps, evalNote, evalTopStars, noteText, starsText } from "@/lib/eval-bareme";
import type { HXSettings } from "@/lib/wod-engines/templates/hyrox-engine";

export const EVAL_NAME = "EVAL S.O.R.O";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Trait d'union insecable : « allers-retours » ne se coupe pas en fin de ligne sur une dia.
const nb = (s: string) => esc(s).replace(/-/g, "&#8209;");
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
// « 2 allers-retours », « 60 répétitions » : la consigne en toutes lettres.
const amount = (reps: number, unit: string) => (unit === "A/R" ? plural(reps, "aller-retour", "allers-retours") : unit === "rép." ? plural(reps, "répétition", "répétitions") : `${reps} ${unit}`);
const minutes = (sec: number) => (sec % 60 === 0 ? plural(sec / 60, "minute", "minutes") : `${sec} secondes`);

export const SLIDE_BASE_CSS = `
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
.gold { background: #fff7d6; border-color: #f2b600; }
.gold h2 { color: #7a5a00; }
@media print { body { background: #fbfaf6; } .slide { margin: 0; } }
`;
const page = (title: string, css: string, slides: string[]) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SLIDE_BASE_CSS}${css}</style></head><body>${slides.join("\n")}</body></html>`;

// ===== 1. Les regles du WOD, l'organisation et l'evaluation, pour les participants =====
export function renderEvalRules(s: HXSettings): string {
  const laps = Math.max(1, s.laps);
  const run = s.runParts.join(" + ");
  const end = s.capMin + s.extraMin;
  const first = EVAL_LEVELS[0];
  const last = EVAL_LEVELS[EVAL_LEVELS.length - 1];
  // Avec les parcours, une station en repetitions depend du parcours de l'equipe (dia « L'evaluation »).
  const qty = (st: HXSettings["stations"][number]) => (s.levels && st.unit === "rép." ? "selon le parcours ⭐" : amount(st.reps, st.unit));
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
.grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr 1fr; gap: 16px; min-height: 0; }
.grid .card h2 { font-size: 33px; }
.grid .card p { font-size: 27px; line-height: 1.26; }
.soro { grid-column: 1 / -1; display: flex; align-items: center; gap: 26px; }
.letters { flex: none; display: flex; align-items: center; gap: 8px; }
.kk { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.k { width: 80px; height: 80px; border-radius: 18px; background: #2d55d8; color: #fff; font-size: 52px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; }
.k.o { background: #141414; }
.k.r { background: #1b6fb8; }
.kk small { font-size: 18px; font-weight: 800; color: #7a5a00; text-transform: uppercase; letter-spacing: 1px; }
.ar { font-size: 40px; font-weight: 900; color: #7a5a00; margin-bottom: 26px; }
.grid .soro p { font-size: 28px; line-height: 1.27; }
.steps { display: flex; gap: 12px; align-items: stretch; }
.st { flex: 1; background: #e9eefc; border-radius: 16px; padding: 10px 14px; font-size: 23px; line-height: 1.2; }
.st b { display: block; font-size: 30px; color: #2446b8; }
.org { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; gap: 16px; min-height: 0; }
.org .card h2 { font-size: 33px; margin-bottom: 8px; }
.org .card p { font-size: 27px; line-height: 1.28; }
.ev { flex: 1; display: grid; grid-template-columns: 760px 1fr; gap: 20px; min-height: 0; }
.parts { display: flex; flex-direction: column; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 6px 0 16px; }
.half { border-radius: 18px; padding: 12px 18px; color: #fff; }
.half .pc { font-size: 56px; font-weight: 900; line-height: 1; }
.half .lb { font-size: 27px; font-weight: 800; margin-top: 4px; }
.half .sb { font-size: 20px; opacity: 0.92; margin-top: 3px; line-height: 1.2; }
.prev { background: #6b7489; }
.today { background: #2d55d8; }
.parts h3 { font-size: 26px; margin: 0 0 4px; color: #2446b8; }
.part { display: grid; grid-template-columns: 300px 1fr 92px; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 2px solid #f0eee8; }
.part:last-child { border-bottom: 0; }
.part .lb { font-size: 25px; font-weight: 800; line-height: 1.12; }
.part .lb small { display: block; font-size: 19px; font-weight: 600; color: #555; margin-top: 2px; }
.part .bar { height: 36px; background: #eef1fb; border-radius: 10px; overflow: hidden; }
.part .bar span { display: block; height: 100%; background: #2d55d8; border-radius: 10px; }
.part .pc { font-size: 34px; font-weight: 900; text-align: right; }
.lvl { display: flex; flex-direction: column; gap: 10px; }
.lvl table { width: 100%; flex: 1; border-collapse: separate; border-spacing: 0 7px; font-size: 34px; text-align: center; }
.lvl th { font-size: 21px; line-height: 1.15; color: #555; font-weight: 700; padding: 0 6px 4px; vertical-align: bottom; }
.lvl th b { display: block; font-size: 25px; color: #141414; }
.lvl th.grp { border-left: 3px solid #e2e2e2; }
.lvl th.sup { font-size: 22px; color: #2446b8; font-weight: 800; padding: 0 6px 6px; border-bottom: 3px solid #e2e2e2; }
.lvl td { background: #f4f2ec; padding: 0 8px; font-weight: 800; }
.lvl td:first-child { border-radius: 14px 0 0 14px; text-align: left; padding-left: 18px; color: #b76a00; letter-spacing: 1px; white-space: nowrap; }
.lvl td:last-child { border-radius: 0 14px 14px 0; }
.lvl td.rp { font-size: 40px; }
.lvl td small { font-size: 19px; font-weight: 600; color: #666; letter-spacing: 0; }
.lvl td.max { color: #0f6b2f; }
.lvl tr.def td { background: #fff1c9; }
.lvl .tag { display: inline-block; font-size: 17px; letter-spacing: 0; color: #7a5a00; background: #ffe08a; border-radius: 9px; padding: 2px 8px; margin-left: 10px; vertical-align: 6px; font-weight: 700; }
.lvl .notes { font-size: 22px; line-height: 1.3; color: #333; margin: 0; padding-left: 26px; }
`;

  // ----- Dia 1 : les regles (S.O.R.O.) -----
  const rules = `<section class="slide">
  <div class="top"><h1>🏁 ${EVAL_NAME}</h1><span class="sub">Les règles · ${plural(s.stations.length, "station", "stations")} · un run après chaque station · ${plural(laps, "tour", "tours")} · par équipe de 3 · ${s.capMin} minutes</span></div>
  <div class="cols">
    <div class="card course">
      <h2>Le parcours</h2>
      <ol>${stations}</ol>
      <div class="runbox">🏃 <b>Après chaque station : ${esc(s.runLabel.toLowerCase())} de ${esc(run)}.</b><br>Puis la station suivante. Après la ${s.stations.length}, on revient à la 1.${laps > 1 ? ` <b>${laps} tours complets.</b>` : ""}</div>
    </div>
    <div class="grid">
      <div class="card soro gold">
        <div class="letters"><span class="kk"><span class="k">S</span><small>Station</small></span><span class="ar">→</span><span class="kk"><span class="k o">O</span><small>Ordi</small></span><span class="ar">→</span><span class="kk"><span class="k r">R</span><small>Run</small></span><span class="ar">→</span><span class="kk"><span class="k o">O</span><small>Ordi</small></span></div>
        <p><b>S.O.R.O.</b> Après <b>chaque station</b>, l'équipe vient valider à l'ordi. Après <b>chaque run</b> aussi&nbsp;! C'est l'heure du clic qui fait votre temps : on vient quand c'est <b>fini</b>.</p>
      </div>
      <div class="card"><h2>🏃 Le run</h2><p>À trois, <b>groupés</b>. La ligne est franchie à chaque extrémité. On ne part pas, et on ne commence pas la station suivante, tant que <b>l'équipe n'est pas complète</b>.</p></div>
      <div class="card"><h2>💪 Les répétitions</h2><p>Elles comptent pour <b>toute l'équipe</b> : à vous de vous répartir le travail. Chaque répétition se fait <b>en entier et proprement</b>.</p><p>🟨 Triche ou bâclé : <b>carte jaune, + ${minutes(s.penSec)}</b>.</p></div>
      <div class="card"><h2>⏱️ Le classement</h2><p>Au <b>temps</b> : la première équipe qui boucle ${laps > 1 ? `ses ${laps} tours` : "son tour"} gagne. ${s.extraMin > 0 ? "Fin officielle" : "Limite"} : <b>${s.capMin}:00</b> ; les autres sont classées à l'avancement.</p>${s.extraMin > 0 ? `<p>Le chrono continue jusqu'à <b>${end}:00</b> pour finir son parcours, hors classement.</p>` : ""}</div>
      <div class="card"><h2>📍 La station de départ</h2><p>Chaque équipe commence à <b>SA station</b>, donnée par le greffier, puis suit l'ordre : après la ${s.stations.length}, la 1.</p></div>
    </div>
  </div>
</section>`;

  // ----- Dia 2 : l'organisation generale -----
  const org = `<section class="slide">
  <div class="top"><h1>🧭 L'ORGANISATION</h1><span class="sub">${EVAL_NAME} · c'est un sport d'équipe&nbsp;!</span></div>
  <div class="steps">
    <div class="st"><b>1 · Avant</b>équipes de 3 et parcours ⭐</div>
    <div class="st"><b>2 · 0:00</b>départ, chacun à sa station</div>
    <div class="st"><b>3 · ${s.capMin}:00</b>fin officielle du WOD</div>
    ${s.extraMin > 0 ? `<div class="st"><b>4 · ${end}:00</b>fin du chrono</div>` : ""}
    <div class="st"><b>${s.extraMin > 0 ? 5 : 4} · Après</b>QCM bonus et auto-évaluation</div>
  </div>
  <div class="org">
    <div class="card"><h2>👥 Ton équipe</h2><p>Équipes de <b>3</b>. Le greffier vous donne un <b>numéro d'équipe</b> et une <b>station de départ</b>.</p><p>Restez groupés toute la séance.</p></div>
    ${s.levels
      ? `<div class="card gold"><h2>⭐ Ton parcours</h2><p>Tout le monde part à <b>${EVAL_DEFAULT_STARS}★ = ${evalLevelReps(EVAL_DEFAULT_STARS)} répétitions</b> par station. À la création des équipes, demandez de <b>monter ou de descendre</b> (${first.stars}★ = ${first.reps} … ${last.stars}★ = ${last.reps}), en connaissance de cause.</p><p>Une fois partis, il <b>ne change plus</b>.</p></div>`
      : `<div class="card"><h2>💪 Les quantités</h2><p>Elles comptent pour <b>toute l'équipe</b> : à vous de vous répartir le travail.</p></div>`}
    <div class="card"><h2>🤝 Un sport d'équipe</h2><p>Un coéquipier qui bâcle ses répétitions fait gagner du temps : <b>c'est de la triche</b>. Tu dois voir qu'un partenaire de <b>TON équipe</b> ne respecte pas les règles, et le lui dire.</p></div>
    <div class="card"><h2>🗣️ Communication &amp; transitions</h2><p>Trop d'équipes perdent du temps dans les <b>transitions</b> : entre deux élèves d'une même station, et entre deux stations.</p><p>Parlez-vous : qui commence, combien chacun, qui va valider.</p></div>
    <div class="card"><h2>👁 Vous êtes observés</h2><p>Des arbitres (élèves dispensés et profs) te suivent ${OBS_MINUTES} minutes : ils <b>comptent tes répétitions</b> et <b>notent ta technique</b>.</p><p>Les profs notent aussi l'<b>implication</b> de l'équipe.</p></div>
    <div class="card"><h2>📱 Après le WOD</h2><p>Sur ton téléphone : le <b>QCM bonus</b> (si le prof l'ouvre), puis ton <b>auto-évaluation</b>, dans les 24 heures.</p></div>
  </div>
</section>`;
  if (!s.levels) return page(`${EVAL_NAME} · les règles`, css, [rules, org]);

  // ----- Dia 3 : l'evaluation (repartition des points, tableau des parcours) -----
  const W = EVAL_WEIGHTS;
  const parts = [
    { pc: W.perf, lb: "La perf", sb: "ton parcours ⭐ et ton temps (tableau →)" },
    { pc: W.personal, lb: "Ta technique", sb: "tes répétitions, vues par les arbitres" },
    { pc: W.team, lb: "La technique de ton équipe", sb: "les répétitions de tes 2 coéquipiers" },
    { pc: W.involvement, lb: "L'implication de l'équipe", sb: "transitions, suivi des coéquipiers, engagement" },
  ];
  const maxPc = Math.max(...parts.map((p) => p.pc));
  const head = EVAL_GROUPS.map((g) => `<th class="grp"><b>${esc(g.years)}</b>${esc(g.team)}</th>`).join("");
  const rows = [...EVAL_LEVELS].reverse().map((l) => {
    const def = l.stars === EVAL_DEFAULT_STARS;
    return `<tr${def ? ' class="def"' : ""}><td>${starsText(l.stars)}${def ? '<span class="tag">par défaut</span>' : ""}</td><td class="rp">${l.reps}</td>${EVAL_GROUPS.map((g) => { const n = evalNote(g.key, l.stars); return `<td class="nt${n >= EVAL_NOTE_MAX ? " max" : ""}">${noteText(n)}<small>/${EVAL_NOTE_MAX}</small></td>`; }).join("")}</tr>`;
  }).join("");
  // « A chacun son 20/20 » : premier parcours qui vaut 20 pour chaque groupe.
  const top20 = [...new Set(EVAL_GROUPS.map((g) => g.years))].map((y) => `${esc(y)} : ${EVAL_GROUPS.filter((g) => g.years === y).map((g) => `${g.team === "filles" ? "filles" : "garçons"} dès <b>${evalTopStars(g.key)}★</b>`).join(", ")}`).join(" · ");
  const evaluation = `<section class="slide">
  <div class="top"><h1>📊 L'ÉVALUATION</h1><span class="sub">${EVAL_NAME} · ta note et le tableau des parcours</span></div>
  <div class="ev">
    <div class="card parts">
      <h2>Ta note du cycle</h2>
      <div class="split">
        <div class="half prev"><div class="pc">${W.previous} %</div><div class="lb">Les cours précédents</div><div class="sb">les mêmes critères que ton auto-évaluation</div></div>
        <div class="half today"><div class="pc">${W.today} %</div><div class="lb">L'éval du jour</div><div class="sb">en 4 parties ↓</div></div>
      </div>
      <h3>L'éval du jour :</h3>
      ${parts.map((p) => `<div class="part"><div class="lb">${esc(p.lb)}<small>${esc(p.sb)}</small></div><div class="bar"><span style="width:${((p.pc / maxPc) * 100).toFixed(1)}%"></span></div><div class="pc">${p.pc} %</div></div>`).join("")}
    </div>
    <div class="card lvl">
      <h2>⭐ La perf : les points de ton parcours, si l'équipe boucle le WOD avant ${s.capMin}:00</h2>
      <table>
        <thead><tr><th rowspan="2">Parcours</th><th rowspan="2">Rép. par<br>station</th><th class="sup" colspan="${EVAL_GROUPS.length}">Points selon tes années et ton équipe</th></tr><tr>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <ul class="notes">
        <li>À chacun son 20/20 : ${top20}.</li>
        <li>Filles = une équipe de filles uniquement ; une équipe mixte lit « garçons ou mixte ».</li>
        <li>Pas fini à ${s.capMin}:00 : la note part de ce maximum et <b>baisse</b> selon ce qu'il restait à faire.</li>
      </ul>
    </div>
  </div>
</section>`;
  return page(`${EVAL_NAME} · les règles`, css, [rules, org, evaluation]);
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
  <div class="top"><h1>👁 ARBITRE · ${EVAL_NAME}</h1><span class="sub">Tu ne joues pas aujourd'hui : tu observes un élève à la fois, pendant ${OBS_MINUTES} minutes.</span></div>
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
  return page(`${EVAL_NAME} · guide des arbitres`, css, [how, grid]);
}
