// FILE PATH: app/auth/forgot-password/page.tsx
//
// UNIFIED FORGOT PASSWORD PAGE
// ─────────────────────────────────────────────────────────────────────────────
// The old page had a Student / Instructor toggle that was required because the
// API checked different tables based on the selected role.
//
// The updated /api/auth/send-otp route (when purpose=forgot-password and no
// role is specified) already handles auto-detection: it checks the users table
// and the instructors table in sequence. The reset-password route similarly
// updates whichever table contains the email.
//
// This page removes the role selector entirely. The user enters their email,
// an OTP is sent, and the API auto-detects whether it belongs to a student or
// an instructor.
//
// NOTE: The send-otp route accepts an optional `role` param. When omitted (as
// this page does), the route must auto-detect. The route already supports this:
// the `normalizedRole` is undefined when role is not sent, and the forgot-
// password branch falls through to the student path by default. However the
// student path also checks instructors because reset-password updates both
// tables. We update send-otp to handle the unified case — see the note in the
// send-otp rewrite instructions below. For this page we simply omit `role`.

"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Zap,
  KeyRound,
  RefreshCw,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";

type Step = "email" | "verify" | "reset";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [verificationToken, setVerificationToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputCls =
    "w-full pl-10 pr-4 py-3 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all";

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

  // ── Step 1: request OTP — no role needed ─────────────────────────────────
  // The API auto-detects whether the email belongs to a student or instructor.
  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        purpose: "forgot-password",
        // No role — server auto-detects from both tables
      }),
    });
    const data = await res.json();
    setLoading(false);

    // Backend returns { redirectToRegister: true } when the email is not found.
    if (data.redirectToRegister) {
      const params = new URLSearchParams({ email });
      router.push(`/auth/register?${params.toString()}`);
      return;
    }

    if (!res.ok) {
      setError(data.error || "Failed to send OTP.");
      return;
    }

    setStep("verify");
    setSuccess("A 6-digit verification code was sent to your email.");
    startCooldown();
  };

  // ── Step 2: verify OTP ───────────────────────────────────────────────────
  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Invalid code.");
      return;
    }

    setVerificationToken(data.verificationToken);
    setSuccess("Email verified. Create a new password below.");
    setStep("reset");
  };

  // ── Step 3: set new password ─────────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        verificationToken,
        password: newPassword,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Failed to reset password.");
      return;
    }

    setSuccess("Password reset successfully! Redirecting to sign in…");
    setTimeout(() => router.push("/auth/signin"), 1800);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-void">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] rounded-full bg-cyan-500/6 blur-[100px]" />
      <div className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] rounded-full bg-violet-500/6 blur-[100px]" />

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
              <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-2xl font-bold text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {step === "email" && "Forgot password?"}
              {step === "verify" && "Verify your email"}
              {step === "reset" && "Set new password"}
            </h1>
            <p className="text-text-muted text-sm mt-1.5">
              {step === "email" &&
                "Enter your email and we'll send a verification code."}
              {step === "verify" &&
                `Enter the 6-digit code sent to ${email}`}
              {step === "reset" && "Choose a new password for your account."}
            </p>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-6">
            <div className="flex-1 h-1 rounded-full bg-cyan-500" />
            <div
              className={`flex-1 h-1 rounded-full transition-all ${
                step === "verify" || step === "reset"
                  ? "bg-cyan-500"
                  : "bg-border"
              }`}
            />
            <div
              className={`flex-1 h-1 rounded-full transition-all ${
                step === "reset" ? "bg-cyan-500" : "bg-border"
              }`}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              {success}
            </div>
          )}

          {/* ── Step: Email ── */}
          {step === "email" && (
            <form onSubmit={handleSendOTP} className="space-y-4">
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
                    autoFocus
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/25"
              >
                {loading ? "Sending code…" : "Send Verification Code"}
              </button>
            </form>
          )}

          {/* ── Step: Verify OTP ── */}
          {step === "verify" && (
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
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
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
                disabled={loading || otp.length !== 6}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/25"
              >
                {loading ? "Verifying…" : "Verify Code"}
              </button>
              <button
                type="button"
                onClick={handleSendOTP}
                disabled={otpCooldown > 0 || loading}
                className="w-full py-2.5 rounded-xl border border-border text-text-muted hover:text-white text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend Code"}
              </button>
            </form>
          )}

          {/* ── Step: Reset Password ── */}
          {step === "reset" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="Min. 8 characters"
                    className={`${inputCls} pr-10`}
                    autoFocus
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
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Repeat your password"
                    className={`${inputCls} pr-10`}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/25"
              >
                {loading ? "Resetting…" : "Reset Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}