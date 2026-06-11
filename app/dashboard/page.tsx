// FILE PATH: app/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import DashboardClient from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const role = (session.user as any).role;
  if (role === "ADMIN") redirect("/admin");
  if (role === "INSTRUCTOR") redirect("/instructor");

  const userId = session.user.id;

  const [
    user,
    rawEnrollments,
    certificates,
    quizAttempts,
    myDiscussions,
    unreadMessages,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, role: true },
    }),

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
        completedAt: true,
      },
      orderBy: { completedAt: "desc" },
    }),

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

    // Unread messages: admin messages sent TO this user that they haven't read
    prisma.adminMessage.count({
      where: {
        threadId: `admin_${userId}`,
        senderRole: "ADMIN",
        isReadByRecipient: false,
      },
    }),
  ]);

  if (!user) redirect("/auth/signin");

  // ── Quiz threshold correction for legacy attempts ────────────────────────
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
  const bestByQuiz = new Map<
    string,
    { score: number; maxScore: number; percentage: number }
  >();

  for (const a of quizAttempts) {
    const threshold = thresholdByQuizId.get(a.quizId) ?? 0;
    const isPassed = a.passed || a.percentage >= threshold;
    if (isPassed) quizPassedSet.add(a.quizId);
    const ex = bestByQuiz.get(a.quizId);
    if (!ex || a.score > ex.score) {
      bestByQuiz.set(a.quizId, {
        score: a.score,
        maxScore: a.maxScore,
        percentage: a.percentage,
      });
    }
  }

  // ── Per-enrollment progress computation ──────────────────────────────────
  const certCourseIds = new Set(certificates.map((c) => c.courseId));

  const enrollments = rawEnrollments.map((e) => {
    const allModules = e.course.modules;
    const totalModules = allModules.length;
    const progressByModule = new Map(
      e.moduleProgress.map((p) => [p.moduleId, p])
    );

    let completedModules = 0;
    let totalQuizzes = 0;
    let passedQuizzes = 0;
    let attemptedQuizzes = 0;

    for (const mod of allModules) {
      const hasQuiz = mod.quizzes.length > 0;
      const modProgress = progressByModule.get(mod.id);

      if (hasQuiz) {
        totalQuizzes += mod.quizzes.length;
        const modPassed = mod.quizzes.filter((q) =>
          quizPassedSet.has(q.id)
        ).length;
        const modAttempted = mod.quizzes.filter((q) =>
          bestByQuiz.has(q.id)
        ).length;
        passedQuizzes += modPassed;
        attemptedQuizzes += modAttempted;
        if (modPassed > 0) completedModules++;
      } else {
        if (modProgress?.status === "COMPLETED") completedModules++;
      }
    }

    const progressPct =
      totalModules > 0
        ? Math.round((completedModules / totalModules) * 100)
        : 0;

    return {
      id: e.id,
      enrolledAt: e.enrolledAt.toISOString(),
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

  // ── Top-level stats ──────────────────────────────────────────────────────
  const overallPct =
    enrollments.length > 0
      ? Math.round(
          enrollments.reduce((s, e) => s + e.progressPct, 0) /
            enrollments.length
        )
      : 0;

  const activeCount = enrollments.filter(
    (e) =>
      e.progressPct > 0 &&
      e.progressPct < 100 &&
      !certCourseIds.has(e.course.id)
  ).length;

  const completedCount = certificates.length;

  // ── Discussion stats ─────────────────────────────────────────────────────
  const totalDiscussions = myDiscussions.length;
  const pendingReply = myDiscussions.filter(
    (d) => !d.isResolved && d.replies.length === 0
  ).length;
  const inConversation = myDiscussions.filter(
    (d) => !d.isResolved && d.replies.length > 0
  ).length;
  const resolvedDiscussions = myDiscussions.filter((d) => d.isResolved).length;

  // ── Serialize certificates ───────────────────────────────────────────────
  const serializedCertificates = certificates.map((c) => ({
    id: c.id,
    courseId: c.courseId,
    issuedAt: c.issuedAt.toISOString(),
    overallPercentage: c.overallPercentage,
    course: { id: c.course.id, title: c.course.title },
  }));

  const data = {
    enrolledCount: enrollments.length,
    completedCount,
    activeCount,
    overallPct,
    enrollments,
    certificates: serializedCertificates,
    discussionStats: {
      total: totalDiscussions,
      pendingReply,
      inConversation,
      resolved: resolvedDiscussions,
    },
  };

  return (
    <>
      <Navbar />
      <DashboardClient data={data} unreadMessages={unreadMessages} />
    </>
  );
}