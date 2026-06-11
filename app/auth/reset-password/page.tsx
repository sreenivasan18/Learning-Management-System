"use client";
import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock, Eye, EyeOff, KeyRound, CheckCircle, Zap } from "lucide-react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const emailParam = searchParams.get("email") || "";
  const tokenParam = searchParams.get("verificationToken") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputCls =
    "w-full pl-10 pr-4 py-3 glass rounded-xl border border-border text-white text-sm " +
    "placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 " +
    "focus:ring-1 focus:ring-cyan-500/20 transition-all";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (!emailParam || !tokenParam) {
      setError("Invalid or expired reset link. Please start the forgot password process again.");
      return;
    }

    setLoading(true); setError("");
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailParam, verificationToken: tokenParam, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error || "Failed to reset password."); return; }
    setSuccess("Password reset successfully! Redirecting to sign in…");
    setTimeout(() => router.push("/auth/signin"), 2000);
  };

  if (!emailParam || !tokenParam) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">Invalid or expired reset link.</p>
        <Link href="/auth/forgot-password" className="text-cyan-400 underline text-sm">
          Start over
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />{success}
        </div>
      )}

      <div>
        <label className="text-text-secondary text-sm font-medium mb-1.5 block">New Password</label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="At least 8 characters"
            className={inputCls}
          />
          <button type="button" onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-white transition-colors">
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="text-text-secondary text-sm font-medium mb-1.5 block">Confirm Password</label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type={showPw ? "text" : "password"}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            placeholder="Repeat new password"
            className={inputCls}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || password.length < 8 || password !== confirm}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg"
      >
        {loading ? "Resetting…" : "Reset Password"}
      </button>

      <Link href="/auth/signin"
        className="flex items-center justify-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors mt-2">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-cyan-400 font-mono text-sm mb-4">
            <Zap className="w-4 h-4" /> NovaMind LMS
          </div>
          <h1 className="text-2xl font-black text-white mb-2">Set New Password</h1>
          <p className="text-text-muted text-sm">Choose a strong password for your account.</p>
        </div>
        <div className="glass-bright rounded-3xl p-8 border border-border">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Reset Password</h2>
              <p className="text-text-muted text-xs">Enter and confirm your new password</p>
            </div>
          </div>
          <Suspense fallback={<div className="text-text-muted text-sm text-center py-8">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}