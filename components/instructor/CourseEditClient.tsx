// FILE PATH: components/instructor/CourseEditClient.tsx
//
// FIXES:
//   1. readOnly prop is now properly destructured and applied — approved/published
//      courses show a read-only view instead of an editable form.
//   2. handleSubmit now sends the full modules array (with quiz data) to the PATCH
//      API, so all module and quiz edits are persisted correctly.
//   3. Video player shown inline when a module already has a videoKey.
//   4. Rejected course resubmit correctly resets approvalStatus to PENDING via API.
//
// VIDEO DURATION FIX:
//   - Removed the manual "Duration (mins)" number input per module.
//   - Duration is extracted automatically by the backend (ffprobe) when an MP4 is
//     uploaded. The upload API writes both videoDurationSecs and durationMins on
//     the module record without any instructor input.
//   - In the edit form, the duration section now shows a read-only computed display:
//       · If videoDurationSecs is set → shows "Xm Ys (auto-detected)"
//       · If durationMins is set but videoDurationSecs is null → shows "X min (manual)"
//       · If neither is set → shows "Not set — upload a video to auto-detect"
//   - After a video is successfully uploaded, the onUploaded callback refreshes
//     the module's videoKey and the parent re-renders with the updated duration
//     from the next API fetch.
//   - durationMins is still sent to the PATCH API (as the current state value)
//     because the API accumulates a totalDuration for the course; the value is
//     set correctly from the DB on page load and is NOT user-editable here.

"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, BookOpen, AlertCircle, CheckCircle,
  Film, ChevronDown, ChevronUp, PlusCircle, Trash2,
  Clock, Send, Eye,
} from "lucide-react";

const VideoUpload = dynamic(() => import("@/components/course/VideoUpload"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface Question {
  id?: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface Quiz {
  id?: string;
  title: string;
  description: string;
  passingPercentage: number;
  questions: Question[];
}

interface Module {
  id: string;
  title: string;
  description: string;
  contentMd: string;
  durationMins: number;
  isFree: boolean;
  order: number;
  videoUrl: string | null;
  videoKey: string | null;
  videoDurationSecs: number | null;
  isPublished: boolean;
  quizzes: Quiz[];
}

interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  level: string;
  price: number;
  thumbnail: string | null;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewComment: string | null;
  isPublished: boolean;
  modules: Module[];
}

interface Props {
  course: Course;
  readOnly?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  passingPercentage: 0,
  questions: [emptyQuestion()],
});

/**
 * Format a duration for display in the module card.
 * Priority: videoDurationSecs (authoritative, from ffprobe) → durationMins (legacy manual).
 */
function formatDuration(videoDurationSecs: number | null, durationMins: number): string {
  if (videoDurationSecs !== null && videoDurationSecs > 0) {
    const mins = Math.floor(videoDurationSecs / 60);
    const secs = videoDurationSecs % 60;
    return secs > 0 ? `${mins}m ${secs}s (auto-detected)` : `${mins}m (auto-detected)`;
  }
  if (durationMins > 0) {
    return `${durationMins} min`;
  }
  return "Not set — upload a video to auto-detect";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CourseEditClient({ course, readOnly = false }: Props) {
  const router = useRouter();

  // ── Form state pre-filled from existing course ─────────────────────────────
  const [form, setForm] = useState({
    title: course.title,
    description: course.description,
    category: course.category,
    level: course.level,
    price: course.price,
    thumbnail: course.thumbnail ?? "",
  });

  // ── Module state pre-filled from existing modules ──────────────────────────
  const [modules, setModules] = useState<Module[]>(
    course.modules.map((m) => ({
      ...m,
      description: m.description ?? "",
      contentMd: m.contentMd ?? "",
      quizzes: (m.quizzes ?? []).map((q: any) => ({
        id: q.id,
        title: q.title ?? "",
        description: q.description ?? "",
        passingPercentage: q.passingPercentage ?? 0,
        questions: (q.questions ?? []).map((qq: any) => ({
          id: qq.id,
          question: qq.question ?? "",
          options: (() => {
            try {
              const parsed = typeof qq.options === "string" ? JSON.parse(qq.options) : qq.options;
              return Array.isArray(parsed) ? parsed : ["", "", "", ""];
            } catch {
              return ["", "", "", ""];
            }
          })(),
          correctAnswer: qq.correctAnswer ?? 0,
          explanation: qq.explanation ?? "",
        })),
      })),
    }))
  );

  const [expandedMod, setExpandedMod] = useState<number | null>(null);
  const [expandedModuleVideo, setExpandedModuleVideo] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const isRejected = course.approvalStatus === "REJECTED";

  // ── Module field setters ───────────────────────────────────────────────────

  const setModField = (i: number, key: keyof Module, val: any) =>
    setModules((ms) => ms.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)));

  const addQuiz = (mi: number) =>
    setModules((ms) =>
      ms.map((m, i) => (i === mi ? { ...m, quizzes: [...m.quizzes, emptyQuiz()] } : m))
    );

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
        i !== mi ? m : {
          ...m,
          quizzes: m.quizzes.map((q, j) =>
            j !== qi ? q : { ...q, questions: q.questions.filter((_, k) => k !== ki) }
          ),
        }
      )
    );

  const removeQuiz = (mi: number, qi: number) =>
    setModules((ms) =>
      ms.map((m, i) =>
        i !== mi ? m : { ...m, quizzes: m.quizzes.filter((_, j) => j !== qi) }
      )
    );

  // ── Video upload handler ───────────────────────────────────────────────────
  // After upload, mark videoKey as set on the local module state.
  // videoDurationSecs will be updated on next page load from the DB;
  // for this session we show the "Video uploaded" indicator.
  const handleVideoUploaded = useCallback(
    (moduleId: string, videoUrl: string) => {
      setModules((prev) =>
        prev.map((m) =>
          m.id === moduleId
            ? { ...m, videoUrl, videoKey: `${moduleId}.mp4` }
            : m
        )
      );
      setExpandedModuleVideo(null);
      setSuccessMsg(
        "Video uploaded successfully! Duration has been auto-detected and saved. " +
        "Reload the page to see the updated duration."
      );
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    []
  );

  // ── Save handler ───────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;

    setSaving(true);
    setErr("");
    setSuccessMsg("");

    try {
      // PATCH the course metadata AND modules/quizzes together.
      // The API will automatically set approvalStatus=PENDING if course was REJECTED.
      // durationMins values in the modules array come from the current state which
      // reflects what was loaded from the DB (auto-set by the upload API).
      const res = await fetch(`/api/instructor/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          category: form.category,
          level: form.level,
          price: form.price,
          thumbnail: form.thumbnail || null,
          durationMins: modules.reduce((s, m) => s + (m.durationMins || 0), 0),
          // Send modules array so the API can persist module + quiz edits.
          // durationMins per module is NOT user-edited here — it reflects
          // the auto-detected value stored in the DB.
          modules: modules.map((m) => ({
            id: m.id,
            title: m.title,
            description: m.description || null,
            contentMd: m.contentMd || null,
            durationMins: m.durationMins || 0,
            isFree: m.isFree,
            quizzes: m.quizzes.map((q) => ({
              id: q.id,
              title: q.title,
              description: q.description || null,
              passingPercentage: q.passingPercentage || 0,
              questions: q.questions.map((qq) => ({
                id: qq.id,
                question: qq.question,
                options: qq.options,
                correctAnswer: qq.correctAnswer,
                explanation: qq.explanation || "",
              })),
            })),
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErr(data.error || "Failed to save course.");
        return;
      }

      if (isRejected) {
        setSuccessMsg(
          "Course resubmitted for admin review! You will be notified of the decision."
        );
      } else {
        setSuccessMsg("Course saved successfully! All modules and quizzes have been updated.");
      }

      setTimeout(() => router.push("/instructor"), 2000);
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2.5 bg-white/5 rounded-xl border border-border text-white text-sm " +
    "placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 transition-all";

  const readOnlyCls =
    "w-full px-3 py-2.5 bg-white/2 rounded-xl border border-border/50 text-text-secondary text-sm cursor-not-allowed";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-4">

        {/* Back button & header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/instructor"
            className="p-2 rounded-xl hover:bg-white/5 text-text-muted hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1
              className="text-2xl font-black text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {readOnly
                ? "Course Overview"
                : isRejected
                ? "Edit & Resubmit Course"
                : "Edit Course"}
            </h1>
            <p className="text-text-muted text-sm mt-0.5">
              {readOnly
                ? "This course is approved. Contact admin for changes."
                : isRejected
                ? "Address the admin's feedback below, then save to resubmit for review."
                : "Update your course details and modules. All changes are saved together."}
            </p>
          </div>
        </div>

        {/* Read-only notice for approved/published courses */}
        {readOnly && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/30">
            <Eye className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-400 font-semibold text-sm">Course Approved — Read Only</p>
              <p className="text-blue-300/80 text-sm mt-1">
                This course has been approved{course.isPublished ? " and published" : ""}.
                The content is locked. Contact an admin if you need to make changes.
              </p>
            </div>
          </div>
        )}

        {/* Rejection feedback banner */}
        {isRejected && course.reviewComment && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-semibold text-sm">Admin Feedback</p>
              <p className="text-red-300/80 text-sm mt-1 leading-relaxed">
                {course.reviewComment}
              </p>
              <p className="text-red-300/50 text-xs mt-2">
                Please address this feedback, then save to resubmit for review.
              </p>
            </div>
          </div>
        )}

        {/* Pending notice */}
        {course.approvalStatus === "PENDING" && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
            <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-400 font-semibold text-sm">Awaiting Admin Review</p>
              <p className="text-amber-300/80 text-sm mt-1">
                This course is under review. You can still edit it — saving will update the submitted version.
              </p>
            </div>
          </div>
        )}

        {/* Error/success banners */}
        {err && (
          <div className="mb-6 flex items-center gap-2 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{err}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-6 flex items-center gap-2 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Course Details ─────────────────────────────────────────────── */}
          <div className="glass-bright rounded-2xl border border-border p-6 space-y-5">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" /> Course Details
            </h2>

            <div>
              <label className="block text-text-secondary text-sm mb-1.5">Course Title *</label>
              {readOnly ? (
                <div className={readOnlyCls}>{form.title}</div>
              ) : (
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="e.g. Complete React Developer Course"
                  className={inputCls}
                />
              )}
            </div>

            <div>
              <label className="block text-text-secondary text-sm mb-1.5">Description *</label>
              {readOnly ? (
                <div className={readOnlyCls + " min-h-[80px] whitespace-pre-wrap"}>{form.description}</div>
              ) : (
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  required
                  rows={4}
                  placeholder="What will students learn?"
                  className={inputCls + " resize-y min-h-[100px]"}
                />
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Category *</label>
                {readOnly ? (
                  <div className={readOnlyCls}>{form.category}</div>
                ) : (
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className={inputCls}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Level *</label>
                {readOnly ? (
                  <div className={readOnlyCls}>{form.level}</div>
                ) : (
                  <select
                    value={form.level}
                    onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                    className={inputCls}
                  >
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Price (₹)</label>
                {readOnly ? (
                  <div className={readOnlyCls}>{form.price === 0 ? "Free" : `₹${form.price}`}</div>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: parseInt(e.target.value) || 0 }))}
                    className={inputCls}
                  />
                )}
              </div>
              <div>
                <label className="block text-text-secondary text-sm mb-1.5">Thumbnail URL</label>
                {readOnly ? (
                  <div className={readOnlyCls + " truncate"}>{form.thumbnail || "None"}</div>
                ) : (
                  <input
                    type="url"
                    value={form.thumbnail}
                    onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
                    placeholder="https://..."
                    className={inputCls}
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Modules ───────────────────────────────────────────────────── */}
          <div className="glass-bright rounded-2xl border border-border p-6 space-y-4">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <Film className="w-5 h-5 text-violet-400" /> Modules
              <span className="text-text-muted text-sm font-normal">({modules.length})</span>
            </h2>

            {modules.length === 0 && (
              <p className="text-text-muted text-sm text-center py-6">
                No modules in this course.
              </p>
            )}

            {modules.map((mod, mi) => {
              const isExpanded = expandedMod === mi;
              return (
                <div key={mod.id} className="glass rounded-xl border border-border overflow-hidden">
                  {/* Module header */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/2 transition-colors"
                    onClick={() => setExpandedMod(isExpanded ? null : mi)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-text-muted text-xs w-5 text-center font-mono">{mod.order}</span>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{mod.title || `Module ${mi + 1}`}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted flex-wrap">
                          {mod.videoKey ? (
                            <span className="text-violet-400 flex items-center gap-1">
                              <Film className="w-3 h-3" /> Video uploaded
                              {mod.videoDurationSecs != null && mod.videoDurationSecs > 0 && (
                                <span className="text-text-muted ml-1">
                                  ({Math.floor(mod.videoDurationSecs / 60)}m
                                  {mod.videoDurationSecs % 60 > 0 ? ` ${mod.videoDurationSecs % 60}s` : ""})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-text-muted/50">No video</span>
                          )}
                          {mod.quizzes.length > 0 && (
                            <span className="text-amber-400">
                              {mod.quizzes.length} quiz{mod.quizzes.length !== 1 ? "zes" : ""}
                            </span>
                          )}
                          {mod.isFree && (
                            <span className="text-emerald-400">Free preview</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
                    )}
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/50 p-4 space-y-4">

                      {/* Module title */}
                      <div>
                        <label className="text-text-muted text-xs mb-1 block">Module Title</label>
                        {readOnly ? (
                          <div className={readOnlyCls}>{mod.title}</div>
                        ) : (
                          <input
                            className={inputCls}
                            value={mod.title}
                            onChange={(e) => setModField(mi, "title", e.target.value)}
                            placeholder={`Module ${mi + 1} title`}
                          />
                        )}
                      </div>

                      {/* Description */}
                      <div>
                        <label className="text-text-muted text-xs mb-1 block">Description</label>
                        {readOnly ? (
                          <div className={readOnlyCls + " min-h-[50px] whitespace-pre-wrap"}>{mod.description || "—"}</div>
                        ) : (
                          <textarea
                            className={inputCls + " min-h-[60px] resize-y"}
                            value={mod.description}
                            onChange={(e) => setModField(mi, "description", e.target.value)}
                            placeholder="Brief module overview"
                          />
                        )}
                      </div>

                      {/* Content Markdown */}
                      <div>
                        <label className="text-text-muted text-xs mb-1 block">Content (Markdown)</label>
                        {readOnly ? (
                          <div className={readOnlyCls + " min-h-[60px] font-mono text-xs whitespace-pre-wrap"}>{mod.contentMd || "—"}</div>
                        ) : (
                          <textarea
                            className={inputCls + " min-h-[80px] resize-y font-mono text-xs"}
                            value={mod.contentMd}
                            onChange={(e) => setModField(mi, "contentMd", e.target.value)}
                            placeholder="# Lesson content..."
                          />
                        )}
                      </div>

                      {/* Duration (read-only, auto-detected) + Free preview toggle */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-text-muted text-xs mb-1 block flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Duration
                          </label>
                          {/* Duration is always read-only — set automatically from uploaded video. */}
                          <div className={`${readOnlyCls} text-xs`}>
                            {formatDuration(mod.videoDurationSecs, mod.durationMins)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-5">
                          <input
                            type="checkbox"
                            id={`free-${mi}`}
                            checked={mod.isFree}
                            disabled={readOnly}
                            onChange={(e) => !readOnly && setModField(mi, "isFree", e.target.checked)}
                            className="accent-cyan-500"
                          />
                          <label
                            htmlFor={`free-${mi}`}
                            className={`text-xs ${readOnly ? "text-text-muted/50" : "text-text-muted cursor-pointer"}`}
                          >
                            Free preview module
                          </label>
                        </div>
                      </div>

                      {/* Video section */}
                      <div className="pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-text-muted text-xs font-medium uppercase tracking-wider">Video</p>
                          {mod.videoKey && (
                            <button
                              type="button"
                              onClick={() => setPlayingVideo(playingVideo === mod.id ? null : mod.id)}
                              className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                            >
                              <Film className="w-3 h-3" />
                              {playingVideo === mod.id ? "Hide Video" : "Preview Video"}
                            </button>
                          )}
                        </div>

                        {/* Inline video preview */}
                        {mod.videoKey && playingVideo === mod.id && (
                          <div className="mb-3 rounded-xl overflow-hidden bg-black border border-border/50">
                            <video
                              src={`/api/video/${mod.id}/stream`}
                              controls
                              controlsList="nodownload"
                              className="w-full max-h-56 object-contain"
                              preload="metadata"
                            >
                              Your browser does not support the video tag.
                            </video>
                          </div>
                        )}

                        {/* Video status + replace/upload controls */}
                        {mod.videoKey ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-violet-400 flex items-center gap-1">
                              <Film className="w-3 h-3" /> Video uploaded
                              {mod.videoDurationSecs != null && mod.videoDurationSecs > 0 && (
                                <span className="text-text-muted ml-1">
                                  ({Math.floor(mod.videoDurationSecs / 60)}m
                                  {mod.videoDurationSecs % 60 > 0 ? ` ${mod.videoDurationSecs % 60}s` : ""})
                                </span>
                              )}
                            </span>
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedModuleVideo(
                                    expandedModuleVideo === mod.id ? null : mod.id
                                  )
                                }
                                className="text-xs text-text-muted hover:text-white transition-colors"
                              >
                                Replace video
                              </button>
                            )}
                          </div>
                        ) : (
                          !readOnly && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedModuleVideo(
                                  expandedModuleVideo === mod.id ? null : mod.id
                                )
                              }
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/25 transition-all"
                            >
                              <Film className="w-3.5 h-3.5" /> Upload Video
                            </button>
                          )
                        )}

                        {expandedModuleVideo === mod.id && !readOnly && (
                          <div className="mt-3">
                            <VideoUpload
                              moduleId={mod.id}
                              currentVideoUrl={mod.videoUrl}
                              onUploaded={(videoUrl) => handleVideoUploaded(mod.id, videoUrl)}
                            />
                          </div>
                        )}
                      </div>

                      {/* Quizzes */}
                      <div className="pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-text-muted text-xs font-medium uppercase tracking-wider">
                            Quizzes ({mod.quizzes.length})
                          </p>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => addQuiz(mi)}
                              className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                            >
                              <PlusCircle className="w-3 h-3" /> Add Quiz
                            </button>
                          )}
                        </div>
                        {mod.quizzes.length === 0 && (
                          <p className="text-text-muted/60 text-xs">
                            {readOnly ? "No quizzes for this module." : "No quizzes yet. Click 'Add Quiz' to create one."}
                          </p>
                        )}
                        {mod.quizzes.map((quiz, qi) => (
                          <div key={qi} className="border border-border/50 rounded-lg p-3 mb-2 space-y-2">
                            <div className="flex items-center gap-2">
                              {readOnly ? (
                                <div className={readOnlyCls + " flex-1"}>{quiz.title}</div>
                              ) : (
                                <input
                                  className={inputCls + " flex-1"}
                                  value={quiz.title}
                                  onChange={(e) => setQuizField(mi, qi, "title", e.target.value)}
                                  placeholder="Quiz title"
                                />
                              )}
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => removeQuiz(mi, qi)}
                                  className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {quiz.questions.map((q, ki) => (
                              <div key={ki} className="bg-white/2 rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-text-muted font-mono w-4">Q{ki + 1}</span>
                                  {readOnly ? (
                                    <div className={readOnlyCls + " flex-1 text-xs"}>{q.question}</div>
                                  ) : (
                                    <input
                                      className={inputCls + " flex-1"}
                                      value={q.question}
                                      onChange={(e) =>
                                        setQField(mi, qi, ki, "question", e.target.value)
                                      }
                                      placeholder="Question"
                                    />
                                  )}
                                  {!readOnly && quiz.questions.length > 1 && (
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
                                        disabled={readOnly}
                                        onChange={() => !readOnly && setQField(mi, qi, ki, "correctAnswer", oi)}
                                        className="accent-emerald-500 flex-shrink-0"
                                      />
                                      {readOnly ? (
                                        <div className={`text-xs px-2 py-1 rounded bg-white/3 border border-border/30 text-text-secondary flex-1 ${q.correctAnswer === oi ? "border-emerald-500/30 text-emerald-300" : ""}`}>
                                          {opt || `Option ${oi + 1}`}
                                        </div>
                                      ) : (
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
                                      )}
                                    </div>
                                  ))}
                                </div>
                                {readOnly ? (
                                  q.explanation && (
                                    <p className="text-text-muted text-xs italic">{q.explanation}</p>
                                  )
                                ) : (
                                  <input
                                    className={inputCls + " text-xs"}
                                    value={q.explanation}
                                    onChange={(e) =>
                                      setQField(mi, qi, ki, "explanation", e.target.value)
                                    }
                                    placeholder="Explanation (optional)"
                                  />
                                )}
                              </div>
                            ))}
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() => addQuestion(mi, qi)}
                                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                              >
                                <PlusCircle className="w-3 h-3" /> Add Question
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3">
            <Link
              href="/instructor"
              className="px-5 py-2.5 rounded-xl border border-border text-text-muted hover:text-white hover:border-white/20 transition-all text-sm"
            >
              {readOnly ? "Back to Dashboard" : "Cancel"}
            </Link>
            {!readOnly && (
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>Saving…</>
                ) : isRejected ? (
                  <><Send className="w-4 h-4" /> Resubmit for Review</>
                ) : (
                  <><CheckCircle className="w-4 h-4" /> Save Changes</>
                )}
              </button>
            )}
          </div>

        </form>
      </div>
    </main>
  );
}