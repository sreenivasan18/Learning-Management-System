// FILE PATH: app/api/instructor/discussions/route.ts
//
// Instructor-only: all student discussions from courses this instructor manages.
// Used by the Instructor Dashboard "Discussions" tab.
//
// VERIFIED CORRECT: Uses Instructor.id resolution (not User.id) to scope to
// the instructor's own courses. Returns discussions with full student info,
// reply counts, and course context so the instructor can triage efficiently.
//
// ADDED: summary stats in response (pending/resolved/total) for dashboard metrics.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function resolveInstructorId(email: string | null | undefined): Promise<string | null> {
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

  // Resolve the Instructor table record from User session email
  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit   = 20;
  const courseId = searchParams.get("courseId") ?? undefined;
  const statusFilter = searchParams.get("status") ?? "all"; // "all" | "pending" | "resolved"

  // Fetch instructor's course IDs (scoping boundary)
  const instructorCourses = await prisma.course.findMany({
    where: { instructorId },
    select: { id: true },
  });
  const courseIds = instructorCourses.map((c) => c.id);

  if (courseIds.length === 0) {
    return NextResponse.json({
      discussions: [],
      total: 0,
      page: 1,
      totalPages: 0,
      stats: { total: 0, pending: 0, resolved: 0 },
    });
  }

  // Validate the courseId filter belongs to this instructor
  const scopedCourseId =
    courseId && courseIds.includes(courseId) ? courseId : undefined;

  const where: any = {
    courseId: scopedCourseId ?? { in: courseIds },
    isHidden: false,
  };

  if (statusFilter === "pending")  where.isResolved = false;
  if (statusFilter === "resolved") where.isResolved = true;

  const [discussions, total, pendingCount, resolvedCount] = await Promise.all([
    prisma.discussion.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, image: true, role: true } },
        course: { select: { id: true, title: true, slug: true } },
        _count: { select: { replies: { where: { isHidden: false } } } },
      },
      orderBy: [
        { isResolved: "asc" },   // unresolved first
        { createdAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.discussion.count({ where }),
    prisma.discussion.count({
      where: { courseId: scopedCourseId ?? { in: courseIds }, isHidden: false, isResolved: false },
    }),
    prisma.discussion.count({
      where: { courseId: scopedCourseId ?? { in: courseIds }, isHidden: false, isResolved: true },
    }),
  ]);

  return NextResponse.json({
    discussions,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    stats: {
      total: pendingCount + resolvedCount,
      pending: pendingCount,
      resolved: resolvedCount,
    },
  });
}