// FILE PATH: app/api/progress/route.ts
//
// SECURE PROGRESS API — hardened against client manipulation.
// FIXED: Now logs PROGRESS_UPDATE activity events on module completion.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const enrollmentId = searchParams.get("enrollmentId");
  if (!enrollmentId) {
    return NextResponse.json({ error: "enrollmentId required." }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, userId: session.user.id },
    include: {
      moduleProgress: {
        include: {
          module: {
            select: {
              id: true,
              title: true,
              order: true,
              videoUrl: true,
              quizzes: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!enrollment) {
    return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, moduleProgress: enrollment.moduleProgress });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { enrollmentId, moduleId } = body;

  if (!enrollmentId || typeof enrollmentId !== "string") {
    return NextResponse.json({ error: "enrollmentId is required." }, { status: 400 });
  }
  if (!moduleId || typeof moduleId !== "string") {
    return NextResponse.json({ error: "moduleId is required." }, { status: 400 });
  }

  const userId = session.user.id;

  // IDOR prevention — enrollment must belong to this user
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, userId },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  }

  const module = await prisma.module.findFirst({
    where: { id: moduleId, courseId: enrollment.courseId },
    include: { quizzes: { select: { id: true } } },
  });
  if (!module) {
    return NextResponse.json({ error: "Module not found in this course." }, { status: 404 });
  }

  const videoProgress = await prisma.videoProgress.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
    select: { completed: true, watchedSecs: true },
  });

  const hasVideo = !!module.videoUrl;
  const videoCompleted = hasVideo ? (videoProgress?.completed ?? false) : true;

  const hasQuiz = module.quizzes.length > 0;
  let quizPassed = false;
  if (hasQuiz) {
    const passedAttempt = await prisma.quizAttempt.findFirst({
      where: {
        userId,
        quizId: { in: module.quizzes.map((q) => q.id) },
        passed: true,
      },
    });
    quizPassed = !!passedAttempt;
  } else {
    quizPassed = true;
  }

  const moduleFullyDone = videoCompleted && quizPassed;
  const now = new Date();

  const existing = await prisma.moduleProgress.findUnique({
    where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
  });

  const wasAlreadyCompleted = existing?.status === "COMPLETED";

  const progress = await prisma.moduleProgress.upsert({
    where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
    create: {
      enrollmentId,
      moduleId,
      videoCompleted,
      quizPassed,
      status: moduleFullyDone ? "COMPLETED" : videoCompleted || videoProgress ? "IN_PROGRESS" : "NOT_STARTED",
      watchedSecs: videoProgress?.watchedSecs ?? 0,
      startedAt: now,
      completedAt: moduleFullyDone ? now : null,
    },
    update: {
      videoCompleted,
      quizPassed,
      status: moduleFullyDone
        ? "COMPLETED"
        : videoProgress
        ? "IN_PROGRESS"
        : existing?.status ?? "NOT_STARTED",
      watchedSecs: videoProgress?.watchedSecs ?? existing?.watchedSecs ?? 0,
      startedAt: existing?.startedAt ?? now,
      completedAt: moduleFullyDone ? (existing?.completedAt ?? now) : null,
    },
  });

  // Log activity only when newly completed (not on repeated updates)
  if (moduleFullyDone && !wasAlreadyCompleted) {
    const [user, course] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.course.findUnique({ where: { id: enrollment.courseId }, select: { title: true } }),
    ]);

    await logActivity({
      activityType: "PROGRESS_UPDATE",
      actorId:      userId,
      actorName:    user?.name ?? userId,
      actorRole:    "STUDENT",
      targetId:     moduleId,
      targetType:   "MODULE",
      targetTitle:  module.title,
      metadata:     { enrollmentId, courseId: enrollment.courseId, courseTitle: course?.title },
    });
  }

  if (moduleFullyDone) {
    const { maybeCompleteCourse } = await import("@/lib/course-completion");
    await maybeCompleteCourse(enrollmentId, enrollment.courseId, userId);
  }

  return NextResponse.json({ success: true, progress });
}