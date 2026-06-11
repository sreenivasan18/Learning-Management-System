// FILE PATH: app/api/instructor/students/route.ts
//
// BUG FIXED (CRITICAL):
//   `const instructorId = session.user.id` used User.id to filter enrollments
//   by `course.instructorId`. But Course.instructorId references the Instructor
//   table (a completely separate table from User). These IDs never match, so
//   every enrolled student lookup returned a 403 "Forbidden" or empty list.
//
//   The ownership check `course.instructorId !== instructorId` always failed for
//   the same reason — comparing Instructor.id with User.id.
//
// FIX: Resolve Instructor.id from session user's email (the shared key between
//   the User and Instructor tables), exactly as done in all other instructor APIs.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Bridge: User.email → Instructor.id
async function resolveInstructorId(
  email: string | null | undefined
): Promise<string | null> {
  if (!email) return null;
  const rec = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return rec?.id ?? null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // FIXED: resolve Instructor.id via email bridge
  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json(
      { error: "Instructor record not found." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const courseIdFilter = searchParams.get("courseId") ?? undefined;
  const search = searchParams.get("search")?.trim() ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10))
  );

  // If a specific courseId is requested, verify ownership BEFORE querying
  if (courseIdFilter) {
    const course = await prisma.course.findUnique({
      where: { id: courseIdFilter },
      select: { instructorId: true },
    });
    // FIXED: compare against resolved Instructor.id (not User.id)
    if (!course || course.instructorId !== instructorId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const enrollmentWhere: any = {
    course: {
      instructorId, // FIXED: now correctly scoped to Instructor.id
      ...(courseIdFilter ? { id: courseIdFilter } : {}),
    },
    ...(search
      ? {
          user: {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
            ],
          },
        }
      : {}),
  };

  const [totalCount, enrollments] = await Promise.all([
    prisma.enrollment.count({ where: enrollmentWhere }),
    prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            createdAt: true,
            profile: {
              select: {
                avatarUrl: true,
                college: true,
                education: true,
                bio: true,
              },
            },
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
        moduleProgress: {
          select: { status: true },
        },
      },
      orderBy: { enrolledAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const students = enrollments.map((enrollment) => {
    const totalModules = enrollment.moduleProgress.length;
    const completedModules = enrollment.moduleProgress.filter(
      (p) => p.status === "COMPLETED"
    ).length;
    const progressPct =
      totalModules > 0
        ? Math.round((completedModules / totalModules) * 100)
        : 0;

    return {
      enrollmentId: enrollment.id,
      enrolledAt: enrollment.enrolledAt,
      status: enrollment.status,
      pricePaid: enrollment.pricePaid,
      completedAt: enrollment.completedAt,
      progressPct,
      completedModules,
      totalModules,
      course: enrollment.course,
      student: {
        id: enrollment.user.id,
        name: enrollment.user.name,
        email: enrollment.user.email,
        image: enrollment.user.image,
        createdAt: enrollment.user.createdAt,
        profile: enrollment.user.profile,
      },
    };
  });

  return NextResponse.json({
    students,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  });
}
