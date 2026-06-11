// FILE PATH: app/api/feedback/moderate/route.ts
// Instructor/Admin moderation: hide or restore feedback.
//
// BUG FIXED: Instructor ID resolution.
// Course.instructorId is Instructor.id (separate table from User).
// Bridge via shared email field.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function resolveInstructorId(userId: string, email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const instructor = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return instructor?.id ?? null;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const { feedbackId, hide } = body;
  if (!feedbackId || typeof hide !== "boolean") {
    return NextResponse.json({ error: "feedbackId and hide (boolean) required." }, { status: 400 });
  }

  const feedback = await prisma.courseFeedback.findUnique({
    where: { id: feedbackId },
    include: { course: { select: { instructorId: true } } },
  });

  if (!feedback) {
    return NextResponse.json({ error: "Feedback not found." }, { status: 404 });
  }

  // FIXED: Instructors can only moderate their own courses.
  // Resolve Instructor.id from session user email, then compare to course.instructorId.
  if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.id, session.user.email);
    if (!instructorId || feedback.course.instructorId !== instructorId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  await prisma.courseFeedback.update({
    where: { id: feedbackId },
    data: {
      isHidden: hide,
      hiddenAt: hide ? new Date() : null,
      hiddenBy: hide ? session.user.id : null,
    },
  });

  return NextResponse.json({ success: true });
}