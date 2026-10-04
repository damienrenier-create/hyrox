import { db } from "@/lib/db";
import { getSession } from "@/lib/session-server";
import { renderEvalReferee, renderEvalRules } from "@/lib/eval-slides";
import { readHXSettings } from "@/lib/wod-engines/templates/hyrox-engine";

export const dynamic = "force-dynamic";

// Dias du WOD Eval (a projeter, ou Imprimer -> PDF) : ?doc=regles (participants) ou ?doc=arbitres (eleves dispenses).
// Avec ?session=, le parcours de cette seance ; sinon le parcours par defaut.
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) return Response.redirect(new URL("/", req.url), 307);
  const params = new URL(req.url).searchParams;
  const sessionId = params.get("session");
  const session = sessionId ? await db.orm.public.Session.where({ id: sessionId }).first() : null;
  const settings = readHXSettings(session?.wodType === "HYROX" ? session.settings : null);
  const html = params.get("doc") === "arbitres" ? renderEvalReferee(settings) : renderEvalRules(settings);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
