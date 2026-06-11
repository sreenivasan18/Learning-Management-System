// FILE PATH: app/api/admin/feedback/route.ts
// Admin-only: platform-wide feedback overview.
// Returns all course feedback across all courses for monitoring.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = 30;
  const courseId = searchParams.get("courseId") ?? undefined;
  const showHidden = searchParams.get("showHidden") === "true";

  const where: any = {};
  if (courseId) where.courseId = courseId;
  if (!showHidden) where.isHidden = false;

  const [feedback, total] = await Promise.all([
    prisma.courseFeedback.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.courseFeedback.count({ where }),
  ]);

  // Aggregate: average rating per course
  const avgByCoursePairs = await prisma.courseFeedback.groupBy({
    by: ["courseId"],
    where: { isHidden: false },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const avgByCourse = Object.fromEntries(
    avgByCoursePairs.map((r) => [
      r.courseId,
      { avg: r._avg.rating ?? 0, count: r._count.rating },
    ])
  );

  return NextResponse.json({
    feedback,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    avgByCourse,
  });
}