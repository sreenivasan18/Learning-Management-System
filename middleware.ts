// FILE PATH: middleware.ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const isLoggedIn = !!session?.user;
  const role = (session?.user as any)?.role;

  const redirectToSignIn = () => {
    const url = new URL("/auth/signin", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  };

  // ── Admin routes ────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) return redirectToSignIn();
    if (role !== "ADMIN") return NextResponse.redirect(new URL("/403", req.url));
  }

  // ── Instructor routes ───────────────────────────────────────────────────
  if (pathname.startsWith("/instructor")) {
    if (!isLoggedIn) return redirectToSignIn();
    if (role !== "INSTRUCTOR")
      return NextResponse.redirect(new URL("/403", req.url));
  }

  // ── Student/shared protected routes ────────────────────────────────────
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/certificate")
  ) {
    if (!isLoggedIn) return redirectToSignIn();
  }

  if (pathname.startsWith("/quiz")) {
    if (!isLoggedIn) return redirectToSignIn();
  }

  if (pathname.startsWith("/courses/") && pathname !== "/courses") {
    if (!isLoggedIn) return redirectToSignIn();
  }

  // ── Redirect already-authenticated users away from auth pages ───────────
  // Includes google-onboarding so a logged-in user can't re-trigger onboarding
  const authOnlyPaths = [
    "/auth/signin",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/verify-otp",
    "/auth/reset-password",
    "/auth/google-onboarding",
  ];
  if (
    isLoggedIn &&
    authOnlyPaths.some((p) => pathname === p || pathname.startsWith(p))
  ) {
    if (role === "ADMIN") return NextResponse.redirect(new URL("/admin", req.url));
    if (role === "INSTRUCTOR")
      return NextResponse.redirect(new URL("/instructor", req.url));
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/instructor/:path*",
    "/certificate/:path*",
    "/courses/:path*",
    "/quiz/:path*",
    "/auth/signin",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/verify-otp",
    "/auth/reset-password",
    "/auth/google-onboarding",
  ],
};