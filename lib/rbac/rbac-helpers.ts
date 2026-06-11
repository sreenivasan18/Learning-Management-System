// FILE PATH: lib/rbac/rbac-helpers.ts
//
// FIX: requireStudent() previously blocked all non-STUDENT users, including
// ADMIN. This prevented admins from accessing student-adjacent routes (course
// detail pages, quiz pages, certificate views) for oversight and moderation.
//
// Updated requireStudent() now allows ADMIN access in addition to STUDENT.
// All resource-level permission checks (canAccessCertificate, canAccessCourse,
// canAccessModule, canAccessQuiz) already handle ADMIN correctly by returning
// true at the top of each function. This change makes the page-level guard
// consistent with the resource-level guards.
//
// requireInstructor() is unchanged: it already allows ADMIN access.

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  isInstructor?: boolean;
};

// ── Page-level guards (server components / route handlers that use redirect) ──

export async function requireAuth(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  return session.user as SessionUser;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/403");
  return user;
}

export async function requireInstructor(): Promise<SessionUser> {
  const user = await requireAuth();
  // ADMIN can access instructor routes for oversight
  if (user.role !== "INSTRUCTOR" && user.role !== "ADMIN") redirect("/403");
  return user;
}

export async function requireStudent(): Promise<SessionUser> {
  const user = await requireAuth();
  // ADMIN can access student routes for oversight and moderation
  // STUDENT is the primary audience
  if (user.role !== "STUDENT" && user.role !== "ADMIN") redirect("/403");
  return user;
}

// ── API-level guards (return NextResponse, no redirect) ──

export async function apiRequireAuth(): Promise<
  { user: SessionUser; error?: never } | { user?: never; error: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user: session.user as SessionUser };
}

// ── Resource-level permission checks ──

export async function canAccessCertificate(
  certificateId: string,
  sessionUser: SessionUser
): Promise<boolean> {
  if (sessionUser.role === "ADMIN") return true;

  const cert = await prisma.certificate.findUnique({
    where: { id: certificateId },
    include: { course: { select: { instructorId: true } } },
  });
  if (!cert) return false;

  if (sessionUser.role === "STUDENT") return cert.userId === sessionUser.id;
  if (sessionUser.role === "INSTRUCTOR")
    return cert.course.instructorId === sessionUser.id;

  return false;
}

export async function canAccessCourse(
  courseId: string,
  sessionUser: SessionUser
): Promise<boolean> {
  if (sessionUser.role === "ADMIN") return true;

  if (sessionUser.role === "INSTRUCTOR") {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    return course?.instructorId === sessionUser.id;
  }

  if (sessionUser.role === "STUDENT") {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: sessionUser.id, courseId } },
    });
    return !!enrollment;
  }

  return false;
}

export async function canAccessModule(
  moduleId: string,
  sessionUser: SessionUser
): Promise<boolean> {
  if (sessionUser.role === "ADMIN") return true;

  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { courseId: true, isFree: true },
  });
  if (!module) return false;

  // Free preview modules are publicly accessible
  if (module.isFree) return true;

  return canAccessCourse(module.courseId, sessionUser);
}

export async function canAccessQuiz(
  quizId: string,
  sessionUser: SessionUser
): Promise<boolean> {
  if (sessionUser.role === "ADMIN") return true;

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { module: { select: { courseId: true } } },
  });
  if (!quiz) return false;

  return canAccessCourse(quiz.module.courseId, sessionUser);
}

export async function canAccessQuizAttempt(
  attemptId: string,
  sessionUser: SessionUser
): Promise<boolean> {
  if (sessionUser.role === "ADMIN") return true;

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      userId: true,
      quiz: { select: { module: { select: { courseId: true } } } },
    },
  });
  if (!attempt) return false;

  if (sessionUser.role === "STUDENT") return attempt.userId === sessionUser.id;

  if (sessionUser.role === "INSTRUCTOR") {
    const course = await prisma.course.findUnique({
      where: { id: attempt.quiz.module.courseId },
      select: { instructorId: true },
    });
    return course?.instructorId === sessionUser.id;
  }

  return false;
}