// FILE PATH: lib/course-completion.ts
//
// Shared helper: check if all published modules in a course are completed,
// and if so, issue a certificate and mark the enrollment COMPLETED.
// FIXED: Now logs COURSE_COMPLETED and CERTIFICATE_ISSUED activity events.

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export async function maybeCompleteCourse(
  enrollmentId: string,
  courseId: string,
  userId: string
): Promise<void> {
  const allModules = await prisma.module.findMany({
    where: { courseId, isPublished: true },
    select: { id: true },
  });

  if (allModules.length === 0) return;

  const allProgress = await prisma.moduleProgress.findMany({
    where: { enrollmentId },
    select: { moduleId: true, status: true },
  });

  const progressMap = new Map(allProgress.map((p) => [p.moduleId, p.status]));
  const allDone = allModules.every((m) => progressMap.get(m.id) === "COMPLETED");

  if (!allDone) return;

  // Fetch quiz attempts
  const attempts = await prisma.quizAttempt.findMany({
    where: {
      userId,
      quiz: { module: { courseId } },
    },
    include: {
      quiz: {
        select: {
          id: true,
          title: true,
          module: { select: { title: true } },
          _count: { select: { questions: true } },
        },
      },
      answers: { select: { isCorrect: true } },
    },
    orderBy: { completedAt: "desc" },
  });

  const bestByQuiz = new Map<string, (typeof attempts)[0]>();
  for (const a of attempts) {
    if (
      !bestByQuiz.has(a.quizId) ||
      a.percentage > bestByQuiz.get(a.quizId)!.percentage
    ) {
      bestByQuiz.set(a.quizId, a);
    }
  }

  const best = Array.from(bestByQuiz.values());

  const overallPct =
    best.length > 0
      ? best.reduce((s, a) => s + a.percentage, 0) / best.length
      : 100;

  const quizSummary = best.map((a) => {
    const totalQuestions = a.quiz._count.questions;
    const correctAnswers = a.answers.filter((ans) => ans.isCorrect).length;
    return {
      quizTitle:      a.quiz.title,
      moduleTitle:    a.quiz.module.title,
      totalQuestions,
      correctAnswers,
      score:          a.score,
      percentage:     a.percentage,
    };
  });

  await prisma.$transaction([
    prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.certificate.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: {
        userId,
        courseId,
        overallPercentage: overallPct,
        quizSummary: JSON.stringify(quizSummary),
      },
      update: {
        overallPercentage: overallPct,
        quizSummary: JSON.stringify(quizSummary),
        issuedAt: new Date(),
      },
    }),
  ]);

  // Resolve user and course info for activity logging
  const [user, course] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }),
  ]);

  await logActivity({
    activityType: "COURSE_COMPLETED",
    actorId:      userId,
    actorName:    user?.name ?? userId,
    actorRole:    "STUDENT",
    targetId:     courseId,
    targetType:   "COURSE",
    targetTitle:  course?.title ?? courseId,
    metadata:     { enrollmentId, overallPct },
  });

  await logActivity({
    activityType: "CERTIFICATE_ISSUED",
    actorId:      userId,
    actorName:    user?.name ?? userId,
    actorRole:    "STUDENT",
    targetId:     courseId,
    targetType:   "COURSE",
    targetTitle:  course?.title ?? courseId,
    metadata:     { enrollmentId, overallPct },
  });
}