// FILE PATH: components/instructor/InstructorDashboardClient.tsx
//
// APPROVAL WORKFLOW CHANGES:
//   - Course interface updated: added approvalStatus, reviewComment fields.
//   - handleTogglePublish REMOVED. Instructors cannot publish/unpublish courses.
//     Only admins can publish after approving.
//   - Course card status badge now reflects: Pending Review / Approved (Not Live)
//     / Published / Rejected — instead of just Draft / Published.
//   - Publish/Unpublish button REMOVED from course card.
//   - Rejection feedback (reviewComment) shown inline on rejected courses.
//   - "Awaiting admin review" notice shown on pending courses.
//   - "Approved — admin will publish" notice shown on approved-but-not-live courses.
//
// VIDEO SYSTEM FIXES IN THIS VERSION:
//   - Bug Fix: When a module has videoKey set, the dashboard previously showed
//     only a static "Video uploaded" text with NO way to preview or replace.
//     Now: shows "Preview Video" toggle (inline <video> element) and a "Replace
//     Video" button that opens the VideoUpload widget.
//   - Bug Fix: When a module has videoKey set but the physical file is missing
//     on disk (stream endpoint returns 404), the inline video preview detects
//     this via an onerror handler and shows a "File missing — re-upload required"
//     warning. The "Replace Video" button becomes "Re-upload Required" (highlighted
//     in red) to draw the instructor's attention.
//   - The VideoUpload widget is shown for BOTH the "no video yet" case AND the
//     "replace video" case, so instructors can always upload from the dashboard.

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  BookOpen, Users, BarChart3, PlusCircle, GraduationCap,
  CheckCircle, Film, AlertCircle, ChevronDown, ChevronUp,
  MessageSquare, Star, RefreshCw, Pin, CheckCircle2,
  Trash2, Send, Lock, Clock, Inbox, Eye, EyeOff,
} from "lucide-react";
import InstructorStudentsClient from "./InstructorStudentsClient";

const VideoUpload = dynamic(() => import("@/components/course/VideoUpload"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface Quiz {
  id: string;
  title: string;
  _count: { questions: number; attempts: number };
}

interface Module {
  id: string;
  title: string;
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
  isPublished: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewComment?: string | null;
  instructor: { name: string } | null;
  _count: { enrollments: number; modules: number };
  modules: Module[];
}

interface DiscussionItem {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  isResolved: boolean;
  replyCount: number;
  createdAt: string;
  author: { id: string; name: string | null; role: string };
  course: { id: string; title: string; slug: string };
  _count?: { replies: number };
}

interface Reply {
  id: string;
  body: string;
  isInstructorReply: boolean;
  createdAt: string;
  author: { id: string; name: string | null; image: string | null; role: string };
}

interface FeedbackItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  user: { id: string; name: string | null; image: string | null };
  course: { id: string; title: string };
}

interface DiscussionStats {
  total: number;
  pending: number;
  resolved: number;
}

interface AdminMessageItem {
  id: string;
  body: string;
  senderRole: string;
  isReadByRecipient: boolean;
  isReadByAdmin: boolean;
  createdAt: string;
}

interface Props {
  instructor: { name: string; email: string; specialization?: string | null };
  courses: Course[];
  unreadMessages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StarDisplay({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= value ? "fill-amber-400 text-amber-400" : "text-white/20"}`}
        />
      ))}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(dateStr).toLocaleDateString();
}

function ReplyAvatar({ name, role }: { name: string | null; role: string }) {
  const initials = (name || "?")[0].toUpperCase();
  const gradient =
    role === "INSTRUCTOR" || role === "ADMIN"
      ? "from-violet-500 to-purple-600"
      : "from-cyan-500 to-blue-600";
  return (
    <div
      className={`w-7 h-7 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}
    >
      {initials}
    </div>
  );
}

// ─── Approval status badge ────────────────────────────────────────────────────

function ApprovalBadge({ course }: { course: Course }) {
  if (course.isPublished) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
        Published
      </span>
    );
  }
  if (course.approvalStatus === "PENDING") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25">
        Pending Review
      </span>
    );
  }
  if (course.approvalStatus === "APPROVED") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-500/15 text-blue-400 border border-blue-500/25">
        Approved — Not Live
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-400 border border-red-500/25">
      Rejected
    </span>
  );
}

// ─── Approval status notice ───────────────────────────────────────────────────

function ApprovalNotice({ course }: { course: Course }) {
  if (course.isPublished) return null;

  if (course.approvalStatus === "PENDING") {
    return (
      <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
        <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-amber-300/80 text-xs">
          Awaiting admin review. You will be notified once a decision is made.
        </p>
      </div>
    );
  }

  if (course.approvalStatus === "APPROVED") {
    return (
      <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/15">
        <CheckCircle className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-blue-300/80 text-xs">
          Approved! The admin will publish this course when ready.
        </p>
      </div>
    );
  }

  if (course.approvalStatus === "REJECTED" && course.reviewComment) {
    return (
      <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15">
        <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-400 text-xs font-medium">Admin Feedback:</p>
          <p className="text-red-300/80 text-xs mt-0.5">{course.reviewComment}</p>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Module Video Section ──────────────────────────────────────────────────────
// A self-contained component for each module's video state in the instructor dashboard.
// Handles: no video, video uploaded + preview, video uploaded but file missing, replace flow.

function ModuleVideoSection({
  mod,
  courseId,
  onVideoUploaded,
}: {
  mod: Module;
  courseId: string;
  onVideoUploaded: (courseId: string, moduleId: string, videoUrl: string) => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // FIX: Track whether the stream endpoint signals a missing file
  const [fileMissing, setFileMissing] = useState(false);

  // When the module changes (e.g. after upload replaces key), reset states
  useEffect(() => {
    setFileMissing(false);
    setShowPreview(false);
    setShowUpload(false);
  }, [mod.videoKey]);

  const handleVideoError = useCallback(() => {
    // The stream endpoint returns X-Video-File-Missing: true or a 404 body
    // when the file doesn't exist. The <video> element fires onerror in this case.
    // We set fileMissing=true so the UI shows the re-upload prompt.
    setFileMissing(true);
    setShowPreview(false);
  }, []);

  if (!mod.videoKey) {
    // No video yet
    return (
      <div className="mt-2">
        {!showUpload ? (
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/25 transition-all"
          >
            <Film className="w-3.5 h-3.5" /> Upload Video
          </button>
        ) : (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-muted text-xs">Upload MP4 video for this module:</p>
              <button
                onClick={() => setShowUpload(false)}
                className="text-text-muted text-xs hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
            <VideoUpload
              moduleId={mod.id}
              onUploaded={(videoUrl) => {
                onVideoUploaded(courseId, mod.id, videoUrl);
                setShowUpload(false);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Video key exists — check file status
  return (
    <div className="mt-2 space-y-2">
      {/* FIX: File-missing warning — shown when stream returns 404 for the file */}
      {fileMissing && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/25">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-xs font-semibold">Video file missing</p>
            <p className="text-red-300/70 text-xs mt-0.5">
              The video record exists in the database but the file was not found on the server.
              Please re-upload the video.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {/* Status badge */}
        {fileMissing ? (
          <span className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> File missing
          </span>
        ) : (
          <span className="text-xs text-violet-400 flex items-center gap-1">
            <Film className="w-3 h-3" /> Video uploaded
            {mod.videoDurationSecs && (
              <span className="text-text-muted ml-1">
                ({Math.round(mod.videoDurationSecs / 60)}m {mod.videoDurationSecs % 60}s)
              </span>
            )}
          </span>
        )}

        {/* FIX: Preview toggle button — always available for uploaded videos */}
        {!fileMissing && (
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-white transition-colors"
          >
            {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showPreview ? "Hide Preview" : "Preview"}
          </button>
        )}

        {/* Replace / Re-upload button */}
        <button
          onClick={() => setShowUpload(!showUpload)}
          className={`flex items-center gap-1 text-xs transition-colors ${
            fileMissing
              ? "text-red-400 hover:text-red-300 font-semibold"
              : "text-text-muted hover:text-white"
          }`}
        >
          <Film className="w-3 h-3" />
          {showUpload ? "Cancel" : fileMissing ? "Re-upload Video" : "Replace Video"}
        </button>
      </div>

      {/* FIX: Inline video preview with error detection */}
      {showPreview && !showUpload && (
        <div className="rounded-xl overflow-hidden bg-black border border-border/50">
          <video
            src={`/api/video/${mod.id}/stream`}
            controls
            controlsList="nodownload"
            className="w-full max-h-48 object-contain"
            preload="metadata"
            onError={handleVideoError}
          >
            Your browser does not support the video tag.
          </video>
          <p className="text-text-muted text-xs px-3 py-1.5 bg-black/30">
            {mod.title}
          </p>
        </div>
      )}

      {/* Upload widget for replace/re-upload */}
      {showUpload && (
        <div>
          <VideoUpload
            moduleId={mod.id}
            currentVideoUrl={mod.videoUrl}
            onUploaded={(videoUrl) => {
              onVideoUploaded(courseId, mod.id, videoUrl);
              setShowUpload(false);
              setFileMissing(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Toast Notification ────────────────────────────────────────────────────────

function Toast({
  message,
  type,
  onDismiss,
}: {
  message: string;
  type: "success" | "error";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl text-sm font-medium animate-in slide-in-from-bottom-4 duration-300 ${
        type === "success"
          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
          : "bg-red-500/20 border-red-500/40 text-red-300"
      }`}
    >
      {type === "success" ? (
        <CheckCircle className="w-4 h-4 flex-shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
      )}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100 transition-opacity">
        ✕
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InstructorDashboardClient({
  instructor,
  courses: initialCourses,
  unreadMessages,
}: Props) {
  const [tab, setTab] = useState<"courses" | "students" | "discussions" | "feedback" | "messages">("courses");
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  // Discussions state
  const [discussions, setDiscussions] = useState<DiscussionItem[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [discussionsError, setDiscussionsError] = useState("");
  const [discussionStats, setDiscussionStats] = useState<DiscussionStats>({ total: 0, pending: 0, resolved: 0 });
  const [activeDiscussion, setActiveDiscussion] = useState<DiscussionItem | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [filterResolved, setFilterResolved] = useState<boolean | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Feedback state
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  // Messages state
  const [messages, setMessages] = useState<AdminMessageItem[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const totalVideos = courses.reduce(
    (s, c) => s + c.modules.filter((m) => !!m.videoKey).length,
    0
  );
  const totalStudents = courses.reduce((s, c) => s + c._count.enrollments, 0);

  // ── Video upload handler ──────────────────────────────────────────────────

  const handleVideoUploaded = useCallback(
    (courseId: string, moduleId: string, videoUrl: string) => {
      setCourses((prev) =>
        prev.map((c) =>
          c.id !== courseId ? c : {
            ...c,
            modules: c.modules.map((m) =>
              m.id !== moduleId ? m : { ...m, videoUrl, videoKey: `${moduleId}.mp4` }
            ),
          }
        )
      );
      showToast("Video uploaded successfully!", "success");
    },
    [showToast]
  );

  // ── Discussions ───────────────────────────────────────────────────────────

  const fetchDiscussions = useCallback(async () => {
    setDiscussionsLoading(true);
    setDiscussionsError("");
    try {
      const params = new URLSearchParams();
      if (filterResolved !== null) params.set("resolved", String(filterResolved));
      const res = await fetch(`/api/instructor/discussions?${params}`);
      const data = await res.json();
      if (!res.ok) { setDiscussionsError(data.error || "Failed to load discussions."); return; }
      setDiscussions(data.discussions ?? []);
      setDiscussionStats(data.stats ?? { total: 0, pending: 0, resolved: 0 });
    } catch {
      setDiscussionsError("Network error loading discussions.");
    } finally {
      setDiscussionsLoading(false);
    }
  }, [filterResolved]);

  const fetchReplies = useCallback(async (discussionId: string) => {
    setRepliesLoading(true);
    try {
      const res = await fetch(`/api/discussions/${discussionId}/replies`);
      const data = await res.json();
      if (res.ok) setReplies(data.replies ?? []);
    } catch { /* ignore */ }
    finally { setRepliesLoading(false); }
  }, []);

  const handleOpenDiscussion = useCallback(async (d: DiscussionItem) => {
    setActiveDiscussion(d);
    setReplyBody("");
    await fetchReplies(d.id);
  }, [fetchReplies]);

  const handleSendReply = useCallback(async () => {
    if (!activeDiscussion || !replyBody.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/discussions/${activeDiscussion.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      if (res.ok) {
        setReplyBody("");
        await fetchReplies(activeDiscussion.id);
        await fetchDiscussions();
      }
    } catch { /* ignore */ }
    finally { setSendingReply(false); }
  }, [activeDiscussion, replyBody, fetchReplies, fetchDiscussions]);

  const handleToggleResolved = useCallback(async (discussion: DiscussionItem) => {
    setTogglingId(discussion.id);
    try {
      const res = await fetch(`/api/discussions/${discussion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isResolved: !discussion.isResolved }),
      });
      if (res.ok) {
        await fetchDiscussions();
        if (activeDiscussion?.id === discussion.id) {
          setActiveDiscussion((d) => d ? { ...d, isResolved: !d.isResolved } : d);
        }
      }
    } catch { /* ignore */ }
    finally { setTogglingId(null); }
  }, [fetchDiscussions, activeDiscussion]);

  const handleTogglePin = useCallback(async (discussion: DiscussionItem) => {
    setTogglingId(discussion.id);
    try {
      const res = await fetch(`/api/discussions/${discussion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned: !discussion.isPinned }),
      });
      if (res.ok) {
        await fetchDiscussions();
      }
    } catch { /* ignore */ }
    finally { setTogglingId(null); }
  }, [fetchDiscussions]);

  // ── Feedback ──────────────────────────────────────────────────────────────

  const fetchFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError("");
    try {
      const res = await fetch("/api/instructor/feedback");
      const data = await res.json();
      if (!res.ok) { setFeedbackError(data.error || "Failed to load feedback."); return; }
      setFeedback(data.feedback ?? []);
    } catch {
      setFeedbackError("Network error loading feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  }, []);

  // ── Admin Messages ────────────────────────────────────────────────────────

  const fetchMessages = useCallback(async () => {
    setMessagesLoading(true);
    setMessagesError("");
    try {
      const res = await fetch("/api/admin/messages?self=true");
      const data = await res.json();
      if (!res.ok) { setMessagesError(data.error || "Failed to load messages."); return; }
      setMessages(data.messages ?? []);
    } catch {
      setMessagesError("Network error loading messages.");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim()) return;
    setSendingMessage(true);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      if (res.ok) {
        setNewMessage("");
        await fetchMessages();
      }
    } catch { /* ignore */ }
    finally { setSendingMessage(false); }
  }, [newMessage, fetchMessages]);

  // ── Tab change ────────────────────────────────────────────────────────────

  const handleTabChange = (newTab: typeof tab) => {
    setTab(newTab);
    if (newTab === "discussions") fetchDiscussions();
    if (newTab === "feedback") fetchFeedback();
    if (newTab === "messages") fetchMessages();
  };

  useEffect(() => {
    if (tab === "discussions") fetchDiscussions();
  }, [filterResolved, tab, fetchDiscussions]);

  const inputCls =
    "w-full px-3 py-2.5 glass rounded-xl border border-border text-white text-sm " +
    "placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 transition-all";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={dismissToast} />
      )}

      <div className="max-w-6xl mx-auto px-4">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 text-violet-400 text-sm font-mono mb-1">
              <GraduationCap className="w-4 h-4" /> INSTRUCTOR PORTAL
            </div>
            <h1
              className="text-3xl font-black text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Welcome, {instructor.name}
            </h1>
            {instructor.specialization && (
              <p className="text-text-muted text-sm mt-1">{instructor.specialization}</p>
            )}
          </div>
          <Link
            href="/instructor/courses/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all flex-shrink-0"
          >
            <PlusCircle className="w-4 h-4" /> New Course
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { icon: BookOpen, label: "Courses", value: courses.length, color: "text-cyan-400" },
            { icon: Users, label: "Students", value: totalStudents, color: "text-violet-400" },
            { icon: Film, label: "Videos Uploaded", value: totalVideos, color: "text-violet-400" },
            { icon: BarChart3, label: "Modules", value: courses.reduce((s, c) => s + c._count.modules, 0), color: "text-emerald-400" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="glass-bright rounded-2xl p-4 border border-border text-center">
              <Icon className={`w-5 h-5 ${color} mx-auto mb-2`} />
              <div className="text-2xl font-black text-white">{value}</div>
              <div className="text-text-muted text-xs">{label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 glass rounded-xl p-1 border border-border w-fit mb-6 flex-wrap">
          {[
            ["courses", "My Courses"],
            ["students", "Students"],
            ["discussions", `Q&A${discussionStats.pending > 0 ? ` (${discussionStats.pending})` : ""}`],
            ["feedback", "Reviews"],
            ["messages", unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleTabChange(key as typeof tab)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === key
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : key === "messages" && unreadMessages > 0
                  ? "text-purple-300 hover:text-white"
                  : "text-text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Courses Tab ── */}
        {tab === "courses" && (
          <div className="space-y-4">
            {courses.length === 0 ? (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <BookOpen className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted mb-4">No courses yet. Create your first one!</p>
                <Link
                  href="/instructor/courses/new"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90 transition-all"
                >
                  <PlusCircle className="w-4 h-4" /> Create Course
                </Link>
              </div>
            ) : (
              courses.map((course) => (
                <div key={course.id} className="glass-bright rounded-2xl border border-border overflow-hidden">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <ApprovalBadge course={course} />
                        </div>
                        <h3 className="text-white font-bold text-lg leading-tight">{course.title}</h3>
                        <ApprovalNotice course={course} />
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-white text-sm font-bold">{course._count.enrollments}</p>
                          <p className="text-text-muted text-xs">students</p>
                        </div>
                        <Link
                          href={`/instructor/courses/${course.id}/edit`}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white hover:bg-white/10 border border-border transition-all"
                        >
                          {course.approvalStatus === "REJECTED"
                            ? "Edit & Resubmit →"
                            : course.approvalStatus === "APPROVED" || course.isPublished
                            ? "View Course →"
                            : "Edit Course →"}
                        </Link>
                      </div>
                    </div>

                    {/* Modules with video management */}
                    {course.modules.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-text-muted text-xs font-medium uppercase tracking-wider">
                          Modules ({course.modules.length})
                        </p>
                        {course.modules.map((mod) => (
                          <div key={mod.id} className="bg-white/3 rounded-xl p-4 border border-white/5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium">{mod.title}</p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-text-muted flex-wrap">
                                  <span className={mod.isPublished ? "text-emerald-400" : "text-amber-400"}>
                                    {mod.isPublished ? "Published" : "Draft"}
                                  </span>
                                  {mod.quizzes.length > 0 && (
                                    <span>
                                      {mod.quizzes.length} quiz{mod.quizzes.length !== 1 ? "zes" : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* FIX: Full video management section per module */}
                            <ModuleVideoSection
                              mod={mod}
                              courseId={course.id}
                              onVideoUploaded={handleVideoUploaded}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Students Tab ── */}
        {tab === "students" && (
          <InstructorStudentsClient courses={courses} />
        )}

        {/* ── Discussions Tab ── */}
        {tab === "discussions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-white font-bold text-lg">
                Q&A Discussions
                {discussionStats.pending > 0 && (
                  <span className="ml-2 text-amber-400 text-sm font-normal">
                    · {discussionStats.pending} need reply
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 glass rounded-xl p-1 border border-border">
                  {[
                    { key: null, label: "All" },
                    { key: false, label: "Pending" },
                    { key: true, label: "Resolved" },
                  ].map(({ key, label }) => (
                    <button
                      key={String(key)}
                      onClick={() => setFilterResolved(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        filterResolved === key
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                          : "text-text-muted hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={fetchDiscussions}
                  disabled={discussionsLoading}
                  className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${discussionsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {discussionsError && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {discussionsError}
              </div>
            )}

            {discussionsLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-2xl bg-white/3 animate-pulse" />
                ))}
              </div>
            )}

            {!discussionsLoading && discussions.length === 0 && (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <MessageSquare className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No discussions found.</p>
              </div>
            )}

            <div className="grid lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2 space-y-2">
                {discussions.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleOpenDiscussion(d)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      activeDiscussion?.id === d.id
                        ? "glass-bright border-cyan-500/30 bg-cyan-500/5"
                        : "glass border-border hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {d.isPinned && <Pin className="w-3 h-3 text-amber-400 mt-1 flex-shrink-0" />}
                      {d.isResolved && <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-1 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{d.title}</p>
                        <p className="text-text-muted text-xs truncate mt-0.5">{d.course.title}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-text-muted">
                          <span>{d.author.name || "Student"}</span>
                          <span>·</span>
                          <span>{timeAgo(d.createdAt)}</span>
                          <span>·</span>
                          <span>{d.replyCount} replies</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-3">
                {activeDiscussion ? (
                  <div className="glass-bright rounded-2xl border border-border overflow-hidden">
                    <div className="p-5 border-b border-border">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-white font-bold">{activeDiscussion.title}</h4>
                          <p className="text-text-muted text-xs mt-0.5">
                            {activeDiscussion.course.title} · {activeDiscussion.author.name || "Student"} · {timeAgo(activeDiscussion.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleTogglePin(activeDiscussion)}
                            disabled={togglingId === activeDiscussion.id}
                            className={`p-1.5 rounded-lg transition-colors ${
                              activeDiscussion.isPinned ? "text-amber-400 bg-amber-500/10" : "text-text-muted hover:text-amber-400"
                            }`}
                            title={activeDiscussion.isPinned ? "Unpin" : "Pin"}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleResolved(activeDiscussion)}
                            disabled={togglingId === activeDiscussion.id}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                              activeDiscussion.isResolved
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-white/5 text-text-muted hover:text-white border border-border"
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {activeDiscussion.isResolved ? "Resolved" : "Mark Resolved"}
                          </button>
                        </div>
                      </div>
                      <p className="text-text-secondary text-sm mt-3 leading-relaxed">{activeDiscussion.body}</p>
                    </div>

                    <div className="p-5 space-y-4 max-h-64 overflow-y-auto">
                      {repliesLoading && (
                        <p className="text-text-muted text-sm text-center">Loading replies…</p>
                      )}
                      {!repliesLoading && replies.length === 0 && (
                        <p className="text-text-muted text-sm text-center">No replies yet.</p>
                      )}
                      {replies.map((r) => (
                        <div key={r.id} className="flex gap-3">
                          <ReplyAvatar name={r.author.name} role={r.author.role} />
                          <div className={`flex-1 p-3 rounded-xl text-sm ${
                            r.isInstructorReply
                              ? "bg-violet-500/10 border border-violet-500/20"
                              : "bg-white/3 border border-border"
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-white text-xs font-medium">{r.author.name || "Student"}</span>
                              {r.isInstructorReply && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">Instructor</span>
                              )}
                              <span className="text-text-muted text-xs">{timeAgo(r.createdAt)}</span>
                            </div>
                            <p className="text-text-secondary leading-relaxed">{r.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-4 border-t border-border flex gap-2">
                      <textarea
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendReply();
                          }
                        }}
                        placeholder="Write your reply… (Enter to send)"
                        rows={2}
                        className={`${inputCls} flex-1 resize-none`}
                      />
                      <button
                        onClick={handleSendReply}
                        disabled={sendingReply || !replyBody.trim()}
                        className="p-3 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-400 hover:bg-violet-500/30 disabled:opacity-40 transition-all flex-shrink-0"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="glass-bright rounded-2xl border border-border h-full flex items-center justify-center p-12 text-center">
                    <div>
                      <MessageSquare className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
                      <p className="text-text-muted">Select a discussion to view and reply.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Feedback Tab ── */}
        {tab === "feedback" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-400" /> Course Reviews
              </h3>
              <button
                onClick={fetchFeedback}
                disabled={feedbackLoading}
                className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${feedbackLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {feedbackError && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{feedbackError}</div>
            )}
            {feedbackLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-white/3 animate-pulse" />)}
              </div>
            )}
            {!feedbackLoading && feedback.length === 0 && (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <Star className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No reviews yet.</p>
              </div>
            )}
            {!feedbackLoading && feedback.map((f) => (
              <div key={f.id} className="glass-bright rounded-2xl border border-border p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">
                        {(f.user.name || "?"[0]).toUpperCase()}
                      </div>
                      <span className="text-white text-sm font-medium">{f.user.name || "Student"}</span>
                    </div>
                    <StarDisplay value={f.rating} />
                  </div>
                  <div className="text-right">
                    <p className="text-cyan-400 text-xs">{f.course.title}</p>
                    <p className="text-text-muted text-xs">{timeAgo(f.createdAt)}</p>
                  </div>
                </div>
                {f.comment && (
                  <p className="text-text-secondary text-sm mt-3 leading-relaxed">{f.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Messages Tab ── */}
        {tab === "messages" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <Lock className="w-5 h-5 text-purple-400" /> Admin Messages
              </h3>
              <button
                onClick={fetchMessages}
                disabled={messagesLoading}
                className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${messagesLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {messagesError && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{messagesError}</div>
            )}
            {messagesLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-white/3 animate-pulse" />)}
              </div>
            )}
            {!messagesLoading && messages.length === 0 && (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <Inbox className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No messages from admin yet.</p>
              </div>
            )}
            {!messagesLoading && messages.length > 0 && (
              <div className="glass-bright rounded-2xl border border-border divide-y divide-border/50 overflow-hidden max-h-96 overflow-y-auto">
                {messages.map((m) => {
                  const isAdmin = m.senderRole === "ADMIN";
                  return (
                    <div key={m.id} className={`p-4 flex ${isAdmin ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-sm px-4 py-2.5 rounded-2xl text-sm border ${
                        isAdmin
                          ? "bg-white/5 text-white border-border"
                          : "bg-violet-500/20 text-white border-violet-500/25"
                      }`}>
                        <p className="leading-relaxed">{m.body}</p>
                        <p className="text-xs mt-1 opacity-50">{timeAgo(m.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                }}
                placeholder="Send a message to admin… (Enter to send)"
                rows={2}
                className={`${inputCls} flex-1 resize-none`}
              />
              <button
                onClick={handleSendMessage}
                disabled={sendingMessage || !newMessage.trim()}
                className="p-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 disabled:opacity-40 transition-all flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}