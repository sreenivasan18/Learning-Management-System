import Link from "next/link";
import { ShieldOff, ArrowLeft } from "lucide-react";
export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-void">
      <div className="text-center">
        <ShieldOff className="w-20 h-20 text-red-400 mx-auto mb-6" />
        <h1 className="text-5xl font-bold text-white mb-2">403</h1>
        <p className="text-text-muted text-lg mb-8">You don&apos;t have permission to access this page.</p>
        <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-semibold">
          <ArrowLeft className="w-4 h-4" /> Go Home
        </Link>
      </div>
    </div>
  );
}
