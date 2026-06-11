// FILE PATH: components/instructor/CourseFormClient.tsx
// Full file — adds VideoUpload integration and replaces the videoUrl text input.
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle, Trash2, ChevronDown, ChevronUp, BookOpen, ArrowLeft, Film, AlertCircle } from "lucide-react";
import Link from "next/link";

interface Question {
  question: string;
  options: [string, string, string, string];
  correctAnswer: number;
  explanation: string;
}
interface Quiz { title: string; description: string; questions: Question[] }
interface Module {
  title: string;
  description: string;
  videoUrl: string;      // only a URL reference; actual upload is via VideoUpload component post-creation
  durationMins: number;
  isFree: boolean;
  quizzes: Quiz[];
}

const emptyQuestion = (): Question => ({
  question: "", options: ["", "", "", ""], correctAnswer: 0, explanation: "",
});
const emptyQuiz = (): Quiz => ({ title: "", description: "", questions: [emptyQuestion()] });
const emptyModule = (): Module => ({
  title: "", description: "", videoUrl: "", durationMins: 0, isFree: false, quizzes: [],
});

const CATEGORIES = ["Programming", "Design", "Business", "Marketing", "Data Science", "DevOps", "Other"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

export default function CourseFormClient({
  instructors = [],
  role,
}: {
  instructors: { id: string; name: string; email: string }[];
  role: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [successCourseId, setSuccessCourseId] = useState<string | null>(null);
  const [expandedMod, setExpandedMod] = useState<number | null>(0);
  const [expandedQuiz, setExpandedQuiz] = useState<[number, number] | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Programming",
    level: "Beginner",
    price: 0,
    thumbnail: "",
    instructorId: "",
    isPublished: false,
  });
  const [modules, setModules] = useState<Module[]>([emptyModule()]);

  const setModField = (i: number, key: keyof Module, val: any) =>
    setModules((ms) => ms.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)));

  const addQuiz = (mi: number) =>
    setModules((ms) => ms.map((m, i) => (i === mi ? { ...m, quizzes: [...m.quizzes, emptyQuiz()] } : m)));

  const setQuizField = (mi: number, qi: number, key: keyof Quiz, val: any) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi ? m : { ...m, quizzes: m.quizzes.map((q, j) => (j === qi ? { ...q, [key]: val } : q)) }
      )
    );

  const addQuestion = (mi: number, qi: number) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi ? m : {
          ...m,
          quizzes: m.quizzes.map((q, j) =>
            j !== qi ? q : { ...q, questions: [...q.questions, emptyQuestion()] }
          ),
        }
      )
    );

  const setQField = (mi: number, qi: number, ki: number, key: string, val: any) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi ? m : {
          ...m,
          quizzes: m.quizzes.map((q, j) =>
            j !== qi ? q : {
              ...q,
              questions: q.questions.map((qq, k) =>
                k !== ki ? qq : key === "options" ? { ...qq, options: val } : { ...qq, [key]: val }
              ),
            }
          ),
        }
      )
    );

  const removeQuestion = (mi: number, qi: number, ki: number) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi ? m : {
          ...m,
          quizzes: m.quizzes.map((q, j) =>
            j !== qi ? q : { ...q, questions: q.questions.filter((_, k) => k !== ki) }
          ),
        }
      )
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr("");

    const apiRoute = role === "INSTRUCTOR" ? "/api/instructor/courses" : "/api/admin/courses";

    const res = await fetch(apiRoute, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, modules }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setErr(data.error || "Failed to save course.");
      return;
    }
    // On success, redirect to the course edit page where videos can be uploaded per-module
    router.push(role === "INSTRUCTOR" ? "/instructor" : "/admin");
  };

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center gap-3 mb-8">
          <Link href={role === "INSTRUCTOR" ? "/instructor" : "/admin"}
            className="p-2 rounded-xl hover:bg-white/5 text-text-muted hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>Create New Course</h1>
            <p className="text-text-muted text-sm mt-0.5">Fill in the details below. Upload videos after saving.</p>
          </div>
        </div>

        {err && (
          <div className="mb-6 flex items-center gap-2 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{err}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Course Info */}
          <div className="glass-bright rounded-2xl border border-border p-6 space-y-5">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" /> Course Details
            </h2>

            <div className="grid gap-4">
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Course Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="e.g. Complete React Developer Course"
                  className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white placeholder:text-text-muted text-sm focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Description *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  required
                  rows={4}
                  placeholder="What will students learn? Why should they take this course?"
                  className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-white placeholder:text-text-muted text-sm resize-none focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Category *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50"
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Level *</label>
                  <select
                    value={form.level}
                    onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50"
                  >
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Thumbnail URL</label>
                  <input
                    value={form.thumbnail}
                    onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
                    placeholder="https://..."
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white placeholder:text-text-muted text-sm focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>

              {role === "ADMIN" && instructors.length > 0 && (
                <div>
                  <label className="block text-text-secondary text-sm mb-1.5">Assign Instructor</label>
                  <select
                    value={form.instructorId}
                    onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="">No instructor</option>
                    {instructors.map((ins) => (
                      <option key={ins.id} value={ins.id}>{ins.name} ({ins.email})</option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className={`w-10 h-5 rounded-full transition-colors relative ${form.isPublished ? "bg-cyan-500" : "bg-white/10"}`}
                  onClick={() => setForm((f) => ({ ...f, isPublished: !f.isPublished }))}
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${form.isPublished ? "left-5" : "left-0.5"}`} />
                </div>
                <span className="text-text-secondary text-sm">Publish immediately</span>
              </label>
            </div>
          </div>

          {/* Modules */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">Modules</h2>
              <button
                type="button"
                onClick={() => setModules((ms) => [...ms, emptyModule()])}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all"
              >
                <PlusCircle className="w-4 h-4" /> Add Module
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 flex items-start gap-2">
              <Film className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-300 text-xs">
                Videos are uploaded separately after saving the course. Only MP4 files are accepted.
                Save the course first, then use the module video upload feature.
              </p>
            </div>

            {modules.map((mod, mi) => (
              <div key={mi} className="glass-bright rounded-2xl border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedMod(expandedMod === mi ? null : mi)}
                  className="w-full flex items-center justify-between p-4 hover:bg-white/2 transition-colors"
                >
                  <span className="text-white font-medium text-sm">
                    Module {mi + 1}{mod.title ? `: ${mod.title}` : ""}
                  </span>
                  {expandedMod === mi ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                </button>

                {expandedMod === mi && (
                  <div className="px-4 pb-4 border-t border-border/50 pt-4 space-y-4">
                    <div className="grid gap-3">
                      <input
                        value={mod.title}
                        onChange={(e) => setModField(mi, "title", e.target.value)}
                        placeholder="Module title *"
                        className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white placeholder:text-text-muted text-sm focus:outline-none focus:border-cyan-500/50"
                      />
                      <textarea
                        value={mod.description}
                        onChange={(e) => setModField(mi, "description", e.target.value)}
                        rows={2}
                        placeholder="Module description (optional)"
                        className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white placeholder:text-text-muted text-sm resize-none focus:outline-none focus:border-cyan-500/50"
                      />
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="text-text-muted text-xs pt-1">Duration is detected automatically when a video is uploaded.</div>
                        <div className="flex items-center gap-3 pt-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={mod.isFree}
                              onChange={(e) => setModField(mi, "isFree", e.target.checked)}
                              className="w-4 h-4 accent-cyan-500"
                            />
                            <span className="text-text-secondary text-sm">Free preview</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Quizzes */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-white text-sm font-medium">Quizzes</h4>
                        <button
                          type="button"
                          onClick={() => addQuiz(mi)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-all"
                        >
                          + Add Quiz
                        </button>
                      </div>

                      {mod.quizzes.map((quiz, qi) => {
                        const isQExpanded = expandedQuiz?.[0] === mi && expandedQuiz?.[1] === qi;
                        return (
                          <div key={qi} className="rounded-xl border border-violet-500/20 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExpandedQuiz(isQExpanded ? null : [mi, qi])}
                              className="w-full flex items-center justify-between p-3 hover:bg-violet-500/5 transition-colors text-sm text-white"
                            >
                              <span>Quiz {qi + 1}{quiz.title ? `: ${quiz.title}` : ""}</span>
                              {isQExpanded ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
                            </button>

                            {isQExpanded && (
                              <div className="px-3 pb-3 pt-2 space-y-3 border-t border-violet-500/20">
                                <input
                                  value={quiz.title}
                                  onChange={(e) => setQuizField(mi, qi, "title", e.target.value)}
                                  placeholder="Quiz title *"
                                  className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-white placeholder:text-text-muted text-sm focus:outline-none focus:border-violet-500/50"
                                />
                                <input
                                  value={quiz.description}
                                  onChange={(e) => setQuizField(mi, qi, "description", e.target.value)}
                                  placeholder="Description (optional)"
                                  className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-white placeholder:text-text-muted text-sm focus:outline-none focus:border-violet-500/50"
                                />

                                {quiz.questions.map((q, ki) => (
                                  <div key={ki} className="p-3 rounded-lg bg-white/3 border border-border space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-secondary text-xs font-medium">Question {ki + 1}</span>
                                      {quiz.questions.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => removeQuestion(mi, qi, ki)}
                                          className="text-text-muted hover:text-red-400 transition-colors"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                    <input
                                      value={q.question}
                                      onChange={(e) => setQField(mi, qi, ki, "question", e.target.value)}
                                      placeholder="Question text *"
                                      className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-white placeholder:text-text-muted text-xs focus:outline-none"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                      {q.options.map((opt, oi) => (
                                        <div key={oi} className="flex items-center gap-1.5">
                                          <input
                                            type="radio"
                                            name={`correct-${mi}-${qi}-${ki}`}
                                            checked={q.correctAnswer === oi}
                                            onChange={() => setQField(mi, qi, ki, "correctAnswer", oi)}
                                            className="accent-emerald-500 flex-shrink-0"
                                          />
                                          <input
                                            value={opt}
                                            onChange={(e) => {
                                              const newOpts = [...q.options] as [string, string, string, string];
                                              newOpts[oi] = e.target.value;
                                              setQField(mi, qi, ki, "options", newOpts);
                                            }}
                                            placeholder={`Option ${oi + 1}`}
                                            className="flex-1 bg-white/5 border border-border rounded-lg px-2.5 py-1.5 text-white placeholder:text-text-muted text-xs focus:outline-none min-w-0"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                    <input
                                      value={q.explanation}
                                      onChange={(e) => setQField(mi, qi, ki, "explanation", e.target.value)}
                                      placeholder="Explanation (optional)"
                                      className="w-full bg-white/5 border border-border rounded-lg px-3 py-1.5 text-white placeholder:text-text-muted text-xs focus:outline-none"
                                    />
                                  </div>
                                ))}

                                <button
                                  type="button"
                                  onClick={() => addQuestion(mi, qi)}
                                  className="w-full text-xs px-3 py-2 rounded-lg border border-dashed border-border text-text-muted hover:text-white hover:border-white/30 transition-all"
                                >
                                  + Add Question
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setModules((ms) => ms.filter((_, idx) => idx !== mi))
                      }
                      className="text-red-400/70 hover:text-red-400 text-xs flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove Module
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20"
          >
            {saving ? "Saving Course…" : "Save Course"}
          </button>
        </form>
      </div>
    </main>
  );
}