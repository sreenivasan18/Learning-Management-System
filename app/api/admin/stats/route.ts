// FILE PATH: app/api/admin/stats/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [
    students,
    instructors,
    courses,
    publishedCourses,
    pendingCoursesCount,
    modules,
    publishedModules,
    videosWithUpload,
    enrollments,
    activeEnrollments,
    completedEnrollments,
    certificates,
    quizAttempts,
    feedbackAggregate,
    moduleProgressCount,
    platformActivityCount,
    adminMessageCount,
    unreadAdminMessages,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.instructor.count(),
    prisma.course.count(),
    prisma.course.count({ where: { isPublished: true } }),
    prisma.course.count({ where: { approvalStatus: "PENDING" } }),  // ← ADDED
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
    prisma.moduleProgress.count(),
    prisma.platformActivity.count(),
    prisma.adminMessage.count(),
    prisma.adminMessage.count({ where: { isReadByAdmin: false, senderRole: { not: "ADMIN" } } }),
  ]);

  return NextResponse.json({
    students,
    instructors,
    courses,
    publishedCourses,
    pendingCourses: pendingCoursesCount,  // ← ADDED
    modules,
    publishedModules,
    videos: videosWithUpload,
    enrollments,
    activeEnrollments,
    completedEnrollments,
    certificates,
    quizAttempts,
    feedbackCount: feedbackAggregate._count.id,
    avgRating: feedbackAggregate._avg.rating,
    moduleProgressRecords: moduleProgressCount,
    platformActivityCount,
    adminMessageCount,
    unreadAdminMessages,
  });
}