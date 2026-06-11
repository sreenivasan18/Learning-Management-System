// app/api/video/[moduleId]/heartbeat/route.ts
//
// VIDEO WATCH HEARTBEAT — the core of anti-skip enforcement.
//
// FIXES:
// 1. When Module.videoDurationSecs is null (ffprobe not available at upload time),
//    the first heartbeat now back-fills it from the browser's reported totalDuration.
//    This means subsequent page loads will show the correct resume position.
// 2. Added startedAt to the moduleProgress update branch (was missing, causing
//    startedAt to remain null forever on update-only paths).
// 3. Tightened the anti-skip math comments for clarity.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maybeCompleteCourse } from "@/lib/course-completion";

const SPEED_ALLOWANCE = 1.25;  // Allow up to 1.25× playback speed
const COMPLETION_THRESHOLD = 0.9;  // 90% watch = complete
const HEARTBEAT_INTERVAL_SECS = 6;  // Expected client interval

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ moduleId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { moduleId } = await params;

  let body: any;
  try {
    const text = await req.text();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const { currentTime, totalDuration } = body;

  if (
    typeof currentTime !== "number" ||
    typeof totalDuration !== "number" ||
    currentTime < 0 ||
    totalDuration <= 0
  ) {
    return NextResponse.json({ error: "Invalid heartbeat data." }, { status: 400 });
  }

  // ── Verify module + enrollment ─────────────────────────────────────────────
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { courseId: true, videoDurationSecs: true },
  });
  if (!module) {
    return NextResponse.json({ error: "Module not found." }, { status: 404 });
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId: module.courseId },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "Not enrolled." }, { status: 403 });
  }

  const now = new Date();

  // FIXED: back-fill Module.videoDurationSecs from browser if DB has null.
  // This happens when ffprobe was unavailable at upload time.
  // We only write it once (when null) to avoid stale overwrites.
  const reportedTotalSecs = Math.round(totalDuration);
  if (!module.videoDurationSecs && reportedTotalSecs > 0) {
    // Fire-and-forget — don't await to keep heartbeat fast
    prisma.module.update({
      where: { id: moduleId },
      data: { videoDurationSecs: reportedTotalSecs },
    }).catch(() => {/* silently ignore */});
  }

  // ── Get or create VideoProgress ────────────────────────────────────────────
  let vp = await prisma.videoProgress.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
  });

  if (!vp) {
    vp = await prisma.videoProgress.create({
      data: {
        userId,
        moduleId,
        watchedSecs: 0,
        totalSecs: reportedTotalSecs,
        lastHeartbeatAt: now,
      },
    });
  }

  // ── Anti-skip validation ───────────────────────────────────────────────────
  // We track wall-clock time between heartbeats and allow at most
  // (elapsed × SPEED_ALLOWANCE) seconds of progress per beat.
  // A client that jumps to 100% immediately will get clamped back to
  // wherever they legitimately were.
  const reportedSecs = Math.round(currentTime);
  const prevWatchedSecs = vp.watchedSecs;

  let secondsSinceLastBeat = HEARTBEAT_INTERVAL_SECS;
  if (vp.lastHeartbeatAt) {
    secondsSinceLastBeat = Math.max(
      1,
      (now.getTime() - vp.lastHeartbeatAt.getTime()) / 1000
    );
  }

  // Maximum credible position: previous position + wall-clock elapsed × speed allowance
  const maxCredibleSecs = Math.min(
    Math.round(prevWatchedSecs + secondsSinceLastBeat * SPEED_ALLOWANCE),
    reportedTotalSecs
  );

  // New watched position: cannot go back (monotonic), cannot jump ahead of credible limit
  const newWatchedSecs = Math.min(
    Math.max(prevWatchedSecs, Math.min(reportedSecs, maxCredibleSecs)),
    reportedTotalSecs
  );

  // ── Check completion ───────────────────────────────────────────────────────
  const totalSecs = reportedTotalSecs;
  const threshold = Math.round(totalSecs * COMPLETION_THRESHOLD);
  const isNowComplete = !vp.completed && newWatchedSecs >= threshold;

  // ── Persist VideoProgress ──────────────────────────────────────────────────
  await prisma.videoProgress.update({
    where: { id: vp.id },
    data: {
      watchedSecs: newWatchedSecs,
      totalSecs,
      lastHeartbeatAt: now,
      completed: vp.completed || isNowComplete,
      completedAt: isNowComplete ? now : vp.completedAt,
    },
  });

  // ── On completion: update ModuleProgress ──────────────────────────────────
  if (isNowComplete) {
    const quiz = await prisma.quiz.findFirst({
      where: { moduleId },
      select: { id: true },
    });
    const hasQuiz = !!quiz;

    const existingProgress = await prisma.moduleProgress.findUnique({
      where: {
        enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId },
      },
    });

    const quizPassed = existingProgress?.quizPassed ?? false;
    const moduleFullyDone = !hasQuiz || quizPassed;

    await prisma.moduleProgress.upsert({
      where: {
        enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId },
      },
      create: {
        enrollmentId: enrollment.id,
        moduleId,
        videoCompleted: true,
        quizPassed,
        status: moduleFullyDone ? "COMPLETED" : "IN_PROGRESS",
        watchedSecs: newWatchedSecs,
        startedAt: now,
        completedAt: moduleFullyDone ? now : null,
      },
      update: {
        videoCompleted: true,
        watchedSecs: newWatchedSecs,
        status: moduleFullyDone ? "COMPLETED" : "IN_PROGRESS",
        // FIXED: ensure startedAt is set even on update path
        startedAt: existingProgress?.startedAt ?? now,
        completedAt: moduleFullyDone ? (existingProgress?.completedAt ?? now) : null,
      },
    });

    if (moduleFullyDone) {
      await maybeCompleteCourse(enrollment.id, enrollment.courseId, userId);
    }
  } else {
    // Still in progress — update watched position
    const existingProgress = await prisma.moduleProgress.findUnique({
      where: {
        enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId },
      },
      select: { startedAt: true, status: true },
    });

    await prisma.moduleProgress.upsert({
      where: {
        enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId },
      },
      create: {
        enrollmentId: enrollment.id,
        moduleId,
        status: "IN_PROGRESS",
        watchedSecs: newWatchedSecs,
        startedAt: now,
      },
      update: {
        watchedSecs: newWatchedSecs,
        // FIXED: only advance to IN_PROGRESS, never downgrade from COMPLETED
        status: existingProgress?.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
        // FIXED: preserve startedAt if already set
        startedAt: existingProgress?.startedAt ?? now,
      },
    });
  }

  return NextResponse.json({
    success: true,
    watchedSecs: newWatchedSecs,
    totalSecs,
    completed: vp.completed || isNowComplete,
    percentWatched: totalSecs > 0 ? Math.round((newWatchedSecs / totalSecs) * 100) : 0,
  });
}