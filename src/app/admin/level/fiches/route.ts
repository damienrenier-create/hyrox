import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { LEVEL_STAFF, freezeLevels, readFrozenFromSettings } from "@/lib/level";
import { activeCards, estimateSeconds, fmtTheoretical, DEFAULT_TEAM, type FrozenLevel } from "@/lib/wod-engines/templates/level-engine";
import { wodLabel } from "@/lib/student-sessions";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Fiches a imprimer et decouper (page HTML autonome, hors gabarit de l'app) : une carte par fiche (reps +
// exercice + niveau) precedee de l'en-tete du niveau. L'echelle commune par defaut, ou l'echelle figee
// d'une seance avec ?session=. 3 x 4 cartes par page A4.
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !(LEVEL_STAFF as readonly string[]).includes(user.role)) return Response.redirect(new URL("/", req.url), 307);
  const sessionId = new URL(req.url).searchParams.get("session");
  let levels: FrozenLevel[] = [];
  let title = "Échelle commune";
  if (sessionId) {
    const s = await db.orm.public.Session.where({ id: sessionId }).first();
    if (s) {
      levels = readFrozenFromSettings(s.settings);
      title = `${s.label ?? wodLabel(s.wodType)} · échelle de la séance`;
    }
  }
  if (!levels.length) {
    levels = await freezeLevels();
    title = "Échelle commune";
  }
  const cards = levels.flatMap((l) => {
    const act = activeCards(l);
    const head = `<div class="card head${l.boss ? " boss" : ""}"><div class="lvl">${l.boss ? "BOSS" : "Niveau"} ${l.number}</div><div class="name">${esc(l.name ? l.name.replace(/^BOSS · /, "") : l.boss ? "Boss" : `Niveau ${l.number}`)}</div><div class="list">${esc(act.map(({ card }) => `${card.reps} ${cap(card.label)}`).join(" · "))}</div><div class="meta">≈ ${fmtTheoretical(estimateSeconds(act.map(({ card }) => ({ reps: card.reps, weight: card.weight })), l.boss))}${l.boss ? " · toute l'équipe en même temps, validé par un prof" : " · une fiche par membre, en relais"}</div></div>`;
    return [head, ...act.map(({ card, index }) => `<div class="card${l.boss ? " boss" : ""}"><div class="lvl">${l.boss ? "BOSS" : "Niveau"} ${l.number} · fiche ${index + 1}/${act.length}</div><div class="reps">${card.reps}</div><div class="exo">${esc(cap(card.label))}</div><div class="meta">${l.boss ? `à ${DEFAULT_TEAM} en simultané` : `≈ ${fmtTheoretical(card.reps * card.weight)} pour un membre`}</div></div>`)];
  });
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiches WOD Level</title><style>
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
.bar { padding: 10px 12px; background: #f3f3f3; border-bottom: 1px solid #ddd; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.bar button { font: inherit; font-weight: bold; padding: 6px 14px; border-radius: 8px; border: 1px solid #999; background: #fff; cursor: pointer; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; padding: 6mm; }
.card { border: 2px dashed #999; border-radius: 10px; height: 62mm; padding: 5mm; display: flex; flex-direction: column; page-break-inside: avoid; break-inside: avoid; }
.card.boss { border-color: #c0392b; background: #fdecea; }
.card.head { border-style: solid; background: #111; color: #fff; }
.card.head.boss { background: #c0392b; }
.lvl { font-size: 11pt; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; opacity: .8; }
.reps { font-size: 44pt; font-weight: 900; line-height: 1; margin-top: auto; }
.exo { font-size: 18pt; font-weight: 800; line-height: 1.1; }
.meta { font-size: 9pt; opacity: .7; margin-top: auto; }
.head .name { font-size: 22pt; font-weight: 900; margin-top: auto; }
.head .list { font-size: 9.5pt; opacity: .9; margin-top: 4px; }
@media print { .bar { display: none; } }
</style></head><body>
<div class="bar"><b>Fiches WOD Level · ${esc(title)}</b><span style="opacity:.7">${levels.length} niveaux · ${cards.length - levels.length} fiches · 3 × 4 par page A4</span><button type="button" onclick="window.print()">Imprimer</button><a href="/admin/level" style="margin-left:auto">← Atelier</a></div>
<div class="grid">${cards.join("")}</div>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
