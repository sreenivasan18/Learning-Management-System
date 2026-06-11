"use client";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";
import { Zap, LayoutDashboard, BookOpen, Award, ShieldCheck, Menu, X, LogOut, UserCircle, GraduationCap } from "lucide-react";

export function Navbar() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const role = (session?.user as any)?.role;

  const dashLink = role === "ADMIN" ? "/admin" : role === "INSTRUCTOR" ? "/instructor" : "/dashboard";
  const dashLabel = role === "ADMIN" ? "Admin" : role === "INSTRUCTOR" ? "Studio" : "Dashboard";
  const dashIcon = role === "ADMIN" ? ShieldCheck : role === "INSTRUCTOR" ? GraduationCap : LayoutDashboard;
  const DashIcon = dashIcon;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-void/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-white text-lg" style={{ fontFamily: "var(--font-display)" }}>Nova<span className="text-gradient-cyan">Mind</span></span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          <Link href="/courses" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-all text-sm font-medium">
            <BookOpen className="w-4 h-4" /> Courses
          </Link>
          {session?.user && (
            <>
              <Link href={dashLink} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-all text-sm font-medium">
                <DashIcon className="w-4 h-4" /> {dashLabel}
              </Link>
              {role === "STUDENT" && (
                <Link href="/dashboard" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-all text-sm font-medium">
                  <Award className="w-4 h-4" /> Certificates
                </Link>
              )}
            </>
          )}
        </div>

        <div className="hidden md:flex items-center gap-3">
          {session?.user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-border">
                <UserCircle className="w-4 h-4 text-cyan-400" />
                <span className="text-white text-sm font-medium max-w-32 truncate">{session.user.name || session.user.email}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${role === "ADMIN" ? "bg-violet-500/20 text-violet-300" : role === "INSTRUCTOR" ? "bg-orange-500/20 text-orange-300" : "bg-cyan-500/20 text-cyan-300"}`}>{role}</span>
              </div>
              <button onClick={() => signOut({ callbackUrl: "/auth/signin" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all text-sm">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          ) : (
            <Link href="/auth/signin" className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-semibold text-sm hover:opacity-90 transition-all">
              Sign In
            </Link>
          )}
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden text-text-muted hover:text-white transition-colors">
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden glass border-t border-border px-4 py-4 space-y-2">
          <Link href="/courses" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/5 text-sm">
            <BookOpen className="w-4 h-4" /> Courses
          </Link>
          {session?.user ? (
            <>
              <Link href={dashLink} onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/5 text-sm">
                <DashIcon className="w-4 h-4" /> {dashLabel}
              </Link>
              <button onClick={() => signOut({ callbackUrl: "/auth/signin" })} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-500/10 text-sm">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </>
          ) : (
            <Link href="/auth/signin" onClick={() => setOpen(false)} className="block text-center px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-semibold text-sm">
              Sign In
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
