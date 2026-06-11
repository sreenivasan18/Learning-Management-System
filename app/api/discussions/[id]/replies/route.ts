// FILE PATH: app/api/discussions/[id]/replies/route.ts
//
// COMPLETE REWRITE — PRIVACY + REPLY SYSTEM FIX
//
// GET  → fetch replies for a discussion thread
//   STUDENT   → only if they own the discussion (authorId === userId)
//   INSTRUCTOR → only if the discussion is in their course
//   ADMIN     → any discussion
//
// POST → add a reply to a discussion thread
//   STUDENT   → only on discussions they own (continue their own thread)
//   INSTRUCTOR → only on discussions in their courses
//   ADMIN     → any discussion
//
// BUG FIXED: Previously GET had NO privacy checks — any authenticated user
// could read any discussion's private reply thread by knowing the discussion ID.
//
// BUG FIXED: isInstructorReply flag now correctly set for instructors of the
// SPECIFIC course being discussed, not just any instructor.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_REPLY_LENGTH = 3000;
const MIN_REPLY_LENGTH = 2;

function sanitize(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").replace(/[^\S\r\n]+/g, " ").trim();
}

async function resolveInstructorId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const rec = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return rec?.id ?? null;
}

/**
 * Shared access check: verifies the caller is allowed to interact with this
 * specific discussion based on their role and relationship to the discussion.
 *
 * Returns the discussion record if access is granted, or null if denied.
 */
async function getDiscussionWithAccessCheck(
  discussionId: string,
  userId: string,
  role: string,
  userEmail: string | null | undefined
) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    select: {
      id: true,
      courseId: true,
      authorId: true,
      isHidden: true,
      course: { select: { instructorId: true } },
    },
  });

  if (!discussion || discussion.isHidden) return null;

  if (role === "STUDENT") {
    // Students can only interact with their own discussion threads
    if (discussion.authorId !== userId) return null;

    // Also verify they're still enrolled (enrollment can be suspended)
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId, courseId: discussion.courseId },
      select: { id: true },
    });
    if (!enrollment) return null;
  } else if (role === "INSTRUCTOR") {
    // Instructors can only interact with discussions in their courses
    const instructorId = await resolveInstructorId(userEmail);
    if (!instructorId || discussion.course.instructorId !== instructorId) return null;
  }
  // ADMIN: unrestricted access

  return discussion;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/discussions/[id]/replies
// Returns all visible replies for a discussion thread.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role   = (session.user as any).role as string;
  const { id } = await params;

  const discussion = await getDiscussionWithAccessCheck(id, userId, role, session.user.email);
  if (!discussion) {
    return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
  }

  const replies = await prisma.discussionReply.findMany({
    where: { discussionId: id, isHidden: false },
    include: {
      author: { select: { id: true, name: true, image: true, role: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ replies });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/discussions/[id]/replies
// Add a new reply to a discussion thread.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role   = (session.user as any).role as string;
  const { id } = await params;

  const discussion = await getDiscussionWithAccessCheck(id, userId, role, session.user.email);
  if (!discussion) {
    return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const rawBody = body?.body;
  if (!rawBody || typeof rawBody !== "string" || !rawBody.trim()) {
    return NextResponse.json({ error: "Reply body is required." }, { status: 400 });
  }

  const safeBody = sanitize(rawBody).slice(0, MAX_REPLY_LENGTH);
  if (safeBody.length < MIN_REPLY_LENGTH) {
    return NextResponse.json({ error: "Reply is too short." }, { status: 400 });
  }

  // Determine if this reply is from the instructor of this specific course
  let isInstructorReply = false;
  if (role === "ADMIN") {
    isInstructorReply = true; // admins treated as authoritative
  } else if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    isInstructorReply = !!instructorId && discussion.course.instructorId === instructorId;
  }

  // Transaction: create reply AND increment the denormalized replyCount
  const reply = await prisma.$transaction(async (tx) => {
    const r = await tx.discussionReply.create({
      data: {
        discussionId: id,
        authorId: userId,
        body: safeBody,
        isInstructorReply,
      },
      include: {
        author: { select: { id: true, name: true, image: true, role: true } },
      },
    });
    // Keep replyCount in sync (denormalized counter for fast listing)
    await tx.discussion.update({
      where: { id },
      data: { replyCount: { increment: 1 } },
    });
    return r;
  });

  return NextResponse.json({ success: true, reply }, { status: 201 });
}