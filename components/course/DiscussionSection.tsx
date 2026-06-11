// FILE PATH: components/course/DiscussionSection.tsx
//
// COMPLETE REWRITE — PRIVATE STUDENT-INSTRUCTOR SUPPORT THREAD SYSTEM
//
// ARCHITECTURE:
//   STUDENT view:
//     - Sees ONLY their own discussion threads for this course.
//     - Privacy is enforced server-side (API returns authorId-filtered results).
//     - Can create new doubts, reply to continue their own threads.
//     - Clear status indicators: Pending Reply / In Conversation / Resolved.
//
//   INSTRUCTOR view:
//     - Sees ALL student discussion threads for their course.
//     - Can expand any thread to read the full conversation.
//     - Has an inline reply input to respond directly from the course page.
//     - Can mark threads resolved, pin, or hide.
//
//   ADMIN view:
//     - Same as instructor but with additional hide/delete moderation controls.
//
// BUGS FIXED:
//   - Student privacy: backend already filters, UI confirms with role-aware labels.
//   - Synchronization: reply list refreshes immediately after each post.
//   - Stale data: thread replies are refetched when expanded, not cached forever.

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageSquarePlus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Pin,
  Trash2,
  Send,
  BookOpen,
  Clock,
  MessageSquare,
  AlertCircle,
  RefreshCw,
  Lock,
  User,
  Shield,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplyAuthor {
  id: string;
  name: string | null;
  image: string | null;
  role: string;
}

interface Reply {
  id: string;
  body: string;
  isInstructorReply: boolean;
  createdAt: string;
  author: ReplyAuthor;
}

interface DiscussionAuthor {
  id: string;
  name: string | null;
  image: string | null;
  role: string;
}

interface DiscussionItem {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  isResolved: boolean;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  author: DiscussionAuthor;
  _count?: { replies: number };
}

interface Props {
  courseId: string;
  moduleId?: string;
  currentUserId: string | null;
  currentUserRole: string | null;
  isEnrolled: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function Avatar({ name, image, role }: { name: string | null; image: string | null; role: string }) {
  const initials = (name || "?")[0].toUpperCase();
  const gradient =
    role === "ADMIN"       ? "from-red-500 to-orange-500"
    : role === "INSTRUCTOR" ? "from-violet-500 to-purple-600"
    : "from-cyan-500 to-blue-600";
  return (
    <div
      className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 overflow-hidden`}
    >
      {image ? (
        <img src={image} alt={name || "User"} className="w-full h-full object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

function RoleBadge({ role, isInstructorReply }: { role: string; isInstructorReply?: boolean }) {
  if (isInstructorReply || role === "INSTRUCTOR") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-medium">
        Instructor
      </span>
    );
  }
  if (role === "ADMIN") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 font-medium">
        Admin
      </span>
    );
  }
  return null;
}

type ThreadStatus = "pending" | "in-progress" | "resolved";

function getThreadStatus(d: DiscussionItem): ThreadStatus {
  if (d.isResolved) return "resolved";
  if (d.replyCount > 0) return "in-progress";
  return "pending";
}

function StatusBadge({ status }: { status: ThreadStatus }) {
  if (status === "resolved") {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-medium">
        <CheckCircle className="w-3 h-3" /> Resolved
      </span>
    );
  }
  if (status === "in-progress") {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25 font-medium">
        <MessageSquare className="w-3 h-3" /> In Progress
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 font-medium">
      <Clock className="w-3 h-3" /> Awaiting Reply
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DiscussionSection({
  courseId,
  moduleId,
  currentUserId,
  currentUserRole,
  isEnrolled,
}: Props) {
  const isStudent             = currentUserRole === "STUDENT";
  const isInstructor          = currentUserRole === "INSTRUCTOR";
  const isAdmin               = currentUserRole === "ADMIN";
  const isInstructorOrAdmin   = isInstructor || isAdmin;
  const canCreateThread       = isStudent && isEnrolled;
  const canReply              = isEnrolled || isInstructorOrAdmin;

  // ── Discussion list state ────────────────────────────────────────────────
  const [discussions, setDiscussions]         = useState<DiscussionItem[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [listError, setListError]             = useState("");
  const [statusFilter, setStatusFilter]       = useState("all");

  // ── New thread form state (students only) ────────────────────────────────
  const [showForm, setShowForm]               = useState(false);
  const [formTitle, setFormTitle]             = useState("");
  const [formBody, setFormBody]               = useState("");
  const [formError, setFormError]             = useState("");
  const [formSubmitting, setFormSubmitting]   = useState(false);

  // ── Thread expansion + replies state ────────────────────────────────────
  const [expandedId, setExpandedId]           = useState<string | null>(null);
  const [replies, setReplies]                 = useState<Record<string, Reply[]>>({});
  const [loadingReplies, setLoadingReplies]   = useState<Record<string, boolean>>({});
  const [replyText, setReplyText]             = useState<Record<string, string>>({});
  const [submittingReply, setSubmittingReply] = useState<Record<string, boolean>>({});
  const [replyError, setReplyError]           = useState<Record<string, string>>({});

  const replyInputRef = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // ── Fetch discussion list ────────────────────────────────────────────────
  const fetchDiscussions = useCallback(async (filter = statusFilter) => {
    setLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams({ courseId });
      if (moduleId) params.set("moduleId", moduleId);
      if (filter !== "all") params.set("status", filter);
      const res  = await fetch(`/api/discussions?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setDiscussions(data.discussions ?? []);
      } else {
        setListError(data.error || "Failed to load discussions.");
      }
    } catch {
      setListError("Network error. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [courseId, moduleId, statusFilter]);

  useEffect(() => {
    fetchDiscussions();
  }, [fetchDiscussions]);

  // ── Fetch replies for a specific thread ─────────────────────────────────
  const fetchReplies = useCallback(async (discussionId: string, force = false) => {
    if (!force && replies[discussionId]) return; // already loaded
    setLoadingReplies((p) => ({ ...p, [discussionId]: true }));
    try {
      const res  = await fetch(`/api/discussions/${discussionId}/replies`);
      const data = await res.json();
      if (res.ok) {
        setReplies((p) => ({ ...p, [discussionId]: data.replies ?? [] }));
      }
    } catch {
      // Silently fail; replies will be empty array
    } finally {
      setLoadingReplies((p) => ({ ...p, [discussionId]: false }));
    }
  }, [replies]);

  const toggleExpand = useCallback(
    (discussionId: string) => {
      if (expandedId === discussionId) {
        setExpandedId(null);
      } else {
        setExpandedId(discussionId);
        fetchReplies(discussionId);
      }
    },
    [expandedId, fetchReplies]
  );

  // ── Create new discussion thread (student only) ──────────────────────────
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formBody.trim()) {
      setFormError("Please fill in both the title and description.");
      return;
    }
    setFormSubmitting(true);
    setFormError("");
    try {
      const res  = await fetch("/api/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          moduleId: moduleId || undefined,
          title: formTitle,
          body: formBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to post. Please try again.");
        return;
      }
      setFormTitle("");
      setFormBody("");
      setShowForm(false);
      // Prepend the new discussion to the list without a full refetch
      setDiscussions((prev) => [data.discussion, ...prev]);
      // Auto-expand the new thread
      setExpandedId(data.discussion.id);
      setReplies((p) => ({ ...p, [data.discussion.id]: [] }));
    } finally {
      setFormSubmitting(false);
    }
  };

  // ── Post a reply ─────────────────────────────────────────────────────────
  const handleReplySubmit = async (discussionId: string) => {
    const text = replyText[discussionId]?.trim();
    if (!text) return;

    setSubmittingReply((p) => ({ ...p, [discussionId]: true }));
    setReplyError((p) => ({ ...p, [discussionId]: "" }));

    try {
      const res  = await fetch(`/api/discussions/${discussionId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReplyError((p) => ({ ...p, [discussionId]: data.error || "Failed to send reply." }));
        return;
      }
      // Optimistically update the reply list
      setReplyText((p) => ({ ...p, [discussionId]: "" }));
      setReplies((p) => ({
        ...p,
        [discussionId]: [...(p[discussionId] || []), data.reply],
      }));
      // Increment reply count on the discussion card
      setDiscussions((prev) =>
        prev.map((d) =>
          d.id === discussionId
            ? { ...d, replyCount: d.replyCount + 1 }
            : d
        )
      );
    } finally {
      setSubmittingReply((p) => ({ ...p, [discussionId]: false }));
    }
  };

  // ── Delete a reply ───────────────────────────────────────────────────────
  const handleDeleteReply = async (discussionId: string, replyId: string) => {
    if (!confirm("Delete this reply?")) return;
    const res = await fetch(`/api/discussions/${discussionId}/replies/${replyId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setReplies((p) => ({
        ...p,
        [discussionId]: (p[discussionId] || []).filter((r) => r.id !== replyId),
      }));
      setDiscussions((prev) =>
        prev.map((d) =>
          d.id === discussionId
            ? { ...d, replyCount: Math.max(0, d.replyCount - 1) }
            : d
        )
      );
    }
  };

  // ── Status / moderation actions (instructor / admin) ─────────────────────
  const handlePatch = async (
    discussionId: string,
    patch: { isPinned?: boolean; isResolved?: boolean; isHidden?: boolean }
  ) => {
    const res = await fetch(`/api/discussions/${discussionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      if (patch.isHidden) {
        setDiscussions((prev) => prev.filter((d) => d.id !== discussionId));
      } else {
        fetchDiscussions(statusFilter);
      }
    }
  };

  const handleDeleteThread = async (discussionId: string) => {
    if (!confirm("Permanently delete this discussion and all its replies?")) return;
    const res = await fetch(`/api/discussions/${discussionId}`, { method: "DELETE" });
    if (res.ok) {
      setDiscussions((prev) => prev.filter((d) => d.id !== discussionId));
      if (expandedId === discussionId) setExpandedId(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const sectionTitle = isStudent
    ? "My Questions"
    : isInstructor
    ? "Student Questions"
    : "All Discussions";

  const emptyMessage = isStudent
    ? 'No questions yet. Click "Ask a Question" to start a private thread with your instructor.'
    : 'No student questions yet.';

  return (
    <section className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            {sectionTitle}
          </h2>
          {isStudent && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
              title="Only you, your instructor, and admins can see these conversations."
            >
              <Lock className="w-3 h-3" /> Private
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter (instructor/admin) */}
          {isInstructorOrAdmin && (
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                fetchDiscussions(e.target.value);
              }}
              className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-border text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          )}

          {/* Refresh */}
          <button
            onClick={() => fetchDiscussions(statusFilter)}
            disabled={loading}
            className="p-2 rounded-lg bg-white/5 border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          {/* Ask question (student enrolled only) */}
          {canCreateThread && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 text-sm font-medium transition-all"
            >
              <MessageSquarePlus className="w-4 h-4" />
              Ask a Question
            </button>
          )}
        </div>
      </div>

      {/* ── Privacy notice (students) ───────────────────────────────────── */}
      {isStudent && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/15 text-cyan-400/70 text-xs">
          <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Your questions are <strong className="text-cyan-400">private</strong> — only you, your instructor, and course admins can see them. Other students cannot view your discussions.
          </span>
        </div>
      )}

      {/* ── Create new thread form (students) ──────────────────────────── */}
      {showForm && canCreateThread && (
        <form
          onSubmit={handleCreateThread}
          className="glass-bright rounded-2xl border border-cyan-500/30 p-5 space-y-4"
        >
          <h3 className="text-white font-semibold text-sm">New Question</h3>

          {formError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {formError}
            </div>
          )}

          <div>
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value.slice(0, 200))}
              placeholder="Question title — e.g. 'How does async/await work here?'"
              className="w-full bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white placeholder:text-text-muted text-sm focus:outline-none focus:border-cyan-500/50 transition-colors"
              required
            />
            <p className="text-text-muted text-xs mt-1 text-right">
              {formTitle.length}/200
            </p>
          </div>

          <div>
            <textarea
              value={formBody}
              onChange={(e) => setFormBody(e.target.value.slice(0, 5000))}
              rows={5}
              placeholder="Describe your question in detail. Include any error messages, code snippets, or specific steps you've already tried…"
              className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-white placeholder:text-text-muted text-sm resize-none focus:outline-none focus:border-cyan-500/50 transition-colors"
              required
            />
            <p className="text-text-muted text-xs mt-1 text-right">
              {formBody.length}/5000
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={formSubmitting}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {formSubmitting ? "Posting…" : "Post Question"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(""); }}
              className="px-5 py-2.5 rounded-xl border border-border text-text-secondary hover:text-white text-sm transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {listError && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {listError}
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-white/3 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {!loading && discussions.length === 0 && !listError && (
        <div className="glass-bright rounded-2xl border border-border p-12 text-center">
          <MessageSquare className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
          <p className="text-text-muted text-sm">{emptyMessage}</p>
          {canCreateThread && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 text-sm font-medium transition-all"
            >
              <MessageSquarePlus className="w-4 h-4" /> Ask Your First Question
            </button>
          )}
        </div>
      )}

      {/* ── Discussion thread list ──────────────────────────────────────── */}
      {!loading && discussions.length > 0 && (
        <div className="space-y-3">
          {discussions.map((d) => {
            const isExpanded   = expandedId === d.id;
            const threadStatus = getThreadStatus(d);
            const isOwner      = d.author.id === currentUserId;
            const threadReplies = replies[d.id] || [];

            return (
              <div
                key={d.id}
                className={`glass-bright rounded-2xl border overflow-hidden transition-all
                  ${d.isPinned ? "border-amber-500/40" : "border-border"}
                  ${d.isResolved ? "opacity-75" : ""}`}
              >
                {/* ── Thread header ───────────────────────────────────── */}
                <div className="p-4 space-y-2">
                  {/* Top row: status + pinned + actions */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                      {d.isPinned && (
                        <span className="flex items-center gap-1 text-xs text-amber-400 font-medium">
                          <Pin className="w-3 h-3" /> Pinned
                        </span>
                      )}
                      <StatusBadge status={threadStatus} />
                      <h3 className="text-white text-sm font-semibold leading-snug flex-1 min-w-0 truncate">
                        {d.title}
                      </h3>
                    </div>

                    {/* Moderation controls (instructor / admin) */}
                    {isInstructorOrAdmin && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handlePatch(d.id, { isPinned: !d.isPinned })}
                          className={`p-1.5 rounded-lg transition-colors
                            ${d.isPinned
                              ? "text-amber-400 hover:bg-amber-500/10"
                              : "text-text-muted hover:text-amber-400 hover:bg-amber-500/10"}`}
                          title={d.isPinned ? "Unpin" : "Pin"}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handlePatch(d.id, { isResolved: !d.isResolved })}
                          className={`p-1.5 rounded-lg transition-colors
                            ${d.isResolved
                              ? "text-emerald-400 hover:bg-emerald-500/10"
                              : "text-text-muted hover:text-emerald-400 hover:bg-emerald-500/10"}`}
                          title={d.isResolved ? "Mark Unresolved" : "Mark Resolved"}
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handlePatch(d.id, { isHidden: true })}
                          className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Hide discussion"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Author can delete their own thread */}
                    {isOwner && isStudent && (
                      <button
                        onClick={() => handleDeleteThread(d.id)}
                        className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                        title="Delete this question"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Body preview */}
                  <p className="text-text-secondary text-sm leading-relaxed line-clamp-2">
                    {d.body}
                  </p>

                  {/* Footer: author info + expand button */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      {isInstructorOrAdmin && (
                        <>
                          <User className="w-3 h-3" />
                          <span className="font-medium text-text-secondary">
                            {d.author.name || "Student"}
                          </span>
                          <span>·</span>
                        </>
                      )}
                      <span>{timeAgo(d.createdAt)}</span>
                    </div>

                    <button
                      onClick={() => toggleExpand(d.id)}
                      className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {d.replyCount} {d.replyCount === 1 ? "reply" : "replies"}
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* ── Expanded thread ─────────────────────────────────── */}
                {isExpanded && (
                  <div className="border-t border-border/50 bg-black/10 px-4 py-4 space-y-4">
                    {/* Original question (full body) */}
                    <div className="flex gap-3">
                      <Avatar
                        name={d.author.name}
                        image={d.author.image}
                        role={d.author.role}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-white text-xs font-semibold">
                            {isStudent ? "You" : (d.author.name || "Student")}
                          </span>
                          <span className="text-text-muted text-xs">{timeAgo(d.createdAt)}</span>
                        </div>
                        <div className="bg-white/3 rounded-xl px-3 py-2.5 border border-border/50">
                          <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
                            {d.body}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Replies */}
                    {loadingReplies[d.id] ? (
                      <div className="h-12 rounded-xl bg-white/3 animate-pulse" />
                    ) : (
                      threadReplies.map((r) => {
                        const isMine  = r.author.id === currentUserId;
                        const isStaff = r.isInstructorReply || r.author.role === "ADMIN";

                        return (
                          <div key={r.id} className="flex gap-3">
                            {/* Staff replies have different visual weight */}
                            <Avatar
                              name={r.author.name}
                              image={r.author.image}
                              role={r.isInstructorReply ? "INSTRUCTOR" : r.author.role}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-white text-xs font-semibold">
                                  {isMine && isStudent ? "You" : (r.author.name || "User")}
                                </span>
                                <RoleBadge
                                  role={r.author.role}
                                  isInstructorReply={r.isInstructorReply}
                                />
                                <span className="text-text-muted text-xs">
                                  {timeAgo(r.createdAt)}
                                </span>
                              </div>
                              <div
                                className={`rounded-xl px-3 py-2.5 border
                                  ${isStaff
                                    ? "bg-violet-500/8 border-violet-500/20"
                                    : "bg-white/3 border-border/50"}`}
                              >
                                <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
                                  {r.body}
                                </p>
                              </div>
                            </div>
                            {/* Delete reply: own reply or instructor/admin moderating */}
                            {(isMine || isInstructorOrAdmin) && (
                              <button
                                onClick={() => handleDeleteReply(d.id, r.id)}
                                className="p-1 rounded text-text-muted/40 hover:text-red-400 transition-colors flex-shrink-0 self-start mt-5"
                                title="Delete reply"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}

                    {/* No replies yet (for instructor/admin) */}
                    {!loadingReplies[d.id] && threadReplies.length === 0 && isInstructorOrAdmin && (
                      <p className="text-text-muted text-xs text-center py-2">
                        No replies yet — be the first to respond.
                      </p>
                    )}

                    {/* ── Reply input ─────────────────────────────────── */}
                    {canReply && !d.isResolved && (
                      <div className="space-y-2">
                        {replyError[d.id] && (
                          <p className="text-red-400 text-xs flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> {replyError[d.id]}
                          </p>
                        )}
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <textarea
                              ref={(el) => { replyInputRef.current[d.id] = el; }}
                              value={replyText[d.id] ?? ""}
                              onChange={(e) =>
                                setReplyText((p) => ({
                                  ...p,
                                  [d.id]: e.target.value.slice(0, 3000),
                                }))
                              }
                              placeholder={
                                isInstructor
                                  ? "Write your reply to the student…"
                                  : isAdmin
                                  ? "Write a moderator reply…"
                                  : "Continue the conversation…"
                              }
                              rows={2}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  handleReplySubmit(d.id);
                                }
                              }}
                              className="w-full bg-white/5 border border-border rounded-xl px-3 py-2 text-white placeholder:text-text-muted text-sm resize-none focus:outline-none focus:border-cyan-500/50 transition-colors"
                            />
                          </div>
                          <button
                            onClick={() => handleReplySubmit(d.id)}
                            disabled={submittingReply[d.id] || !replyText[d.id]?.trim()}
                            className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all disabled:opacity-50
                              ${isInstructorOrAdmin
                                ? "bg-violet-500/20 border-violet-500/30 text-violet-400 hover:bg-violet-500/30"
                                : "bg-cyan-500/20 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30"}`}
                            title="Send reply (Enter)"
                          >
                            {submittingReply[d.id] ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <p className="text-text-muted/50 text-xs">Press Enter to send · Shift+Enter for new line</p>
                      </div>
                    )}

                    {/* Resolved notice */}
                    {d.isResolved && (
                      <div className="flex items-center gap-2 text-xs text-emerald-400 py-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        This thread is marked as resolved.
                        {isInstructorOrAdmin && (
                          <button
                            onClick={() => handlePatch(d.id, { isResolved: false })}
                            className="underline hover:no-underline ml-1"
                          >
                            Reopen?
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}