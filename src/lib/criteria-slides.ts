// Dia des criteres pour les arbitres (eleves dispenses), a projeter avant le WOD (Sartay 28/09). Module pur :
// servi par /admin/level/criteres et utilise pour generer le PDF. 16:9, 2 exercices par dia, une dia de regle.

import { CRITERIA, criteriaFor, exoLabel, shortCriteriaFor } from "@/lib/level-criteria";

// Dia UNIQUE (Sartay 28/09 : « faut le faire tenir en 1 dia ») : les 21 exercices, 4 criteres courts chacun
// (29/09 : 3 techniques + ⚡ intensite), grille 7 x 3. Les phrases completes restent sur le telephone de l'arbitre.
const item = (x: string, i: number, n: number) => (n === 4 && i === 3 ? `<li class="int">${esc(x)}</li>` : `<li>${esc(x)}</li>`);
export function renderCriteriaOneSlide(labels: string[], subtitle: string): string {
  const known = Object.keys(CRITERIA);
  const ordered = [...labels.filter((l) => known.includes(l.toUpperCase())).sort((a, b) => known.indexOf(a.toUpperCase()) - known.indexOf(b.toUpperCase())), ...labels.filter((l) => !known.includes(l.toUpperCase()))];
  const cols = ordered.length > 18 ? 7 : ordered.length > 12 ? 6 : ordered.length > 8 ? 4 : 3;
  const cells = ordered.map((l) => `<div class="c"><h3>${esc(exoLabel(l))}</h3><ol>${shortCriteriaFor(l).map((x, i, a) => item(x, i, a.length)).join("")}</ol></div>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Critères des arbitres</title><style>
@page { size: 1920px 1080px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #141414; background: #fbfaf6; padding: 22px 30px 16px; display: flex; flex-direction: column; gap: 14px; }
.top { display: flex; align-items: center; gap: 24px; }
h1 { font-size: 46px; margin: 0; letter-spacing: -0.5px; white-space: nowrap; }
.sub { font-size: 20px; color: #666; font-weight: 600; }
.grid { flex: 1; display: grid; grid-template-columns: repeat(${cols}, 1fr); grid-auto-rows: 1fr; gap: 12px; min-height: 0; }
.c { background: #fff; border: 3px solid #e2e2e2; border-radius: 18px; padding: 10px 14px; display: flex; flex-direction: column; min-height: 0; }
.c h3 { font-size: 25px; margin: 0 0 6px; color: #c0392b; line-height: 1.1; }
.c ol { margin: 0; padding-left: 28px; flex: 1; display: flex; flex-direction: column; justify-content: space-around; }
.c li { font-size: 23px; line-height: 1.18; font-weight: 700; }
.c li::marker { font-weight: 800; color: #999; }
.c li.int { list-style: none; margin-left: -28px; padding-left: 28px; text-indent: -28px; font-weight: 600; color: #b45309; }
.c li.int::before { content: "⚡ "; }
.foot { font-size: 21px; color: #444; text-align: center; }
</style></head><body>
<div class="top"><h1>🧑‍⚖️ Critères des arbitres</h1><span class="sub">${esc(subtitle)} · coche seulement ce que tu as vraiment vu</span>
</div>
<div class="grid">${cells}</div>
<div class="foot">1 · 2 · 3 = technique, du plus important au moins important · ⚡ = intensité · les 4 cochés et <b>vraiment très bien faits</b> ? ajoute un ❤️ · sur ton téléphone, chaque critère est écrit en entier.</div>
</body></html>`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// « KB SNATCH » -> « KB snatch », « TIRE TAPIS AR » -> « Tire tapis AR » : sigles gardes en capitales.
const cap = exoLabel;

export function renderCriteriaSlides(labels: string[], subtitle: string): string {
  // Ordre de la liste de Sartay, puis les exercices hors liste.
  const known = Object.keys(CRITERIA);
  const ordered = [...labels.filter((l) => known.includes(l.toUpperCase())).sort((a, b) => known.indexOf(a.toUpperCase()) - known.indexOf(b.toUpperCase())), ...labels.filter((l) => !known.includes(l.toUpperCase()))];
  const cards = ordered.map((l, i) => `<div class="exo"><h2><span class="n">${i + 1}</span>${esc(cap(l))}</h2><ol>${criteriaFor(l).map((c, i, a) => item(c, i, a.length)).join("")}</ol></div>`);
  const pages: string[] = [];
  pages.push(`<section class="slide intro">
    <h1>🧑‍⚖️ Arbitres : comment évaluer ?</h1>
    <p class="sub">${esc(subtitle)}</p>
    <div class="steps">
      <div><b>1</b> Choisis un élève d'une autre équipe (jamais deux fois de suite la même équipe).</div>
      <div><b>2</b> Choisis l'exercice que tu l'as vu faire et encode les <b>reps observées</b>.</div>
      <div><b>3</b> Coche les <b>critères que tu as vraiment vus</b> (3 techniques + ⚡ l'intensité). Les 4 vraiment très bien faits ? Ajoute un <b>❤️</b>.</div>
      <div><b>4</b> Tire une case du démineur. Chaque bombe trouvée te rapporte des points.</div>
    </div>
    <p class="note">Les 3 critères techniques sont classés du plus important au moins important ; le ⚡ est l'intensité. Le ❤️ est rare : seulement quand les 4 sont vraiment très bien faits. Sois honnête : les profs voient les évaluations qui ne collent pas avec celles des autres arbitres.</p>
  </section>`);
  for (let i = 0; i < cards.length; i += 2) pages.push(`<section class="slide pair">${cards[i]}${cards[i + 1] ?? ""}</section>`);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Critères des arbitres</title><style>
@page { size: 1920px 1080px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #141414; background: #eee; }
.slide { width: 1920px; height: 1080px; background: #fbfaf6; padding: 44px 56px; page-break-after: always; break-after: page; overflow: hidden; margin: 0 auto 12px; }
.intro h1 { font-size: 72px; margin: 0; letter-spacing: -1px; }
.intro .sub { font-size: 28px; color: #666; margin: 6px 0 30px; font-weight: 600; }
.steps { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.steps div { background: #fff; border: 3px solid #e2e2e2; border-radius: 22px; padding: 20px 26px; font-size: 32px; line-height: 1.3; }
.steps b:first-child { display: inline-block; width: 52px; height: 52px; border-radius: 50%; background: #141414; color: #fff; text-align: center; line-height: 52px; margin-right: 12px; font-size: 30px; }
.note { font-size: 26px; color: #444; line-height: 1.35; margin: 30px 0 0; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
.exo { background: #fff; border: 4px solid #e2e2e2; border-radius: 28px; padding: 26px 30px; display: flex; flex-direction: column; }
.exo h2 { font-size: 60px; margin: 0 0 20px; display: flex; align-items: center; gap: 16px; }
.exo .n { display: inline-flex; width: 72px; height: 72px; border-radius: 18px; background: #c0392b; color: #fff; align-items: center; justify-content: center; font-size: 34px; }
.exo ol { margin: 0; padding-left: 52px; }
.exo li { font-size: 36px; line-height: 1.26; margin: 0 0 18px; padding-left: 8px; }
.exo li::marker { font-weight: 800; color: #c0392b; }
.exo li.int { list-style: none; margin-left: -52px; padding-left: 60px; text-indent: -52px; color: #b45309; }
.exo li.int::before { content: "⚡ "; }
@media print { body { background: #fbfaf6; } .slide { margin: 0; } }
</style></head><body>${pages.join("\n")}</body></html>`;
}
