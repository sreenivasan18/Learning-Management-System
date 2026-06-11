// FILE PATH: app/api/instructor/courses/route.ts
//
// APPROVAL WORKFLOW:
//   - Instructors can create courses. All new courses are set to approvalStatus=PENDING.
//   - Instructors CANNOT set isPublished=true. Only admins can publish approved courses.
//   - isPublished is forced to false on creation regardless of what the body sends.
//   - FIXED: Quizzes and questions are now properly saved during course creation.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { logActivity } from "@/lib/activity";

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

  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
  }

  const courses = await prisma.course.findMany({
    where: { instructorId },
    include: {
      _count: { select: { enrollments: true, modules: true } },
      modules: {
        include: {
          quizzes: {
            include: {
              _count: { select: { questions: true, attempts: true } },
            },
          },
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
  if (!session?.user?.id || role !== "INSTRUCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const instructorId = await resolveInstructorId(session.user.email);
  if (!instructorId) {
    return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
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
  } = body;

  if (!title || !description || !category || !level) {
    return NextResponse.json(
      { error: "Title, description, category, and level are required." },
      { status: 400 }
    );
  }

  const slug = slugify(title);
  const existingSlug = await prisma.course.findUnique({ where: { slug } });
  const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

  try {
    // APPROVAL WORKFLOW: All instructor-created courses start as PENDING.
    // isPublished is always false — only admins can publish after approval.
    // FIXED: Now uses $transaction to properly save modules AND their quizzes+questions.
    const course = await prisma.$transaction(async (tx) => {
      const totalDuration = (modulesData as any[]).reduce(
        (sum: number, m: any) => sum + (m.durationMins || 0),
        0
      );

      const newCourse = await tx.course.create({
        data: {
          title,
          description,
          slug: finalSlug,
          category,
          level,
          price: typeof price === "number" ? price : 0,
          thumbnail: thumbnail || null,
          isPublished: false,        // Instructors cannot publish
          approvalStatus: "PENDING", // Always starts pending admin review
          instructorId,
          durationMins: totalDuration,
        },
      });

      // Create modules with their quizzes and questions
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
            isFree: Boolean(modData.isFree),
            isPublished: false,
          },
        });

        // FIXED: Save quizzes and their questions
        if (Array.isArray(modData.quizzes) && modData.quizzes.length > 0) {
          for (const quizData of modData.quizzes) {
            if (!quizData.title?.trim()) continue;

            const newQuiz = await tx.quiz.create({
              data: {
                moduleId: newModule.id,
                title: quizData.title.trim(),
                description: quizData.description || "",
                passingPercentage: quizData.passingPercentage || 0,
              },
            });

            if (Array.isArray(quizData.questions) && quizData.questions.length > 0) {
              for (let qi = 0; qi < quizData.questions.length; qi++) {
                const q = quizData.questions[qi];
                if (!q.question?.trim()) continue;
                await tx.quizQuestion.create({
                  data: {
                    quizId: newQuiz.id,
                    question: q.question.trim(),
                    options: JSON.stringify(q.options),
                    correctAnswer: q.correctAnswer ?? 0,
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

    // Fetch full course with relations for response
    const fullCourse = await prisma.course.findUnique({
      where: { id: course.id },
      include: {
        _count: { select: { enrollments: true, modules: true } },
        modules: {
          include: {
            quizzes: {
              include: {
                _count: { select: { questions: true, attempts: true } },
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    });

    await logActivity({
      activityType: "COURSE_CREATED",
      actorId:      session.user.id,
      actorName:    session.user.name ?? session.user.email ?? session.user.id,
      actorRole:    "INSTRUCTOR",
      targetId:     course.id,
      targetType:   "COURSE",
      targetTitle:  course.title,
      metadata:     { courseId: course.id, slug: course.slug, approvalStatus: "PENDING" },
    });

    return NextResponse.json({ course: fullCourse }, { status: 201 });
  } catch (err) {
    console.error("instructor create course error:", err);
    return NextResponse.json(
      { error: "Failed to create course. Please try again." },
      { status: 500 }
    );
  }
}