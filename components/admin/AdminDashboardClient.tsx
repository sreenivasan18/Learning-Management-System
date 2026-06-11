// FILE PATH: components/admin/AdminDashboardClient.tsx
//
// MONITORING REWRITE:
// Fixed: Student and Instructor interfaces now include all monitoring fields
// returned by their respective APIs (isOnline, lastActiveAt, totalLearningSeconds,
// enriched enrollments with progressPct, activityLog, coursePerformance).
// Added: Full monitoring UI for Students tab (online badge, last active, learning
// hours, per-course progress bars, activity timeline).
// Added: Full monitoring UI for Instructors tab (online badge, last active,
// course performance table, activity timeline).
// Added: Discussions monitoring tab (platform-wide thread view with stats).
// Added: 30-second auto-refresh for stats + online status polling.

"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Users, BookOpen, Award, BarChart3, UserPlus, PlusCircle,
  GraduationCap, Shield, Zap, CheckCircle, X, Eye, EyeOff,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Film, AlertCircle, MessageSquare, Star, RefreshCw,
  Activity, Send, Inbox, Lock, Clock, ThumbsUp, ThumbsDown,
  FileText, Wifi, WifiOff, Timer, TrendingUp, BookMarked,
  MessageCircle,
} from "lucide-react";

const VideoUpload = dynamic(() => import("@/components/course/VideoUpload"), { ssr: false });

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Stats {
  students: number;
  instructors: number;
  courses: number;
  publishedCourses: number;
  pendingCourses: number;
  modules: number;
  publishedModules: number;
  videos: number;
  enrollments: number;
  activeEnrollments: number;
  completedEnrollments: number;
  certificates: number;
  quizAttempts: number;
  feedbackCount: number;
  avgRating: number | null;
  platformActivityCount: number;
  adminMessageCount: number;
  unreadAdminMessages: number;
}

interface Certificate {
  id: string;
  issuedAt: string;
  overallPercentage: number;
  course: { title: string };
}

// Enriched enrollment returned by /api/admin/students
interface EnrollmentWithProgress {
  id: string;
  course: { id: string; title: string; slug: string };
  status: string;
  enrolledAt: string;
  completedAt: string | null;
  progressPct: number;
  completedModules: number;
  totalModules: number;
}

// Per-student activity log entry
interface StudentActivityEntry {
  id: string;
  activityType: string;
  targetTitle: string | null;
  targetType: string | null;
  createdAt: string;
}

// Full monitoring-enriched Student returned by /api/admin/students
interface Student {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  profile: {
    phone?: string | null;
    bio?: string | null;
    college?: string | null;
    education?: string | null;
  } | null;
  // Monitoring fields
  isOnline: boolean;
  lastActiveAt: string | null;
  totalLearningSeconds: number;
  // Enriched data
  enrollments: EnrollmentWithProgress[];
  certificates: Certificate[];
  activityLog: StudentActivityEntry[];
  _count: { enrollments: number; certificates: number; quizAttempts: number };
}

// Per-course performance for instructor monitoring
interface CoursePerformance {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  approvalStatus: string;
  enrollmentCount: number;
  completionCount: number;
  avgRating: number | null;
  reviewCount: number;
}

// Per-instructor activity log entry
interface InstructorActivityEntry {
  id: string;
  activityType: string;
  targetTitle: string | null;
  targetType: string | null;
  createdAt: string;
}

// Full monitoring-enriched Instructor returned by /api/admin/instructors
interface Instructor {
  id: string;
  name: string;
  email: string;
  specialization?: string | null;
  bio?: string | null;
  createdAt: string;
  // Monitoring fields
  isOnline: boolean;
  lastActiveAt: string | null;
  totalPlatformActivityCount: number;
  totalEnrollments: number;
  // Enriched data
  courses: { id: string; _count: { enrollments: number } }[];
  coursePerformance: CoursePerformance[];
  activityLog: InstructorActivityEntry[];
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string;
  correctAnswer: number;
  explanation?: string | null;
  order: number;
}

interface Quiz {
  id: string;
  title: string;
  description?: string | null;
  passingPercentage?: number | null;
  timeLimit?: number | null;
  _count: { questions: number; attempts: number };
  questions?: QuizQuestion[];
}

interface Module {
  id: string;
  title: string;
  description?: string | null;
  contentMd?: string | null;
  order: number;
  videoUrl: string | null;
  videoKey: string | null;
  videoDurationSecs: number | null;
  isPublished: boolean;
  isFree: boolean;
  durationMins: number;
  quizzes: Quiz[];
}

interface Course {
  id: string;
  title: string;
  slug: string;
  description?: string;
  category?: string;
  level?: string;
  price?: number;
  thumbnail?: string | null;
  isPublished: boolean;
  isFeatured?: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewComment?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  instructor: { name: string; email?: string } | null;
  _count: { enrollments: number; modules: number };
  modules: Module[];
}

interface FeedbackItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  isHidden: boolean;
  user: { id: string; name: string | null; email: string };
  course: { id: string; title: string; slug: string };
}

interface ActivityItem {
  id: string;
  activityType: string;
  actorName: string | null;
  actorRole: string | null;
  targetTitle: string | null;
  targetType: string | null;
  metadata: string;
  createdAt: string;
}

interface MessageThread {
  threadId: string;
  otherUser: { id: string; name: string | null; email: string; role: string };
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface MessageItem {
  id: string;
  body: string;
  senderRole: string;
  isReadByRecipient: boolean;
  isReadByAdmin: boolean;
  createdAt: string;
}

interface MessageableUser {
  id: string;
  name: string | null;
  email: string;
  role: "STUDENT" | "INSTRUCTOR";
}

interface DiscussionItem {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  isResolved: boolean;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string | null; email: string; role: string };
  course: { id: string; title: string; slug: string };
  _count: { replies: number };
}

interface DiscussionStats {
  total: number;
  active: number;
  resolved: number;
  hidden: number;
}

interface Props {
  stats: Stats;
  instructors: Instructor[];
  courses: Course[];
}

// ── Utility helpers ───────────────────────────────────────────────────────────

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

function formatLearningTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}

function OnlineBadge({ isOnline }: { isOnline: boolean }) {
  return isOnline ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      Online
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white/5 text-text-muted border border-border">
      <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
      Offline
    </span>
  );
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  ENROLLMENT:         "Enrollment",
  PROGRESS_UPDATE:    "Progress Update",
  COURSE_COMPLETED:   "Course Completed",
  CERTIFICATE_ISSUED: "Certificate Issued",
  VIDEO_UPLOADED:     "Video Uploaded",
  MODULE_UPDATED:     "Module Updated",
  COURSE_CREATED:     "Course Created",
  COURSE_UPDATED:     "Course Updated",
  COURSE_APPROVED:    "Course Approved",
  COURSE_REJECTED:    "Course Rejected",
  REVIEW_SUBMITTED:   "Review Submitted",
  ADMIN_MESSAGE_SENT: "Admin Message",
  QUIZ_ATTEMPTED:     "Quiz Attempted",
};

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  ENROLLMENT:         "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  PROGRESS_UPDATE:    "bg-violet-500/15 text-violet-400 border-violet-500/25",
  COURSE_COMPLETED:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  CERTIFICATE_ISSUED: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  VIDEO_UPLOADED:     "bg-pink-500/15 text-pink-400 border-pink-500/25",
  MODULE_UPDATED:     "bg-blue-500/15 text-blue-400 border-blue-500/25",
  COURSE_CREATED:     "bg-orange-500/15 text-orange-400 border-orange-500/25",
  COURSE_UPDATED:     "bg-orange-500/15 text-orange-400 border-orange-500/25",
  COURSE_APPROVED:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  COURSE_REJECTED:    "bg-red-500/15 text-red-400 border-red-500/25",
  REVIEW_SUBMITTED:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  ADMIN_MESSAGE_SENT: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  QUIZ_ATTEMPTED:     "bg-teal-500/15 text-teal-400 border-teal-500/25",
};

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

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ pct, color = "bg-cyan-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

// ── Admin module video row (unchanged from original) ──────────────────────────

function AdminModuleVideoRow({ mod }: { mod: Module }) {
  const [playingVideo, setPlayingVideo] = useState(false);
  const [videoFileMissing, setVideoFileMissing] = useState(false);

  if (!mod.videoKey) {
    return (
      <span className="text-text-muted/50 flex items-center gap-1">
        <Film className="w-3 h-3" /> No video uploaded
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {videoFileMissing ? (
          <span className="text-red-400 flex items-center gap-1 text-xs">
            <AlertCircle className="w-3 h-3" /> Video file missing on server
          </span>
        ) : (
          <button
            onClick={() => setPlayingVideo(!playingVideo)}
            className="flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors font-medium text-xs"
          >
            <Film className="w-3 h-3" />
            {playingVideo ? "Hide Video" : "Watch Video"}
            {mod.videoDurationSecs && (
              <span className="text-text-muted font-normal ml-1">
                ({Math.round(mod.videoDurationSecs / 60)}m)
              </span>
            )}
          </button>
        )}
        {videoFileMissing && (
          <span className="text-red-300/60 text-xs">— re-upload required via Courses tab</span>
        )}
      </div>

      {playingVideo && !videoFileMissing && (
        <div className="rounded-xl overflow-hidden bg-black border border-border/50">
          <video
            src={`/api/video/${mod.id}/stream`}
            controls
            controlsList="nodownload"
            className="w-full max-h-64 object-contain"
            preload="metadata"
            onError={() => { setVideoFileMissing(true); setPlayingVideo(false); }}
          >
            Your browser does not support the video tag.
          </video>
          <p className="text-text-muted text-xs px-3 py-1.5 bg-black/30">
            {mod.title} — streamed via secure endpoint (admin access)
          </p>
        </div>
      )}

      {videoFileMissing && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-xs font-semibold">Video File Missing</p>
            <p className="text-red-300/70 text-xs mt-0.5">
              The database has a video record (<code className="text-red-300/60">{mod.videoKey}</code>)
              but the file was not found on the server. Go to the{" "}
              <strong>Courses tab → expand this module</strong> to re-upload the video.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CoursePreviewModal({ course, onClose }: { course: Course; onClose: () => void }) {
  const [expandedQuizId, setExpandedQuizId] = useState<string | null>(null);
  const [fullCourse, setFullCourse] = useState<Course>(course);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/admin/courses/${course.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          if (data.course) setFullCourse(data.course);
          else setFetchError("Failed to load full course details.");
        }
      })
      .catch(() => { if (!cancelled) setFetchError("Network error loading course details."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [course.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="glass-bright rounded-3xl border border-border w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-white font-bold text-lg">Course Preview</h2>
              <p className="text-text-muted text-xs">Reviewing as Admin — full content visible</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-10 text-text-muted text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading full course details…
            </div>
          )}
          {fetchError && !loading && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {fetchError}
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <ApprovalBadge course={fullCourse} />
              {fullCourse.category && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">
                  {fullCourse.category}
                </span>
              )}
            </div>
            <h3 className="text-white font-black text-2xl mb-2">{fullCourse.title}</h3>
            {fullCourse.description && (
              <p className="text-text-secondary text-sm leading-relaxed">{fullCourse.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              <span>By: <span className="text-white">{fullCourse.instructor?.name || "No instructor"}</span></span>
              <span>{fullCourse._count.enrollments} enrolled</span>
              <span>{fullCourse._count.modules} modules</span>
              {fullCourse.price !== undefined && (
                <span className="text-white font-semibold">
                  {fullCourse.price === 0 ? "Free" : `₹${fullCourse.price}`}
                </span>
              )}
            </div>
          </div>

          {fullCourse.thumbnail && (
            <div className="rounded-xl overflow-hidden h-48">
              <img src={fullCourse.thumbnail} alt={fullCourse.title} className="w-full h-full object-cover" />
            </div>
          )}

          {fullCourse.reviewComment && (
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-amber-400 text-xs font-semibold mb-1">Previous Review Comment</p>
              <p className="text-amber-300/80 text-sm">{fullCourse.reviewComment}</p>
            </div>
          )}

          <div>
            <h4 className="text-white font-bold mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-cyan-400" />
              Course Modules ({fullCourse.modules.length})
            </h4>
            {fullCourse.modules.length === 0 ? (
              <div className="text-center py-6 text-text-muted text-sm glass rounded-xl border border-border">
                No modules added yet.
              </div>
            ) : (
              <div className="space-y-4">
                {fullCourse.modules.map((mod) => (
                  <div key={mod.id} className="glass rounded-xl border border-border overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-text-muted text-xs font-mono w-5">{mod.order}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm mb-1">{mod.title}</p>
                          {mod.description && (
                            <p className="text-text-muted text-xs mb-2">{mod.description}</p>
                          )}
                          <AdminModuleVideoRow mod={mod} />
                        </div>
                      </div>
                    </div>
                    {mod.quizzes.length > 0 && (
                      <div className="border-t border-border/50 px-4 py-3 bg-black/5">
                        <p className="text-text-muted text-xs font-medium mb-2 uppercase tracking-wider">
                          Quizzes ({mod.quizzes.length})
                        </p>
                        <div className="space-y-3">
                          {mod.quizzes.map((quiz) => {
                            const isExpanded = expandedQuizId === quiz.id;
                            const parsedQuestions: QuizQuestion[] = quiz.questions ?? [];
                            return (
                              <div key={quiz.id} className="rounded-lg bg-violet-500/5 border border-violet-500/15 overflow-hidden">
                                <button
                                  onClick={() => setExpandedQuizId(isExpanded ? null : quiz.id)}
                                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-violet-500/10 transition-colors"
                                >
                                  <div className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-white text-xs font-medium">{quiz.title}</p>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                                      <span className="text-violet-400">{quiz._count.questions} questions</span>
                                      {quiz._count.attempts > 0 && <span>{quiz._count.attempts} attempts</span>}
                                    </div>
                                  </div>
                                  <span className="text-text-muted text-xs">{isExpanded ? "▲ Hide" : "▼ Show"}</span>
                                </button>
                                {isExpanded && (
                                  <div className="border-t border-violet-500/15 p-3 space-y-4">
                                    {parsedQuestions.length === 0 ? (
                                      <p className="text-text-muted text-xs text-center py-2">No questions added yet.</p>
                                    ) : (
                                      parsedQuestions.map((q, qi) => {
                                        let options: string[] = [];
                                        try { options = JSON.parse(q.options); } catch { options = []; }
                                        return (
                                          <div key={q.id} className="space-y-2">
                                            <p className="text-white text-xs font-medium">
                                              <span className="text-text-muted mr-1.5">Q{qi + 1}.</span>{q.question}
                                            </p>
                                            <div className="space-y-1 ml-5">
                                              {options.map((opt, oi) => (
                                                <div key={oi} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${oi === q.correctAnswer ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-white/3 border-border/40 text-text-secondary"}`}>
                                                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${oi === q.correctAnswer ? "bg-emerald-500/30 text-emerald-300" : "bg-white/10 text-text-muted"}`}>
                                                    {String.fromCharCode(65 + oi)}
                                                  </span>
                                                  <span className="flex-1">{opt}</span>
                                                  {oi === q.correctAnswer && <span className="text-emerald-400 text-[10px] font-semibold">✓ Correct</span>}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalActionModal({
  course, action, onClose, onSuccess,
}: {
  course: Course;
  action: "approve" | "reject";
  onClose: () => void;
  onSuccess: (updated: Course) => void;
}) {
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (action === "reject" && !comment.trim()) {
      setError("A review comment is required when rejecting a course.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewComment: comment.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `Failed to ${action} course.`); return; }
      onSuccess(data.course);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="glass-bright rounded-3xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-lg">
            {action === "approve" ? "Approve Course" : "Reject Course"}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mb-4 p-3 rounded-xl bg-white/3 border border-border">
          <p className="text-white text-sm font-semibold truncate">{course.title}</p>
          <p className="text-text-muted text-xs mt-0.5">{course.instructor?.name || "No instructor"}</p>
        </div>
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}
        <div className="mb-5">
          <label className="text-text-muted text-xs font-medium mb-1.5 block">
            {action === "reject" ? "Rejection Reason *" : "Review Comment (optional)"}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder={action === "reject" ? "Explain what needs to be fixed..." : "Optional feedback for the instructor..."}
            className="w-full px-3 py-2.5 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 transition-all resize-none"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-text-muted hover:text-white text-sm transition-all">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${action === "approve" ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30" : "bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"}`}
          >
            {loading ? "Processing..." : action === "approve" ? "Approve Course" : "Reject Course"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminModuleUploadRow({
  mod, course, onVideoUploaded,
}: {
  mod: Module;
  course: Course;
  onVideoUploaded: (courseId: string, moduleId: string, videoUrl: string) => void;
}) {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [videoFileMissing, setVideoFileMissing] = useState(false);

  return (
    <div className="glass rounded-xl border border-border overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/2 transition-colors"
        onClick={() => setIsUploadOpen(!isUploadOpen)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-text-muted text-xs w-5 text-center font-mono">{mod.order}</span>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{mod.title}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${mod.isPublished ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                {mod.isPublished ? "Published" : "Draft"}
              </span>
              {mod.videoKey && !videoFileMissing && (
                <span className="text-xs text-violet-400">
                  <Film className="w-3 h-3 inline mr-0.5" />
                  Video{mod.videoDurationSecs && <span className="text-text-muted ml-1">({Math.round(mod.videoDurationSecs / 60)}m)</span>}
                </span>
              )}
              {videoFileMissing && (
                <span className="text-xs text-red-400 flex items-center gap-0.5">
                  <AlertCircle className="w-3 h-3" /> File missing
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${videoFileMissing ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-violet-500/10 text-violet-400 border-violet-500/20"}`}>
            <Film className="w-3 h-3" />
            {videoFileMissing ? "Re-upload" : mod.videoKey ? "Replace" : "Upload"}
          </span>
          {isUploadOpen ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
        </div>
      </div>

      {isUploadOpen && (
        <div className="border-t border-border/50 p-4 bg-black/10 space-y-3">
          {mod.videoKey && !videoFileMissing && (
            <div className="rounded-xl overflow-hidden bg-black border border-border/50">
              <video
                src={`/api/video/${mod.id}/stream`}
                controls
                controlsList="nodownload"
                className="w-full max-h-48 object-contain"
                preload="metadata"
                onError={() => setVideoFileMissing(true)}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          )}
          <VideoUpload
            moduleId={mod.id}
            currentVideoUrl={mod.videoUrl}
            onUploaded={(url) => {
              onVideoUploaded(course.id, mod.id, url);
              setIsUploadOpen(false);
              setVideoFileMissing(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdminDashboardClient({
  stats: initialStats,
  instructors: initialInstructors,
  courses: initialCourses,
}: Props) {
  type Tab = "overview" | "students" | "instructors" | "courses" | "discussions" | "activity" | "messages" | "feedback";
  const [tab, setTab] = useState<Tab>("overview");
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [statsRefreshing, setStatsRefreshing] = useState(false);

  const [showAddInstructor, setShowAddInstructor] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", bio: "", specialization: "" });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // ── Students state ──────────────────────────────────────────────────────────
  const [students, setStudents] = useState<Student[] | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsErr, setStudentsErr] = useState("");
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [studentsPage, setStudentsPage] = useState(1);
  const [studentsTotalPages, setStudentsTotalPages] = useState(1);
  const [studentsTotalCount, setStudentsTotalCount] = useState(0);
  const [studentsSearch, setStudentsSearch] = useState("");
  const studentsSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Instructors state (live-fetched for monitoring) ─────────────────────────
  const [instructors, setInstructors] = useState<Instructor[]>(initialInstructors as Instructor[]);
  const [instructorsLoading, setInstructorsLoading] = useState(false);
  const [expandedInstructor, setExpandedInstructor] = useState<string | null>(null);

  // ── Courses state ───────────────────────────────────────────────────────────
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED" | "PUBLISHED">("ALL");
  const [previewCourse, setPreviewCourse] = useState<Course | null>(null);
  const [approvalModal, setApprovalModal] = useState<{ course: Course; action: "approve" | "reject" } | null>(null);

  // ── Discussions state ───────────────────────────────────────────────────────
  const [discussions, setDiscussions] = useState<DiscussionItem[]>([]);
  const [discussionStats, setDiscussionStats] = useState<DiscussionStats | null>(null);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [discussionsError, setDiscussionsError] = useState("");
  const [discussionsPage, setDiscussionsPage] = useState(1);
  const [discussionsTotalPages, setDiscussionsTotalPages] = useState(1);
  const [discussionStatusFilter, setDiscussionStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [expandedDiscussion, setExpandedDiscussion] = useState<string | null>(null);
  const [discussionReplies, setDiscussionReplies] = useState<Record<string, any[]>>({});

  // ── Feedback state ──────────────────────────────────────────────────────────
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackTotalPages, setFeedbackTotalPages] = useState(1);
  const [showHiddenFeedback, setShowHiddenFeedback] = useState(false);

  // ── Activity state ──────────────────────────────────────────────────────────
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityTypeFilter, setActivityTypeFilter] = useState("ALL");
  const [activityTypeCounts, setActivityTypeCounts] = useState<{ type: string; count: number }[]>([]);

  // ── Messages state ──────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [activeThreadUserId, setActiveThreadUserId] = useState<string | null>(null);
  const [activeThreadMessages, setActiveThreadMessages] = useState<MessageItem[]>([]);
  const [activeThreadOtherUser, setActiveThreadOtherUser] = useState<MessageThread["otherUser"] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadSearch, setNewThreadSearch] = useState("");

  // ── Auto-refresh (30 seconds) ───────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      // Refresh stats silently
      fetch("/api/admin/stats").then((r) => r.json()).then((d) => { if (d && !d.error) setStats(d); }).catch(() => {});
      // If students tab is open, refresh student online status silently
      if (tab === "students" && students !== null) {
        fetchStudents(studentsPage, studentsSearch, true);
      }
      // If instructors tab is open, refresh instructor online status silently
      if (tab === "instructors") {
        fetchInstructors(true);
      }
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, studentsPage, studentsSearch, students]);

  // ── Data fetchers ───────────────────────────────────────────────────────────

  const refreshStats = useCallback(async () => {
    setStatsRefreshing(true);
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json();
      if (res.ok) setStats(data);
    } catch { /* silently fail */ } finally { setStatsRefreshing(false); }
  }, []);

  const fetchStudents = async (page = 1, search = "", silent = false) => {
    if (!silent) { setStudentsLoading(true); setStudentsErr(""); }
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/admin/students?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) { if (!silent) setStudentsErr(data.error || "Failed to load students."); return; }
      setStudents(data.students);
      setStudentsPage(data.pagination.page);
      setStudentsTotalPages(data.pagination.totalPages);
      setStudentsTotalCount(data.pagination.totalCount);
    } catch {
      if (!silent) setStudentsErr("Network error loading students.");
    } finally {
      if (!silent) setStudentsLoading(false);
    }
  };

  const fetchInstructors = async (silent = false) => {
    if (!silent) setInstructorsLoading(true);
    try {
      const res = await fetch("/api/admin/instructors");
      const data = await res.json();
      if (res.ok && data.instructors) setInstructors(data.instructors);
    } catch { /* ignore */ } finally {
      if (!silent) setInstructorsLoading(false);
    }
  };

  const fetchDiscussions = useCallback(async (page = 1, status: "all" | "open" | "resolved" = "all") => {
    setDiscussionsLoading(true);
    setDiscussionsError("");
    try {
      const params = new URLSearchParams({ page: String(page), status });
      const res = await fetch(`/api/admin/discussions?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) { setDiscussionsError(data.error || "Failed to load discussions."); return; }
      setDiscussions(data.discussions);
      setDiscussionsPage(data.page);
      setDiscussionsTotalPages(data.totalPages);
      if (data.stats) setDiscussionStats(data.stats);
    } catch {
      setDiscussionsError("Network error loading discussions.");
    } finally {
      setDiscussionsLoading(false);
    }
  }, []);

  const fetchDiscussionReplies = async (discussionId: string) => {
    try {
      const res = await fetch(`/api/admin/discussions?withReplies=true&page=1`);
      // Re-fetch single discussion with replies via the discussion-specific endpoint
      // (the admin discussions API returns replies when withReplies=true)
      // For now we load all with replies and find the matching one
      const data = await res.json();
      if (res.ok && data.discussions) {
        const found = data.discussions.find((d: any) => d.id === discussionId);
        if (found?.replies) {
          setDiscussionReplies((prev) => ({ ...prev, [discussionId]: found.replies }));
        }
      }
    } catch { /* ignore */ }
  };

  const fetchFeedback = useCallback(async (page = 1, showHidden = false) => {
    setFeedbackLoading(true);
    setFeedbackError("");
    try {
      const res = await fetch(`/api/admin/feedback?page=${page}&showHidden=${showHidden}`);
      const data = await res.json();
      if (!res.ok) { setFeedbackError(data.error || "Failed to load feedback."); return; }
      setFeedbackList(data.feedback);
      setFeedbackPage(data.page);
      setFeedbackTotalPages(data.totalPages);
    } catch {
      setFeedbackError("Network error loading feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  }, []);

  const fetchActivity = useCallback(async (page = 1, typeFilter = "ALL") => {
    setActivitiesLoading(true);
    setActivitiesError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      const res = await fetch(`/api/admin/activity?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) { setActivitiesError(data.error || "Failed to load activity."); return; }
      setActivities(data.activities);
      setActivityPage(data.page);
      setActivityTotalPages(data.totalPages);
      setActivityTotal(data.total);
      if (data.typeCounts) setActivityTypeCounts(data.typeCounts);
    } catch {
      setActivitiesError("Network error loading activity.");
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError("");
    try {
      const res = await fetch("/api/admin/messages");
      const data = await res.json();
      if (!res.ok) { setThreadsError(data.error || "Failed to load messages."); return; }
      setThreads(data.threads ?? []);
    } catch {
      setThreadsError("Network error loading messages.");
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const openThread = async (userId: string) => {
    setActiveThreadUserId(userId);
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/admin/messages?userId=${userId}`);
      const data = await res.json();
      if (res.ok) {
        setActiveThreadMessages(data.messages ?? []);
        setActiveThreadOtherUser(data.otherUser ?? null);
        fetchThreads();
      }
    } catch { /* ignore */ } finally { setThreadLoading(false); }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeThreadUserId) return;
    setSendingMessage(true);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim(), recipientId: activeThreadUserId }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewMessage("");
        await openThread(activeThreadUserId);
        refreshStats();
      } else {
        setErr(data.error || "Failed to send message.");
      }
    } catch {
      setErr("Network error. Could not send message.");
    } finally {
      setSendingMessage(false);
    }
  };

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    if (newTab === "students" && students === null) fetchStudents(1);
    if (newTab === "instructors") fetchInstructors();
    if (newTab === "discussions") fetchDiscussions(1, discussionStatusFilter);
    if (newTab === "feedback") fetchFeedback(1, showHiddenFeedback);
    if (newTab === "activity") fetchActivity(1, activityTypeFilter);
    if (newTab === "messages") {
      fetchThreads();
      if (students === null) fetchStudents(1);
    }
  };

  const handleStudentsSearch = (q: string) => {
    setStudentsSearch(q);
    if (studentsSearchTimer.current) clearTimeout(studentsSearchTimer.current);
    studentsSearchTimer.current = setTimeout(() => {
      setStudentsPage(1);
      fetchStudents(1, q);
    }, 350);
  };

  const handleAddInstructor = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr(""); setMsg("");
    const res = await fetch("/api/admin/instructors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setErr(data.error); return; }
    setMsg("Instructor created successfully!");
    setShowAddInstructor(false);
    setForm({ name: "", email: "", password: "", bio: "", specialization: "" });
    setTimeout(() => window.location.reload(), 1200);
  };

  const handleTogglePublish = async (course: Course) => {
    if (!course.isPublished && course.approvalStatus !== "APPROVED") {
      setErr(`"${course.title}" must be approved before it can be published.`);
      setTimeout(() => setErr(""), 4000);
      return;
    }
    setPublishingId(course.id); setErr("");
    try {
      const res = await fetch(`/api/admin/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: course.isPublished ? "unpublish" : "publish" }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Failed to update course."); return; }
      setCourses((prev) => prev.map((c) => c.id === course.id ? { ...c, isPublished: data.course.isPublished, approvalStatus: data.course.approvalStatus } : c));
      setMsg(data.course.isPublished ? `"${course.title}" is now published.` : `"${course.title}" has been unpublished.`);
      setTimeout(() => setMsg(""), 3000);
      refreshStats();
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setPublishingId(null);
    }
  };

  const handleApprovalSuccess = (updatedCourse: Course) => {
    setCourses((prev) => prev.map((c) => c.id === updatedCourse.id ? { ...c, approvalStatus: updatedCourse.approvalStatus, reviewComment: updatedCourse.reviewComment, isPublished: updatedCourse.isPublished, approvedAt: updatedCourse.approvedAt, rejectedAt: updatedCourse.rejectedAt } : c));
    const action = updatedCourse.approvalStatus === "APPROVED" ? "approved" : "rejected";
    setMsg(`Course has been ${action}.`);
    setTimeout(() => setMsg(""), 4000);
    setApprovalModal(null);
    refreshStats();
  };

  const handleVideoUploaded = useCallback((courseId: string, moduleId: string, videoUrl: string) => {
    setCourses((prev) => prev.map((c) => c.id !== courseId ? c : { ...c, modules: c.modules.map((m) => m.id !== moduleId ? m : { ...m, videoUrl, videoKey: `${moduleId}.mp4` }) }));
    setMsg("Video uploaded successfully!");
    setTimeout(() => setMsg(""), 5000);
    refreshStats();
  }, [refreshStats]);

  const handleFeedbackModerate = async (feedbackId: string, hide: boolean) => {
    const res = await fetch("/api/feedback/moderate", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackId, hide }),
    });
    if (res.ok) {
      fetchFeedback(feedbackPage, showHiddenFeedback);
      setMsg(hide ? "Feedback hidden." : "Feedback restored.");
      setTimeout(() => setMsg(""), 2000);
    }
  };

  const messageableUsers: MessageableUser[] = [
    ...(students ?? []).map((s) => ({ id: s.id, name: s.name, email: s.email, role: "STUDENT" as const })),
    ...instructors.map((inst) => ({ id: inst.id, name: inst.name, email: inst.email, role: "INSTRUCTOR" as const })),
  ];

  const filteredUsersForMessage = messageableUsers.filter((u) => {
    if (!newThreadSearch.trim()) return true;
    const q = newThreadSearch.toLowerCase();
    return (u.name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const startNewThread = async (user: MessageableUser) => {
    setShowNewThread(false);
    setNewThreadSearch("");
    await openThread(user.id);
    setThreads((prev) => {
      const tid = `admin_${user.id}`;
      if (prev.some((t) => t.threadId === tid)) return prev;
      return [{ threadId: tid, otherUser: { id: user.id, name: user.name, email: user.email, role: user.role }, lastMessage: "", lastMessageAt: new Date().toISOString(), unreadCount: 0 }, ...prev];
    });
  };

  const filteredCourses = courses.filter((c) => {
    if (courseFilter === "ALL") return true;
    if (courseFilter === "PUBLISHED") return c.isPublished;
    if (courseFilter === "PENDING") return c.approvalStatus === "PENDING" && !c.isPublished;
    if (courseFilter === "APPROVED") return c.approvalStatus === "APPROVED" && !c.isPublished;
    if (courseFilter === "REJECTED") return c.approvalStatus === "REJECTED";
    return true;
  });

  const pendingCount = courses.filter((c) => c.approvalStatus === "PENDING").length;
  const onlineStudentsCount = students ? students.filter((s) => s.isOnline).length : 0;
  const onlineInstructorsCount = instructors.filter((i) => i.isOnline).length;

  const inputCls = "w-full px-3 py-2.5 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 transition-all";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      {previewCourse && <CoursePreviewModal course={previewCourse} onClose={() => setPreviewCourse(null)} />}
      {approvalModal && (
        <ApprovalActionModal
          course={approvalModal.course}
          action={approvalModal.action}
          onClose={() => setApprovalModal(null)}
          onSuccess={handleApprovalSuccess}
        />
      )}

      <div className="max-w-7xl mx-auto px-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 text-violet-400 text-sm font-mono mb-1">
              <Shield className="w-4 h-4" /> ADMIN PANEL
            </div>
            <h1 className="text-3xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
              Nova<span className="text-gradient-cyan">Mind</span> Dashboard
            </h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setShowAddInstructor(true); handleTabChange("instructors"); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 text-black font-bold text-sm hover:opacity-90"
            >
              <UserPlus className="w-4 h-4" /> Add Instructor
            </button>
            <Link
              href="/admin/courses/new"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm hover:opacity-90"
            >
              <PlusCircle className="w-4 h-4" /> New Course
            </Link>
          </div>
        </div>

        {msg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />{msg}
          </div>
        )}
        {err && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />{err}
          </div>
        )}

        {pendingCount > 0 && tab !== "courses" && (
          <div
            className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center justify-between gap-2 cursor-pointer hover:bg-amber-500/15 transition-all"
            onClick={() => { handleTabChange("courses"); setCourseFilter("PENDING"); }}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>{pendingCount} course{pendingCount !== 1 ? "s" : ""} awaiting your review</span>
            </div>
            <span className="text-amber-300 text-xs font-medium">Review Now →</span>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
          {[
            { icon: Users,        label: "Students",     value: stats.students,     color: "text-cyan-400" },
            { icon: GraduationCap,label: "Instructors",  value: stats.instructors,  color: "text-orange-400" },
            { icon: BookOpen,     label: "Courses",      value: stats.courses,      color: "text-violet-400" },
            { icon: Zap,          label: "Enrollments",  value: stats.enrollments,  color: "text-emerald-400" },
            { icon: Award,        label: "Certificates", value: stats.certificates, color: "text-amber-400" },
            { icon: Film,         label: "Videos",       value: stats.videos ?? 0,  color: "text-pink-400" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="glass-bright rounded-2xl p-4 border border-border text-center">
              <Icon className={`w-5 h-5 ${color} mx-auto mb-2`} />
              <div className="text-2xl font-black text-white">{value ?? 0}</div>
              <div className="text-text-muted text-xs">{label}</div>
            </div>
          ))}
        </div>

        {/* Secondary stats row — includes live online counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="glass-bright rounded-2xl p-4 border border-emerald-500/20 text-center">
            <Wifi className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-emerald-400">
              {tab === "students" ? onlineStudentsCount : "—"}
            </div>
            <div className="text-text-muted text-xs">Students Online</div>
          </div>
          <div className="glass-bright rounded-2xl p-4 border border-orange-500/20 text-center">
            <Wifi className="w-5 h-5 text-orange-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-orange-400">
              {tab === "instructors" ? onlineInstructorsCount : "—"}
            </div>
            <div className="text-text-muted text-xs">Instructors Online</div>
          </div>
          <div
            className="glass-bright rounded-2xl p-4 border border-amber-500/30 text-center cursor-pointer hover:bg-amber-500/5 transition-all"
            onClick={() => { handleTabChange("courses"); setCourseFilter("PENDING"); }}
            title="Click to view pending courses"
          >
            <Clock className="w-5 h-5 text-amber-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-amber-400">{stats.pendingCourses ?? 0}</div>
            <div className="text-text-muted text-xs">Pending Review</div>
          </div>
          <div className="glass-bright rounded-2xl p-4 border border-border text-center">
            <Star className="w-5 h-5 text-yellow-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white">
              {stats.avgRating != null ? stats.avgRating.toFixed(1) : "—"}
            </div>
            <div className="text-text-muted text-xs">Avg. Rating</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="glass-bright rounded-2xl p-4 border border-border text-center">
            <Activity className="w-5 h-5 text-blue-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white">{stats.platformActivityCount ?? 0}</div>
            <div className="text-text-muted text-xs">Activity Events</div>
          </div>
          <div className="glass-bright rounded-2xl p-4 border border-border text-center">
            <MessageSquare className="w-5 h-5 text-purple-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white">{stats.adminMessageCount ?? 0}</div>
            <div className="text-text-muted text-xs">Admin Messages</div>
          </div>
          <div className="glass-bright rounded-2xl p-4 border border-border text-center">
            <Zap className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white">{stats.activeEnrollments ?? 0}</div>
            <div className="text-text-muted text-xs">Active Enrollments</div>
          </div>
          <div className="glass-bright rounded-2xl p-4 border border-border text-center">
            <CheckCircle className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white">{stats.completedEnrollments ?? 0}</div>
            <div className="text-text-muted text-xs">Completed Courses</div>
          </div>
        </div>

        <div className="flex justify-end mb-4">
          <button
            onClick={refreshStats}
            disabled={statsRefreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl glass border border-border text-text-muted text-xs hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statsRefreshing ? "animate-spin" : ""}`} />
            Refresh Stats
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 glass rounded-xl p-1 border border-border w-fit mb-6 flex-wrap">
          {([
            ["overview",      "Overview"],
            ["students",      "Students"],
            ["instructors",   "Instructors"],
            ["courses",       pendingCount > 0 ? `Courses (${pendingCount})` : "Courses"],
            ["discussions",   "Discussions"],
            ["activity",      "Activity"],
            ["messages",      stats.unreadAdminMessages > 0 ? `Messages (${stats.unreadAdminMessages})` : "Messages"],
            ["feedback",      "Reviews"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === key
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : key === "messages" && (stats.unreadAdminMessages ?? 0) > 0
                  ? "text-purple-300 hover:text-white"
                  : key === "courses" && pendingCount > 0
                  ? "text-amber-300 hover:text-white"
                  : "text-text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Add Instructor Modal ── */}
        {showAddInstructor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="glass-bright rounded-3xl p-8 border border-border w-full max-w-md">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Add New Instructor</h2>
                <button onClick={() => { setShowAddInstructor(false); setErr(""); }} className="text-text-muted hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {err && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{err}</div>}
              <form onSubmit={handleAddInstructor} className="space-y-4">
                {[
                  ["name", "Full Name", "text"],
                  ["email", "Email", "email"],
                  ["password", "Password (min 8 chars)", "password"],
                  ["specialization", "Specialization", "text"],
                ].map(([field, label, type]) => (
                  <div key={field}>
                    <label className="text-text-secondary text-xs font-medium mb-1 block">{label}</label>
                    <input
                      type={type}
                      required={field !== "specialization"}
                      minLength={field === "password" ? 8 : undefined}
                      value={(form as any)[field]}
                      onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                      placeholder={label}
                      className={inputCls}
                    />
                  </div>
                ))}
                <div>
                  <label className="text-text-secondary text-xs font-medium mb-1 block">Bio (optional)</label>
                  <textarea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} rows={2} placeholder="Brief bio..." className={`${inputCls} resize-none`} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => { setShowAddInstructor(false); setErr(""); }} className="flex-1 py-2.5 rounded-xl border border-border text-text-muted hover:text-white text-sm transition-all">Cancel</button>
                  <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 text-black font-bold text-sm hover:opacity-90 disabled:opacity-50">
                    {loading ? "Creating..." : "Create Instructor"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="glass-bright rounded-2xl border border-border overflow-hidden">
                <div className="p-5 border-b border-border flex justify-between items-center">
                  <h3 className="text-white font-bold">Recent Instructors</h3>
                  <button onClick={() => handleTabChange("instructors")} className="text-cyan-400 text-xs hover:text-cyan-300">View all</button>
                </div>
                <div className="divide-y divide-border/50">
                  {instructors.slice(0, 5).map((inst) => (
                    <div key={inst.id} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center text-black font-bold text-sm">
                            {inst.name[0].toUpperCase()}
                          </div>
                          {inst.isOnline && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-black" />
                          )}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{inst.name}</p>
                          <p className="text-text-muted text-xs">{inst.email}</p>
                        </div>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full bg-orange-500/20 text-orange-300">
                        {inst.courses.length} courses
                      </span>
                    </div>
                  ))}
                  {instructors.length === 0 && <div className="p-6 text-center text-text-muted text-sm">No instructors yet.</div>}
                </div>
              </div>
              <div className="glass-bright rounded-2xl border border-border overflow-hidden">
                <div className="p-5 border-b border-border flex justify-between items-center">
                  <h3 className="text-white font-bold">Recent Courses</h3>
                  <button onClick={() => handleTabChange("courses")} className="text-cyan-400 text-xs hover:text-cyan-300">View all</button>
                </div>
                <div className="divide-y divide-border/50">
                  {courses.slice(0, 5).map((c) => (
                    <div key={c.id} className="p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium">{c.title}</p>
                          <ApprovalBadge course={c} />
                        </div>
                        <p className="text-text-muted text-xs">{c.instructor?.name || "No instructor"}</p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-300">{c._count.enrollments} enrolled</span>
                    </div>
                  ))}
                  {courses.length === 0 && <div className="p-6 text-center text-text-muted text-sm">No courses yet.</div>}
                </div>
              </div>
            </div>
            <div className="glass-bright rounded-2xl border border-border p-5">
              <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-violet-400" /> Platform Summary
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-black text-white">{stats.activeEnrollments ?? 0}</div>
                  <div className="text-text-muted text-xs mt-0.5">Active Enrollments</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-emerald-400">{stats.completedEnrollments ?? 0}</div>
                  <div className="text-text-muted text-xs mt-0.5">Completed Courses</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white">{stats.publishedCourses ?? 0}</div>
                  <div className="text-text-muted text-xs mt-0.5">Published Courses</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-amber-400">
                    {stats.avgRating != null ? stats.avgRating.toFixed(1) : "—"}
                  </div>
                  <div className="text-text-muted text-xs mt-0.5">Platform Rating</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STUDENTS MONITORING TAB ── */}
        {tab === "students" && (
          <div className="space-y-4">
            {/* Monitoring summary bar */}
            {students && students.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="glass-bright rounded-xl p-3 border border-emerald-500/20 text-center">
                  <div className="text-xl font-black text-emerald-400">{onlineStudentsCount}</div>
                  <div className="text-text-muted text-xs">Online Now</div>
                </div>
                <div className="glass-bright rounded-xl p-3 border border-border text-center">
                  <div className="text-xl font-black text-white">{studentsTotalCount}</div>
                  <div className="text-text-muted text-xs">Total Students</div>
                </div>
                <div className="glass-bright rounded-xl p-3 border border-border text-center">
                  <div className="text-xl font-black text-cyan-400">{stats.activeEnrollments}</div>
                  <div className="text-text-muted text-xs">Active Enrollments</div>
                </div>
                <div className="glass-bright rounded-xl p-3 border border-border text-center">
                  <div className="text-xl font-black text-amber-400">{stats.certificates}</div>
                  <div className="text-text-muted text-xs">Certificates Issued</div>
                </div>
              </div>
            )}

            <div className="glass-bright rounded-2xl border border-border overflow-hidden">
              <div className="p-5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-white font-bold">
                  Student Monitoring
                  {studentsTotalCount > 0 && <span className="text-text-muted font-normal text-sm ml-2">({studentsTotalCount})</span>}
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={studentsSearch}
                    onChange={(e) => handleStudentsSearch(e.target.value)}
                    placeholder="Search name or email…"
                    className="px-3 py-1.5 glass rounded-xl border border-border text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-cyan-500/50 w-48"
                  />
                  <button
                    onClick={() => fetchStudents(studentsPage, studentsSearch)}
                    disabled={studentsLoading}
                    className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all"
                  >
                    <RefreshCw className={`w-4 h-4 ${studentsLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {studentsLoading && <div className="p-8 text-center text-text-muted text-sm">Loading students…</div>}
              {studentsErr && <div className="p-5 text-red-400 text-sm">{studentsErr}</div>}
              {students && students.length === 0 && <div className="p-8 text-center text-text-muted text-sm">No students found.</div>}

              {students && students.length > 0 && (
                <>
                  <div className="divide-y divide-border/50">
                    {students.map((s) => {
                      const isExpanded = expandedStudent === s.id;
                      return (
                        <div key={s.id}>
                          <div
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/2 transition-colors"
                            onClick={() => setExpandedStudent(isExpanded ? null : s.id)}
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                                  {(s.name || s.email)[0].toUpperCase()}
                                </div>
                                {s.isOnline && (
                                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-black animate-pulse" />
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-white text-sm font-medium">{s.name || "—"}</p>
                                  <OnlineBadge isOnline={s.isOnline} />
                                </div>
                                <p className="text-text-muted text-xs">{s.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              {/* Last active */}
                              <div className="hidden md:block text-right">
                                <p className="text-text-muted text-xs flex items-center gap-1 justify-end">
                                  <Clock className="w-3 h-3" />
                                  {s.lastActiveAt ? timeAgo(s.lastActiveAt) : "Never"}
                                </p>
                                <p className="text-text-muted text-xs">last active</p>
                              </div>
                              {/* Learning time */}
                              <div className="hidden md:block text-right">
                                <p className="text-cyan-400 text-sm font-bold flex items-center gap-1 justify-end">
                                  <Timer className="w-3 h-3" />
                                  {formatLearningTime(s.totalLearningSeconds)}
                                </p>
                                <p className="text-text-muted text-xs">learned</p>
                              </div>
                              {/* Enrollments */}
                              <div className="hidden md:block text-right">
                                <p className="text-white text-sm font-bold">{s._count.enrollments}</p>
                                <p className="text-text-muted text-xs">courses</p>
                              </div>
                              {/* Certs */}
                              <div className="hidden md:block text-right">
                                <p className="text-amber-400 text-sm font-bold">{s._count.certificates}</p>
                                <p className="text-text-muted text-xs">certs</p>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleTabChange("messages"); openThread(s.id); }}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/25 text-purple-400 text-xs font-medium hover:bg-purple-500/20 transition-all"
                              >
                                <MessageSquare className="w-3.5 h-3.5" /> Message
                              </button>
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                            </div>
                          </div>

                          {/* ── Expanded monitoring panel ── */}
                          {isExpanded && (
                            <div className="bg-black/10 px-5 py-4 border-t border-border/30 space-y-5">
                              {/* Row 1: Status cards */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="glass rounded-xl p-3 border border-border text-center">
                                  <p className="text-xs text-text-muted mb-1">Status</p>
                                  <OnlineBadge isOnline={s.isOnline} />
                                </div>
                                <div className="glass rounded-xl p-3 border border-border text-center">
                                  <p className="text-xs text-text-muted mb-1">Last Active</p>
                                  <p className="text-white text-xs font-semibold">
                                    {s.lastActiveAt ? timeAgo(s.lastActiveAt) : "Never"}
                                  </p>
                                </div>
                                <div className="glass rounded-xl p-3 border border-border text-center">
                                  <p className="text-xs text-text-muted mb-1">Total Learning</p>
                                  <p className="text-cyan-400 text-sm font-bold">{formatLearningTime(s.totalLearningSeconds)}</p>
                                </div>
                                <div className="glass rounded-xl p-3 border border-border text-center">
                                  <p className="text-xs text-text-muted mb-1">Quiz Attempts</p>
                                  <p className="text-white text-sm font-bold">{s._count.quizAttempts}</p>
                                </div>
                              </div>

                              {/* Profile info */}
                              {s.profile && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                  {s.profile.college && <div><span className="text-text-muted">College: </span><span className="text-white">{s.profile.college}</span></div>}
                                  {s.profile.education && <div><span className="text-text-muted">Education: </span><span className="text-white">{s.profile.education}</span></div>}
                                  {s.profile.phone && <div><span className="text-text-muted">Phone: </span><span className="text-white">{s.profile.phone}</span></div>}
                                </div>
                              )}

                              {/* Course progress */}
                              {s.enrollments.length > 0 && (
                                <div>
                                  <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1">
                                    <TrendingUp className="w-3.5 h-3.5" /> Course Progress
                                  </p>
                                  <div className="space-y-2.5">
                                    {s.enrollments.map((enr) => (
                                      <div key={enr.id} className="glass rounded-xl p-3 border border-border">
                                        <div className="flex items-center justify-between mb-1.5">
                                          <p className="text-white text-xs font-medium truncate max-w-[60%]">{enr.course.title}</p>
                                          <div className="flex items-center gap-2">
                                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${enr.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-400" : enr.status === "ACTIVE" ? "bg-cyan-500/15 text-cyan-400" : "bg-red-500/15 text-red-400"}`}>
                                              {enr.status.toLowerCase()}
                                            </span>
                                            <span className="text-white text-xs font-bold">{enr.progressPct}%</span>
                                          </div>
                                        </div>
                                        <ProgressBar pct={enr.progressPct} color={enr.progressPct === 100 ? "bg-emerald-500" : "bg-cyan-500"} />
                                        <p className="text-text-muted text-xs mt-1">
                                          {enr.completedModules}/{enr.totalModules} modules · enrolled {timeAgo(enr.enrolledAt)}
                                          {enr.completedAt && ` · completed ${timeAgo(enr.completedAt)}`}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Certificates */}
                              {s.certificates.length > 0 && (
                                <div>
                                  <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <Award className="w-3.5 h-3.5" /> Certificates
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {s.certificates.map((c) => (
                                      <span key={c.id} className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400">
                                        {c.course.title} · {new Date(c.issuedAt).toLocaleDateString()}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Activity timeline */}
                              {s.activityLog.length > 0 && (
                                <div>
                                  <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <Activity className="w-3.5 h-3.5" /> Recent Activity
                                  </p>
                                  <div className="space-y-1.5">
                                    {s.activityLog.map((a) => (
                                      <div key={a.id} className="flex items-center gap-3 text-xs">
                                        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full border ${ACTIVITY_TYPE_COLORS[a.activityType] ?? "bg-white/5 text-white/60 border-white/10"}`}>
                                          {ACTIVITY_TYPE_LABELS[a.activityType] ?? a.activityType}
                                        </span>
                                        {a.targetTitle && <span className="text-white truncate">{a.targetTitle}</span>}
                                        <span className="text-text-muted ml-auto flex-shrink-0">{timeAgo(a.createdAt)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {s.enrollments.length === 0 && s.activityLog.length === 0 && (
                                <p className="text-text-muted text-xs text-center py-2">No activity recorded yet.</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {studentsTotalPages > 1 && (
                    <div className="p-4 border-t border-border flex items-center justify-center gap-2">
                      <button disabled={studentsPage === 1} onClick={() => { const p = studentsPage - 1; setStudentsPage(p); fetchStudents(p, studentsSearch); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30 transition-all">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-text-muted text-sm">Page {studentsPage} of {studentsTotalPages}</span>
                      <button disabled={studentsPage === studentsTotalPages} onClick={() => { const p = studentsPage + 1; setStudentsPage(p); fetchStudents(p, studentsSearch); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30 transition-all">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── INSTRUCTORS MONITORING TAB ── */}
        {tab === "instructors" && (
          <div className="space-y-4">
            {/* Monitoring summary bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="glass-bright rounded-xl p-3 border border-emerald-500/20 text-center">
                <div className="text-xl font-black text-emerald-400">{onlineInstructorsCount}</div>
                <div className="text-text-muted text-xs">Online Now</div>
              </div>
              <div className="glass-bright rounded-xl p-3 border border-border text-center">
                <div className="text-xl font-black text-white">{instructors.length}</div>
                <div className="text-text-muted text-xs">Total Instructors</div>
              </div>
              <div className="glass-bright rounded-xl p-3 border border-border text-center">
                <div className="text-xl font-black text-violet-400">{instructors.reduce((s, i) => s + i.courses.length, 0)}</div>
                <div className="text-text-muted text-xs">Total Courses</div>
              </div>
              <div className="glass-bright rounded-xl p-3 border border-border text-center">
                <div className="text-xl font-black text-orange-400">{instructors.reduce((s, i) => s + (i.totalEnrollments ?? 0), 0)}</div>
                <div className="text-text-muted text-xs">Total Enrollments</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-lg">Instructor Monitoring</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => fetchInstructors()} disabled={instructorsLoading} className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all">
                  <RefreshCw className={`w-4 h-4 ${instructorsLoading ? "animate-spin" : ""}`} />
                </button>
                <button onClick={() => setShowAddInstructor(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 text-sm font-medium hover:bg-orange-500/25 transition-all">
                  <UserPlus className="w-4 h-4" /> Add Instructor
                </button>
              </div>
            </div>

            {instructors.length === 0 ? (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <GraduationCap className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No instructors yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {instructors.map((inst) => {
                  const isExpanded = expandedInstructor === inst.id;
                  return (
                    <div key={inst.id} className="glass-bright rounded-2xl border border-border overflow-hidden">
                      <div
                        className="p-5 cursor-pointer hover:bg-white/2 transition-colors"
                        onClick={() => setExpandedInstructor(isExpanded ? null : inst.id)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center text-black font-bold">
                                {inst.name[0].toUpperCase()}
                              </div>
                              {inst.isOnline && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-black animate-pulse" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-white font-semibold">{inst.name}</p>
                                <OnlineBadge isOnline={inst.isOnline} />
                              </div>
                              <p className="text-text-muted text-xs">{inst.email}</p>
                              {inst.specialization && <p className="text-text-secondary text-xs mt-0.5">{inst.specialization}</p>}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="hidden md:block text-right">
                              <p className="text-text-muted text-xs">{inst.lastActiveAt ? timeAgo(inst.lastActiveAt) : "Never"}</p>
                              <p className="text-text-muted text-xs">last active</p>
                            </div>
                            <div className="hidden md:block text-right">
                              <p className="text-violet-400 text-sm font-bold">{inst.courses.length}</p>
                              <p className="text-text-muted text-xs">courses</p>
                            </div>
                            <div className="hidden md:block text-right">
                              <p className="text-orange-400 text-sm font-bold">{inst.totalEnrollments ?? 0}</p>
                              <p className="text-text-muted text-xs">enrollments</p>
                            </div>
                            <div className="hidden md:block text-right">
                              <p className="text-blue-400 text-sm font-bold">{inst.totalPlatformActivityCount ?? 0}</p>
                              <p className="text-text-muted text-xs">activities</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleTabChange("messages"); openThread(inst.id); }}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/25 text-purple-400 text-xs font-medium hover:bg-purple-500/20 transition-all"
                            >
                              <MessageSquare className="w-3 h-3" /> Message
                            </button>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                          </div>
                        </div>
                      </div>

                      {/* ── Expanded instructor monitoring panel ── */}
                      {isExpanded && (
                        <div className="border-t border-border/50 bg-black/10 px-5 py-4 space-y-5">
                          {/* Status cards */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="glass rounded-xl p-3 border border-border text-center">
                              <p className="text-xs text-text-muted mb-1">Status</p>
                              <OnlineBadge isOnline={inst.isOnline} />
                            </div>
                            <div className="glass rounded-xl p-3 border border-border text-center">
                              <p className="text-xs text-text-muted mb-1">Last Active</p>
                              <p className="text-white text-xs font-semibold">{inst.lastActiveAt ? timeAgo(inst.lastActiveAt) : "Never"}</p>
                              {inst.lastActiveAt && <p className="text-text-muted text-xs">{new Date(inst.lastActiveAt).toLocaleDateString()}</p>}
                            </div>
                            <div className="glass rounded-xl p-3 border border-border text-center">
                              <p className="text-xs text-text-muted mb-1">Total Activities</p>
                              <p className="text-blue-400 text-sm font-bold">{inst.totalPlatformActivityCount ?? 0}</p>
                            </div>
                            <div className="glass rounded-xl p-3 border border-border text-center">
                              <p className="text-xs text-text-muted mb-1">Total Enrollments</p>
                              <p className="text-orange-400 text-sm font-bold">{inst.totalEnrollments ?? 0}</p>
                            </div>
                          </div>

                          {/* Course performance table */}
                          {inst.coursePerformance && inst.coursePerformance.length > 0 && (
                            <div>
                              <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1">
                                <BookMarked className="w-3.5 h-3.5" /> Course Performance
                              </p>
                              <div className="space-y-2">
                                {inst.coursePerformance.map((cp) => (
                                  <div key={cp.id} className="glass rounded-xl p-3 border border-border">
                                    <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                                      <div className="flex items-center gap-2">
                                        <p className="text-white text-xs font-medium">{cp.title}</p>
                                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cp.isPublished ? "bg-emerald-500/15 text-emerald-400" : cp.approvalStatus === "PENDING" ? "bg-amber-500/15 text-amber-400" : "bg-white/5 text-text-muted"}`}>
                                          {cp.isPublished ? "Published" : cp.approvalStatus.toLowerCase()}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-4 text-xs text-text-muted">
                                        <span className="text-white font-semibold">{cp.enrollmentCount} enrolled</span>
                                        <span className="text-emerald-400">{cp.completionCount} completed</span>
                                        {cp.avgRating != null && (
                                          <span className="flex items-center gap-1 text-amber-400">
                                            <Star className="w-3 h-3 fill-amber-400" /> {cp.avgRating}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {cp.enrollmentCount > 0 && (
                                      <ProgressBar
                                        pct={cp.enrollmentCount > 0 ? Math.round((cp.completionCount / cp.enrollmentCount) * 100) : 0}
                                        color="bg-orange-500"
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Activity timeline */}
                          {inst.activityLog && inst.activityLog.length > 0 && (
                            <div>
                              <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Activity className="w-3.5 h-3.5" /> Recent Activity
                              </p>
                              <div className="space-y-1.5">
                                {inst.activityLog.map((a) => (
                                  <div key={a.id} className="flex items-center gap-3 text-xs">
                                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full border ${ACTIVITY_TYPE_COLORS[a.activityType] ?? "bg-white/5 text-white/60 border-white/10"}`}>
                                      {ACTIVITY_TYPE_LABELS[a.activityType] ?? a.activityType}
                                    </span>
                                    {a.targetTitle && <span className="text-white truncate">{a.targetTitle}</span>}
                                    <span className="text-text-muted ml-auto flex-shrink-0">{timeAgo(a.createdAt)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {inst.courses.length === 0 && (
                            <p className="text-text-muted text-xs text-center py-2">No courses created yet.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── COURSES TAB ── */}
        {tab === "courses" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="text-white font-bold text-lg">
                All Courses ({courses.length})
                {pendingCount > 0 && <span className="ml-2 text-amber-400 text-sm font-normal">· {pendingCount} pending review</span>}
              </h3>
              <div className="flex gap-1 glass rounded-xl p-1 border border-border">
                {[
                  { key: "ALL", label: "All" },
                  { key: "PENDING", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
                  { key: "APPROVED", label: "Approved" },
                  { key: "PUBLISHED", label: "Published" },
                  { key: "REJECTED", label: "Rejected" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setCourseFilter(key as typeof courseFilter)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      courseFilter === key
                        ? key === "PENDING" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "text-text-muted hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredCourses.length === 0 ? (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <BookOpen className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">{courseFilter === "ALL" ? "No courses yet." : `No ${courseFilter.toLowerCase()} courses.`}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCourses.map((course) => {
                  const isExpanded = expandedCourse === course.id;
                  return (
                    <div key={course.id} className="glass-bright rounded-2xl border border-border overflow-hidden">
                      <div className="p-5 cursor-pointer hover:bg-white/2 transition-colors" onClick={() => setExpandedCourse(isExpanded ? null : course.id)}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <ApprovalBadge course={course} />
                              {course.instructor && <span className="text-xs text-text-muted">{course.instructor.name}</span>}
                            </div>
                            <h3 className="text-white font-bold text-lg leading-tight">{course.title}</h3>
                            {course.description && <p className="text-text-muted text-xs mt-1 line-clamp-2">{course.description}</p>}
                            <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                              <span>{course._count.enrollments} students</span>
                              <span>{course._count.modules} modules</span>
                            </div>
                            {course.approvalStatus === "REJECTED" && course.reviewComment && (
                              <div className="mt-2 p-2 rounded-lg bg-red-500/5 border border-red-500/15">
                                <p className="text-red-400 text-xs"><span className="font-semibold">Rejection reason:</span> {course.reviewComment}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                            <button onClick={(e) => { e.stopPropagation(); setPreviewCourse(course); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all">
                              <Eye className="w-3.5 h-3.5" /> Preview
                            </button>
                            {course.approvalStatus === "PENDING" && (
                              <button onClick={(e) => { e.stopPropagation(); setApprovalModal({ course, action: "approve" }); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/25 transition-all">
                                <ThumbsUp className="w-3.5 h-3.5" /> Approve
                              </button>
                            )}
                            {(course.approvalStatus === "PENDING" || (course.approvalStatus === "APPROVED" && !course.isPublished)) && (
                              <button onClick={(e) => { e.stopPropagation(); setApprovalModal({ course, action: "reject" }); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/25 transition-all">
                                <ThumbsDown className="w-3.5 h-3.5" /> Reject
                              </button>
                            )}
                            {course.approvalStatus === "APPROVED" && (
                              <button onClick={(e) => { e.stopPropagation(); handleTogglePublish(course); }} disabled={publishingId === course.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${course.isPublished ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/25" : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/25"}`}>
                                {publishingId === course.id ? "..." : course.isPublished ? <><EyeOff className="w-3.5 h-3.5" /> Unpublish</> : <><Eye className="w-3.5 h-3.5" /> Publish</>}
                              </button>
                            )}
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border/50 p-5 space-y-3">
                          {course.modules.length === 0 ? (
                            <p className="text-text-muted text-sm text-center py-4">No modules in this course.</p>
                          ) : (
                            course.modules.map((mod) => (
                              <AdminModuleUploadRow key={mod.id} mod={mod} course={course} onVideoUploaded={handleVideoUploaded} />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── DISCUSSIONS MONITORING TAB ── */}
        {tab === "discussions" && (
          <div className="space-y-4">
            {/* Discussion stats */}
            {discussionStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="glass-bright rounded-xl p-3 border border-border text-center">
                  <div className="text-xl font-black text-white">{discussionStats.total}</div>
                  <div className="text-text-muted text-xs">Total Threads</div>
                </div>
                <div className="glass-bright rounded-xl p-3 border border-cyan-500/20 text-center">
                  <div className="text-xl font-black text-cyan-400">{discussionStats.active}</div>
                  <div className="text-text-muted text-xs">Open Threads</div>
                </div>
                <div className="glass-bright rounded-xl p-3 border border-emerald-500/20 text-center">
                  <div className="text-xl font-black text-emerald-400">{discussionStats.resolved}</div>
                  <div className="text-text-muted text-xs">Resolved</div>
                </div>
                <div className="glass-bright rounded-xl p-3 border border-red-500/20 text-center">
                  <div className="text-xl font-black text-red-400">{discussionStats.hidden}</div>
                  <div className="text-text-muted text-xs">Hidden</div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-cyan-400" /> Discussion Monitoring
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 glass rounded-xl p-1 border border-border">
                  {(["all", "open", "resolved"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => { setDiscussionStatusFilter(s); fetchDiscussions(1, s); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${discussionStatusFilter === s ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-text-muted hover:text-white"}`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <button onClick={() => fetchDiscussions(discussionsPage, discussionStatusFilter)} disabled={discussionsLoading} className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all">
                  <RefreshCw className={`w-4 h-4 ${discussionsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {discussionsLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-white/3 animate-pulse" />)}
              </div>
            )}
            {discussionsError && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {discussionsError}
              </div>
            )}
            {!discussionsLoading && !discussionsError && discussions.length === 0 && (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <MessageCircle className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No discussions found.</p>
              </div>
            )}

            {!discussionsLoading && discussions.length > 0 && (
              <div className="glass-bright rounded-2xl border border-border divide-y divide-border/50 overflow-hidden">
                {discussions.map((d) => {
                  const isExpanded = expandedDiscussion === d.id;
                  return (
                    <div key={d.id}>
                      <div
                        className="p-4 hover:bg-white/2 transition-colors cursor-pointer"
                        onClick={() => {
                          const next = isExpanded ? null : d.id;
                          setExpandedDiscussion(next);
                          if (next && !discussionReplies[d.id]) fetchDiscussionReplies(d.id);
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {d.isPinned && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25">Pinned</span>}
                              {d.isResolved && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Resolved</span>}
                              {d.isHidden && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/25">Hidden</span>}
                              <span className="text-xs text-cyan-400">{d.course.title}</span>
                            </div>
                            <p className="text-white text-sm font-semibold">{d.title}</p>
                            <p className="text-text-muted text-xs mt-0.5 line-clamp-1">{d.body}</p>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                              <span>
                                by <span className="text-white">{d.author.name || d.author.email}</span>
                                <span className={`ml-1 px-1 py-0.5 rounded text-xs font-medium ${d.author.role === "INSTRUCTOR" ? "text-orange-400" : "text-cyan-400"}`}>
                                  ({d.author.role.toLowerCase()})
                                </span>
                              </span>
                              <span>{d._count.replies} replies</span>
                              <span>{timeAgo(d.createdAt)}</span>
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="bg-black/10 px-5 py-4 border-t border-border/30 space-y-3">
                          <div className="glass rounded-xl p-3 border border-border">
                            <p className="text-text-muted text-xs font-semibold mb-1">Original Post</p>
                            <p className="text-white text-sm">{d.body}</p>
                          </div>
                          {discussionReplies[d.id] && discussionReplies[d.id].length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Replies ({discussionReplies[d.id].length})</p>
                              {discussionReplies[d.id].map((reply: any) => (
                                <div key={reply.id} className="glass rounded-xl p-3 border border-border ml-4">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-white text-xs font-medium">{reply.author?.name || reply.author?.email || "Unknown"}</span>
                                    {reply.isInstructorReply && <span className="text-xs px-1 py-0.5 rounded bg-orange-500/15 text-orange-400">Instructor</span>}
                                    <span className="text-text-muted text-xs ml-auto">{timeAgo(reply.createdAt)}</span>
                                  </div>
                                  <p className="text-text-secondary text-sm">{reply.body}</p>
                                </div>
                              ))}
                            </div>
                          ) : d._count.replies > 0 ? (
                            <p className="text-text-muted text-xs text-center py-2">Loading replies…</p>
                          ) : (
                            <p className="text-text-muted text-xs text-center py-2">No replies yet.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {discussionsTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button disabled={discussionsPage === 1} onClick={() => { const p = discussionsPage - 1; setDiscussionsPage(p); fetchDiscussions(p, discussionStatusFilter); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-text-muted text-sm">Page {discussionsPage} of {discussionsTotalPages}</span>
                <button disabled={discussionsPage === discussionsTotalPages} onClick={() => { const p = discussionsPage + 1; setDiscussionsPage(p); fetchDiscussions(p, discussionStatusFilter); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── ACTIVITY TAB ── */}
        {tab === "activity" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-400" />
                Platform Activity
                {activityTotal > 0 && <span className="text-text-muted text-sm font-normal">({activityTotal} events)</span>}
              </h3>
              <button onClick={() => fetchActivity(activityPage, activityTypeFilter)} disabled={activitiesLoading} className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all">
                <RefreshCw className={`w-4 h-4 ${activitiesLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {activityTypeCounts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setActivityTypeFilter("ALL"); fetchActivity(1, "ALL"); }} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${activityTypeFilter === "ALL" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "glass border-border text-text-muted hover:text-white"}`}>
                  All
                </button>
                {activityTypeCounts.map((tc) => (
                  <button key={tc.type} onClick={() => { setActivityTypeFilter(tc.type); fetchActivity(1, tc.type); }} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${activityTypeFilter === tc.type ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "glass border-border text-text-muted hover:text-white"}`}>
                    {ACTIVITY_TYPE_LABELS[tc.type] ?? tc.type} ({tc.count})
                  </button>
                ))}
              </div>
            )}

            {activitiesLoading && <div className="space-y-3">{[1,2,3,4,5].map((i) => <div key={i} className="h-16 rounded-2xl bg-white/3 animate-pulse" />)}</div>}
            {activitiesError && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {activitiesError}</div>}
            {!activitiesLoading && !activitiesError && activities.length === 0 && (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <Activity className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No activity recorded yet.</p>
              </div>
            )}

            {!activitiesLoading && activities.length > 0 && (
              <div className="glass-bright rounded-2xl border border-border divide-y divide-border/50 overflow-hidden">
                {activities.map((a) => (
                  <div key={a.id} className="p-4 flex items-start gap-4">
                    <div className="flex-shrink-0 mt-0.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${ACTIVITY_TYPE_COLORS[a.activityType] ?? "bg-white/5 text-white/60 border-white/10"}`}>
                        {ACTIVITY_TYPE_LABELS[a.activityType] ?? a.activityType}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm">
                        <span className="font-semibold">{a.actorName ?? "System"}</span>
                        {a.actorRole && <span className="text-text-muted text-xs ml-1">({a.actorRole.toLowerCase()})</span>}
                        {a.targetTitle && <><span className="text-text-muted"> — </span><span className="text-cyan-400">{a.targetTitle}</span></>}
                      </p>
                      <p className="text-text-muted text-xs mt-0.5">{timeAgo(a.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activityTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button disabled={activityPage === 1} onClick={() => { const p = activityPage - 1; setActivityPage(p); fetchActivity(p, activityTypeFilter); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-text-muted text-sm">Page {activityPage} of {activityTotalPages}</span>
                <button disabled={activityPage === activityTotalPages} onClick={() => { const p = activityPage + 1; setActivityPage(p); fetchActivity(p, activityTypeFilter); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── MESSAGES TAB ── */}
        {tab === "messages" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <Lock className="w-5 h-5 text-purple-400" /> Private Messages
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowNewThread(!showNewThread); if (students === null) fetchStudents(1); }} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 text-sm font-medium hover:bg-purple-500/25 transition-all">
                  <MessageSquare className="w-4 h-4" /> New Message
                </button>
                <button onClick={fetchThreads} disabled={threadsLoading} className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all">
                  <RefreshCw className={`w-4 h-4 ${threadsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {showNewThread && (
              <div className="glass-bright rounded-2xl border border-purple-500/25 p-4">
                <p className="text-text-muted text-xs mb-3">Search for a student or instructor to message:</p>
                <input type="text" value={newThreadSearch} onChange={(e) => setNewThreadSearch(e.target.value)} placeholder="Name or email..." className={inputCls} />
                <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
                  {studentsLoading && <p className="text-text-muted text-xs text-center py-2">Loading users…</p>}
                  {filteredUsersForMessage.slice(0, 10).map((u) => (
                    <button key={u.id} onClick={() => startNewThread(u)} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors text-left">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${u.role === "INSTRUCTOR" ? "bg-gradient-to-br from-orange-500 to-amber-400" : "bg-gradient-to-br from-cyan-500 to-violet-600"}`}>
                        {(u.name || u.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white text-sm">{u.name || u.email}</p>
                        <p className="text-text-muted text-xs">{u.email} <span className={`ml-1 px-1 py-0.5 rounded text-xs font-medium ${u.role === "INSTRUCTOR" ? "bg-orange-500/15 text-orange-400" : "bg-cyan-500/15 text-cyan-400"}`}>{u.role.toLowerCase()}</span></p>
                      </div>
                    </button>
                  ))}
                  {filteredUsersForMessage.length === 0 && !studentsLoading && <p className="text-text-muted text-xs text-center py-2">No users found.</p>}
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-4" style={{ minHeight: "500px" }}>
              <div className="md:col-span-1 glass-bright rounded-2xl border border-border overflow-hidden flex flex-col">
                <div className="p-4 border-b border-border">
                  <h4 className="text-white font-semibold text-sm flex items-center gap-2"><Inbox className="w-4 h-4 text-purple-400" /> Conversations</h4>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                  {threadsLoading && <div className="p-6 text-center text-text-muted text-sm">Loading…</div>}
                  {threadsError && <div className="p-4 text-red-400 text-sm">{threadsError}</div>}
                  {!threadsLoading && threads.length === 0 && <div className="p-6 text-center text-text-muted text-sm">No conversations yet.</div>}
                  {threads.map((t) => (
                    <button key={t.threadId} onClick={() => openThread(t.otherUser.id)} className={`w-full p-4 text-left hover:bg-white/3 transition-colors ${activeThreadUserId === t.otherUser.id ? "bg-purple-500/10" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${t.otherUser.role === "INSTRUCTOR" ? "bg-gradient-to-br from-orange-500 to-amber-400" : "bg-gradient-to-br from-purple-500 to-violet-600"}`}>
                          {(t.otherUser.name || t.otherUser.email)[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-white text-sm font-medium truncate">{t.otherUser.name || t.otherUser.email}</p>
                            {t.unreadCount > 0 && <span className="ml-2 flex-shrink-0 w-5 h-5 rounded-full bg-purple-500 text-white text-xs flex items-center justify-center font-bold">{t.unreadCount}</span>}
                          </div>
                          <p className="text-text-muted text-xs truncate">{t.lastMessage || "No messages yet"}</p>
                          <p className="text-text-muted text-xs">{timeAgo(t.lastMessageAt)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2 glass-bright rounded-2xl border border-border flex flex-col overflow-hidden">
                {!activeThreadUserId ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <MessageSquare className="w-12 h-12 text-text-muted/30 mb-3" />
                    <p className="text-text-muted">Select a conversation or start a new one.</p>
                    <p className="text-text-muted text-xs mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> All messages are private and secure.</p>
                  </div>
                ) : (
                  <>
                    <div className="p-4 border-b border-border flex items-center gap-3">
                      {activeThreadOtherUser && (
                        <>
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold ${activeThreadOtherUser.role === "INSTRUCTOR" ? "bg-gradient-to-br from-orange-500 to-amber-400" : "bg-gradient-to-br from-purple-500 to-violet-600"}`}>
                            {(activeThreadOtherUser.name || activeThreadOtherUser.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-white font-semibold text-sm">{activeThreadOtherUser.name || activeThreadOtherUser.email}</p>
                            <p className="text-text-muted text-xs">{activeThreadOtherUser.email} · {activeThreadOtherUser.role.toLowerCase()}</p>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: "380px" }}>
                      {threadLoading && <div className="text-center text-text-muted text-sm py-4">Loading…</div>}
                      {!threadLoading && activeThreadMessages.length === 0 && <div className="text-center text-text-muted text-sm py-4">No messages yet. Send the first message below.</div>}
                      {activeThreadMessages.map((m) => {
                        const isAdmin = m.senderRole === "ADMIN";
                        return (
                          <div key={m.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-xs md:max-w-sm px-4 py-2.5 rounded-2xl text-sm ${isAdmin ? "bg-purple-500/20 text-white border border-purple-500/25" : "bg-white/5 text-white border border-border"}`}>
                              <p className="leading-relaxed">{m.body}</p>
                              <p className="text-xs mt-1 opacity-60">{timeAgo(m.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="p-4 border-t border-border flex items-end gap-2">
                      <textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                        placeholder="Type a message… (Enter to send)"
                        rows={2}
                        className={`${inputCls} flex-1 resize-none`}
                      />
                      <button onClick={sendMessage} disabled={sendingMessage || !newMessage.trim()} className="p-3 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 disabled:opacity-40 transition-all flex-shrink-0">
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── REVIEWS TAB ── */}
        {tab === "feedback" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-400" /> All Course Reviews
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => { const next = !showHiddenFeedback; setShowHiddenFeedback(next); fetchFeedback(1, next); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${showHiddenFeedback ? "bg-red-500/10 border-red-500/30 text-red-400" : "glass border-border text-text-muted hover:text-white"}`}>
                  {showHiddenFeedback ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {showHiddenFeedback ? "Showing Hidden" : "Show Hidden"}
                </button>
                <button onClick={() => fetchFeedback(feedbackPage, showHiddenFeedback)} disabled={feedbackLoading} className="p-2 rounded-xl glass border border-border text-text-muted hover:text-white disabled:opacity-50 transition-all">
                  <RefreshCw className={`w-4 h-4 ${feedbackLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {feedbackLoading && <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/3 animate-pulse" />)}</div>}
            {feedbackError && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {feedbackError}</div>}
            {!feedbackLoading && !feedbackError && feedbackList.length === 0 && (
              <div className="glass-bright rounded-2xl border border-border p-12 text-center">
                <Star className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
                <p className="text-text-muted">No reviews found.</p>
              </div>
            )}

            {!feedbackLoading && feedbackList.map((f) => (
              <div key={f.id} className={`glass-bright rounded-2xl border border-border p-5 space-y-2 ${f.isHidden ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(f.user.name || f.user.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{f.user.name || f.user.email}</p>
                      <StarDisplay value={f.rating} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-cyan-400 text-xs">{f.course.title}</p>
                      <p className="text-text-muted text-xs">{timeAgo(f.createdAt)}</p>
                    </div>
                    <button onClick={() => handleFeedbackModerate(f.id, !f.isHidden)} className={`p-1.5 rounded-lg transition-colors ${f.isHidden ? "text-text-muted hover:text-emerald-400" : "text-text-muted hover:text-red-400"}`} title={f.isHidden ? "Restore" : "Hide"}>
                      {f.isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                {f.comment && <p className="text-text-secondary text-sm leading-relaxed">{f.comment}</p>}
                {f.isHidden && <p className="text-red-400 text-xs">Hidden from public view</p>}
              </div>
            ))}

            {feedbackTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button disabled={feedbackPage === 1} onClick={() => { setFeedbackPage((p) => p - 1); fetchFeedback(feedbackPage - 1, showHiddenFeedback); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-text-muted text-sm">Page {feedbackPage} of {feedbackTotalPages}</span>
                <button disabled={feedbackPage === feedbackTotalPages} onClick={() => { setFeedbackPage((p) => p + 1); fetchFeedback(feedbackPage + 1, showHiddenFeedback); }} className="p-1.5 rounded-lg glass border border-border text-text-muted hover:text-white disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  );
}