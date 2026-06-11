// FILE PATH: app/api/discussions/[id]/replies/[replyId]/route.ts
//
// Edit or delete a specific reply.
//
// PATCH body: { body: string }     → content edit, author only
// PATCH body: { isHidden: boolean } → moderation, instructor of course or admin
// DELETE                           → author, instructor of course, or admin
//
// BUG FIXED: Instructor ID resolution (User.id ≠ Instructor.id).
// Privacy: checks that replyId belongs to discussionId to prevent cross-thread attacks.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/discussions/[id]/replies/[replyId]
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; replyId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role   = (session.user as any).role as string;
  const { id: discussionId, replyId } = await params;

  const reply = await prisma.discussionReply.findUnique({
    where: { id: replyId },
    select: {
      authorId: true,
      discussionId: true,
      discussion: {
        select: {
          course: { select: { instructorId: true } },
        },
      },
    },
  });

  if (!reply || reply.discussionId !== discussionId) {
    return NextResponse.json({ error: "Reply not found." }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Content edit: only the reply author can edit their own words
  if (body.body !== undefined) {
    if (reply.authorId !== userId) {
      return NextResponse.json({ error: "Forbidden: you can only edit your own replies." }, { status: 403 });
    }
    const safeBody = sanitize(String(body.body)).slice(0, 3000);
    if (safeBody.length < 2) {
      return NextResponse.json({ error: "Reply too short." }, { status: 400 });
    }
    const updated = await prisma.discussionReply.update({
      where: { id: replyId },
      data: { body: safeBody, updatedAt: new Date() },
      include: { author: { select: { id: true, name: true, image: true, role: true } } },
    });
    return NextResponse.json({ success: true, reply: updated });
  }

  // Hide/unhide: instructor of this course or admin
  if (body.isHidden !== undefined) {
    const isAdmin = role === "ADMIN";
    let isInstructorOfCourse = false;
    if (role === "INSTRUCTOR") {
      const instructorId = await resolveInstructorId(session.user.email);
      isInstructorOfCourse =
        !!instructorId && reply.discussion.course.instructorId === instructorId;
    }
    if (!isAdmin && !isInstructorOfCourse) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    await prisma.discussionReply.update({
      where: { id: replyId },
      data: { isHidden: Boolean(body.isHidden) },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/discussions/[id]/replies/[replyId]
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; replyId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role   = (session.user as any).role as string;
  const { id: discussionId, replyId } = await params;

  const reply = await prisma.discussionReply.findUnique({
    where: { id: replyId },
    select: {
      authorId: true,
      discussionId: true,
      discussion: {
        select: {
          course: { select: { instructorId: true } },
        },
      },
    },
  });

  if (!reply || reply.discussionId !== discussionId) {
    return NextResponse.json({ error: "Reply not found." }, { status: 404 });
  }

  const isAuthor = reply.authorId === userId;
  const isAdmin  = role === "ADMIN";
  let isInstructorOfCourse = false;
  if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    isInstructorOfCourse =
      !!instructorId && reply.discussion.course.instructorId === instructorId;
  }

  if (!isAuthor && !isAdmin && !isInstructorOfCourse) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  await prisma.$transaction([
    prisma.discussionReply.delete({ where: { id: replyId } }),
    prisma.discussion.update({
      where: { id: discussionId },
      data: { replyCount: { decrement: 1 } },
    }),
  ]);

  return NextResponse.json({ success: true });
}