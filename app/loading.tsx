// FILE PATH: app/loading.tsx
// Root-level loading UI — shown while any server component page is streaming.
// Each route segment can also have its own loading.tsx for finer control.
export default function GlobalLoading() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {/* Animated logo pulse */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 animate-pulse" />
        <p className="text-text-muted text-sm font-mono animate-pulse">
          Loading…
        </p>
      </div>
    </div>
  );
}
