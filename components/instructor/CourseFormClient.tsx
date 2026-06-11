// FILE PATH: components/instructor/CourseFormClient.tsx
//
// APPROVAL WORKFLOW:
//   - Removed "Publish immediately" toggle. Instructors cannot publish.
//   - All courses submit as PENDING for admin review.
//   - Shows a clear "Pending Admin Review" notice at the bottom of the form.
//   - Fixed: Props interface includes `instructors` field so admin new-course page
//     can pass instructors={[]} without a TypeScript error.
//
// VIDEO DURATION FIX:
//   - Removed the manual "Duration (mins)" input per module.
//   - Duration is extracted automatically from the uploaded MP4 by the backend
//     (ffprobe) and written to both videoDurationSecs and durationMins on the
//     module record. Instructors never need to enter duration.
//   - On the new-course form there is no video upload step (videos are uploaded
//     per-module after the course is created via the Edit Course / Dashboard
//     video upload widget). The duration field is therefore entirely absent here.
//   - durationMins is still kept in the Module interface and sent to the API as 0
//     so the API schema is satisfied; the real value is populated on first upload.

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PlusCircle, Trash2, ChevronDown, ChevronUp,
  BookOpen, ArrowLeft, AlertCircle, Film,
} from "lucide-react";

interface Question {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface Quiz {
  title: string;
  description: string;
  questions: Question[];
}

interface Module {
  title: string;
  description: string;
  contentMd: string;
  durationMins: number; // always 0 on create; auto-set by backend after video upload
  isFree: boolean;
  quizzes: Quiz[];
}

// ── Props ─────────────────────────────────────────────────────────────────────
// `instructors` is used by the Admin "new course" page to assign an instructor.
// For the Instructor portal it is always an empty array.
// `role` controls which API endpoint is used and whether an instructor picker is shown.

interface Props {
  instructors: { id: string; name: string; email: string }[];
  role: string;
}

const CATEGORIES = [
  "Programming", "Design", "Business", "Marketing",
  "Data Science", "DevOps", "Other",
];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

const emptyQuestion = (): Question => ({
  question: "",
  options: ["", "", "", ""],
  correctAnswer: 0,
  explanation: "",
});

const emptyQuiz = (): Quiz => ({
  title: "",
  description: "",
  questions: [emptyQuestion()],
});

const emptyModule = (): Module => ({
  title: "",
  description: "",
  contentMd: "",
  durationMins: 0,   // will be overwritten by upload API once a video is uploaded
  isFree: false,
  quizzes: [],
});

export default function CourseFormClient({ instructors = [], role = "INSTRUCTOR" }: Props) {
  const router = useRouter();
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState("");
  const [expandedModules, setExpandedModules] = useState<number[]>([0]);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Programming",
    level: "Beginner",
    price: 0,
    thumbnail: "",
    instructorId: "",
  });
  const [modules, setModules] = useState<Module[]>([emptyModule()]);

  const setModField = (i: number, key: keyof Module, val: any) =>
    setModules((ms) => ms.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)));

  const addQuiz = (mi: number) =>
    setModules((ms) =>
      ms.map((m, i) => (i === mi ? { ...m, quizzes: [...m.quizzes, emptyQuiz()] } : m))
    );

  const setQuizField = (mi: number, qi: number, key: keyof Quiz, val: any) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi
          ? m
          : { ...m, quizzes: m.quizzes.map((q, j) => (j === qi ? { ...q, [key]: val } : q)) }
      )
    );

  const addQuestion = (mi: number, qi: number) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi
          ? m
          : {
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
        i !== mi
          ? m
          : {
              ...m,
              quizzes: m.quizzes.map((q, j) =>
                j !== qi
                  ? q
                  : {
                      ...q,
                      questions: q.questions.map((qq, k) =>
                        k !== ki
                          ? qq
                          : key === "options"
                          ? { ...qq, options: val }
                          : { ...qq, [key]: val }
                      ),
                    }
              ),
            }
      )
    );

  const removeQuestion = (mi: number, qi: number, ki: number) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi
          ? m
          : {
              ...m,
              quizzes: m.quizzes.map((q, j) =>
                j !== qi ? q : { ...q, questions: q.questions.filter((_, k) => k !== ki) }
              ),
            }
      )
    );

  const toggleModule = (i: number) =>
    setExpandedModules((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr("");

    const apiRoute =
      role === "INSTRUCTOR" ? "/api/instructor/courses" : "/api/admin/courses";

    const res = await fetch(apiRoute, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // isPublished is NOT sent — instructor cannot publish; courses start PENDING.
      // durationMins is 0 on create; the upload API overwrites it when a video
      // is uploaded, so instructors never need to type a duration.
      body: JSON.stringify({ ...form, modules }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setErr(data.error || "Failed to create course.");
      return;
    }

    router.push(role === "ADMIN" ? "/admin" : "/instructor");
  };

  const inputCls =
    "w-full px-3 py-2.5 glass rounded-xl border border-border text-white text-sm " +
    "placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 transition-all";

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href={role === "ADMIN" ? "/admin" : "/instructor"}
            className="text-text-muted hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-white">Create New Course</h1>
            <p className="text-text-muted text-sm mt-0.5">
              {role === "INSTRUCTOR"
                ? "Your course will be submitted for admin review before going live."
                : "Admin-created courses are pre-approved and can be published immediately."}
            </p>
          </div>
        </div>

        {err && (
          <div className="mb-6 flex items-center gap-2 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{err}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── Course Details ─────────────────────────────────────────────── */}
          <div className="glass-bright rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" /> Course Details
            </h2>

            <div>
              <label className="block text-text-secondary text-sm mb-1.5">Course Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                placeholder="e.g. Complete React Developer Course"
                className={inputCls}
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
                className={inputCls + " resize-y min-h-[100px]"}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Category *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className={inputCls}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Level *</label>
                <select
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                  className={inputCls}
                >
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Price (₹) — 0 = Free</label>
                <input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: parseInt(e.target.value) || 0 }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Thumbnail URL</label>
                <input
                  type="url"
                  value={form.thumbnail}
                  onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
                  placeholder="https://..."
                  className={inputCls}
                />
              </div>
            </div>

            {/* Admin-only: assign instructor */}
            {role === "ADMIN" && instructors.length > 0 && (
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Assign Instructor</label>
                <select
                  value={form.instructorId}
                  onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">— No instructor assigned —</option>
                  {instructors.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({inst.email})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── Modules ───────────────────────────────────────────────────── */}
          <div className="glass-bright rounded-2xl border border-border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">Modules</h2>
              <button
                type="button"
                onClick={() => {
                  const newIdx = modules.length;
                  setModules((ms) => [...ms, emptyModule()]);
                  setExpandedModules((prev) => [...prev, newIdx]);
                }}
                className="flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <PlusCircle className="w-4 h-4" /> Add Module
              </button>
            </div>

            {/* Video upload notice */}
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
              <Film className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
              <p className="text-violet-300/80 text-xs leading-relaxed">
                Videos are uploaded per module after the course is created.
                Use the <strong className="text-violet-300">Instructor Dashboard → Course → Upload Video</strong> button
                on each module. Duration is detected automatically from the MP4 file — no manual entry needed.
              </p>
            </div>

            {modules.map((mod, mi) => {
              const isExpanded = expandedModules.includes(mi);
              return (
                <div key={mi} className="glass rounded-xl border border-border overflow-hidden">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/2 transition-colors"
                    onClick={() => toggleModule(mi)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted text-xs font-mono w-5">{mi + 1}</span>
                      <p className="text-white text-sm font-medium">
                        {mod.title || `Module ${mi + 1}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {modules.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModules((ms) => ms.filter((_, i) => i !== mi));
                            setExpandedModules((prev) =>
                              prev.filter((x) => x !== mi).map((x) => (x > mi ? x - 1 : x))
                            );
                          }}
                          className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-text-muted" />
                        : <ChevronDown className="w-4 h-4 text-text-muted" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border p-4 space-y-3">
                      {/* Module Title */}
                      <div>
                        <label className="text-text-muted text-xs mb-1 block">Module Title *</label>
                        <input
                          className={inputCls}
                          value={mod.title}
                          onChange={(e) => setModField(mi, "title", e.target.value)}
                          placeholder={`Module ${mi + 1} title`}
                        />
                      </div>

                      {/* Description */}
                      <div>
                        <label className="text-text-muted text-xs mb-1 block">Description</label>
                        <textarea
                          className={inputCls + " min-h-[60px] resize-y"}
                          value={mod.description}
                          onChange={(e) => setModField(mi, "description", e.target.value)}
                          placeholder="Brief module overview"
                        />
                      </div>

                      {/* Content MD */}
                      <div>
                        <label className="text-text-muted text-xs mb-1 block">Content (Markdown)</label>
                        <textarea
                          className={inputCls + " min-h-[80px] resize-y font-mono text-xs"}
                          value={mod.contentMd}
                          onChange={(e) => setModField(mi, "contentMd", e.target.value)}
                          placeholder="# Lesson content..."
                        />
                      </div>

                      {/* Free preview toggle — duration field intentionally removed */}
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`free-${mi}`}
                          checked={mod.isFree}
                          onChange={(e) => setModField(mi, "isFree", e.target.checked)}
                          className="accent-cyan-500"
                        />
                        <label htmlFor={`free-${mi}`} className="text-text-muted text-xs cursor-pointer">
                          Free preview module (accessible without enrollment)
                        </label>
                      </div>

                      {/* Video upload reminder */}
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/3 border border-border/50">
                        <Film className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                        <p className="text-text-muted text-xs">
                          Video upload available after course creation via the Dashboard.
                          Duration is read automatically from the MP4.
                        </p>
                      </div>

                      {/* Quizzes */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-text-muted text-xs font-medium uppercase tracking-wider">
                            Quizzes
                          </p>
                          <button
                            type="button"
                            onClick={() => addQuiz(mi)}
                            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            <PlusCircle className="w-3 h-3" /> Add Quiz
                          </button>
                        </div>
                        {mod.quizzes.map((quiz, qi) => (
                          <div key={qi} className="border border-border/50 rounded-lg p-3 mb-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                className={inputCls + " flex-1"}
                                value={quiz.title}
                                onChange={(e) => setQuizField(mi, qi, "title", e.target.value)}
                                placeholder="Quiz title"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setModules((ms) =>
                                    ms.map((m, i) =>
                                      i !== mi
                                        ? m
                                        : { ...m, quizzes: m.quizzes.filter((_, j) => j !== qi) }
                                    )
                                  )
                                }
                                className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {quiz.questions.map((q, ki) => (
                              <div key={ki} className="bg-white/2 rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-text-muted font-mono w-4">Q{ki + 1}</span>
                                  <input
                                    className={inputCls + " flex-1"}
                                    value={q.question}
                                    onChange={(e) =>
                                      setQField(mi, qi, ki, "question", e.target.value)
                                    }
                                    placeholder="Question"
                                  />
                                  {quiz.questions.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeQuestion(mi, qi, ki)}
                                      className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className="flex items-center gap-1.5">
                                      <input
                                        type="radio"
                                        name={`correct-${mi}-${qi}-${ki}`}
                                        checked={q.correctAnswer === oi}
                                        onChange={() =>
                                          setQField(mi, qi, ki, "correctAnswer", oi)
                                        }
                                        className="accent-emerald-500 flex-shrink-0"
                                      />
                                      <input
                                        className={inputCls + " text-xs py-1.5"}
                                        value={opt}
                                        onChange={(e) => {
                                          const newOpts = [...q.options];
                                          newOpts[oi] = e.target.value;
                                          setQField(mi, qi, ki, "options", newOpts);
                                        }}
                                        placeholder={`Option ${oi + 1}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                                <input
                                  className={inputCls + " text-xs"}
                                  value={q.explanation}
                                  onChange={(e) =>
                                    setQField(mi, qi, ki, "explanation", e.target.value)
                                  }
                                  placeholder="Explanation (optional)"
                                />
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => addQuestion(mi, qi)}
                              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                            >
                              <PlusCircle className="w-3 h-3" /> Add Question
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* APPROVAL WORKFLOW: No publish toggle for instructors. */}
          {role === "INSTRUCTOR" && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-semibold text-sm">Pending Admin Review</p>
                <p className="text-amber-300/70 text-xs mt-0.5">
                  Your course will be submitted for review. An admin will approve or reject it
                  and you will be notified. Only approved courses can be published for students.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link
              href={role === "ADMIN" ? "/admin" : "/instructor"}
              className="px-5 py-2.5 rounded-xl border border-border text-text-muted hover:text-white hover:border-white/20 transition-all text-sm"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? "Submitting…"
                : role === "INSTRUCTOR"
                ? "Submit for Review"
                : "Create Course"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}