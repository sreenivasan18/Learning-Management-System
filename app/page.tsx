import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Zap, BookOpen, Award, Users, ArrowRight, GraduationCap } from "lucide-react";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-void">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-20" />
          <div className="absolute top-1/4 -left-48 w-[600px] h-[600px] rounded-full bg-cyan-500/8 blur-[120px]" />
          <div className="absolute bottom-1/4 -right-48 w-[600px] h-[600px] rounded-full bg-violet-500/8 blur-[120px]" />
          <div className="relative z-10 max-w-6xl mx-auto px-4 pt-36 pb-24 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-cyan-500/20 text-cyan-400 text-sm font-mono mb-8">
              <Zap className="w-4 h-4" /> NovaMind LMS v10 — Quizzes, Certificates & Multi-Role Auth
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-white mb-6 leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              Learn. <span className="text-gradient-cyan">Quiz.</span> Grow.
            </h1>
            <p className="text-text-secondary text-lg md:text-xl max-w-2xl mx-auto mb-10">
              A full-stack LMS with instructor-led courses, interactive quizzes, certificates with performance summaries, and multi-role authentication.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/courses" className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-lg hover:opacity-90 transition-all shadow-2xl shadow-cyan-500/25">
                <BookOpen className="w-5 h-5" /> Explore Courses <ArrowRight className="w-5 h-5" />
              </Link>
              <Link href="/auth/signin" className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl glass border border-border text-white font-semibold text-lg hover:bg-white/5 transition-all">
                Get Started
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-4 gap-6">
          {[
            { icon: GraduationCap, title: "Instructor Roles", desc: "Dedicated instructor accounts to build and manage courses" },
            { icon: BookOpen, title: "Module Quizzes", desc: "Per-module quiz assessments with instant grading & feedback" },
            { icon: Award, title: "Smart Certificates", desc: "PDF certificates with full quiz performance summary tables" },
            { icon: Users, title: "Multi-Auth", desc: "Email/password credentials, OTP passwordless login, and password reset" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass-bright rounded-2xl p-6 border border-border">
              <Icon className="w-8 h-8 text-cyan-400 mb-4" />
              <h3 className="text-white font-bold mb-2">{title}</h3>
              <p className="text-text-muted text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
