// FILE PATH: app/api/quiz/[id]/attempt/route.ts
//
// FIX: VIDEO COMPLETION GATE now checks quiz.module.videoKey instead of
// quiz.module.videoUrl. This is the API-layer counterpart to the same fix
// applied to app/quiz/[id]/page.tsx (the server-component page gate).
//
// Root cause of the previous bug:
// - Seeded modules had videoUrl set to YouTube links with videoKey = null.
// - VideoPlayer.tsx shows "Video Not Available" for non-stream URLs and never
//   fires the heartbeat, so VideoProgress.completed is never true.
// - The old guard `if (quiz.module.videoUrl)` was truthy for YouTube URLs →
//   returned 403 VIDEO_NOT_COMPLETED permanently for seeded-course quizzes.
//
// Correct semantic:
// - videoKey  = real uploaded MP4 exists in the LMS → heartbeat tracking works
//               → video completion can be required before quiz access.
// - videoUrl  = any URL (YouTube, stream path, etc.) → cannot be used alone as
//               the gate condition because non-stream URLs are untrackable.
//
// With this fix: modules with YouTube-only videoUrl (videoKey=null) no longer
// block quiz access. Only modules with a real uploaded file (videoKey non-null)
// enforce the watch-before-quiz requirement.
//
// Also updated the module select to include videoKey alongside videoUrl so the
// ModuleProgress update logic (hasVideo check) remains consistent: hasVideo now
// uses videoKey (same as the gate) rather than videoUrl.
//
// Previously fixed: Logs QUIZ_ATTEMPTED activity event after every graded attempt.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maybeCompleteCourse } from "@/lib/course-completion";
import { logActivity } from "@/lib/activity";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const role = (session.user as any).role;

  if (role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can attempt quizzes." },
      { status: 403 }
    );
  }

  const { id: quizId } = await params;

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, correctAnswer: true, options: true },
      },
      module: {
        select: {
          id: true,
          title: true,
          courseId: true,
          // FIX: Include both videoUrl and videoKey.
          // videoKey is used for the completion gate (has a real uploaded MP4?).
          // videoUrl is kept for reference but is NOT used as the gate condition.
          videoUrl: true,
          videoKey: true,
          course: { select: { title: true } },
        },
      },
    },
  });

  if (!quiz) {
    return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  }

  // ── Enrollment check ───────────────────────────────────────────────────────
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId: quiz.module.courseId },
  });
  if (!enrollment) {
    return NextResponse.json(
      { error: "You are not enrolled in this course." },
      { status: 403 }
    );
  }

  // ── VIDEO COMPLETION GATE ──────────────────────────────────────────────────
  // FIX: Check quiz.module.videoKey (uploaded MP4 exists) instead of
  // quiz.module.videoUrl (any URL, including untrackable YouTube links).
  // Only modules with a real uploaded MP4 (videoKey non-null) should require
  // video completion before quiz access.
  if (quiz.module.videoKey) {
    const videoProgress = await prisma.videoProgress.findUnique({
      where: { userId_moduleId: { userId, moduleId: quiz.module.id } },
      select: { completed: true },
    });
    if (!videoProgress?.completed) {
      return NextResponse.json(
        {
          error: "You must complete the video lesson before attempting this quiz.",
          code: "VIDEO_NOT_COMPLETED",
        },
        { status: 403 }
      );
    }
  }

  // ── Parse answers ──────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { answers } = body;
  if (!Array.isArray(answers)) {
    return NextResponse.json({ error: "answers must be an array." }, { status: 400 });
  }

  // ── Grade ──────────────────────────────────────────────────────────────────
  let score = 0;
  const maxScore = quiz.questions.length;

  const gradedAnswers = quiz.questions.map((q) => {
    const clientAnswer = answers.find((a: any) => a.questionId === q.id);
    const selected = clientAnswer?.selectedOption ?? -1;
    const isCorrect = selected === q.correctAnswer;
    if (isCorrect) score++;
    return { questionId: q.id, selectedOption: selected, isCorrect };
  });

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const passed = percentage >= (quiz.passingPercentage ?? 0);

  // ── Persist attempt ────────────────────────────────────────────────────────
  const attempt = await prisma.$transaction(async (tx) => {
    return tx.quizAttempt.create({
      data: {
        quizId,
        userId,
        score,
        maxScore,
        percentage,
        passed,
        answers: {
          create: gradedAnswers.map((a) => ({
            questionId: a.questionId,
            selectedOption: a.selectedOption,
            isCorrect: a.isCorrect,
          })),
        },
      },
    });
  });

  // ── Log QUIZ_ATTEMPTED activity ────────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  await logActivity({
    activityType: "QUIZ_ATTEMPTED",
    actorId:      userId,
    actorName:    user?.name ?? session.user.email ?? userId,
    actorRole:    "STUDENT",
    targetId:     quizId,
    targetType:   "QUIZ",
    targetTitle:  quiz.title,
    metadata:     {
      moduleId:    quiz.module.id,
      moduleTitle: quiz.module.title,
      courseId:    quiz.module.courseId,
      courseTitle: quiz.module.course.title,
      score,
      maxScore,
      percentage,
      passed,
      attemptId:   attempt.id,
    },
  });

  // ── Update ModuleProgress on pass ──────────────────────────────────────────
  if (passed) {
    const now = new Date();

    const videoProgress = await prisma.videoProgress.findUnique({
      where: { userId_moduleId: { userId, moduleId: quiz.module.id } },
      select: { completed: true },
    });

    // FIX: Use videoKey (same as the gate above) to determine whether this module
    // has a trackable video. Using videoUrl here was inconsistent with the gate.
    const hasVideo = !!quiz.module.videoKey;
    const videoCompleted = hasVideo ? (videoProgress?.completed ?? false) : true;
    const moduleFullyDone = videoCompleted && passed;

    const existingProgress = await prisma.moduleProgress.findUnique({
      where: {
        enrollmentId_moduleId: {
          enrollmentId: enrollment.id,
          moduleId: quiz.module.id,
        },
      },
    });

    await prisma.moduleProgress.upsert({
      where: {
        enrollmentId_moduleId: {
          enrollmentId: enrollment.id,
          moduleId: quiz.module.id,
        },
      },
      create: {
        enrollmentId: enrollment.id,
        moduleId: quiz.module.id,
        videoCompleted,
        quizPassed: true,
        status: moduleFullyDone ? "COMPLETED" : "IN_PROGRESS",
        startedAt: now,
        completedAt: moduleFullyDone ? now : null,
      },
      update: {
        quizPassed: true,
        status: moduleFullyDone ? "COMPLETED" : existingProgress?.status ?? "IN_PROGRESS",
        completedAt: moduleFullyDone
          ? (existingProgress?.completedAt ?? now)
          : existingProgress?.completedAt ?? null,
      },
    });

    if (moduleFullyDone) {
      await maybeCompleteCourse(enrollment.id, enrollment.courseId, userId);
    }
  }

  // ── Check if certificate was issued (for result screen) ───────────────────
  const certificate = await prisma.certificate.findUnique({
    where: { userId_courseId: { userId, courseId: quiz.module.courseId } },
    select: { id: true },
  });

  return NextResponse.json({
    score,
    maxScore,
    percentage,
    passed,
    gradedAnswers,
    certificateId: certificate?.id ?? null,
    certificateIssued: !!certificate,
  });
}