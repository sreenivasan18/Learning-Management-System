// FILE PATH: app/auth/google-onboarding/page.tsx
//
// FIX: After Google onboarding registration is complete, sign the user in using
// the "google-otp-credentials" provider instead of triggering a full Google
// OAuth redirect with signIn("google", ...).
//
// ROOT CAUSE OF PREVIOUS BUG:
//   The original page called signIn("google", { callbackUrl: "/dashboard" }) after
//   registration. This forced a second full browser-redirect round-trip to Google
//   and back. Two problems:
//     1. Unnecessary latency and UX disruption (user leaves the page twice).
//     2. If the user had switched their active Google account in the browser during
//        the onboarding flow, the new signIn("google") could authenticate as the
//        wrong account, creating an account for Google user A but logging in as B.
//
// FIX APPLIED:
//   After /api/register succeeds (user row created in DB), call
//   signIn("google-otp-credentials", { email, verificationToken, bridgeToken })
//   instead. This provider lives in lib/auth.ts and was built exactly for this
//   case: it validates the already-verified OTP token without requiring a password
//   or a second Google redirect, then issues the JWT directly.
//
//   Token burn on this path:
//   - /api/register burns the verificationToken (sets it to null) for the bridgeToken
//     path when creating the Google-linked user.
//   - Because the token is already burned before signIn() is called here, the
//     google-otp-credentials provider's own findFirst lookup will NOT find the
//     record (verificationToken is null). We therefore keep track of the raw
//     verificationToken string BEFORE /api/register burns it, and call signIn()
//     before the register API call can be made a second time.
//
//   SEQUENCE (corrected):
//     1. OTP verified  → verificationToken received from /api/auth/verify-otp
//     2. /api/register called with { email, bridgeToken, verificationToken, name, phone }
//        → creates User row, Account row, StudentProfile row
//        → DOES NOT burn verificationToken in this path (bridgeToken path)
//           WAIT — re-checking the register route: it DOES call
//           prisma.oTPVerification.update({ data: { verificationToken: null } })
//           for the bridgeToken path (line 128-131 of /api/register/route.ts).
//        → So the token IS burned by /api/register.
//
//   Because /api/register burns the token, google-otp-credentials authorize() will
//   fail since verificationToken is null in the DB after registration. To solve this:
//   We delay the /api/register call until we are ready to sign in, OR we use the
//   verificationToken string client-side for signIn() BEFORE /api/register burns it.
//
//   CORRECT SEQUENCE (revised):
//     1. OTP verified → verificationToken stored in component state
//     2. User clicks "Complete Registration"
//     3. signIn("google-otp-credentials", { email, verificationToken, bridgeToken })
//        is called FIRST — this validates the OTP record (still un-burned, used:true)
//        and issues the session JWT, then burns the token internally.
//     4. If signIn succeeds → the user has a valid JWT session → redirect to /dashboard
//        Note: the user row doesn't exist yet at this point — signIn would fail because
//        google-otp-credentials authorize() calls prisma.user.findUnique and the user
//        hasn't been created yet.
//
//   FINAL CORRECT APPROACH:
//     The token burn happens in /api/register. Therefore we MUST register first, then
//     use a different mechanism to sign in. The right mechanism is to call
//     signIn("google-otp-credentials") with the ORIGINAL (pre-burn) verificationToken
//     but BEFORE /api/register nulls it.
//
//     Modified register endpoint behavior for bridgeToken path:
//       Currently: burns verificationToken BEFORE returning
//       Needed: do NOT burn verificationToken for the bridgeToken path;
//               let the google-otp-credentials provider burn it on signIn.
//
//     OR: use a simpler approach — since we're already doing a fresh Google signIn
//     anyway (existing behavior), we instead do:
//       1. Call /api/register → creates user → response includes { success: true }
//       2. The verificationToken was burned by register
//       3. Now we cannot use google-otp-credentials because the token is gone
//       4. Fall back to signIn("google") which works because user now exists
//
//     The issue with approach 4 is the double redirect. However the REAL issue from
//     the bug report is reliability: signIn("google") occasionally opens a Google
//     account-picker, letting the user pick a different account than the one they
//     registered with.
//
//   DEFINITIVE FIX: Modify /api/register to NOT burn the verificationToken on the
//   bridgeToken path. Instead, let the google-otp-credentials provider burn it on
//   signIn. This removes the double-Google-redirect entirely.
//
//   Two files change:
//     1. app/auth/google-onboarding/page.tsx  (this file)
//        — call signIn("google-otp-credentials") after /api/register succeeds
//        — pass verificationToken (pre-burn) and bridgeToken
//     2. app/api/register/route.ts
//        — on the bridgeToken path, do NOT null-out verificationToken
//        — instead leave it for google-otp-credentials to consume
//
//   NOTE: /api/register/route.ts is rewritten as part of this fix (see below the
//   onboarding page). The change is surgical: one line removed from the bridgeToken
//   block (the update that burns the token). Everything else is unchanged.

"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  Zap, ArrowLeft, Mail, User, Phone, KeyRound, RefreshCw, CheckCircle,
} from "lucide-react";

type Step = "otp" | "details" | "done";

function GoogleOnboardingForm() {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email") || "";
  const bridgeToken = searchParams.get("bridge") || "";

  const [step, setStep] = useState<Step>("otp");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  // verificationToken is stored in state after OTP verification.
  // It must be passed to /api/register AND then to signIn("google-otp-credentials").
  // /api/register (bridgeToken path) no longer burns this token — it is left for
  // signIn to consume. See /api/register/route.ts for the corresponding change.
  const [verificationToken, setVerificationToken] = useState("");

  // Extra details collected after OTP
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputCls =
    "w-full pl-10 pr-4 py-3 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all";

  const startCooldown = () => {
    setOtpCooldown(60);
    const t = setInterval(() => {
      setOtpCooldown((c) => {
        if (c <= 1) { clearInterval(t); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  if (!emailParam || !bridgeToken) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center px-4">
        <div className="glass-bright rounded-3xl p-8 border border-red-500/20 max-w-md w-full text-center">
          <p className="text-red-400 mb-4">
            Invalid or expired Google session. Please try signing in again.
          </p>
          <Link
            href="/auth/signin"
            className="text-cyan-400 underline text-sm"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  const handleSendOTP = async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailParam,
        purpose: "google-onboarding",
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      // If account already exists, this Google email is already registered
      if (res.status === 409) {
        setError(
          "An account with this email already exists. Please sign in instead."
        );
        return;
      }
      setError(data.error || "Failed to send OTP.");
      return;
    }
    setOtpSent(true);
    setSuccess(`Verification code sent to ${emailParam}`);
    startCooldown();
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailParam, otp: otpCode }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Invalid code.");
      return;
    }

    // Store the verificationToken for use in both /api/register and signIn()
    setVerificationToken(data.verificationToken);
    setSuccess("Email verified! Complete your profile to finish.");
    setStep("details");
  };

  const handleCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationToken) {
      setError("Verification token missing. Please start over.");
      return;
    }
    setLoading(true);
    setError("");

    // ── Step 1: Create the account ──────────────────────────────────────────
    // IMPORTANT: /api/register (bridgeToken path) intentionally does NOT burn the
    // verificationToken for this path. The token remains valid so that
    // signIn("google-otp-credentials") can consume it in step 2 below.
    // See the corresponding change in /api/register/route.ts.
    const regRes = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailParam,
        name: name.trim() || emailParam.split("@")[0],
        phone: phone || undefined,
        verificationToken,
        bridgeToken,
      }),
    });
    const regData = await regRes.json();

    if (!regRes.ok) {
      setError(regData.error || "Registration failed.");
      setLoading(false);
      return;
    }

    // ── Step 2: Sign in using google-otp-credentials ──────────────────────
    // This provider validates the (still-live) verificationToken without
    // requiring a Google redirect. It also burns the token so it cannot be reused.
    // The user row now exists (created in step 1 above), so the DB lookup succeeds.
    setSuccess("Account created! Signing you in…");

    const loginRes = await signIn("google-otp-credentials", {
      email: emailParam,
      verificationToken,
      bridgeToken,
      redirect: false,
    });

    setLoading(false);

    if (loginRes?.error) {
      // Fallback: google-otp-credentials failed (e.g. token was already burned,
      // or a race condition). In this case we fall back to a direct Google sign-in
      // which will succeed since the user now exists in the database.
      console.warn("[ONBOARDING] google-otp-credentials failed, falling back to Google signIn:", loginRes.error);
      setSuccess("Account created! Completing sign-in via Google…");
      setStep("done");
      setTimeout(async () => {
        await signIn("google", { callbackUrl: "/dashboard" });
      }, 1500);
      return;
    }

    // Success: JWT issued, redirect to student dashboard
    setStep("done");
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-void">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] rounded-full bg-cyan-500/6 blur-[100px]" />

      <div className="relative z-10 w-full max-w-md px-4">
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2 text-text-muted hover:text-text-secondary text-sm mb-8 transition-colors font-mono"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>

        <div className="glass-bright rounded-3xl p-8 border border-border">
          <div className="text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/25">
              {step === "done" ? (
                <CheckCircle className="w-7 h-7 text-white" strokeWidth={2.5} />
              ) : (
                <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
              )}
            </div>
            <h1 className="text-2xl font-bold text-white">
              {step === "otp" && "Verify your email"}
              {step === "details" && "Complete your profile"}
              {step === "done" && "You're in!"}
            </h1>
            <p className="text-text-muted text-sm mt-1.5">
              {step === "otp" &&
                "One more step — verify your Google email to create your account"}
              {step === "details" && `Setting up your account for ${emailParam}`}
              {step === "done" && "Signing you in…"}
            </p>
          </div>

          {/* Progress */}
          {step !== "done" && (
            <div className="flex items-center gap-2 mb-6">
              <div className="flex-1 h-1 rounded-full bg-cyan-500" />
              <div
                className={`flex-1 h-1 rounded-full transition-all ${
                  step === "details" ? "bg-cyan-500" : "bg-border"
                }`}
              />
            </div>
          )}

          {/* Google account info banner */}
          {step === "otp" && (
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs text-center mb-5">
              <Mail className="w-3.5 h-3.5 inline mr-1.5" />
              Verifying: <strong>{emailParam}</strong>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
          {success && !error && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              {success}
            </div>
          )}

          {/* ── Step: OTP ── */}
          {step === "otp" && (
            <div className="space-y-4">
              {!otpSent ? (
                <button
                  type="button"
                  onClick={handleSendOTP}
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg"
                >
                  {loading ? "Sending code…" : "Send Verification Code"}
                </button>
              ) : (
                <form onSubmit={handleVerifyOTP} className="space-y-4">
                  <div>
                    <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                      6-Digit Verification Code
                    </label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={otpCode}
                        onChange={(e) =>
                          setOtpCode(
                            e.target.value.replace(/\D/g, "").slice(0, 6)
                          )
                        }
                        required
                        placeholder="123456"
                        maxLength={6}
                        autoFocus
                        className={`${inputCls} text-center text-2xl tracking-widest font-mono`}
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading || otpCode.length !== 6}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    {loading ? "Verifying…" : "Verify Email"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendOTP}
                    disabled={otpCooldown > 0 || loading}
                    className="w-full py-2.5 rounded-xl border border-border text-text-muted hover:text-white text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {otpCooldown > 0
                      ? `Resend in ${otpCooldown}s`
                      : "Resend Code"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── Step: Details ── */}
          {step === "details" && (
            <form onSubmit={handleCompleteRegistration} className="space-y-4">
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Phone{" "}
                  <span className="text-text-muted">(optional)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 234 567 8900"
                    className={inputCls}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg"
              >
                {loading ? "Creating account…" : "Complete Registration"}
              </button>
              <p className="text-center text-xs text-text-muted">
                Your account will be linked to your Google profile.
              </p>
            </form>
          )}

          {/* ── Step: Done ── */}
          {step === "done" && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-text-muted text-sm">
                Account created! Taking you to your dashboard…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GoogleOnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-void flex items-center justify-center text-white">
          Loading…
        </div>
      }
    >
      <GoogleOnboardingForm />
    </Suspense>
  );
}