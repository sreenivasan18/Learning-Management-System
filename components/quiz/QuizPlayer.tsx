"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CheckCircle, XCircle, Clock, ArrowLeft, ArrowRight, Award, RotateCcw, BookOpen, ChevronLeft } from "lucide-react";

interface Question {
  id: string;
  question: string;
  options: string[];
  explanation: string;
  order: number;
}

interface QuizPlayerProps {
  quiz: { id: string; title: string; description: string; timeLimit: number | null };
  questions: Question[];
  lastAttempt: { score: number; maxScore: number; percentage: number } | null;
  courseSlug: string;
  moduleTitle: string;
}

type Phase = "intro" | "playing" | "result";

export default function QuizPlayer({ quiz, questions, lastAttempt, courseSlug, moduleTitle }: QuizPlayerProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(quiz.timeLimit || 0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; maxScore: number; percentage: number; gradedAnswers: { questionId: string; isCorrect: boolean; selectedOption: number }[]; certificateId?: string; certificateIssued?: boolean } | null>(null);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    const answerPayload = questions.map(q => ({ questionId: q.id, selectedOption: answers[q.id] ?? -1 }));
    const res = await fetch(`/api/quiz/${quiz.id}/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: answerPayload }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) { setResult(data); setPhase("result"); }
  }, [quiz.id, questions, answers]);

  // Timer
  useEffect(() => {
    if (phase !== "playing" || !quiz.timeLimit) return;
    if (timeLeft <= 0) { handleSubmit(); return; }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, quiz.timeLimit, handleSubmit]);

  const startQuiz = () => {
    setCurrent(0); setAnswers({}); setSelected(null);
    setTimeLeft(quiz.timeLimit || 0); setPhase("playing");
  };

  const selectOption = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    setAnswers(prev => ({ ...prev, [questions[current].id]: idx }));
  };

  const goNext = () => {
    if (current < questions.length - 1) { setCurrent(c => c + 1); setSelected(answers[questions[current + 1]?.id] ?? null); }
  };
  const goPrev = () => {
    if (current > 0) { setCurrent(c => c - 1); setSelected(answers[questions[current - 1]?.id] ?? null); }
  };

  const pct = result ? result.percentage : 0;
  const pctColor = pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  const pctBg = pct >= 70 ? "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30" : pct >= 40 ? "from-amber-500/20 to-amber-600/10 border-amber-500/30" : "from-red-500/20 to-red-600/10 border-red-500/30";

  // Format timer
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-3xl mx-auto px-4">

        {/* Intro */}
        {phase === "intro" && (
          <div className="glass-bright rounded-3xl p-8 border border-border">
            <div className="flex items-center gap-2 mb-2 text-text-muted text-sm font-mono">
              <Link href={`/courses/${courseSlug}`} className="hover:text-cyan-400 transition-colors flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> {moduleTitle}</Link>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "var(--font-display)" }}>{quiz.title}</h1>
            {quiz.description && <p className="text-text-muted mb-6">{quiz.description}</p>}

            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                { label: "Questions", value: questions.length, icon: BookOpen },
                { label: "Time Limit", value: quiz.timeLimit ? formatTime(quiz.timeLimit) : "No limit", icon: Clock },
                { label: "Best Score", value: lastAttempt ? `${lastAttempt.percentage.toFixed(1)}%` : "—", icon: Award },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="glass rounded-2xl p-4 border border-border text-center">
                  <Icon className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
                  <div className="text-white font-bold text-lg">{value}</div>
                  <div className="text-text-muted text-xs">{label}</div>
                </div>
              ))}
            </div>

            {lastAttempt && (
              <div className={`mb-6 p-4 rounded-2xl bg-gradient-to-r border ${pctBg}`}>
                <p className="text-text-muted text-sm">Previous attempt: <span className={`font-bold ${pctColor}`}>{lastAttempt.percentage.toFixed(1)}% ({lastAttempt.score}/{lastAttempt.maxScore})</span></p>
              </div>
            )}

            <button onClick={startQuiz} className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-lg hover:opacity-90 transition-all shadow-lg shadow-cyan-500/25">
              {lastAttempt ? "Retake Quiz" : "Start Quiz"}
            </button>
          </div>
        )}

        {/* Playing */}
        {phase === "playing" && (
          <div className="glass-bright rounded-3xl p-8 border border-border">
            <div className="flex justify-between items-center mb-6">
              <span className="text-text-muted text-sm font-mono">Q {current + 1} / {questions.length}</span>
              <div className="flex items-center gap-3">
                {quiz.timeLimit && (
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-mono font-bold ${timeLeft < 60 ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-void/50 text-text-secondary border border-border"}`}>
                    <Clock className="w-3.5 h-3.5" /> {formatTime(timeLeft)}
                  </div>
                )}
                <button onClick={handleSubmit} disabled={submitting} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all">
                  Submit Now
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-white/5 rounded-full mb-8 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-violet-600 rounded-full transition-all duration-500" style={{ width: `${((current + 1) / questions.length) * 100}%` }} />
            </div>

            <h2 className="text-xl font-semibold text-white mb-6 leading-relaxed">{questions[current].question}</h2>

            <div className="space-y-3 mb-8">
              {questions[current].options.map((opt, idx) => (
                <button key={idx} onClick={() => selectOption(idx)}
                  className={`w-full text-left px-5 py-4 rounded-2xl border transition-all duration-200 font-medium text-sm ${
                    selected === idx ? "bg-cyan-500/20 border-cyan-500/60 text-cyan-200" :
                    selected !== null ? "bg-white/3 border-white/8 text-text-muted opacity-60" :
                    "glass border-border text-text-secondary hover:border-cyan-500/30 hover:bg-cyan-500/5"
                  }`}>
                  <span className="font-mono text-cyan-500 mr-3">{String.fromCharCode(65 + idx)}.</span>{opt}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={goPrev} disabled={current === 0}
                className="flex items-center gap-2 px-5 py-3 rounded-xl border border-border text-text-muted hover:text-white hover:border-white/20 disabled:opacity-30 transition-all">
                <ArrowLeft className="w-4 h-4" /> Previous
              </button>
              {current < questions.length - 1 ? (
                <button onClick={goNext}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 text-cyan-300 hover:from-cyan-500/30 transition-all">
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold hover:opacity-90 transition-all disabled:opacity-50">
                  {submitting ? "Submitting..." : "Submit Quiz"}
                </button>
              )}
            </div>

            {/* Question dots */}
            <div className="flex flex-wrap gap-2 mt-6">
              {questions.map((q, i) => (
                <button key={i} onClick={() => { setCurrent(i); setSelected(answers[questions[i].id] ?? null); }}
                  className={`w-8 h-8 rounded-lg text-xs font-mono font-bold transition-all ${
                    i === current ? "bg-cyan-500 text-black" :
                    answers[q.id] !== undefined ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/40" :
                    "bg-white/5 text-text-muted border border-white/10"
                  }`}>{i + 1}</button>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {phase === "result" && result && (
          <div className="space-y-6">
            <div className={`glass-bright rounded-3xl p-8 border ${pctBg} text-center`}>
              <div className={`text-7xl font-black mb-2 ${pctColor}`}>{result.percentage.toFixed(1)}%</div>
              <p className="text-white text-xl font-semibold mb-1">{result.score} / {result.maxScore} Correct</p>
              <p className="text-text-muted text-sm">
                {pct >= 70 ? "🎉 Excellent work!" : pct >= 40 ? "👍 Good effort!" : "📚 Keep practicing!"}
              </p>
            </div>

            {/* Question review */}
            <div className="glass-bright rounded-3xl p-6 border border-border">
              <h3 className="text-lg font-bold text-white mb-5">Review Answers</h3>
              <div className="space-y-5">
                {questions.map((q, i) => {
                  const graded = result.gradedAnswers.find(a => a.questionId === q.id);
                  const userAns = graded?.selectedOption ?? -1;
                  return (
                    <div key={q.id} className={`rounded-2xl p-4 border ${graded?.isCorrect ? "bg-emerald-500/8 border-emerald-500/20" : "bg-red-500/8 border-red-500/20"}`}>
                      <div className="flex items-start gap-3 mb-3">
                        {graded?.isCorrect ? <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
                        <span className="text-white text-sm font-medium">Q{i + 1}: {q.question}</span>
                      </div>
                      <div className="ml-8 space-y-1.5">
                        {q.options.map((opt, idx) => (
                          <div key={idx} className={`text-xs px-3 py-2 rounded-lg ${idx === userAns && graded?.isCorrect ? "bg-emerald-500/20 text-emerald-300" : idx === userAns && !graded?.isCorrect ? "bg-red-500/20 text-red-300 line-through" : "text-text-muted"}`}>
                            <span className="font-mono mr-2">{String.fromCharCode(65 + idx)}.</span>{opt}
                            {idx === userAns && !graded?.isCorrect && <span className="ml-2 text-red-400">(Your answer)</span>}
                          </div>
                        ))}
                        {q.explanation && <p className="text-amber-300/80 text-xs mt-2 italic">💡 {q.explanation}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={startQuiz} className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 text-cyan-300 hover:from-cyan-500/30 transition-all font-semibold">
                <RotateCcw className="w-4 h-4" /> Retake Quiz
              </button>
              <Link href={`/courses/${courseSlug}`} className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-semibold hover:opacity-90 transition-all">
                <ArrowLeft className="w-4 h-4" /> Back to Course
              </Link>
            </div>
            {result.certificateIssued && result.certificateId && (
              <Link href={`/certificate/${result.certificateId}`}
                className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 text-black font-bold hover:opacity-90 transition-all w-full mt-1">
                <Award className="w-5 h-5" /> View Your Certificate
              </Link>
            )}
            {result.certificateIssued === false && (
              <p className="text-text-muted text-xs text-center mt-1">Complete all course quizzes to earn your certificate.</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
