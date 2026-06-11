// FILE PATH: app/api/admin/courses/route.ts
//
// APPROVAL WORKFLOW:
//   - GET: Admin sees all courses with approvalStatus included.
//          Supports ?status=pending filter for the review queue.
//   - POST: Admin-created courses skip the approval step (set APPROVED directly)
//           and can optionally be published immediately.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

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
  if (!session?.user?.id || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  let where: any = {};
  if (statusFilter === "pending") {
    where.approvalStatus = "PENDING";
  } else if (statusFilter === "approved") {
    where.approvalStatus = "APPROVED";
  } else if (statusFilter === "rejected") {
    where.approvalStatus = "REJECTED";
  }

  const courses = await prisma.course.findMany({
    where,
    include: {
      instructor: { select: { id: true, name: true, email: true } },
      _count: { select: { enrollments: true, modules: true } },
      modules: {
        include: {
          quizzes: { include: { _count: { select: { questions: true, attempts: true } } } },
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ courses });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const {
    title,
    description,
    category,
    level,
    price = 0,
    thumbnail,
    modules: modulesData = [],
    instructorId: bodyInstructorId,
    isPublished = false,
  } = body;

  if (!title || !description || !category || !level) {
    return NextResponse.json(
      { error: "Title, description, category, and level are required." },
      { status: 400 }
    );
  }

  // Admin-created courses are pre-approved (admin is the authority)
  const assignedInstructorId: string | null = bodyInstructorId || null;

  let slug = slugify(title);
  if (!slug) slug = `course-${Date.now()}`;
  const existing = await prisma.course.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now()}`;

  try {
    const course = await prisma.$transaction(async (tx) => {
      const totalDuration = (modulesData as any[]).reduce(
        (sum: number, m: any) => sum + (m.durationMins || 0),
        0
      );

      const newCourse = await tx.course.create({
        data: {
          slug,
          title: title.trim(),
          description: description.trim(),
          category,
          level,
          price: parseInt(String(price)) || 0,
          thumbnail: thumbnail || null,
          durationMins: totalDuration,
          instructorId: assignedInstructorId,
          // Admin-created courses are auto-approved
          approvalStatus: "APPROVED",
          approvedAt: new Date(),
          isPublished: Boolean(isPublished),
        },
      });

      for (let i = 0; i < (modulesData as any[]).length; i++) {
        const modData = (modulesData as any[])[i];
        if (!modData.title?.trim()) continue;

        const newModule = await tx.module.create({
          data: {
            courseId: newCourse.id,
            title: modData.title.trim(),
            description: modData.description || null,
            contentMd: modData.contentMd || null,
            durationMins: modData.durationMins || 0,
            order: i + 1,
            isPublished: Boolean(isPublished),
            isFree: Boolean(modData.isFree),
          },
        });

        if (modData.quizzes?.length) {
          for (const quizData of modData.quizzes) {
            if (!quizData.title?.trim()) continue;
            const newQuiz = await tx.quiz.create({
              data: {
                moduleId: newModule.id,
                title: quizData.title.trim(),
                description: quizData.description || "",
              },
            });
            if (quizData.questions?.length) {
              for (let qi = 0; qi < quizData.questions.length; qi++) {
                const q = quizData.questions[qi];
                if (!q.question?.trim()) continue;
                await tx.quizQuestion.create({
                  data: {
                    quizId: newQuiz.id,
                    question: q.question.trim(),
                    options: JSON.stringify(q.options),
                    correctAnswer: q.correctAnswer,
                    explanation: q.explanation || "",
                    order: qi,
                  },
                });
              }
            }
          }
        }
      }

      return newCourse;
    });

    return NextResponse.json(
      {
        success: true,
        course: {
          id: course.id,
          slug: course.slug,
          isPublished: course.isPublished,
          approvalStatus: course.approvalStatus,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("create course error:", err);
    return NextResponse.json(
      { error: "Failed to create course. Please try again." },
      { status: 500 }
    );
  }
}