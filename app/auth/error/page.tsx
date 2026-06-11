// FILE PATH: app/auth/error/page.tsx
//
// FIX: Corrected "suggested portal" action buttons.
//
// The previous version linked to:
//   /auth/signin?tab=instructor  — not a valid mode (only "unified" and "admin" are valid)
//   /auth/signin?tab=student     — not a valid mode (falls back to "unified" silently)
//
// The signin page uses a 2-mode system:
//   "unified" — one form that handles BOTH students and instructors (role auto-detected)
//   "admin"   — separate admin-only form
//
// There is NO separate instructor tab. Instructors use the same unified form as students.
// The auth server auto-detects the role from the email (instructors table checked first).
//
// Fix applied:
//   - suggestedPortal === "instructor": link now goes to /auth/signin (the unified form).
//     Label updated to "Sign In with Email" since that is the correct action for instructors.
//   - suggestedPortal === "student": link now correctly goes to /auth/signin (same unified form).
//     The old ?tab=student param was silently ignored; it is removed.
//   - All other error messages, styles, and logic are unchanged.
//
// Also fixed: Added "Configuration" error code (already present in previous version — kept).

"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ShieldAlert, ArrowLeft, UserCheck, Settings } from "lucide-react";

type ErrorConfig = {
  icon: "shield" | "role" | "generic" | "settings";
  title: string;
  message: string;
  hint: string;
  suggestedPortal: "student" | "instructor" | null;
};

const ERROR_MAP: Record<string, ErrorConfig> = {
  // ── Google OAuth credential mismatch ──────────────────────────────────────
  // Triggered when GOOGLE_CLIENT_SECRET doesn't match GOOGLE_CLIENT_ID in .env,
  // or when the OAuth app is misconfigured in Google Cloud Console.
  // NextAuth surfaces this as error=Configuration after catching invalid_client.
  Configuration: {
    icon: "settings",
    title: "Google Sign-In Misconfigured",
    message:
      "The Google OAuth credentials are invalid. This usually means the Client Secret in .env doesn't match the Client ID, or the OAuth app was recently recreated in Google Cloud Console.",
    hint:
      "Go to Google Cloud Console → APIs & Services → Credentials, copy the correct Client ID and Client Secret for your OAuth 2.0 app, and update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file, then restart the server.",
    suggestedPortal: null,
  },

  // ── Role-mismatch errors ──────────────────────────────────────────────────
  // These fire when a Google account is registered as one role but was used
  // on the wrong portal (e.g. an instructor trying to sign in as a student).
  ROLE_MISMATCH_INSTRUCTOR_GOOGLE_ON_STUDENT_PORTAL: {
    icon: "role",
    title: "Instructor Account Detected",
    message:
      "This Google account is registered as an Instructor. Instructor accounts must sign in using email and password — Google sign-in is routed through the unified sign-in form.",
    hint: "Click the button below to go to the sign-in page and enter your instructor email and password.",
    // FIX: "instructor" suggestedPortal now renders a link to /auth/signin (the unified form),
    // NOT /auth/signin?tab=instructor which was an invalid, silently-ignored tab parameter.
    suggestedPortal: "instructor",
  },
  ROLE_MISMATCH_STUDENT_GOOGLE_ON_INSTRUCTOR_PORTAL: {
    icon: "role",
    title: "Student Account Detected",
    message:
      "This Google account is registered as a Student and cannot be used to sign in as an Instructor.",
    hint: "Please sign in using your student account instead.",
    suggestedPortal: "student",
  },

  // ── Admin / access blocks ─────────────────────────────────────────────────
  AdminGoogleBlocked: {
    icon: "shield",
    title: "Administrator Access Restricted",
    message:
      "Administrator accounts cannot sign in via Google for security reasons.",
    hint: "Please use the Admin login portal with your email and password. Click the 'Admin login' link on the sign-in page.",
    suggestedPortal: null,
  },
  InstructorNotFound: {
    icon: "shield",
    title: "Instructor Account Not Found",
    message:
      "No Instructor account exists for this Google email address. Instructor accounts are created by the platform administrator.",
    hint: "If you are a student, please use the sign-in page with your student account.",
    suggestedPortal: "student",
  },

  // ── Generic OAuth / NextAuth errors ──────────────────────────────────────
  OAuthAccountNotLinked: {
    icon: "generic",
    title: "Account Not Linked",
    message:
      "This email is already registered with a different sign-in method.",
    hint: "Please sign in using the method you originally used to create your account (email & password or OTP).",
    suggestedPortal: null,
  },
  AccessDenied: {
    icon: "shield",
    title: "Access Denied",
    message: "You do not have permission to sign in.",
    hint: "Please contact your administrator if you believe this is a mistake.",
    suggestedPortal: null,
  },
  Verification: {
    icon: "generic",
    title: "Verification Failed",
    message: "The sign-in link or token may have expired or already been used.",
    hint: "Please request a new sign-in link.",
    suggestedPortal: null,
  },
};

const DEFAULT_ERROR: ErrorConfig = {
  icon: "generic",
  title: "Authentication Error",
  message: "An unexpected error occurred during sign-in. Please try again.",
  hint: "If this issue persists, please contact support.",
  suggestedPortal: null,
};

function ErrorPageContent() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? "";
  const config = ERROR_MAP[errorCode] ?? DEFAULT_ERROR;

  const IconComponent =
    config.icon === "shield"
      ? ShieldAlert
      : config.icon === "role"
      ? UserCheck
      : config.icon === "settings"
      ? Settings
      : AlertTriangle;

  const iconColor =
    config.icon === "role"
      ? "text-amber-400"
      : config.icon === "settings"
      ? "text-blue-400"
      : "text-red-400";

  const borderColor =
    config.icon === "role"
      ? "border-amber-500/20"
      : config.icon === "settings"
      ? "border-blue-500/20"
      : "border-red-500/20";

  const bgColor =
    config.icon === "role"
      ? "bg-amber-500/10"
      : config.icon === "settings"
      ? "bg-blue-500/10"
      : "bg-red-500/10";

  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] rounded-full bg-red-500/4 blur-[100px]" />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2 text-text-muted hover:text-text-secondary text-sm mb-8 transition-colors font-mono"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>

        <div className={`glass-bright rounded-3xl p-8 border ${borderColor}`}>
          <div
            className={`w-16 h-16 rounded-2xl ${bgColor} border ${borderColor} flex items-center justify-center mx-auto mb-6`}
          >
            <IconComponent className={`w-8 h-8 ${iconColor}`} />
          </div>

          <h1
            className="text-xl font-bold text-white text-center mb-3"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {config.title}
          </h1>

          <p className="text-text-secondary text-sm text-center mb-2 leading-relaxed">
            {config.message}
          </p>

          <p className="text-text-muted text-xs text-center mb-6 leading-relaxed">
            {config.hint}
          </p>

          {/* Error code badge for debugging */}
          {errorCode && (
            <div className="text-center mb-4">
              <span className="text-xs font-mono text-text-muted bg-white/5 px-2 py-1 rounded">
                error: {errorCode}
              </span>
            </div>
          )}

          <div className="space-y-3">
            {/*
              FIX: "instructor" suggestedPortal.
              The signin page has NO separate instructor tab — both students and instructors
              use the unified form (/auth/signin with mode="unified").
              The previous code linked to /auth/signin?tab=instructor which is not a valid
              mode and was silently ignored (fell back to mode="unified" anyway).
              The button now goes directly to /auth/signin with a clear label.
            */}
            {config.suggestedPortal === "instructor" && (
              <>
                <Link
                  href="/auth/signin"
                  className="w-full flex items-center justify-center py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 text-black font-bold text-sm hover:opacity-90 transition-all"
                >
                  Sign In with Email & Password
                </Link>
                <p className="text-center text-xs text-text-muted">
                  Use the unified sign-in form with your instructor email and password.
                </p>
              </>
            )}

            {/*
              FIX: "student" suggestedPortal.
              The previous code linked to /auth/signin?tab=student which is not a valid
              mode. Both students and instructors use the same unified form. The ?tab=student
              parameter was silently ignored. Link now goes directly to /auth/signin.
            */}
            {config.suggestedPortal === "student" && (
              <>
                <Link
                  href="/auth/signin"
                  className="w-full flex items-center justify-center py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-bold text-sm hover:opacity-90 transition-all"
                >
                  Go to Sign In
                </Link>
              </>
            )}

            {!config.suggestedPortal && (
              <Link
                href="/auth/signin"
                className="w-full flex items-center justify-center py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-bold text-sm hover:opacity-90 transition-all"
              >
                Return to Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-void flex items-center justify-center text-white">
          Loading…
        </div>
      }
    >
      <ErrorPageContent />
    </Suspense>
  );
}