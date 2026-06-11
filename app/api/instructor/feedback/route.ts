// FILE PATH: app/api/instructor/feedback/route.ts
// Instructor-only: feedback for the instructor's own courses.
//
// BUG FIXED: Uses Instructor.id resolution (not User.id) to scope to instructor's courses.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function resolveInstructorId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const instructor = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return instructor?.id ?? null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // FIXED: resolve Instructor.id from email
  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId") ?? undefined;

  // Get instructor's course IDs
  const instructorCourses = await prisma.course.findMany({
    where: { instructorId },
    select: { id: true, title: true },
  });
  const courseIds = instructorCourses.map((c) => c.id);

  if (courseIds.length === 0) {
    return NextResponse.json({ feedback: [], averageRating: null, count: 0, courses: [] });
  }

  const where: any = {
    courseId: courseId && courseIds.includes(courseId) ? courseId : { in: courseIds },
    isHidden: false,
  };

  const feedback = await prisma.courseFeedback.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, image: true } },
      course: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const avg = feedback.length > 0
    ? feedback.reduce((s, f) => s + f.rating, 0) / feedback.length
    : null;

  return NextResponse.json({
    feedback,
    averageRating: avg,
    count: feedback.length,
    courses: instructorCourses,
  });
}