// FILE PATH: app/api/student/dashboard/route.ts
//
// REWRITE: Added discussion metrics to the dashboard response.
//
// DISCUSSION METRICS ADDED:
//   discussionStats: {
//     total:            total discussions the student has opened
//     pendingReply:     threads where the student hasn't received an instructor reply yet
//     inConversation:   threads with at least one instructor reply, not yet resolved
//     resolved:         threads marked as resolved
//   }
//
// These power the "My Discussions" widget on the student dashboard.
//
// EXISTING FIXES RETAINED:
//   - Video-only module progress (no-quiz modules)
//   - Quiz-based progress blended model
//   - no-cache headers

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role;
  if (role !== "STUDENT") {
    return NextResponse.json({ error: "Only accessible to students." }, { status: 403 });
  }

  const userId = session.user.id;

  const [rawEnrollments, certificates, quizAttempts, myDiscussions] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: {
          select: {
            id: true,
            slug: true,
            title: true,
            category: true,
            thumbnail: true,
            isPublished: true,
            modules: {
              where: { isPublished: true },
              select: {
                id: true,
                title: true,
                order: true,
                videoUrl: true,
                quizzes: { select: { id: true, title: true } },
              },
              orderBy: { order: "asc" },
            },
          },
        },
        moduleProgress: {
          select: {
            moduleId: true,
            status: true,
            videoCompleted: true,
            quizPassed: true,
          },
        },
      },
      orderBy: { enrolledAt: "desc" },
    }),

    prisma.certificate.findMany({
      where: { userId, isRevoked: false },
      include: { course: { select: { id: true, title: true } } },
      orderBy: { issuedAt: "desc" },
    }),

    prisma.quizAttempt.findMany({
      where: { userId },
      select: {
        quizId: true,
        score: true,
        maxScore: true,
        percentage: true,
        passed: true,
      },
      orderBy: { completedAt: "desc" },
    }),

    // ── Discussion metrics for this student ─────────────────────────────
    prisma.discussion.findMany({
      where: { authorId: userId, isHidden: false },
      select: {
        id: true,
        isResolved: true,
        replyCount: true,
        replies: {
          where: { isHidden: false, isInstructorReply: true },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  // ── Discussion stats ───────────────────────────────────────────────────────
  const totalDiscussions   = myDiscussions.length;
  // pendingReply: student asked but no instructor has replied yet
  const pendingReply       = myDiscussions.filter(
    (d) => !d.isResolved && d.replies.length === 0
  ).length;
  // inConversation: instructor replied but thread not resolved
  const inConversation     = myDiscussions.filter(
    (d) => !d.isResolved && d.replies.length > 0
  ).length;
  const resolvedDiscussions = myDiscussions.filter((d) => d.isResolved).length;

  // ── Quiz / progress logic (unchanged) ─────────────────────────────────────
  const attemptedQuizIds = [...new Set(quizAttempts.map((a) => a.quizId))];
  const quizThresholds =
    attemptedQuizIds.length > 0
      ? await prisma.quiz.findMany({
          where: { id: { in: attemptedQuizIds } },
          select: { id: true, passingPercentage: true },
        })
      : [];

  const thresholdByQuizId = new Map(
    quizThresholds.map((q) => [q.id, q.passingPercentage ?? 0])
  );

  const quizPassedSet = new Set<string>();
  const bestByQuiz = new Map<string, { score: number; maxScore: number; percentage: number }>();

  for (const a of quizAttempts) {
    const threshold = thresholdByQuizId.get(a.quizId) ?? 0;
    const isPassed  = a.passed || a.percentage >= threshold;
    if (isPassed) quizPassedSet.add(a.quizId);
    const ex = bestByQuiz.get(a.quizId);
    if (!ex || a.score > ex.score) {
      bestByQuiz.set(a.quizId, { score: a.score, maxScore: a.maxScore, percentage: a.percentage });
    }
  }

  const certCourseIds = new Set(certificates.map((c) => c.courseId));

  const enrollments = rawEnrollments.map((e) => {
    const allModules   = e.course.modules;
    const totalModules = allModules.length;
    const progressByModule = new Map(e.moduleProgress.map((p) => [p.moduleId, p]));

    let completedModules  = 0;
    let totalQuizzes      = 0;
    let passedQuizzes     = 0;
    let attemptedQuizzes  = 0;

    for (const mod of allModules) {
      const hasQuiz    = mod.quizzes.length > 0;
      const modProgress = progressByModule.get(mod.id);

      if (hasQuiz) {
        totalQuizzes += mod.quizzes.length;
        const modPassedQuizzes    = mod.quizzes.filter((q) => quizPassedSet.has(q.id)).length;
        const modAttemptedQuizzes = mod.quizzes.filter((q) => bestByQuiz.has(q.id)).length;
        passedQuizzes    += modPassedQuizzes;
        attemptedQuizzes += modAttemptedQuizzes;
        if (modPassedQuizzes > 0) completedModules++;
      } else {
        if (modProgress?.status === "COMPLETED") completedModules++;
      }
    }

    const progressPct = totalModules > 0
      ? Math.round((completedModules / totalModules) * 100)
      : 0;

    return {
      id: e.id,
      enrolledAt: e.enrolledAt,
      course: {
        id: e.course.id,
        slug: e.course.slug,
        title: e.course.title,
        category: e.course.category,
        thumbnail: e.course.thumbnail,
        isPublished: e.course.isPublished,
      },
      totalQuizzes,
      passedQuizzes,
      attemptedQuizzes,
      progressPct,
      firstQuizId: allModules.flatMap((m) => m.quizzes)[0]?.id ?? null,
    };
  });

  const overallPct =
    enrollments.length > 0
      ? Math.round(enrollments.reduce((s, e) => s + e.progressPct, 0) / enrollments.length)
      : 0;

  const activeCount = enrollments.filter(
    (e) => e.progressPct > 0 && e.progressPct < 100 && !certCourseIds.has(e.course.id)
  ).length;

  return NextResponse.json(
    {
      enrolledCount: enrollments.length,
      completedCount: certificates.length,
      activeCount,
      overallPct,
      enrollments,
      certificates: certificates.map((c) => ({
        id: c.id,
        courseId: c.courseId,
        issuedAt: c.issuedAt.toISOString(),
        overallPercentage: c.overallPercentage,
        course: { id: c.course.id, title: c.course.title },
      })),
      // ── Discussion metrics ─────────────────────────────────────────────
      discussionStats: {
        total: totalDiscussions,
        pendingReply,
        inConversation,
        resolved: resolvedDiscussions,
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    }
  );
}