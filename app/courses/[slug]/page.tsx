// FILE PATH: app/courses/[slug]/page.tsx
//
// APPROVAL WORKFLOW:
//   A course detail page is only accessible to students when the course is
//   APPROVED and published. Pending/rejected courses return 404 for students.
//   Admins can preview ANY course regardless of status.
//   Instructors can preview their own courses regardless of status.
//
// FIX: Enrolled students now see ALL modules in their enrolled course regardless
//   of the module's isPublished flag. When a student is already enrolled, the
//   enrollment itself is the access grant.
//
// FIX 2: VideoProgress is now fetched alongside ModuleProgress so that the
//   VideoPlayer receives the authoritative per-second resume position from
//   VideoProgress.watchedSecs rather than the potentially-lagged
//   ModuleProgress.watchedSecs. This ensures accurate resume-on-return.

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import CourseDetailClient from "@/components/course/CourseDetailClient";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const userRole = (session?.user as any)?.role ?? null;

  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      instructor: {
        select: { name: true, bio: true, specialization: true },
      },
      modules: {
        include: {
          quizzes: {
            include: {
              _count: { select: { questions: true } },
              attempts: userId
                ? {
                    where: { userId },
                    orderBy: { completedAt: "desc" },
                    take: 1,
                  }
                : false,
            },
          },
        },
        orderBy: { order: "asc" },
      },
      _count: { select: { enrollments: true } },
    },
  });

  if (!course) notFound();

  const isAdmin = userRole === "ADMIN";
  const isVisible = course.approvalStatus === "APPROVED" && course.isPublished;

  // Instructors can preview their own courses at any approval status.
  let isOwnInstructor = false;
  if (userRole === "INSTRUCTOR" && session?.user?.email) {
    const instructorRecord = await prisma.instructor.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (instructorRecord && course.instructorId === instructorRecord.id) {
      isOwnInstructor = true;
    }
  }

  // Access control:
  // - Admins: always allowed
  // - Instructors viewing their own course: always allowed
  // - Everyone else: only approved + published
  if (!isAdmin && !isOwnInstructor && !isVisible) notFound();

  // Check enrollment for module visibility
  const enrollment = userId
    ? await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId: course.id } },
        include: {
          moduleProgress: {
            select: {
              moduleId: true,
              status: true,
              videoCompleted: true,
              quizPassed: true,
              watchedSecs: true,
              startedAt: true,
              completedAt: true,
            },
          },
        },
      })
    : null;

  const isEnrolled = !!enrollment;

  // FIX 2: Fetch VideoProgress for all modules this student has watched.
  // VideoProgress.watchedSecs is the authoritative resume position (updated
  // on every heartbeat). ModuleProgress.watchedSecs is a secondary cache
  // that may lag by up to one heartbeat interval (5s).
  // We merge both: use VideoProgress.watchedSecs when available, fall back
  // to ModuleProgress.watchedSecs.
  let videoProgressMap = new Map<string, number>(); // moduleId → watchedSecs
  if (userId && isEnrolled) {
    const moduleIds = course.modules.map((m) => m.id);
    if (moduleIds.length > 0) {
      const vpRecords = await prisma.videoProgress.findMany({
        where: { userId, moduleId: { in: moduleIds } },
        select: { moduleId: true, watchedSecs: true },
      });
      for (const vp of vpRecords) {
        videoProgressMap.set(vp.moduleId, vp.watchedSecs);
      }
    }
  }

  // Merge VideoProgress into moduleProgress so CourseDetailClient
  // receives the most accurate watchedSecs per module.
  const enrichedEnrollment = enrollment
    ? {
        ...enrollment,
        moduleProgress: enrollment.moduleProgress.map((mp) => ({
          ...mp,
          // Use VideoProgress.watchedSecs if available (more accurate),
          // otherwise fall back to ModuleProgress.watchedSecs.
          watchedSecs: videoProgressMap.get(mp.moduleId) ?? mp.watchedSecs,
        })),
      }
    : null;

  // FIX: Module visibility rules
  const filteredModules =
    isAdmin || isOwnInstructor || isEnrolled
      ? course.modules
      : course.modules.filter((m) => m.isPublished);

  const courseWithFilteredModules = {
    ...course,
    modules: filteredModules,
  };

  return (
    <>
      <Navbar />
      <CourseDetailClient
        course={courseWithFilteredModules as any}
        enrollment={enrichedEnrollment as any}
        userId={userId}
        userRole={userRole}
      />
    </>
  );
}