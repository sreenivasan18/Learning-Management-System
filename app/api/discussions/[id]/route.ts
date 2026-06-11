// FILE PATH: app/api/discussions/[id]/route.ts
//
// Single-discussion operations: GET (fetch full thread), PATCH (update), DELETE.
//
// PRIVACY ENFORCEMENT:
//   GET:
//     STUDENT   → only if discussion.authorId === currentUser.id
//     INSTRUCTOR → only if discussion is in one of their courses
//     ADMIN     → any discussion
//
//   PATCH (resolve/pin/hide):
//     INSTRUCTOR of the course or ADMIN only
//
//   PATCH (content edit):
//     Original author only
//
//   DELETE:
//     Original author OR instructor of the course OR admin
//
// BUG FIXED: Added missing GET handler.
// BUG FIXED: Instructor ID resolution (User.id vs Instructor.id).

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
// GET /api/discussions/[id]
// Returns the full discussion with all visible replies.
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

  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, image: true, role: true } },
      course: { select: { id: true, title: true, slug: true, instructorId: true } },
      replies: {
        where: { isHidden: false },
        include: { author: { select: { id: true, name: true, image: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!discussion || discussion.isHidden) {
    return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
  }

  // ── Privacy gate ─────────────────────────────────────────────────────────
  if (role === "STUDENT") {
    if (discussion.authorId !== userId) {
      // Return 404 (not 403) to avoid leaking discussion existence
      return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
    }
  } else if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    if (!instructorId || discussion.course.instructorId !== instructorId) {
      return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
    }
  }
  // ADMIN: unrestricted

  return NextResponse.json({ discussion });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/discussions/[id]
// Content edits (title/body): original author only.
// Status changes (isPinned/isResolved/isHidden): instructor of course or admin.
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(
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

  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: { course: { select: { instructorId: true } } },
  });

  if (!discussion || discussion.isHidden) {
    return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const updates: any = {};

  // ── Content edits (author only) ──────────────────────────────────────────
  if (body.title !== undefined || body.body !== undefined) {
    if (discussion.authorId !== userId) {
      return NextResponse.json({ error: "Forbidden: you can only edit your own posts." }, { status: 403 });
    }
    if (body.title) {
      const t = sanitize(String(body.title)).slice(0, 200);
      if (t.length < 5) return NextResponse.json({ error: "Title too short." }, { status: 400 });
      updates.title = t;
    }
    if (body.body) {
      const b = sanitize(String(body.body)).slice(0, 5000);
      if (b.length < 10) return NextResponse.json({ error: "Body too short." }, { status: 400 });
      updates.body = b;
    }
  }

  // ── Status changes (instructor of this course or admin only) ─────────────
  const isAdmin = role === "ADMIN";
  let isInstructorOfCourse = false;
  if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    isInstructorOfCourse = !!instructorId && discussion.course.instructorId === instructorId;
  }

  if (
    body.isPinned !== undefined ||
    body.isResolved !== undefined ||
    body.isHidden !== undefined
  ) {
    if (!isInstructorOfCourse && !isAdmin) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (body.isPinned  !== undefined) updates.isPinned  = Boolean(body.isPinned);
    if (body.isResolved !== undefined) updates.isResolved = Boolean(body.isResolved);
    if (body.isHidden  !== undefined) updates.isHidden  = Boolean(body.isHidden);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const updated = await prisma.discussion.update({
    where: { id },
    data: { ...updates, updatedAt: new Date() },
    include: {
      author: { select: { id: true, name: true, image: true, role: true } },
      _count: { select: { replies: { where: { isHidden: false } } } },
    },
  });

  return NextResponse.json({ success: true, discussion: updated });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/discussions/[id]
// Original author, course instructor, or admin can delete.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(
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

  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: { course: { select: { instructorId: true } } },
  });

  if (!discussion) {
    return NextResponse.json({ error: "Discussion not found." }, { status: 404 });
  }

  const isAuthor  = discussion.authorId === userId;
  const isAdmin   = role === "ADMIN";
  let isInstructorOfCourse = false;
  if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    isInstructorOfCourse = !!instructorId && discussion.course.instructorId === instructorId;
  }

  if (!isAuthor && !isInstructorOfCourse && !isAdmin) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  await prisma.$transaction([
    prisma.discussionReply.deleteMany({ where: { discussionId: id } }),
    prisma.discussion.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}