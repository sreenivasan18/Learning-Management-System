// FILE PATH: app/api/instructor/courses/[id]/route.ts
//
// APPROVAL WORKFLOW:
//   - Instructors can edit course content (title, description, modules, quizzes)
//     only when the course is PENDING or REJECTED.
//   - Approved/Published courses cannot be edited without admin re-review.
//   - Instructors CANNOT change isPublished or approvalStatus. Those are admin-only.
//   - Instructors CAN resubmit a REJECTED course (sets status back to PENDING).
//   - FIXED: PATCH now accepts modules array and syncs module titles, descriptions,
//     contentMd, durationMins, isFree, and quizzes (create/update) per module.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

async function resolveInstructorId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const instructor = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return instructor?.id ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
  }

  const course = await prisma.course.findFirst({
    where: { id, instructorId },
    include: {
      _count: { select: { enrollments: true, modules: true } },
      modules: {
        include: {
          quizzes: {
            include: {
              questions: { orderBy: { order: "asc" } },
              _count: { select: { questions: true, attempts: true } },
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
  }

  const course = await prisma.course.findFirst({
    where: { id, instructorId },
  });
  if (!course) {
    return NextResponse.json({ error: "Course not found or forbidden." }, { status: 404 });
  }

  // APPROVAL WORKFLOW: Instructors can only edit PENDING or REJECTED courses.
  if (course.approvalStatus === "APPROVED" || course.isPublished) {
    return NextResponse.json(
      {
        error:
          "This course has been approved and cannot be edited directly. " +
          "Contact an admin if changes are needed.",
      },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // ── Course-level field updates ────────────────────────────────────────────
  const courseUpdates: any = {};
  if (typeof body.title === "string" && body.title.trim()) courseUpdates.title = body.title.trim();
  if (typeof body.description === "string" && body.description.trim()) courseUpdates.description = body.description.trim();
  if (typeof body.category === "string" && body.category.trim()) courseUpdates.category = body.category.trim();
  if (typeof body.level === "string" && body.level.trim()) courseUpdates.level = body.level.trim();
  if (typeof body.price === "number") courseUpdates.price = Math.max(0, body.price);
  if (typeof body.thumbnail === "string") courseUpdates.thumbnail = body.thumbnail || null;
  if (typeof body.durationMins === "number") courseUpdates.durationMins = body.durationMins;

  // RESUBMIT: If the course was REJECTED, editing resets it to PENDING
  if (course.approvalStatus === "REJECTED") {
    courseUpdates.approvalStatus = "PENDING";
    courseUpdates.reviewComment = null;
    courseUpdates.rejectedAt = null;
  }

  // ── Module + Quiz sync ────────────────────────────────────────────────────
  // If the body includes a `modules` array, sync module content and quizzes.
  // This handles the edit-course form where instructors update module details.
  const modulesData: any[] | undefined = Array.isArray(body.modules) ? body.modules : undefined;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Update course metadata
      const updatedCourse = await tx.course.update({
        where: { id },
        data: { ...courseUpdates, updatedAt: new Date() },
      });

      // Sync modules if provided
      if (modulesData) {
        for (const modData of modulesData) {
          if (!modData.id) continue; // skip modules without an id (safety check)

          // Verify the module belongs to this course
          const existingMod = await tx.module.findFirst({
            where: { id: modData.id, courseId: id },
          });
          if (!existingMod) continue;

          // Update module fields
          const modUpdate: any = {};
          if (typeof modData.title === "string" && modData.title.trim()) {
            modUpdate.title = modData.title.trim();
          }
          if (typeof modData.description === "string") {
            modUpdate.description = modData.description || null;
          }
          if (typeof modData.contentMd === "string") {
            modUpdate.contentMd = modData.contentMd || null;
          }
          if (typeof modData.durationMins === "number") {
            modUpdate.durationMins = modData.durationMins;
          }
          if (typeof modData.isFree === "boolean") {
            modUpdate.isFree = modData.isFree;
          }

          if (Object.keys(modUpdate).length > 0) {
            await tx.module.update({
              where: { id: modData.id },
              data: { ...modUpdate, updatedAt: new Date() },
            });
          }

          // Sync quizzes for this module
          if (Array.isArray(modData.quizzes)) {
            for (const quizData of modData.quizzes) {
              if (!quizData.title?.trim()) continue;

              let quizId: string;

              if (quizData.id) {
                // Update existing quiz
                const existingQuiz = await tx.quiz.findFirst({
                  where: { id: quizData.id, moduleId: modData.id },
                });
                if (!existingQuiz) continue;

                await tx.quiz.update({
                  where: { id: quizData.id },
                  data: {
                    title: quizData.title.trim(),
                    description: quizData.description || null,
                    passingPercentage: quizData.passingPercentage ?? 0,
                    updatedAt: new Date(),
                  },
                });
                quizId = quizData.id;
              } else {
                // Create new quiz
                const newQuiz = await tx.quiz.create({
                  data: {
                    moduleId: modData.id,
                    title: quizData.title.trim(),
                    description: quizData.description || null,
                    passingPercentage: quizData.passingPercentage ?? 0,
                  },
                });
                quizId = newQuiz.id;
              }

              // Sync questions for this quiz
              if (Array.isArray(quizData.questions)) {
                // Delete existing questions and recreate (simplest reliable approach for edits)
                if (quizData.id) {
                  await tx.quizQuestion.deleteMany({ where: { quizId } });
                }
                for (let qi = 0; qi < quizData.questions.length; qi++) {
                  const q = quizData.questions[qi];
                  if (!q.question?.trim()) continue;
                  await tx.quizQuestion.create({
                    data: {
                      quizId,
                      question: q.question.trim(),
                      options: JSON.stringify(
                        Array.isArray(q.options) ? q.options : ["", "", "", ""]
                      ),
                      correctAnswer: typeof q.correctAnswer === "number" ? q.correctAnswer : 0,
                      explanation: q.explanation || "",
                      order: qi,
                    },
                  });
                }
              }
            }
          }
        }
      }

      // Return the updated course with all relations
      return await tx.course.findUnique({
        where: { id },
        include: {
          _count: { select: { enrollments: true, modules: true } },
          modules: {
            include: {
              quizzes: {
                include: {
                  questions: { orderBy: { order: "asc" } },
                  _count: { select: { questions: true, attempts: true } },
                },
              },
            },
            orderBy: { order: "asc" },
          },
        },
      });
    });

    await logActivity({
      activityType: "COURSE_UPDATED",
      actorId:      session.user.id,
      actorName:    session.user.name ?? session.user.email ?? session.user.id,
      actorRole:    "INSTRUCTOR",
      targetId:     id,
      targetType:   "COURSE",
      targetTitle:  updated?.title ?? id,
      metadata:     {
        courseId:       id,
        approvalStatus: updated?.approvalStatus,
        updatedFields:  Object.keys(courseUpdates),
        modulesUpdated: !!modulesData,
      },
    });

    return NextResponse.json({ course: updated });
  } catch (err) {
    console.error("instructor PATCH course error:", err);
    return NextResponse.json(
      { error: "Failed to save course. Please try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
  }

  const course = await prisma.course.findFirst({
    where: { id, instructorId },
  });
  if (!course) {
    return NextResponse.json({ error: "Course not found or forbidden." }, { status: 404 });
  }

  // Instructors cannot delete published courses
  if (course.isPublished) {
    return NextResponse.json(
      { error: "Cannot delete a published course. Contact an admin to unpublish it first." },
      { status: 403 }
    );
  }

  await prisma.course.delete({ where: { id } });

  return NextResponse.json({ success: true });
}