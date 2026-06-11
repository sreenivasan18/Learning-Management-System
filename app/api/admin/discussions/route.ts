// FILE PATH: app/api/admin/discussions/route.ts
//
// Admin-only: platform-wide discussion monitoring and moderation.
//
// GET  → paginated list of all discussions with author, course, reply count.
//        ?showHidden=true to include soft-deleted content.
//        ?courseId=xxx to filter to a single course.
//        ?withReplies=true to include the first 10 replies per discussion
//           (useful for inline thread preview in admin panel).
//
// ADDED: summary stats (total, active, resolved, hidden) in every response
// so the admin dashboard metrics tile always has fresh numbers.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit       = 25;
  const courseId    = searchParams.get("courseId") ?? undefined;
  const showHidden  = searchParams.get("showHidden") === "true";
  const withReplies = searchParams.get("withReplies") === "true";
  const statusFilter = searchParams.get("status") ?? "all"; // "all" | "open" | "resolved"

  const where: any = {};
  if (courseId) where.courseId = courseId;
  if (!showHidden) where.isHidden = false;
  if (statusFilter === "open")     where.isResolved = false;
  if (statusFilter === "resolved") where.isResolved = true;

  const includeReplies = withReplies
    ? {
        replies: {
          where: { isHidden: false },
          include: {
            author: { select: { id: true, name: true, email: true, role: true } },
          },
          orderBy: { createdAt: "asc" as const },
          take: 50, // cap per-thread for admin preview
        },
      }
    : {};

  const [discussions, total, activeCount, resolvedCount, hiddenCount] = await Promise.all([
    prisma.discussion.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
        course: { select: { id: true, title: true, slug: true } },
        _count: { select: { replies: true } },
        ...includeReplies,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.discussion.count({ where }),
    prisma.discussion.count({ where: { isHidden: false, isResolved: false } }),
    prisma.discussion.count({ where: { isHidden: false, isResolved: true } }),
    prisma.discussion.count({ where: { isHidden: true } }),
  ]);

  return NextResponse.json({
    discussions,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    stats: {
      total: activeCount + resolvedCount,
      active: activeCount,
      resolved: resolvedCount,
      hidden: hiddenCount,
    },
  });
}