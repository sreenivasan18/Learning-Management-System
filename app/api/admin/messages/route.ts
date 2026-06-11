// FILE PATH: app/api/admin/messages/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeThreadId(userId: string): string {
  return `admin_${userId}`;
}

/**
 * Ensures a shadow User row exists for a credentials-based instructor.
 * Credentials instructors authenticate via the `instructors` table but
 * AdminMessage requires User-table foreign keys. Google-auth instructors
 * already get a shadow User (created in auth.ts signIn callback).
 * Credentials instructors do not — we create one on demand here.
 *
 * Returns the User id to use for messaging (same as instructor.id because
 * the shadow row is created with id = instructor.id).
 */
async function ensureInstructorShadowUser(instructorId: string): Promise<string | null> {
  // Already have a User row with this id?
  const existing = await prisma.user.findUnique({ where: { id: instructorId } });
  if (existing) return existing.id;

  // Look up the instructor record
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor) return null;

  // Check by email (shadow might exist with a different id — shouldn't happen but guard)
  const byEmail = await prisma.user.findUnique({ where: { email: instructor.email } });
  if (byEmail) return byEmail.id;

  // Create shadow User with same id as instructor so session.user.id matches
  const shadow = await prisma.user.create({
    data: {
      id:    instructor.id,
      name:  instructor.name,
      email: instructor.email,
      role:  "INSTRUCTOR",
    },
  });
  return shadow.id;
}

// ── GET: Admin views all threads OR a specific thread ─────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const threadUserId = searchParams.get("userId");

  // ── Admin: list all threads or view a specific thread ──────────────────────
  if (role === "ADMIN") {
    if (threadUserId) {
      // Admin opens a specific thread.
      // For credentials-only instructors, the shadow User may not exist yet.
      // Resolve it now so otherUser is never null for a valid instructor id.
      const resolvedUserId = await (async () => {
        const directUser = await prisma.user.findUnique({ where: { id: threadUserId } });
        if (directUser) return directUser.id;
        // Not in users table — try to create shadow for a credentials instructor
        const resolved = await ensureInstructorShadowUser(threadUserId);
        return resolved ?? threadUserId;
      })();

      const threadId = makeThreadId(resolvedUserId);

      // Mark messages in this thread as read by admin
      await prisma.adminMessage.updateMany({
        where: { threadId, isReadByAdmin: false, senderRole: { not: "ADMIN" } },
        data: { isReadByAdmin: true },
      });

      const messages = await prisma.adminMessage.findMany({
        where: { threadId },
        include: {
          sender: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      const otherUser = await prisma.user.findUnique({
        where: { id: resolvedUserId },
        select: { id: true, name: true, email: true, role: true },
      });

      return NextResponse.json({ messages, otherUser, threadId });
    }

    // Admin: list all unique threads
    const rawMessages = await prisma.adminMessage.findMany({
      where: { isArchivedByAdmin: false },
      include: {
        sender:    { select: { id: true, name: true, email: true, role: true } },
        recipient: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const threadMap = new Map<string, {
      threadId: string;
      otherUser: { id: string; name: string | null; email: string; role: string };
      lastMessage: string;
      lastMessageAt: Date;
      unreadCount: number;
    }>();

    for (const msg of rawMessages) {
      const tid = msg.threadId;
      if (threadMap.has(tid)) continue;

      const otherUser = msg.senderRole === "ADMIN"
        ? msg.recipient
        : msg.sender;

      const unread = rawMessages.filter(
        (m) => m.threadId === tid && !m.isReadByAdmin && m.senderRole !== "ADMIN"
      ).length;

      threadMap.set(tid, {
        threadId: tid,
        otherUser: {
          id:    otherUser.id,
          name:  otherUser.name,
          email: otherUser.email,
          role:  otherUser.role as string,
        },
        lastMessage:   msg.body,
        lastMessageAt: msg.createdAt,
        unreadCount:   unread,
      });
    }

    const threads = Array.from(threadMap.values()).sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()
    );

    return NextResponse.json({ threads });
  }

  // ── Student or Instructor: view their own thread with admin ───────────────
  if (role === "STUDENT" || role === "INSTRUCTOR") {
    const userId = session.user.id;

    if (role === "INSTRUCTOR") {
      await ensureInstructorShadowUser(userId);
    }

    const threadId = makeThreadId(userId);

    await prisma.adminMessage.updateMany({
      where: { threadId, isReadByRecipient: false, senderRole: "ADMIN" },
      data: { isReadByRecipient: true },
    });

    const messages = await prisma.adminMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      select: {
        id:                true,
        body:              true,
        senderRole:        true,
        isReadByRecipient: true,
        isReadByAdmin:     true,
        createdAt:         true,
      },
    });

    return NextResponse.json({ messages, threadId });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ── POST: Send a message ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["ADMIN", "STUDENT", "INSTRUCTOR"].includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { message, recipientId } = body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message body required." }, { status: 400 });
  }

  const trimmedMessage = message.trim().slice(0, 5000);
  const senderId       = session.user.id;

  if (role === "ADMIN") {
    if (!recipientId || typeof recipientId !== "string") {
      return NextResponse.json({ error: "recipientId required for admin messages." }, { status: 400 });
    }

    let recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, name: true, role: true },
    });

    if (!recipient) {
      const resolvedId = await ensureInstructorShadowUser(recipientId);
      if (!resolvedId) {
        return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
      }
      recipient = await prisma.user.findUnique({
        where: { id: resolvedId },
        select: { id: true, name: true, role: true },
      });
    }

    if (!recipient) {
      return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
    }
    if (recipient.role === "ADMIN") {
      return NextResponse.json({ error: "Cannot message another admin." }, { status: 400 });
    }

    const threadId = makeThreadId(recipient.id);
    const adminUser = await prisma.user.findUnique({
      where: { id: senderId },
      select: { name: true },
    });

    const msg = await prisma.adminMessage.create({
      data: {
        threadId,
        senderId,
        recipientId: recipient.id,
        senderRole: "ADMIN",
        body: trimmedMessage,
        isReadByAdmin: true,
      },
    });

    await prisma.platformActivity.create({
      data: {
        activityType: "ADMIN_MESSAGE_SENT",
        actorId:      senderId,
        actorName:    adminUser?.name ?? "Admin",
        actorRole:    "ADMIN",
        targetId:     recipient.id,
        targetType:   "USER",
        targetTitle:  recipient.name ?? recipient.id,
        metadata:     JSON.stringify({ threadId, messageId: msg.id }),
      },
    });

    return NextResponse.json({ success: true, message: msg });
  }

  // Student or Instructor sends to admin
  const senderId_ = senderId;

  if (role === "INSTRUCTOR") {
    const resolved = await ensureInstructorShadowUser(senderId_);
    if (!resolved) {
      return NextResponse.json({ error: "Instructor account not found." }, { status: 500 });
    }
  }

  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (!adminUser) {
    return NextResponse.json({ error: "No admin account found." }, { status: 500 });
  }

  const threadId = makeThreadId(senderId_);

  const msg = await prisma.adminMessage.create({
    data: {
      threadId,
      senderId:          senderId_,
      recipientId:       adminUser.id,
      senderRole:        role,
      body:              trimmedMessage,
      isReadByRecipient: true,
    },
  });

  return NextResponse.json({ success: true, message: msg });
}