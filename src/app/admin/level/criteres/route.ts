import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { LEVEL_STAFF, listExercises, readFrozenFromSettings } from "@/lib/level";
import { renderCriteriaSlides } from "@/lib/criteria-slides";
import { CRITERIA } from "@/lib/level-criteria";
import { activeCards, readLadders } from "@/lib/wod-engines/templates/level-engine";

export const dynamic = "force-dynamic";

// Dia des criteres pour les arbitres (a projeter avant le WOD, Imprimer -> PDF). Avec ?session=, seulement les
// exercices des echelles figees de la seance ; sinon tout le catalogue actif.
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !(LEVEL_STAFF as readonly string[]).includes(user.role)) return Response.redirect(new URL("/", req.url), 307);
  const sessionId = new URL(req.url).searchParams.get("session");
  let labels: string[] = [];
  let subtitle = "Les 21 exercices du WOD Level";
  if (sessionId) {
    const s = await db.orm.public.Session.where({ id: sessionId }).first();
    if (s) {
      const all = [readFrozenFromSettings(s.settings), ...Object.values(readLadders(s.settings))].flat();
      labels = [...new Set(all.flatMap((l) => activeCards(l).map(({ card }) => card.label)))];
      if (labels.length) subtitle = `Les ${labels.length} exercices de cette séance`;
    }
  }
  if (!labels.length) {
    const cat = (await listExercises()).filter((e) => e.active).map((e) => e.label);
    labels = cat.length ? cat : Object.keys(CRITERIA);
  }
  return new Response(renderCriteriaSlides(labels, subtitle), { headers: { "content-type": "text/html; charset=utf-8" } });
}
