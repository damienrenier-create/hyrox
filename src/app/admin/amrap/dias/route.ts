import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { renderAmrapSlides } from "@/lib/amrap-slides";
import { readAmrapSettings } from "@/lib/wod-engines/templates/amrap-engine";

export const dynamic = "force-dynamic";

// Dias du WOD AMRAP (a projeter, ou Imprimer -> PDF). Avec ?session=, le circuit de cette seance et le depart de ses
// equipes ; sinon le circuit par defaut.
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return Response.redirect(new URL("/", req.url), 307);
  const sessionId = new URL(req.url).searchParams.get("session");
  const session = sessionId ? await db.orm.public.Session.where({ id: sessionId }).first() : null;
  const amrap = session?.wodType === "AMRAP" ? session : null;
  const teams = amrap ? await db.orm.public.Team.where({ sessionId: amrap.id }).all() : [];
  const html = renderAmrapSlides(readAmrapSettings(amrap?.settings ?? null), teams.map((t) => ({ order: t.order ?? 0, name: t.name })));
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
