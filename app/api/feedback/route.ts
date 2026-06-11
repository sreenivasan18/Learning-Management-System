// FILE PATH: app/api/feedback/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId required." }, { status: 400 });
  }

  const role = (session.user as any).role;
  const userId = session.user.id;

  // Determine visibility: students only see visible reviews; instructors/admin see all
  const where: any = { courseId };
  if (role === "STUDENT") {
    where.isHidden = false;
  }

  const feedback = await prisma.courseFeedback.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Include whether current student has already submitted
  const myFeedback = role === "STUDENT"
    ? await prisma.courseFeedback.findUnique({
        where: { userId_courseId: { userId, courseId } },
      })
    : null;

  const aggregate = await prisma.courseFeedback.aggregate({
    where: { courseId, isHidden: false },
    _avg: { rating: true },
    _count: { id: true },
  });

  return NextResponse.json({
    feedback,
    myFeedback,
    avgRating:    aggregate._avg.rating,
    totalReviews: aggregate._count.id,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role;
  if (role !== "STUDENT") {
    return NextResponse.json({ error: "Only students can submit reviews." }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { courseId, rating, comment } = body;

  if (!courseId || typeof courseId !== "string") {
    return NextResponse.json({ error: "courseId required." }, { status: 400 });
  }
  if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Rating must be 1–5." }, { status: 400 });
  }

  const userId = session.user.id;

  // Verify enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "You must be enrolled to review this course." }, { status: 403 });
  }

  const sanitizedComment = typeof comment === "string"
    ? comment.trim().slice(0, 2000)
    : null;

  const feedback = await prisma.courseFeedback.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: { courseId, userId, rating: Math.round(rating), comment: sanitizedComment },
    update: { rating: Math.round(rating), comment: sanitizedComment, updatedAt: new Date() },
  });

  // Log activity
  const [user, course] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }),
  ]);

  await logActivity({
    activityType: "REVIEW_SUBMITTED",
    actorId:      userId,
    actorName:    user?.name ?? session.user.email ?? userId,
    actorRole:    "STUDENT",
    targetId:     courseId,
    targetType:   "COURSE",
    targetTitle:  course?.title ?? courseId,
    metadata:     { rating, feedbackId: feedback.id },
  });

  return NextResponse.json({ success: true, feedback });
}