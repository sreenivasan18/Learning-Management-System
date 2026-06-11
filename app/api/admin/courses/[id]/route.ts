// FILE PATH: app/api/admin/courses/[id]/route.ts
//
// APPROVAL WORKFLOW (Admin):
//   PATCH supports two modes:
//     1. Content updates (title, description, etc.) — admin can edit any course
//     2. Approval actions via body.action:
//          "approve"   → set approvalStatus=APPROVED, clear rejection data, send email
//          "reject"    → set approvalStatus=REJECTED, set reviewComment, send email
//          "publish"   → set isPublished=true (only allowed if APPROVED)
//          "unpublish" → set isPublished=false
//
//   Only ADMIN role can perform any of these operations.
//
// FIX: Each approval action now logs a DISTINCT activity type:
//   "approve"   → COURSE_APPROVED   (was COURSE_UPDATED — indistinguishable in log)
//   "reject"    → COURSE_REJECTED   (was COURSE_UPDATED)
//   "publish"   → COURSE_PUBLISHED  (was COURSE_UPDATED)
//   "unpublish" → COURSE_UNPUBLISHED(was COURSE_UPDATED)
// This makes the admin activity log meaningfully readable and aligns with the
// display labels already present in AdminDashboardClient.tsx.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendCourseApprovedEmail, sendCourseRejectedEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      instructor: { select: { id: true, name: true, email: true } },
      _count: { select: { enrollments: true, modules: true } },
      modules: {
        include: {
          quizzes: {
            include: {
              _count: { select: { questions: true, attempts: true } },
              questions: {
                select: {
                  id: true,
                  question: true,
                  options: true,
                  correctAnswer: true,
                  explanation: true,
                  order: true,
                },
                orderBy: { order: "asc" },
              },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!course) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  return NextResponse.json({ course });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      approvalStatus: true,
      instructor: { select: { name: true, email: true } },
    },
  });
  if (!course) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // ── Approval action mode ────────────────────────────────────────────────────
  if (body.action) {
    const { action, reviewComment } = body;

    if (!["approve", "reject", "publish", "unpublish"].includes(action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    if (action === "reject" && (!reviewComment || !String(reviewComment).trim())) {
      return NextResponse.json(
        { error: "A review comment is required when rejecting a course." },
        { status: 400 }
      );
    }

    if (action === "publish" && course.approvalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Only approved courses can be published." },
        { status: 400 }
      );
    }

    let updateData: any = {};

    // FIX: Map each action to a distinct, human-readable activity type.
    // The previous version used "COURSE_UPDATED" for all four actions, making
    // it impossible to distinguish approvals from rejections in the activity log.
    type ApprovalActivityType =
      | "COURSE_APPROVED"
      | "COURSE_REJECTED"
      | "COURSE_PUBLISHED"
      | "COURSE_UNPUBLISHED";

    const activityTypeMap: Record<string, ApprovalActivityType> = {
      approve:   "COURSE_APPROVED",
      reject:    "COURSE_REJECTED",
      publish:   "COURSE_PUBLISHED",
      unpublish: "COURSE_UNPUBLISHED",
    };

    const activityType = activityTypeMap[action];

    if (action === "approve") {
      updateData = {
        approvalStatus: "APPROVED",
        reviewComment: reviewComment?.trim() || null,
        approvedAt: new Date(),
        rejectedAt: null,
      };
    } else if (action === "reject") {
      updateData = {
        approvalStatus: "REJECTED",
        reviewComment: String(reviewComment).trim(),
        rejectedAt: new Date(),
        approvedAt: null,
        isPublished: false, // Force unpublish on rejection
      };
      // Also unpublish all modules if rejecting
      await prisma.module.updateMany({
        where: { courseId: id },
        data: { isPublished: false },
      });
    } else if (action === "publish") {
      updateData = { isPublished: true };
      await prisma.module.updateMany({
        where: { courseId: id },
        data: { isPublished: true },
      });
    } else if (action === "unpublish") {
      updateData = { isPublished: false };
      await prisma.module.updateMany({
        where: { courseId: id },
        data: { isPublished: false },
      });
    }

    const updated = await prisma.course.update({
      where: { id },
      data: { ...updateData, updatedAt: new Date() },
      select: {
        id: true,
        slug: true,
        title: true,
        isPublished: true,
        isFeatured: true,
        approvalStatus: true,
        reviewComment: true,
        approvedAt: true,
        rejectedAt: true,
        updatedAt: true,
      },
    });

    // Send notification email to instructor (fire-and-forget — never crash the response)
    if (course.instructor?.email) {
      try {
        if (action === "approve") {
          await sendCourseApprovedEmail({
            to: course.instructor.email,
            instructorName: course.instructor.name,
            courseTitle: course.title,
            reviewComment: reviewComment?.trim() || null,
          });
        } else if (action === "reject") {
          await sendCourseRejectedEmail({
            to: course.instructor.email,
            instructorName: course.instructor.name,
            courseTitle: course.title,
            reviewComment: String(reviewComment).trim(),
          });
        }
      } catch (emailErr) {
        // Log but never fail the request due to email issues
        console.error(`[APPROVAL] Email notification failed for action=${action}:`, emailErr);
      }
    }

    // FIX: Log with the action-specific type (COURSE_APPROVED, COURSE_REJECTED, etc.)
    // instead of the previous generic COURSE_UPDATED for every approval action.
    await logActivity({
      activityType,
      actorId:     session.user.id,
      actorName:   session.user.name ?? session.user.email ?? session.user.id,
      actorRole:   "ADMIN",
      targetId:    id,
      targetType:  "COURSE",
      targetTitle: course.title,
      metadata:    {
        action,
        approvalStatus: updated.approvalStatus,
        isPublished:    updated.isPublished,
        reviewComment:  updated.reviewComment ?? null,
      },
    }).catch(console.error);

    return NextResponse.json({ success: true, course: updated });
  }

  // ── Content update mode ─────────────────────────────────────────────────────
  const updateData: Record<string, any> = {};

  if (typeof body.title === "string" && body.title.trim()) {
    updateData.title = body.title.trim();
  }
  if (typeof body.description === "string" && body.description.trim()) {
    updateData.description = body.description.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    updateData.category = body.category.trim();
  }
  if (typeof body.level === "string" && body.level.trim()) {
    updateData.level = body.level.trim();
  }
  if (typeof body.price === "number") {
    updateData.price = Math.max(0, body.price);
  }
  if (typeof body.thumbnail === "string") {
    updateData.thumbnail = body.thumbnail || null;
  }
  if (typeof body.isFeatured === "boolean") {
    updateData.isFeatured = body.isFeatured;
  }

  // Admins CAN directly set isPublished but only if the course is APPROVED
  if (typeof body.isPublished === "boolean") {
    if (body.isPublished && course.approvalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Only approved courses can be published." },
        { status: 400 }
      );
    }
    updateData.isPublished = body.isPublished;
    await prisma.module.updateMany({
      where: { courseId: id },
      data: { isPublished: body.isPublished },
    });
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const updated = await prisma.course.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      slug: true,
      title: true,
      isPublished: true,
      isFeatured: true,
      approvalStatus: true,
      reviewComment: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ success: true, course: updated });
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any)?.role;
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can delete courses." }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) {
      return NextResponse.json({ error: "Course not found." }, { status: 404 });
    }

    await prisma.course.delete({ where: { id } });

    return NextResponse.json({ success: true, message: "Course deleted." });
  } catch (err) {
    console.error("delete course error:", err);
    return NextResponse.json({ error: "Failed to delete course." }, { status: 500 });
  }
}