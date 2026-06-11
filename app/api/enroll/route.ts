// FILE PATH: app/api/enroll/route.ts
//
// FIXED: Added approvalStatus === "APPROVED" check so students cannot enroll
// in courses that are published but not approved (DB inconsistency protection).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as any).role;
    if (role !== "STUDENT") {
      return NextResponse.json({ error: "Only students can enroll." }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { courseId } = body;
    if (!courseId || typeof courseId !== "string") {
      return NextResponse.json({ error: "Course ID required." }, { status: 400 });
    }

    const userId = session.user.id;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          where: { isPublished: true },
          select: { id: true },
          orderBy: { order: "asc" },
        },
      },
    });

    // FIXED: Require both isPublished AND approvalStatus=APPROVED for enrollment.
    // This prevents students from enrolling in courses that have been published
    // by error without proper approval, or whose approval was later revoked.
    if (!course || !course.isPublished || course.approvalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Course not found or not available for enrollment." },
        { status: 404 }
      );
    }

    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) {
      return NextResponse.json({ error: "Already enrolled in this course." }, { status: 409 });
    }

    const enrollment = await prisma.$transaction(async (tx) => {
      const enr = await tx.enrollment.create({ data: { userId, courseId } });
      for (const mod of course.modules) {
        await tx.moduleProgress.create({
          data: { enrollmentId: enr.id, moduleId: mod.id },
        });
      }
      return enr;
    });

    // Log activity — fire-and-forget, never crashes main flow
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    await logActivity({
      activityType: "ENROLLMENT",
      actorId:      userId,
      actorName:    user?.name ?? session.user.email ?? userId,
      actorRole:    "STUDENT",
      targetId:     courseId,
      targetType:   "COURSE",
      targetTitle:  course.title,
      metadata:     { enrollmentId: enrollment.id },
    });

    return NextResponse.json({ success: true, enrollmentId: enrollment.id });
  } catch (err: any) {
    console.error("enroll error:", err);
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Already enrolled in this course." }, { status: 409 });
    }
    return NextResponse.json({ error: "Enrollment failed. Please try again." }, { status: 500 });
  }
}