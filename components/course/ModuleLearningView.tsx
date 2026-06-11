// FILE PATH: components/course/ModuleLearningView.tsx
//
// THE CORE LEARNING UI — displayed when an enrolled student clicks a module.
// Shows:
//   1. VideoPlayer (if module has a video)
//   2. Quiz (locked until video is complete)
//   3. Completion status with tick
//   4. Discussion section for this module
//
// PROGRESSION LOGIC:
//   videoCompleted → quiz unlocks → quizPassed → module marked COMPLETED
//   (No video = quiz immediately accessible)
//   (No quiz = module complete after video)

"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import {
  CheckCircle, Lock, HelpCircle, AlertCircle, PlayCircle
} from "lucide-react";
import dynamic from "next/dynamic";

const VideoPlayer = dynamic(() => import("./VideoPlayer"), { ssr: false });

interface ModuleProgress {
  status: string;
  videoCompleted: boolean;
  quizPassed: boolean;
  watchedSecs: number;
}

interface Quiz {
  id: string;
  title: string;
  _count?: { questions: number };
  attempts?: { percentage: number; passed: boolean }[];
}

interface Props {
  moduleId: string;
  courseId: string;
  enrollmentId: string;
  title: string;
  description?: string | null;
  videoUrl: string | null;
  videoWatchedSecs: number;
  videoTotalSecs: number;
  quizzes: Quiz[];
  initialProgress: ModuleProgress;
  onProgressUpdate?: (progress: ModuleProgress) => void;
}

export default function ModuleLearningView({
  moduleId, courseId, enrollmentId, title, description,
  videoUrl, videoWatchedSecs, videoTotalSecs, quizzes,
  initialProgress, onProgressUpdate,
}: Props) {
  const [progress, setProgress] = useState<ModuleProgress>(initialProgress);
  const [syncingProgress, setSyncingProgress] = useState(false);

  const hasVideo = !!videoUrl;
  const hasQuiz = quizzes.length > 0;
  const quizUnlocked = !hasVideo || progress.videoCompleted;
  const moduleCompleted = progress.status === "COMPLETED";

  // Called by VideoPlayer when video reaches 90% threshold
  const handleVideoCompleted = useCallback(async () => {
    setSyncingProgress(true);
    try {
      const res = await fetch("/api/progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, moduleId }),
      });
      const data = await res.json();
      if (res.ok && data.progress) {
        const updated: ModuleProgress = {
          status: data.progress.status,
          videoCompleted: data.progress.videoCompleted,
          quizPassed: data.progress.quizPassed,
          watchedSecs: data.progress.watchedSecs,
        };
        setProgress(updated);
        onProgressUpdate?.(updated);
      }
    } catch { /* silently ignore */ }
    finally { setSyncingProgress(false); }
  }, [enrollmentId, moduleId, onProgressUpdate]);

  return (
    <div className="space-y-6">
      {/* Module header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">{title}</h2>
          {description && <p className="text-text-muted text-sm mt-1">{description}</p>}
        </div>
        {moduleCompleted && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-semibold flex-shrink-0">
            <CheckCircle className="w-4 h-4" /> Completed
          </div>
        )}
      </div>

      {/* Video player */}
      {hasVideo && videoUrl ? (
        <div className="space-y-2">
          <VideoPlayer
            moduleId={moduleId}
            videoUrl={videoUrl}
            initialWatchedSecs={videoWatchedSecs}
            totalSecs={videoTotalSecs}
            onCompleted={handleVideoCompleted}
          />
          {progress.videoCompleted && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4" /> Video watched
            </div>
          )}
        </div>
      ) : null}

      {/* Quiz section */}
      {hasQuiz && (
        <div className="glass-bright rounded-2xl border border-border p-5 space-y-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-violet-400" />
            Module Quiz
          </h3>

          {!quizUnlocked ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <Lock className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-amber-300 text-sm font-medium">Quiz is locked</p>
                <p className="text-text-muted text-xs mt-0.5">
                  Complete the video lesson to unlock this quiz.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {quizzes.map((quiz) => {
                const attempt = quiz.attempts?.[0];
                const passed = attempt?.passed ?? false;
                return (
                  <div
                    key={quiz.id}
                    className={`flex items-center justify-between p-4 rounded-xl border
                      ${passed ? "bg-emerald-500/8 border-emerald-500/20" : "bg-violet-500/8 border-violet-500/20"}`}
                  >
                    <div className="flex items-center gap-3">
                      {passed ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <HelpCircle className="w-5 h-5 text-violet-400" />
                      )}
                      <div>
                        <p className="text-white text-sm font-medium">{quiz.title}</p>
                        {quiz._count && (
                          <p className="text-text-muted text-xs">{quiz._count.questions} questions</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {attempt && (
                        <span className={`text-sm font-bold ${attempt.passed ? "text-emerald-400" : "text-amber-400"}`}>
                          {attempt.percentage.toFixed(0)}%
                        </span>
                      )}
                      <Link
                        href={`/quiz/${quiz.id}`}
                        className={`text-xs px-4 py-2 rounded-xl font-medium transition-all
                          ${passed
                            ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
                            : "bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30"}`}
                      >
                        {attempt ? "Retake" : "Start Quiz"}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* No video, no quiz — mark as visited */}
      {!hasVideo && !hasQuiz && !moduleCompleted && (
        <div className="p-4 rounded-xl bg-white/3 border border-border text-text-muted text-sm text-center">
          This module has reading material only.
        </div>
      )}

      {/* Sync status */}
      {syncingProgress && (
        <p className="text-text-muted text-xs flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Syncing progress…
        </p>
      )}
    </div>
  );
}