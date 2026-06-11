// FILE PATH: app/admin/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";

const INSTRUCTOR_LIMIT = 100;
const COURSE_LIMIT = 200;

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  if ((session.user as any).role !== "ADMIN") {
    redirect("/403");
  }

  const [
    students,
    instructors,
    courses,
    publishedCourses,
    pendingCoursesCount,
    modules,
    publishedModules,
    videos,
    enrollments,
    activeEnrollments,
    completedEnrollments,
    certificates,
    quizAttempts,
    feedbackAggregate,
    platformActivityCount,
    adminMessageCount,
    unreadAdminMessages,
    instructorList,
    courseList,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.instructor.count(),
    prisma.course.count(),
    prisma.course.count({ where: { isPublished: true } }),
    prisma.course.count({ where: { approvalStatus: "PENDING" } }),   // ← FIXED
    prisma.module.count(),
    prisma.module.count({ where: { isPublished: true } }),
    prisma.module.count({ where: { videoKey: { not: null } } }),
    prisma.enrollment.count(),
    prisma.enrollment.count({ where: { status: "ACTIVE" } }),
    prisma.enrollment.count({ where: { status: "COMPLETED" } }),
    prisma.certificate.count({ where: { isRevoked: false } }),
    prisma.quizAttempt.count(),
    prisma.courseFeedback.aggregate({
      where: { isHidden: false },
      _count: { id: true },
      _avg: { rating: true },
    }),
    prisma.platformActivity.count(),
    prisma.adminMessage.count(),
    prisma.adminMessage.count({
      where: { isReadByAdmin: false, senderRole: { not: "ADMIN" } },
    }),
    prisma.instructor.findMany({
      include: {
        courses: {
          select: { id: true, _count: { select: { enrollments: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: INSTRUCTOR_LIMIT,
    }),
    prisma.course.findMany({
      include: {
        instructor: { select: { name: true } },
        _count: { select: { enrollments: true, modules: true } },
        modules: {
          select: {
            id: true,
            title: true,
            order: true,
            videoUrl: true,
            videoKey: true,
            videoDurationSecs: true,
            isPublished: true,
            isFree: true,
            durationMins: true,
            description: true,
            contentMd: true,
            quizzes: {
              select: {
                id: true,
                title: true,
                description: true,
                passingPercentage: true,
                timeLimit: true,
                _count: { select: { questions: true, attempts: true } },
                questions: {
                  select: {
                    id: true,
                    question: true,
                    options: true,
                    correctAnswer: true,
                    explanation: true,
                    order: true,
                  },
                  orderBy: { order: "asc" },
                },
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: COURSE_LIMIT,
    }),
  ]);

  const stats = {
    students,
    instructors,
    courses,
    publishedCourses,
    pendingCourses: pendingCoursesCount,   // ← FIXED: was courses - publishedCourses
    modules,
    publishedModules,
    videos,
    enrollments,
    activeEnrollments,
    completedEnrollments,
    certificates,
    quizAttempts,
    feedbackCount: feedbackAggregate._count.id,
    avgRating: feedbackAggregate._avg.rating,
    platformActivityCount,
    adminMessageCount,
    unreadAdminMessages,
  };

  return (
    <>
      <Navbar />
      <AdminDashboardClient
        stats={stats}
        instructors={instructorList as any}
        courses={courseList as any}
      />
    </>
  );
}