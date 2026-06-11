// FILE PATH: app/api/discussions/route.ts
//
// PRIVATE SUPPORT THREAD SYSTEM — COMPLETE REWRITE
//
// PRIVACY MODEL:
//   STUDENT  → GET returns only discussions where authorId === currentUser.id
//   INSTRUCTOR → GET returns all non-hidden discussions in courses they manage
//   ADMIN    → GET returns all discussions (global visibility)
//
// CREATION:
//   Only students can open new threads (doubts). Instructors and admins reply only.
//   This enforces the student-initiates, instructor-responds model.
//
// CRITICAL BUG FIXED: Previously the GET query had NO authorId filter for students,
// meaning any enrolled student could read every other student's private doubts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH  = 5000;

function sanitize(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").replace(/[^\S\r\n]+/g, " ").trim();
}

/**
 * Resolve the Instructor table row from the session user's email.
 * Course.instructorId references Instructor.id (a SEPARATE table from User).
 * The bridge is the shared email field.
 */
async function resolveInstructorId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const rec = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return rec?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/discussions?courseId=xxx[&moduleId=yyy][&page=N][&status=open|resolved|all]
//
// STUDENT  → Only their own discussion threads for the course
// INSTRUCTOR → All student threads in their course (to reply/monitor)
// ADMIN    → All threads globally scoped to courseId
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role   = (session.user as any).role as string;
  const { searchParams } = new URL(req.url);

  const courseId = searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required." }, { status: 400 });
  }

  const moduleId   = searchParams.get("moduleId") ?? undefined;
  const statusFilter = searchParams.get("status") ?? "all"; // "all" | "open" | "resolved"
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = 20;

  // ── Access gate ──────────────────────────────────────────────────────────
  if (role === "STUDENT") {
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId, courseId },
      select: { id: true },
    });
    if (!enrollment) {
      return NextResponse.json(
        { error: "You must be enrolled to view discussions." },
        { status: 403 }
      );
    }
  } else if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    if (!instructorId) {
      return NextResponse.json({ error: "Instructor record not found." }, { status: 403 });
    }
    const course = await prisma.course.findFirst({
      where: { id: courseId, instructorId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Forbidden: not your course." }, { status: 403 });
    }
  }
  // ADMIN: no additional check

  // ── Build privacy-aware WHERE clause ────────────────────────────────────
  const where: any = { courseId, isHidden: false };

  // CRITICAL PRIVACY FIX: students can only see their own threads
  if (role === "STUDENT") {
    where.authorId = userId;
  }

  if (moduleId) where.moduleId = moduleId;

  if (statusFilter === "open")     where.isResolved = false;
  if (statusFilter === "resolved") where.isResolved = true;

  // ── Fetch (pinned first, then newest) ─────────────────────────────────
  const selectAuthor = { id: true, name: true, image: true, role: true };

  const [pinned, unpinned, total] = await Promise.all([
    prisma.discussion.findMany({
      where: { ...where, isPinned: true },
      include: {
        author: { select: selectAuthor },
        _count: { select: { replies: { where: { isHidden: false } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.discussion.findMany({
      where: { ...where, isPinned: false },
      include: {
        author: { select: selectAuthor },
        _count: { select: { replies: { where: { isHidden: false } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.discussion.count({ where }),
  ]);

  return NextResponse.json({
    discussions: [...pinned, ...unpinned],
    total,
    page,
    totalPages: Math.ceil(total / limit),
    role, // let the frontend know which role is viewing
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/discussions — student creates a new doubt/question thread
//
// Only STUDENTS can open new threads. This enforces the required model:
//   student creates doubt → instructor sees it → instructor replies
//
// INSTRUCTOR and ADMIN use POST /api/discussions/[id]/replies to respond.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role   = (session.user as any).role as string;

  // Only students open new threads (instructors/admins only reply)
  if (role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can open new discussion threads." },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { courseId, moduleId, title, body: rawBody } = body;

  if (!courseId || typeof courseId !== "string" || !courseId.trim()) {
    return NextResponse.json({ error: "courseId is required." }, { status: 400 });
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  if (!rawBody || typeof rawBody !== "string" || !rawBody.trim()) {
    return NextResponse.json({ error: "Question body is required." }, { status: 400 });
  }

  const safeTitle = sanitize(title).slice(0, MAX_TITLE_LENGTH);
  const safeBody  = sanitize(rawBody).slice(0, MAX_BODY_LENGTH);

  if (safeTitle.length < 5) {
    return NextResponse.json({ error: "Title too short (minimum 5 characters)." }, { status: 400 });
  }
  if (safeBody.length < 10) {
    return NextResponse.json({ error: "Question body too short (minimum 10 characters)." }, { status: 400 });
  }

  // Student must be enrolled in the course
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId },
    select: { id: true },
  });
  if (!enrollment) {
    return NextResponse.json(
      { error: "You must be enrolled in this course to post a question." },
      { status: 403 }
    );
  }

  // Rate limit: max 3 new threads per 60 seconds per student per course
  const recentCount = await prisma.discussion.count({
    where: {
      authorId: userId,
      courseId,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (recentCount >= 3) {
    return NextResponse.json(
      { error: "Too many posts. Please wait before posting again." },
      { status: 429 }
    );
  }

  // Verify moduleId belongs to courseId if provided
  if (moduleId && typeof moduleId === "string") {
    const mod = await prisma.module.findFirst({
      where: { id: moduleId, courseId },
      select: { id: true },
    });
    if (!mod) {
      return NextResponse.json(
        { error: "Invalid moduleId for this course." },
        { status: 400 }
      );
    }
  }

  const discussion = await prisma.discussion.create({
    data: {
      courseId,
      moduleId: (moduleId && typeof moduleId === "string") ? moduleId : null,
      authorId: userId,
      title: safeTitle,
      body: safeBody,
    },
    include: {
      author: { select: { id: true, name: true, image: true, role: true } },
      _count: { select: { replies: true } },
    },
  });

  return NextResponse.json({ success: true, discussion }, { status: 201 });
}