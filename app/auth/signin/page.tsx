// FILE PATH: app/auth/signin/page.tsx
//
// UNIFIED SIGN-IN PAGE
// ─────────────────────────────────────────────────────────────────────────────
// Design:
//   - ONE login form for students and instructors.
//   - Email + password submitted to the unified "credentials" provider.
//   - The server auto-detects the role from the email.
//   - After successful login the session is read and the user is redirected
//     directly to the correct portal:
//       STUDENT    → /dashboard
//       INSTRUCTOR → /instructor
//       ADMIN      → /admin  (should not reach here via unified form, but handled)
//   - Admin login is a separate, hidden tab (unchanged behavior).
//   - Google OAuth is available in the unified form and on the admin-blocked
//     path it correctly rejects admin emails.
//   - The "store-portal" cookie is still set before Google OAuth to enforce
//     role consistency on the callback (instructor can only Google-login if
//     admin has already provisioned them in the instructors table).

"use client";
import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, getSession } from "next-auth/react";
import {
  Zap,
  ArrowLeft,
  Mail,
  Lock,
  Shield,
  Eye,
  EyeOff,
  AlertTriangle,
} from "lucide-react";

type Mode = "unified" | "admin";

// ── Error messages for specific error codes ───────────────────────────────────
const AUTH_ERROR_MESSAGES: Record<string, { message: string; hint: string }> = {
  ADMIN_USE_ADMIN_TAB: {
    message: "Admin accounts require the admin login portal.",
    hint: "Use the Admin login link below and sign in with your admin credentials.",
  },
};

function getAuthErrorContent(
  errorCode: string | undefined
): { message: string; hint: string } | null {
  if (!errorCode) return null;
  return AUTH_ERROR_MESSAGES[errorCode] ?? null;
}

function isValidMode(s: string | null): s is Mode {
  return s === "unified" || s === "admin";
}

// ── Google SVG Icon ───────────────────────────────────────────────────────────
function GoogleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ── Role-based redirect destination ──────────────────────────────────────────
function getDestinationForRole(role: string | undefined): string {
  if (role === "ADMIN")       return "/admin";
  if (role === "INSTRUCTOR")  return "/instructor";
  return "/dashboard";
}

// ── Inner form (requires useSearchParams inside Suspense) ─────────────────────
function SignInForm() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialMode: Mode = isValidMode(tabParam) ? tabParam : "unified";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState<{
    message: string;
    hint: string;
  } | null>(null);

  const reset = (m: Mode) => {
    setMode(m);
    setError("");
    setAuthError(null);
    setEmail("");
    setPassword("");
  };

  // ── Google OAuth: set portal cookie then redirect ─────────────────────────
  // No portal cookie set: Google signIn callback will look up role from DB
  // and route accordingly. Both students and instructors can use Google here.
  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError("");
    setAuthError(null);
    await signIn("google", { callbackUrl: "/auth/signin" });
    setGoogleLoading(false);
  };

  // ── Unified credentials login ─────────────────────────────────────────────
  // One form, one provider. Role is auto-detected by the server.
  // After success, read the session to get the role, then redirect directly
  // to the correct portal without the extra server-redirect hop.
  const handleUnifiedLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setAuthError(null);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (!res?.error) {
      // Sign-in succeeded — read the session to determine the role.
      // getSession() is a lightweight client call that reads the JWT cookie.
      const session = await getSession();
      const role = (session?.user as any)?.role;
      window.location.href = getDestinationForRole(role);
      return;
    }

    setLoading(false);

    const authErrContent = getAuthErrorContent(res.error);
    if (authErrContent) {
      setAuthError(authErrContent);
    } else {
      setError("Invalid email or password.");
    }
  };

  // ── Admin login ───────────────────────────────────────────────────────────
  const handleAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setAuthError(null);
    const res = await signIn("admin-credentials", {
      email: adminEmail,
      password: adminPass,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) setError("Invalid admin credentials.");
    else window.location.href = "/admin";
  };

  const inputCls =
    "w-full pl-10 pr-4 py-3 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all";

  const googleBtnCls =
    "w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-void">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] rounded-full bg-cyan-500/6 blur-[100px]" />
      <div className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] rounded-full bg-violet-500/6 blur-[100px]" />

      <div className="relative z-10 w-full max-w-md px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-text-muted hover:text-text-secondary text-sm mb-8 transition-colors font-mono"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        <div className="glass-bright rounded-3xl p-8 border border-border">
          <div className="text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/25">
              <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold text-white">
              {mode === "admin" ? "Admin Login" : "Welcome Back"}
            </h1>
            <p className="text-text-muted text-sm mt-1">
              {mode === "admin"
                ? "Administrator access"
                : "Sign in to your account"}
            </p>
          </div>

          {/* Mode switcher */}
          <div className="mb-6 text-center">
            <button
              type="button"
              onClick={() => reset(mode === "admin" ? "unified" : "admin")}
              className="text-xs text-text-muted hover:text-cyan-400 transition-colors underline underline-offset-2"
            >
              {mode === "admin" ? "← Back to Sign In" : "Admin login"}
            </button>
          </div>

          {/* Auth error banner (e.g. admin tried unified form) */}
          {authError && (
            <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-amber-300 font-semibold">
                    {authError.message}
                  </p>
                  <p className="text-amber-200/80 text-xs mt-0.5">
                    {authError.hint}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Generic error */}
          {!authError && error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* ── UNIFIED LOGIN (students + instructors) ── */}
          {mode === "unified" && (
            <div className="space-y-4">
              {/* Google sign-in */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={googleLoading}
                className={googleBtnCls}
              >
                <GoogleIcon />
                {googleLoading
                  ? "Redirecting to Google…"
                  : "Continue with Google"}
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-text-muted text-xs">
                  or sign in with email
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <form onSubmit={handleUnifiedLogin} className="space-y-4">
                <div>
                  <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                    >
                      {showPw ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-start">
                  <Link
                    href="/auth/forgot-password"
                    className="text-cyan-400 hover:text-cyan-300 text-xs underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/25"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>

              <p className="text-center text-text-muted text-sm">
                New to NovaMind?{" "}
                <Link
                  href="/auth/register"
                  className="text-cyan-400 hover:text-cyan-300 underline"
                >
                  Create account
                </Link>
              </p>
            </div>
          )}

          {/* ── ADMIN LOGIN (hidden tab, no Google) ── */}
          {mode === "admin" && (
            <form onSubmit={handleAdmin} className="space-y-4">
              <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs text-center">
                Administrator access only — email & password required
              </div>
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Admin Email
                </label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                    placeholder="admin@example.com"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={adminPass}
                    onChange={(e) => setAdminPass(e.target.value)}
                    required
                    placeholder="••••••••"
                    className={`${inputCls} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                  >
                    {showPw ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-violet-500/25"
              >
                {loading ? "Signing in…" : "Admin Sign In"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-void flex items-center justify-center text-white">
          Loading…
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}