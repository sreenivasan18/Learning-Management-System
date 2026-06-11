// FILE PATH: components/course/CourseDetailClient.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen, Clock, Users, Award, CheckCircle, PlayCircle,
  Lock, HelpCircle, ChevronDown, ChevronUp, Star
} from "lucide-react";
import dynamic from "next/dynamic";

const CourseFeedback = dynamic(() => import("./CourseFeedback"), { ssr: false });
const DiscussionSection = dynamic(() => import("./DiscussionSection"), { ssr: false });
const ModuleLearningView = dynamic(() => import("./ModuleLearningView"), { ssr: false });

export default function CourseDetailClient({ course, enrollment, userId, userRole }: any) {
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);
  const [err, setErr] = useState("");
  const [expandedMod, setExpandedMod] = useState<string | null>(null);
  const [activeLearningMod, setActiveLearningMod] = useState<string | null>(null);
  const [moduleProgressState, setModuleProgressState] = useState<Record<string, any>>({});
  const isEnrolled = !!enrollment;

  const handleEnroll = async () => {
    if (!userId) { router.push("/auth/signin"); return; }
    setEnrolling(true); setErr("");
    const res = await fetch("/api/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: course.id }),
    });
    const data = await res.json();
    setEnrolling(false);
    if (!res.ok) { setErr(data.error); return; }
    router.refresh();
  };

  const getModProgress = (modId: string) => {
    // Local override first, then server state
    const local = moduleProgressState[modId];
    if (local) return local;
    return enrollment?.moduleProgress?.find((mp: any) => mp.moduleId === modId) ?? null;
  };

  const getModStatus = (modId: string) => {
    return getModProgress(modId)?.status ?? "NOT_STARTED";
  };

  const handleProgressUpdate = (modId: string, progress: any) => {
    setModuleProgressState((prev) => ({ ...prev, [modId]: progress }));
  };

  return (
    <main className="min-h-screen bg-void pt-24 pb-16">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left: Course Info */}
          <div className="lg:col-span-2 space-y-8">
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">{course.category}</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">{course.level}</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>{course.title}</h1>
              <p className="text-text-muted leading-relaxed">{course.description}</p>
              {course.instructor && (
                <p className="text-text-secondary text-sm mt-3">
                  By <span className="text-white font-medium">{course.instructor.name}</span>
                  {course.instructor.specialization ? ` · ${course.instructor.specialization}` : ""}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-5 py-4 border-y border-border">
              {[
                { icon: BookOpen, val: `${course.modules.length} modules` },
                { icon: Users, val: `${course._count.enrollments} students` },
                { icon: Clock, val: course.durationMins > 0 ? `${Math.round(course.durationMins / 60)}h total` : "Self-paced" },
                { icon: Award, val: "Certificate included" },
              ].map(({ icon: Icon, val }) => (
                <div key={val} className="flex items-center gap-2 text-text-secondary text-sm">
                  <Icon className="w-4 h-4 text-cyan-400" />{val}
                </div>
              ))}
            </div>

            {/* Modules */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Course Modules</h2>
              <div className="space-y-3">
                {course.modules.map((mod: any, i: number) => {
                  const status = getModStatus(mod.id);
                  const progress = getModProgress(mod.id);
                  const accessible = isEnrolled || mod.isFree;
                  const isExpanded = expandedMod === mod.id;
                  const isLearningActive = activeLearningMod === mod.id;
                  const videoCompleted = progress?.videoCompleted ?? false;
                  const hasVideo = !!mod.videoUrl;

                  return (
                    <div key={mod.id} className={`glass-bright rounded-2xl border overflow-hidden transition-all
                      ${status === "COMPLETED" ? "border-emerald-500/30" : "border-border"}`}>
                      <button
                        onClick={() => setExpandedMod(isExpanded ? null : mod.id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-white/2 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                            ${status === "COMPLETED" ? "bg-emerald-500/20" : status === "IN_PROGRESS" ? "bg-amber-500/20" : "bg-white/5"}`}>
                            {status === "COMPLETED" ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                            ) : accessible ? (
                              <PlayCircle className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <Lock className="w-4 h-4 text-text-muted" />
                            )}
                          </div>
                          <div className="text-left">
                            <p className="text-white text-sm font-medium">{i + 1}. {mod.title}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              {mod.durationMins > 0 && (
                                <span className="text-text-muted text-xs">{mod.durationMins}m</span>
                              )}
                              {mod.isFree && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Free</span>
                              )}
                              {mod.quizzes.length > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 flex items-center gap-1">
                                  <HelpCircle className="w-3 h-3" />{mod.quizzes.length} quiz
                                </span>
                              )}
                              {hasVideo && videoCompleted && (
                                <span className="text-xs text-emerald-400 flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" /> Video done
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-4">
                          {mod.description && (
                            <p className="text-text-muted text-sm">{mod.description}</p>
                          )}

                          {/* Learning View for enrolled users */}
                          {isEnrolled && (hasVideo || mod.quizzes.length > 0) ? (
                            <>
                              {!isLearningActive ? (
                                <button
                                  onClick={() => setActiveLearningMod(mod.id)}
                                  className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                                >
                                  <PlayCircle className="w-4 h-4" />
                                  {status === "COMPLETED" ? "Review Module" : "Start Module"}
                                </button>
                              ) : (
                                <ModuleLearningView
                                  moduleId={mod.id}
                                  courseId={course.id}
                                  enrollmentId={enrollment.id}
                                  title={mod.title}
                                  description={mod.description}
                                  videoUrl={mod.videoUrl}
                                  videoWatchedSecs={progress?.watchedSecs ?? 0}
                                  videoTotalSecs={mod.videoDurationSecs ?? 0}
                                  quizzes={mod.quizzes}
                                  initialProgress={{
                                    status: status,
                                    videoCompleted: progress?.videoCompleted ?? false,
                                    quizPassed: progress?.quizPassed ?? false,
                                    watchedSecs: progress?.watchedSecs ?? 0,
                                  }}
                                  onProgressUpdate={(p) => handleProgressUpdate(mod.id, p)}
                                />
                              )}
                            </>
                          ) : !isEnrolled && mod.isFree && hasVideo ? (
                            // Free preview — direct video link (no completion tracking)
                            <a
                              href={mod.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                            >
                              <PlayCircle className="w-4 h-4" /> Watch Preview
                            </a>
                          ) : !isEnrolled ? (
                            <p className="text-text-muted text-sm flex items-center gap-2">
                              <Lock className="w-4 h-4" /> Enroll to access this module.
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Feedback section */}
            <CourseFeedback
              courseId={course.id}
              currentUserId={userId ?? null}
              isEnrolled={isEnrolled}
            />

            {/* Q&A section */}
            {(isEnrolled || userRole === "INSTRUCTOR" || userRole === "ADMIN") && (
              <DiscussionSection
                courseId={course.id}
                currentUserId={userId ?? null}
                currentUserRole={userRole ?? null}
                isEnrolled={isEnrolled}
              />
            )}
          </div>

          {/* Right: Enroll Card */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 glass-bright rounded-2xl border border-border p-6">
              {course.thumbnail && (
                <div className="rounded-xl overflow-hidden mb-5 aspect-video">
                  <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="text-3xl font-black text-white mb-5">
                {course.price === 0 ? "Free" : `₹${course.price.toLocaleString()}`}
              </div>

              {err && (
                <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{err}</div>
              )}

              {isEnrolled ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
                    <CheckCircle className="w-4 h-4" /> You&apos;re enrolled!
                  </div>
                  {/* Progress summary */}
                  {enrollment?.moduleProgress && (
                    <div className="p-3 rounded-xl bg-white/3 border border-border space-y-2">
                      <p className="text-text-muted text-xs font-medium">Progress</p>
                      {(() => {
                        const total = course.modules.length;
                        const done = enrollment.moduleProgress.filter((mp: any) =>
                          (moduleProgressState[mp.moduleId]?.status ?? mp.status) === "COMPLETED"
                        ).length;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        return (
                          <>
                            <div className="flex justify-between text-xs text-text-secondary">
                              <span>{done}/{total} modules</span>
                              <span>{pct}%</span>
                            </div>
                            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-cyan-500 to-violet-600 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <Link href="/dashboard" className="block text-center py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold hover:opacity-90 transition-all">
                    Go to Dashboard
                  </Link>
                </div>
              ) : (
                <button
                  onClick={handleEnroll}
                  disabled={enrolling}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20"
                >
                  {enrolling ? "Enrolling…" : "Enroll Now"}
                </button>
              )}

              <div className="mt-5 space-y-2 text-text-muted text-sm">
                {["Full course access", "Quiz assessments", "Certificate on completion", "Self-paced learning"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <Star className="w-3.5 h-3.5 text-amber-400" />{f}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}