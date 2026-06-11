// FILE PATH: components/dashboard/DashboardClient.tsx
//
// FIXES:
// 1. DASHBOARD "HALF CUT" / CONTENT HIDDEN UNDER NAVBAR — pt-24 pb-16 applied.
// 2. UNDEFINED CSS CLASSES — bg-void, text-slate-200 used.
// 3. FIXED: "Continue" button is now hidden for unpublished courses. Instead,
//    a notice is shown telling the student the course is temporarily unavailable.
//    The enrollment record is still shown (student keeps their progress).

"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  BookOpen, Award, TrendingUp, Play, CheckCircle,
  Clock, BarChart2, MessageSquare, MessageSquarePlus,
  Send, RefreshCw, Inbox, Lock, ShieldCheck, AlertCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CourseEnrollment {
  id: string;
  enrolledAt: string;
  course: {
    id: string;
    slug: string;
    title: string;
    category: string;
    thumbnail: string | null;
    isPublished: boolean;
  };
  totalQuizzes: number;
  passedQuizzes: number;
  attemptedQuizzes: number;
  progressPct: number;
  firstQuizId: string | null;
}

interface Certificate {
  id: string;
  courseId: string;
  issuedAt: string;
  overallPercentage: number;
  course: { id: string; title: string };
}

interface DiscussionStats {
  total: number;
  pendingReply: number;
  inConversation: number;
  resolved: number;
}

interface DashboardData {
  enrolledCount: number;
  completedCount: number;
  activeCount: number;
  overallPct: number;
  enrollments: CourseEnrollment[];
  certificates: Certificate[];
  discussionStats: DiscussionStats;
}

interface MessageItem {
  id: string;
  body: string;
  senderRole: string;
  isReadByRecipient: boolean;
  isReadByAdmin: boolean;
  createdAt: string;
}

interface Props {
  data: DashboardData;
  unreadMessages: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(dateStr).toLocaleDateString();
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DashboardClient({ data: initialData, unreadMessages: initialUnread }: Props) {
  const [data, setData]         = useState<DashboardData>(initialData);
  const [tab, setTab]           = useState<"courses" | "certificates" | "messages">("courses");
  const [unreadCount, setUnreadCount] = useState(initialUnread);

  // Messages state
  const [messages, setMessages]       = useState<MessageItem[]>([]);
  const [msgLoading, setMsgLoading]   = useState(false);
  const [msgError, setMsgError]       = useState("");
  const [newMessage, setNewMessage]   = useState("");
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState("");
  const msgBottomRef = useRef<HTMLDivElement>(null);

  // Refresh dashboard data
  const refreshData = useCallback(async () => {
    try {
      const res = await fetch("/api/student/dashboard", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {}
  }, []);

  // Load messages
  const loadMessages = useCallback(async () => {
    setMsgLoading(true);
    setMsgError("");
    try {
      const res = await fetch("/api/admin/messages");
      const json = await res.json();
      if (!res.ok) { setMsgError(json.error || "Failed to load messages."); return; }
      setMessages(json.messages ?? []);
      setUnreadCount(0);
    } catch {
      setMsgError("Network error loading messages.");
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "messages") {
      loadMessages();
    }
  }, [tab, loadMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (tab === "messages") {
      msgBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, tab]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setSendError(json.error || "Failed to send message."); return; }
      setNewMessage("");
      await loadMessages();
    } catch {
      setSendError("Network error. Could not send message.");
    } finally {
      setSending(false);
    }
  };

  const TABS = [
    { key: "courses",      label: "My Courses" },
    { key: "certificates", label: "Certificates" },
    {
      key:   "messages",
      label: unreadCount > 0 ? `Messages (${unreadCount})` : "Messages",
    },
  ] as const;

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-6xl mx-auto px-4">

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { icon: BookOpen,    label: "Enrolled",    value: data.enrolledCount,   color: "text-cyan-400" },
            { icon: Play,        label: "In Progress",  value: data.activeCount,    color: "text-violet-400" },
            { icon: CheckCircle, label: "Completed",    value: data.completedCount, color: "text-emerald-400" },
            { icon: TrendingUp,  label: "Overall",      value: `${data.overallPct}%`, color: "text-amber-400" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <Icon className={`w-5 h-5 ${color} mb-2`} />
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-xs text-text-muted">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Discussion Stats ── */}
        {data.discussionStats && data.discussionStats.total > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-white">My Discussions</span>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                { label: "Total",       value: data.discussionStats.total,          color: "text-white" },
                { label: "Pending",     value: data.discussionStats.pendingReply,   color: "text-amber-400" },
                { label: "In Progress", value: data.discussionStats.inConversation, color: "text-cyan-400" },
                { label: "Resolved",    value: data.discussionStats.resolved,       color: "text-emerald-400" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-text-muted">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab Bar ── */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors relative
                ${tab === key
                  ? "bg-white/10 text-white"
                  : "text-text-muted hover:text-white"
                }
                ${key === "messages" && unreadCount > 0 && tab !== "messages"
                  ? "ring-1 ring-violet-500/60"
                  : ""
                }`}
            >
              {label}
              {key === "messages" && unreadCount > 0 && tab !== "messages" && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-violet-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* ── Courses Tab ── */}
        {tab === "courses" && (() => {
          // Split enrollments: completed courses (100% AND have a certificate) go to
          // a separate section; everything else is "active" (including 0% not-started).
          const certCourseIdSet = new Set(data.certificates.map((c) => c.courseId));
          const activeEnrollments = data.enrollments.filter(
            (e) => !(e.progressPct === 100 && certCourseIdSet.has(e.course.id))
          );
          const completedEnrollments = data.enrollments.filter(
            (e) => e.progressPct === 100 && certCourseIdSet.has(e.course.id)
          );

          const renderEnrollmentCard = (e: CourseEnrollment, isCompleted: boolean) => {
            // FIXED: Check if course is still published/available
            const courseAvailable = e.course.isPublished;

            return (
              <div key={e.id} className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col md:flex-row gap-4">
                {e.course.thumbnail && (
                  <img
                    src={e.course.thumbnail}
                    alt={e.course.title}
                    className={`w-full md:w-32 h-20 object-cover rounded-lg flex-shrink-0 ${!courseAvailable ? "opacity-50 grayscale" : ""}`}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-white truncate">{e.course.title}</h3>
                    <span className="text-xs text-text-muted whitespace-nowrap">{e.course.category}</span>
                  </div>

                  {/* Unpublished notice */}
                  {!courseAvailable && (
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-amber-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>This course is temporarily unavailable. Your progress is saved.</span>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                      <span>Progress</span>
                      <span>{e.progressPct}%</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${isCompleted ? "bg-emerald-500" : "bg-violet-500"}`}
                        style={{ width: `${e.progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Quiz stats */}
                  {e.totalQuizzes > 0 && (
                    <div className="text-xs text-text-muted mb-3">
                      Quizzes: {e.passedQuizzes}/{e.totalQuizzes} passed
                      {e.attemptedQuizzes > 0 && e.attemptedQuizzes < e.totalQuizzes && (
                        <span className="ml-2 text-amber-400">{e.attemptedQuizzes} attempted</span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {/* FIXED: Only show Continue/Review if course is published */}
                    {!isCompleted && courseAvailable && (
                      <Link
                        href={`/courses/${e.course.slug}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded-lg transition-colors"
                      >
                        <Play className="w-3 h-3" /> Continue
                      </Link>
                    )}
                    {isCompleted && courseAvailable && (
                      <Link
                        href={`/courses/${e.course.slug}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg transition-colors"
                      >
                        <BookOpen className="w-3 h-3" /> Review Course
                      </Link>
                    )}
                    {e.firstQuizId && e.progressPct > 0 && !isCompleted && courseAvailable && (
                      <Link
                        href={`/quiz/${e.firstQuizId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white text-xs rounded-lg transition-colors"
                      >
                        <BarChart2 className="w-3 h-3" /> Take Quiz
                      </Link>
                    )}
                    {/* Discussion link — only show if course is available */}
                    {courseAvailable && (
                      <Link
                        href={`/courses/${e.course.slug}#discussions`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white text-xs rounded-lg transition-colors"
                      >
                        <MessageSquarePlus className="w-3.5 h-3.5" /> Ask in a Course
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between gap-2 flex-shrink-0">
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${isCompleted ? "text-emerald-400" : "text-white"}`}>
                      {e.progressPct}%
                    </div>
                    <div className="text-xs text-text-muted">complete</div>
                  </div>
                  {isCompleted && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle className="w-3.5 h-3.5" /> Completed
                    </span>
                  )}
                  {!isCompleted && e.progressPct > 0 && e.progressPct < 100 && courseAvailable && (
                    <span className="flex items-center gap-1 text-xs text-amber-400">
                      <Clock className="w-3.5 h-3.5" /> In Progress
                    </span>
                  )}
                  {!isCompleted && !courseAvailable && (
                    <span className="flex items-center gap-1 text-xs text-amber-400/70">
                      <AlertCircle className="w-3.5 h-3.5" /> Unavailable
                    </span>
                  )}
                  {!isCompleted && e.progressPct === 0 && courseAvailable && (
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      Not started
                    </span>
                  )}
                </div>
              </div>
            );
          };

          return (
            <div className="space-y-6">
              {/* Active / In-Progress Courses */}
              <div className="space-y-4">
                <h2 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
                  <Play className="w-4 h-4 text-violet-400" /> My Active Courses
                  {activeEnrollments.length > 0 && (
                    <span className="text-xs text-text-muted font-normal normal-case">
                      ({activeEnrollments.length})
                    </span>
                  )}
                </h2>
                {activeEnrollments.length === 0 ? (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-10 text-center">
                    <BookOpen className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                    <p className="text-text-muted mb-4">You haven&apos;t enrolled in any courses yet.</p>
                    <Link
                      href="/courses"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm rounded-lg transition-colors"
                    >
                      <BookOpen className="w-4 h-4" /> Browse Courses
                    </Link>
                  </div>
                ) : (
                  activeEnrollments.map((e) => renderEnrollmentCard(e, false))
                )}
              </div>

              {/* Completed Courses */}
              {completedEnrollments.length > 0 && (
                <div className="space-y-4">
                  <h2 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" /> Completed Courses
                    <span className="text-xs text-text-muted font-normal normal-case">
                      ({completedEnrollments.length})
                    </span>
                  </h2>
                  {completedEnrollments.map((e) => renderEnrollmentCard(e, true))}
                </div>
              )}

              {data.enrollments.length > 0 && (
                <div className="text-center pt-2">
                  <Link
                    href="/courses"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm rounded-lg transition-colors"
                  >
                    <BookOpen className="w-4 h-4" /> Browse More Courses
                  </Link>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Certificates Tab ── */}
        {tab === "certificates" && (
          <div className="space-y-4">
            {data.certificates.length === 0 ? (
              <div className="bg-white/5 border border-white/10 rounded-xl p-10 text-center">
                <Award className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">Complete a course to earn your first certificate.</p>
              </div>
            ) : (
              data.certificates.map((cert) => (
                <div key={cert.id} className="bg-white/5 border border-white/10 rounded-xl p-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Award className="w-4 h-4 text-amber-400" />
                      <span className="font-semibold text-white">{cert.course.title}</span>
                    </div>
                    <div className="text-xs text-text-muted">
                      Issued {new Date(cert.issuedAt).toLocaleDateString()} ·{" "}
                      Score: {cert.overallPercentage.toFixed(1)}%
                    </div>
                  </div>
                  <Link
                    href={`/certificate/${cert.id}`}
                    target="_blank"
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
                  >
                    View Certificate
                  </Link>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Messages Tab ── */}
        {tab === "messages" && (
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-600/30 rounded-full flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Admin Support</div>
                  <div className="text-xs text-text-muted flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Private & Secure
                  </div>
                </div>
              </div>
              <button
                onClick={loadMessages}
                disabled={msgLoading}
                className="p-1.5 text-text-muted hover:text-white transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${msgLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Message thread */}
            <div className="h-80 overflow-y-auto px-5 py-4 space-y-3">
              {msgLoading && messages.length === 0 && (
                <div className="text-center text-text-muted text-sm py-10">Loading messages…</div>
              )}
              {msgError && (
                <div className="text-center text-red-400 text-sm py-6">{msgError}</div>
              )}
              {!msgLoading && !msgError && messages.length === 0 && (
                <div className="text-center py-10">
                  <Inbox className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
                  <p className="text-text-muted text-sm">No messages yet.</p>
                  <p className="text-text-muted text-xs mt-1">
                    Send a message below to contact Admin.
                  </p>
                </div>
              )}
              {messages.map((msg) => {
                const isMe = msg.senderRole !== "ADMIN";
                return (
                  <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm
                        ${isMe
                          ? "bg-violet-600 text-white rounded-br-sm"
                          : "bg-white/10 text-slate-200 rounded-bl-sm"
                        }`}
                    >
                      {!isMe && (
                        <div className="text-xs font-medium text-violet-400 mb-1">Admin</div>
                      )}
                      <div className="whitespace-pre-wrap break-words">{msg.body}</div>
                      <div className={`text-xs mt-1 ${isMe ? "text-violet-200/60" : "text-text-muted"}`}>
                        {timeAgo(msg.createdAt)}
                        {isMe && !msg.isReadByAdmin && (
                          <span className="ml-2 text-violet-200/40">• Unread by admin</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={msgBottomRef} />
            </div>

            {/* Compose */}
            <div className="px-5 py-4 border-t border-white/10">
              {sendError && (
                <div className="text-red-400 text-xs mb-2">{sendError}</div>
              )}
              <div className="flex gap-3">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type a message to Admin… (Enter to send)"
                  rows={2}
                  maxLength={5000}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !newMessage.trim()}
                  className="self-end px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  {sending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send
                </button>
              </div>
              <div className="text-xs text-text-muted mt-2">
                Messages are private between you and Admin only.
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}