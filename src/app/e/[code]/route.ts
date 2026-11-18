import { NextResponse, type NextRequest } from "next/server";
import { SCHOOL_COOKIE, schoolByLink } from "@/lib/school";

export const dynamic = "force-dynamic";

// Lien d'ecole (Sartay 18/11 : « un lien d'école, une fois ») : https://hyrox-delta.vercel.app/e/<code> retient l'ecole
// sur le telephone (cookie « ecole », un an) puis ouvre la page de connexion, qui ne montre plus que les classes de
// cette ecole. /e/origine revient a l'ecole d'origine. Un code inconnu ne change rien. Les eleves de l'ecole
// d'origine n'ont jamais besoin de lien : sans cookie, c'est leur ecole.
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = NextResponse.redirect(new URL("/", request.url));
  const school = schoolByLink(code);
  if (school?.link) {
    res.cookies.set(SCHOOL_COOKIE, school.link, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  } else if (code === "origine") {
    res.cookies.delete(SCHOOL_COOKIE);
  }
  return res;
}
