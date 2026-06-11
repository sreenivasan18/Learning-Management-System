// FILE PATH: app/api/auth/store-portal/route.ts
//
// PURPOSE:
//   Sets a short-lived httpOnly cookie (`auth_portal`) that encodes WHICH portal
//   (student | instructor) triggered a Google OAuth login.
//
//   This cookie is read by the `signIn` callback in lib/auth.ts during the
//   Google OAuth callback to enforce role ↔ portal consistency.
//
// WHY A SEPARATE ROUTE:
//   Auth.js v5 (next-auth@5.0.0-beta.31) encodes the OAuth `state` parameter as
//   an opaque JWE signed with AUTH_SECRET. We cannot embed custom data in it, nor
//   can we decode it without the secret at callback time. The cookie approach is
//   the standard, reliable mechanism: the browser sends it on the same-origin
//   OAuth callback GET request (sameSite=lax allows top-level navigation cookies).
//
// SECURITY:
//   - httpOnly: not accessible from JavaScript
//   - sameSite=lax: sent on top-level navigations (OAuth callbacks) but NOT on
//     cross-origin sub-resource requests (CSRF protection)
//   - secure: HTTPS-only in production
//   - maxAge=300: 5-minute TTL — enough for the OAuth round-trip, short enough
//     to expire quickly if the OAuth flow is abandoned
//   - path=/api/auth: cookie is scoped to the NextAuth callback path only
//
// USAGE (frontend):
//   const res = await fetch("/api/auth/store-portal", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ portal: "student" }),
//   })
//   await signIn("google", { callbackUrl: "/dashboard" })

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const portal = body?.portal;

    if (portal !== "student" && portal !== "instructor") {
      return NextResponse.json(
        { error: "Invalid portal. Must be 'student' or 'instructor'." },
        { status: 400 }
      );
    }

    const res = NextResponse.json({ ok: true });

    res.cookies.set("auth_portal", portal, {
      httpOnly: true,
      // sameSite=lax is critical: browser sends this cookie on top-level same-site
      // navigations (which includes OAuth callback redirects from Google) but NOT
      // on cross-origin fetches (preventing CSRF).
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 300, // 5 minutes — sufficient for any OAuth round-trip
      path: "/",   // must be "/" not "/api/auth" so it's sent on all paths during redirect
    });

    return res;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }
}