// FILE PATH: app/instructor/courses/[id]/edit/page.tsx
//
// APPROVAL WORKFLOW:
//   PENDING and REJECTED courses → editable (CourseEditClient in edit mode).
//   APPROVED / Published courses → read-only view (no redirect; instructors can see their own content).
//   The API enforces the edit restriction at PATCH level regardless.

import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import CourseEditClient from "@/components/instructor/CourseEditClient";

export default async function InstructorCourseEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "INSTRUCTOR") {
    redirect("/auth/signin");
  }

  const { id } = await params;

  // Resolve instructor record from email
  const instructor = await prisma.instructor.findUnique({
    where: { email: session.user.email! },
    select: { id: true },
  });
  if (!instructor) redirect("/auth/signin");

  // Fetch the course — must belong to this instructor
  const course = await prisma.course.findFirst({
    where: { id, instructorId: instructor.id },
    include: {
      modules: {
        include: {
          quizzes: {
            include: {
              questions: {
                orderBy: { order: "asc" },
              },
              _count: { select: { questions: true, attempts: true } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!course) notFound();

  // APPROVED and published courses are shown read-only.
  // The API also enforces this at PATCH level, but here we pass readOnly=true
  // instead of redirecting so instructors can still view their approved course content.
  const readOnly = course.approvalStatus === "APPROVED" || course.isPublished;

  return (
    <>
      <Navbar />
      <CourseEditClient course={course as any} readOnly={readOnly} />
    </>
  );
}