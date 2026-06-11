// FILE PATH: app/auth/register/page.tsx
//
// CHANGES FROM PREVIOUS VERSION:
// - Fixed: after successful account creation, signIn now calls the correct
//   provider id "credentials" (was incorrectly "student-credentials", which
//   does not exist, causing auto-login after registration to always fail).
// - All other logic unchanged.

"use client";
import { useState, Suspense } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  Zap, ArrowLeft, Mail, Lock, User, Eye, EyeOff, Phone,
  KeyRound, RefreshCw, CheckCircle,
} from "lucide-react";

type Step = "details" | "verify" | "setpassword" | "done";

function RegisterForm() {
  const [step, setStep] = useState<Step>("details");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [otpCode, setOtpCode] = useState("");
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [verificationToken, setVerificationToken] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputCls =
    "w-full pl-10 pr-4 py-3 glass rounded-xl border border-border text-white text-sm " +
    "placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 " +
    "focus:ring-1 focus:ring-cyan-500/20 transition-all";

  const startCooldown = () => {
    setOtpCooldown(60);
    const t = setInterval(() => {
      setOtpCooldown((c) => {
        if (c <= 1) { clearInterval(t); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  // ── Step 1: collect details → send OTP ───────────────────────────────────
  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, purpose: "register" }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      if (data.roleConflict && data.existingRole === "instructor") {
        setError(
          "This email is already registered as an Instructor account. " +
            "Please use the Instructor portal to sign in."
        );
        return;
      }
      setError(data.error || "Failed to send OTP.");
      return;
    }

    setStep("verify");
    setSuccess("A 6-digit code was sent to your email.");
    startCooldown();
  };

  const handleResendOTP = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, purpose: "register" }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error || "Failed to resend OTP."); return; }
    setSuccess("New OTP sent. Check your email.");
    startCooldown();
  };

  // ── Step 2: verify OTP ────────────────────────────────────────────────────
  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) { setError("Enter the 6-digit OTP."); return; }
    setLoading(true);
    setError("");

    const verifyRes = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp: otpCode }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) {
      setError(verifyData.error || "Invalid OTP.");
      setLoading(false);
      return;
    }

    setVerificationToken(verifyData.verificationToken);
    setLoading(false);
    setSuccess("Email verified! Now confirm your password.");
    setStep("setpassword");
  };

  // ── Step 3: create account ────────────────────────────────────────────────
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!verificationToken) { setError("Verification token missing. Please start over."); return; }
    setLoading(true);
    setError("");

    const regRes = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || email.split("@")[0],
        email,
        password,
        phone: phone || undefined,
        verificationToken,
      }),
    });
    const regData = await regRes.json();
    if (!regRes.ok) {
      if (regData.roleConflict && regData.existingRole === "instructor") {
        setError(
          "This email is already registered as an Instructor account. " +
            "Please use the Instructor portal to sign in."
        );
      } else {
        setError(regData.error || "Registration failed.");
      }
      setLoading(false);
      return;
    }

    setSuccess("Account created! Signing you in…");

    // FIX: Use "credentials" — the unified provider that handles students.
    // "student-credentials" does not exist and always caused sign-in failure.
    const login = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);

    if (login?.error) {
      setError("Account created but sign-in failed. Please sign in manually.");
      setTimeout(() => { window.location.href = "/auth/signin"; }, 2000);
    } else {
      setStep("done");
      setTimeout(() => { window.location.href = "/dashboard"; }, 1000);
    }
  };

  const stepNum =
    step === "details" ? 1
    : step === "verify" ? 2
    : step === "setpassword" ? 3
    : 4;

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-void">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] rounded-full bg-emerald-500/6 blur-[100px]" />

      <div className="relative z-10 w-full max-w-md px-4">
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2 text-text-muted hover:text-text-secondary text-sm mb-8 transition-colors font-mono"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>

        <div className="glass-bright rounded-3xl p-8 border border-border">
          <div className="text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25">
              {step === "done" ? (
                <CheckCircle className="w-7 h-7 text-white" strokeWidth={2.5} />
              ) : (
                <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
              )}
            </div>
            <h1 className="text-2xl font-bold text-white">
              {step === "done" ? "You're in!" : "Create Account"}
            </h1>
            <p className="text-text-muted text-sm mt-1.5">
              {step === "details" && "Join NovaMind as a student"}
              {step === "verify" && `Enter the code sent to ${email}`}
              {step === "setpassword" && "Confirm your password to finish"}
              {step === "done" && "Welcome to NovaMind. Redirecting…"}
            </p>
          </div>

          {/* Progress indicator */}
          {step !== "done" && (
            <div className="flex items-center gap-2 mb-6">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`flex-1 h-1 rounded-full transition-all ${
                    stepNum >= n ? "bg-emerald-500" : "bg-border"
                  }`}
                />
              ))}
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

          {/* ── Step 1: details ── */}
          {step === "details" && (
            <form onSubmit={handleSendOTP} className="space-y-4">
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Your full name"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">Email</label>
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
                  Phone <span className="text-text-muted">(optional)</span>
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
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Password <span className="text-text-muted">(min. 8 chars)</span>
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
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/25"
              >
                {loading ? "Sending code…" : "Continue — Verify Email"}
              </button>
              <p className="text-center text-xs text-text-muted">
                A 6-digit code will be sent to verify your email.
              </p>
            </form>
          )}

          {/* ── Step 2: OTP verify ── */}
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
                    value={otpCode}
                    onChange={(e) =>
                      setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
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
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/25"
              >
                {loading ? "Verifying…" : "Verify Email"}
              </button>
              <button
                type="button"
                onClick={handleResendOTP}
                disabled={otpCooldown > 0 || loading}
                className="w-full py-2.5 rounded-xl border border-border text-text-muted hover:text-white text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend OTP"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("details");
                  setError("");
                  setSuccess("");
                  setOtpCode("");
                }}
                className="w-full text-xs text-text-muted hover:text-text-secondary transition-colors text-center"
              >
                ← Change email or details
              </button>
            </form>
          )}

          {/* ── Step 3: confirm password + create account ── */}
          {step === "setpassword" && (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Confirm Password <span className="text-text-muted">(min. 8 chars)</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-text-secondary text-sm font-medium mb-1.5 block">
                  Repeat Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type={showPw ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="Repeat password"
                    className={inputCls}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || password.length < 8 || password !== confirm}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/25"
              >
                {loading ? "Creating account…" : "Create Account"}
              </button>
            </form>
          )}

          {step !== "done" && (
            <p className="text-center text-text-muted text-sm mt-6">
              Already have an account?{" "}
              <Link href="/auth/signin" className="text-cyan-400 hover:text-cyan-300 underline">
                Sign in
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-void flex items-center justify-center text-white">
          Loading…
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}