// FILE PATH: app/error.tsx
// Global error boundary for unhandled server and client errors.
// Without this, Next.js shows a generic blank error page in production.
"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to your error tracking service (Sentry, etc.) here
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-void">
      <div className="glass-bright rounded-3xl p-10 border border-red-500/20 max-w-md w-full mx-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">
          Something went wrong
        </h1>
        <p className="text-text-muted text-sm mb-6">
          An unexpected error occurred. Please try again or return to the home
          page.
        </p>
        {process.env.NODE_ENV === "development" && error?.message && (
          <pre className="text-left text-xs text-red-300 bg-red-500/10 rounded-xl p-4 mb-6 overflow-auto max-h-40 border border-red-500/20">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 border border-border text-white text-sm font-semibold hover:bg-white/15 transition-all"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-all"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
