// Dia des criteres pour les arbitres (eleves dispenses), a projeter avant le WOD (Sartay 28/09). Module pur :
// servi par /admin/level/criteres et utilise pour generer le PDF. 16:9, 2 exercices par dia, une dia de regle.

import { CRITERIA, criteriaFor, exoLabel } from "@/lib/level-criteria";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// « KB SNATCH » -> « KB snatch », « TIRE TAPIS AR » -> « Tire tapis AR » : sigles gardes en capitales.
const cap = exoLabel;

export function renderCriteriaSlides(labels: string[], subtitle: string): string {
  // Ordre de la liste de Sartay, puis les exercices hors liste.
  const known = Object.keys(CRITERIA);
  const ordered = [...labels.filter((l) => known.includes(l.toUpperCase())).sort((a, b) => known.indexOf(a.toUpperCase()) - known.indexOf(b.toUpperCase())), ...labels.filter((l) => !known.includes(l.toUpperCase()))];
  const cards = ordered.map((l, i) => `<div class="exo"><h2><span class="n">${i + 1}</span>${esc(cap(l))}</h2><ol>${criteriaFor(l).map((c) => `<li>${esc(c)}</li>`).join("")}</ol></div>`);
  const pages: string[] = [];
  pages.push(`<section class="slide intro">
    <h1>🧑‍⚖️ Arbitres : comment évaluer ?</h1>
    <p class="sub">${esc(subtitle)}</p>
    <div class="steps">
      <div><b>1</b> Choisis un élève d'une autre équipe (jamais deux fois de suite la même équipe).</div>
      <div><b>2</b> Choisis l'exercice que tu l'as vu faire et encode les <b>reps observées</b>.</div>
      <div><b>3</b> Coche les <b>critères que tu as vraiment vus</b>. Pas d'appréciation à choisir : l'appli la calcule.</div>
      <div><b>4</b> Tire une case du démineur. Chaque bombe trouvée te rapporte des points.</div>
    </div>
    <div class="scale">
      <span>1 critère = <b class="ti">TI</b></span><span>2 = <b class="i">I</b></span><span>3 = <b class="s">S</b></span><span>4 = <b class="b">B</b></span><span>5 = <b class="tb">TB</b></span><span>6 = <b class="e">E</b></span>
    </div>
    <p class="note">Les critères sont classés du plus important (sécurité, posture) au moins important (rythme, intensité). L'élève évalué reçoit son appréciation et un conseil construit sur les critères non réalisés. Sois honnête : les profs voient les évaluations qui ne collent pas avec celles des autres arbitres.</p>
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
.scale { display: flex; gap: 16px; margin: 30px 0 22px; flex-wrap: wrap; }
.scale span { background: #fff; border: 3px solid #e2e2e2; border-radius: 16px; padding: 12px 22px; font-size: 32px; font-weight: 600; }
.ti { color: #dc2626; } .i { color: #ea580c; } .s { color: #d97706; } .b { color: #4d7c0f; } .tb { color: #059669; } .e { color: #0284c7; }
.note { font-size: 26px; color: #444; line-height: 1.35; margin: 0; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
.exo { background: #fff; border: 4px solid #e2e2e2; border-radius: 28px; padding: 26px 30px; display: flex; flex-direction: column; }
.exo h2 { font-size: 60px; margin: 0 0 20px; display: flex; align-items: center; gap: 16px; }
.exo .n { display: inline-flex; width: 72px; height: 72px; border-radius: 18px; background: #c0392b; color: #fff; align-items: center; justify-content: center; font-size: 34px; }
.exo ol { margin: 0; padding-left: 52px; }
.exo li { font-size: 36px; line-height: 1.26; margin: 0 0 18px; padding-left: 8px; }
.exo li::marker { font-weight: 800; color: #c0392b; }
@media print { body { background: #fbfaf6; } .slide { margin: 0; } }
</style></head><body>${pages.join("\n")}</body></html>`;
}
