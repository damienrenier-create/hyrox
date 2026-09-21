import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/lib/auth";

const protectedRoutes = ["/greffier", "/touche-coule"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if route is protected
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtectedRoute) {
    const sessionCookie = request.cookies.get("session")?.value;
    
    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    try {
      const session = await decrypt(sessionCookie);

      // Le greffier est accessible par le MASTER_ADMIN (Toi) et le GREFFIER
      if (pathname.startsWith("/greffier") && !["MASTER_ADMIN", "GREFFIER"].includes(session.role as string)) {
        return NextResponse.redirect(new URL("/touche-coule", request.url));
      }
      
      // Tout utilisateur connecté peut accéder au touche-coule
      return NextResponse.next();
    } catch (e) {
      // Session invalide
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/greffier/:path*", "/touche-coule/:path*"],
};
