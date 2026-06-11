// FILE PATH: components/certificate/CertificateView.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Download,
  Award,
  Calendar,
  BookOpen,
  CheckCircle,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";

interface QuizRow {
  quizTitle: string;
  moduleTitle: string;
  totalQuestions: number;
  correctAnswers: number;
  score: number;
  percentage: number;
}

interface Props {
  cert: {
    id: string;
    issuedAt: Date;
    overallPercentage: number;
    verifyToken: string;
    quizSummary: string;
  };
  student: { name: string | null; email: string | null };
  course: { title: string; category: string; level: string };
}

export default function CertificateView({ cert, student, course }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  let quizSummary: QuizRow[] = [];
  try {
    quizSummary = JSON.parse(cert.quizSummary || "[]");
  } catch {}

  const pct = cert.overallPercentage;
  const pctColor =
    pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  const pctBorder =
    pct >= 70
      ? "border-emerald-500/30 bg-emerald-500/10"
      : pct >= 40
      ? "border-amber-500/30 bg-amber-500/10"
      : "border-red-500/30 bg-red-500/10";

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const res = await fetch(`/api/certificate/${cert.id}/pdf`);
      if (!res.ok) {
        setDownloadError("Failed to generate PDF. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `certificate-${cert.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Network error. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const displayName = student.name || student.email || "Student";

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-text-muted hover:text-white text-sm mb-8 transition-colors font-mono"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>

        {/* Certificate Card */}
        <div className="relative glass-bright rounded-3xl overflow-hidden border border-cyan-500/20 mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-violet-500/5 pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-cyan-500" />

          <div className="p-8 md:p-12">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-8">
              <div>
                <div className="flex items-center gap-2 text-cyan-400 text-sm font-mono mb-3">
                  <Award className="w-4 h-4" /> CERTIFICATE OF COMPLETION
                </div>
                {/* FIX: was "has successfully enrolled in" — corrected to "has successfully completed" */}
                <h1
                  className="text-3xl md:text-4xl font-black text-white mb-2"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {displayName}
                </h1>
                <p className="text-text-muted text-base">
                  has successfully completed
                </p>
                <p className="text-2xl font-bold text-white mt-1">{course.title}</p>
              </div>
              <div
                className={`flex-shrink-0 p-5 rounded-2xl border ${pctBorder} text-center min-w-28`}
              >
                <div className={`text-4xl font-black ${pctColor}`}>
                  {pct.toFixed(1)}%
                </div>
                <div className="text-text-muted text-xs mt-1">Overall Score</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                {
                  icon: Calendar,
                  label: "Issued",
                  value: new Date(cert.issuedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }),
                },
                { icon: BookOpen, label: "Category", value: course.category },
                { icon: TrendingUp, label: "Level", value: course.level },
                {
                  icon: CheckCircle,
                  label: "Quizzes",
                  value: `${quizSummary.length} completed`,
                },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="glass rounded-xl p-3 border border-border">
                  <Icon className="w-4 h-4 text-cyan-400 mb-1" />
                  <div className="text-text-muted text-xs">{label}</div>
                  <div className="text-white text-sm font-semibold">{value}</div>
                </div>
              ))}
            </div>

            {downloadError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {downloadError}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-text-muted text-xs font-mono">ID: {cert.id}</div>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20"
              >
                <Download className="w-4 h-4" />
                {downloading ? "Generating PDF…" : "Download PDF"}
              </button>
            </div>
          </div>
        </div>

        {/* Quiz Summary Table */}
        {quizSummary.length > 0 && (
          <div className="glass-bright rounded-3xl border border-border overflow-hidden">
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-bold text-white">Quiz Performance Summary</h2>
              <p className="text-text-muted text-sm mt-1">
                Detailed breakdown of all quiz attempts
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-white/2">
                    {[
                      "Quiz Title",
                      "Module",
                      "Total Q",
                      "Correct",
                      "Score",
                      "Percentage",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold text-cyan-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quizSummary.map((row, i) => {
                    const rColor =
                      row.percentage >= 70
                        ? "text-emerald-400"
                        : row.percentage >= 40
                        ? "text-amber-400"
                        : "text-red-400";
                    return (
                      <tr
                        key={i}
                        className="border-b border-border/50 hover:bg-white/2 transition-colors"
                      >
                        <td className="px-4 py-3 text-white text-sm font-medium">
                          {row.quizTitle}
                        </td>
                        <td className="px-4 py-3 text-text-muted text-sm">
                          {row.moduleTitle}
                        </td>
                        <td className="px-4 py-3 text-text-secondary text-sm">
                          {row.totalQuestions}
                        </td>
                        <td className="px-4 py-3 text-text-secondary text-sm">
                          {row.correctAnswers}
                        </td>
                        <td className="px-4 py-3 text-text-secondary text-sm font-mono">
                          {row.score}
                        </td>
                        <td className={`px-4 py-3 text-sm font-bold ${rColor}`}>
                          {row.percentage.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-white/3 border-t-2 border-border">
                    <td
                      colSpan={5}
                      className="px-4 py-3 text-text-secondary text-sm font-semibold"
                    >
                      Overall Performance
                    </td>
                    <td className={`px-4 py-3 text-sm font-black ${pctColor}`}>
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
