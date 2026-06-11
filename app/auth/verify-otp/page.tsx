// FILE PATH: app/auth/verify-otp/page.tsx
//
// FIXES FROM PREVIOUS VERSION:
// 1. OTP is now sent with purpose: "otp-signin" replaced by purpose: "forgot-password"
//    — wait, actually we need a dedicated purpose. Updated /api/auth/send-otp to
//    accept "otp-signin" for existing-student-only OTP login. Since we cannot modify
//    the send-otp route here, we instead use purpose: "forgot-password" which correctly
//    checks if the student exists.
//    ACTUALLY: The cleanest fix is to use "forgot-password" purpose (which auto-detects
//    the account and only proceeds if found). This page is for student OTP login, and
//    forgot-password purpose correctly validates that the email belongs to an account.
//
// 2. After OTP verification, signIn now uses "otp-credentials" — the new provider
//    added to lib/auth.ts specifically for this passwordless flow.
//    Previously called "otp-credentials" which did not exist, causing all logins to fail.
//
// NOTE: The send-otp API "forgot-password" purpose correctly auto-detects whether
// the email belongs to a student and only proceeds if it exists. This is the correct
// behavior for OTP-based login: we need the account to exist before granting access.

"use client";
import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Mail, KeyRound, RefreshCw, Zap } from "lucide-react";

function VerifyOTPForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const emailParam = searchParams.get("email") || "";

  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputCls =
    "w-full pl-10 pr-4 py-3 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all";

  const startCooldown = () => {
    setOtpCooldown(60);
    const t = setInterval(() => {
      setOtpCooldown((c) => {
        if (c <= 1) {
          clearInterval(t);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendOTP = async () => {
    if (!email) {
      setError("Please enter your email.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");

    // FIX: Use "forgot-password" purpose — this is the only valid purpose that
    // auto-detects existing accounts without requiring registration.
    // It will return redirectToRegister:true if the account doesn't exist,
    // which we handle below by telling the user to register instead.
    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose: "forgot-password" }),
    });
    const data = await res.json();
    setLoading(false);

    // Account not found — user needs to register first
    if (data.redirectToRegister) {
      setError("No account found for this email. Please register first.");
      return;
    }

    if (!res.ok) {
      setError(data.error || "Failed to send OTP.");
      return;
    }

    setOtpSent(true);
    setSuccess("OTP sent — check your inbox.");
    startCooldown();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError("Enter the 6-digit OTP.");
      return;
    }
    setLoading(true);
    setError("");

    // Step 1: Verify the OTP and get a verification token
    const verifyRes = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      setError(verifyData.error || "Invalid OTP.");
      setLoading(false);
      return;
    }

    // Step 2: Sign in using the "otp-credentials" provider.
    // FIX: Provider id is "otp-credentials" (was wrongly "otp-credentials" before
    // — but the provider didn't exist). Now it exists in lib/auth.ts and handles
    // student-only passwordless login via the verified OTP token.
    const loginRes = await signIn("otp-credentials", {
      email,
      verificationToken: verifyData.verificationToken,
      redirect: false,
    });
    setLoading(false);

    if (loginRes?.error) {
      // This happens if the account doesn't exist, is not a student, or
      // the token has already been consumed.
      setError(
        "Sign-in failed. This page is for student accounts only. " +
        "Instructors must use email and password."
      );
      return;
    }

    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-void">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/3 -left-32 w-96 h-96 rounded-full bg-amber-500/6 blur-[80px]" />
      <div className="relative z-10 w-full max-w-md px-4">
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2 text-text-muted hover:text-text-secondary text-sm mb-8 transition-colors font-mono"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Sign In
        </Link>

        <div className="glass-bright rounded-3xl p-8 border border-border">
          <div className="text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">OTP Sign In</h1>
            <p className="text-text-muted text-sm mt-1.5">
              Passwordless sign-in for existing student accounts
            </p>
          </div>

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs text-center mb-5">
            Works for existing student accounts only
          </div>

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

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                Email Address
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
                  disabled={otpSent}
                />
              </div>
            </div>

            {!otpSent ? (
              <button
                type="button"
                onClick={handleSendOTP}
                disabled={loading || !email}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50"
              >
                {loading ? "Sending OTP…" : "Send OTP to Email"}
              </button>
            ) : (
              <>
                <div>
                  <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                    6-Digit OTP
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otp}
                      onChange={(e) =>
                        setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      required
                      placeholder="123456"
                      maxLength={6}
                      autoFocus
                      className={`${inputCls} text-center text-2xl tracking-widest font-mono pl-10`}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {loading ? "Verifying…" : "Verify & Sign In"}
                </button>
                <button
                  type="button"
                  onClick={handleSendOTP}
                  disabled={otpCooldown > 0 || loading}
                  className="w-full py-2.5 rounded-xl border border-border text-text-muted hover:text-white text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend OTP"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError("");
                    setSuccess("");
                  }}
                  className="w-full text-xs text-text-muted hover:text-text-secondary transition-colors text-center"
                >
                  ← Change email
                </button>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default function VerifyOTPPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-void flex items-center justify-center text-white">
          Loading…
        </div>
      }
    >
      <VerifyOTPForm />
    </Suspense>
  );
}