// FILE PATH: app/api/admin/instructors/route.ts
//
// MONITORING REWRITE:
// GET now returns full instructor monitoring data:
//   - lastActiveAt: derived from their most recent PlatformActivity event.
//   - isOnline: true if lastActiveAt is within the last 5 minutes.
//   - totalPlatformActivityCount: count of all activity events.
//   - coursePerformance: per-course enrollment count, avg rating, completion count.
//   - activityLog: last 10 PlatformActivity events for this instructor.
//
// Source of truth for instructor activity is PlatformActivity (actorId = instructor's
// shadow User id OR direct instructor id). Instructors use a shadow User row for auth,
// so we cross-reference by both instructor.id and the shadow user with matching email.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

async function requireAdmin(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "ADMIN") {
    return null;
  }
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch all instructors with their courses
  const instructors = await prisma.instructor.findMany({
    include: {
      courses: {
        include: {
          _count: { select: { enrollments: true } },
          feedback: {
            where: { isHidden: false },
            select: { rating: true },
          },
          enrollments: {
            where: { status: "COMPLETED" },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();

  // For each instructor, resolve their shadow User id (if any) for activity lookup.
  // Instructors may have shadow users with the same id or same email.
  const instructorEmails = instructors.map((i) => i.email);
  const shadowUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: instructors.map((i) => i.id) } },
        { email: { in: instructorEmails }, role: "INSTRUCTOR" },
      ],
    },
    select: { id: true, email: true },
  });

  // Map instructor.id → shadow user id (for activity log queries)
  const emailToShadowId = new Map(shadowUsers.map((u) => [u.email, u.id]));
  const idToShadowId    = new Map(shadowUsers.map((u) => [u.id,    u.id]));

  // Collect all actor IDs to fetch activity in one query
  const actorIds = instructors.map((inst) => {
    return idToShadowId.get(inst.id) ?? emailToShadowId.get(inst.email) ?? inst.id;
  });

  // Fetch recent activity for all instructors in one query
  const allActivity = await prisma.platformActivity.findMany({
    where: { actorId: { in: actorIds } },
    select: {
      id: true,
      activityType: true,
      actorId: true,
      targetTitle: true,
      targetType: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200, // cap for performance; enough for all instructors
  });

  // Group activity by actorId
  const activityByActor = new Map<string, typeof allActivity>();
  for (const act of allActivity) {
    if (!act.actorId) continue;
    if (!activityByActor.has(act.actorId)) activityByActor.set(act.actorId, []);
    activityByActor.get(act.actorId)!.push(act);
  }

  const enriched = instructors.map((inst) => {
    const resolvedActorId =
      idToShadowId.get(inst.id) ?? emailToShadowId.get(inst.email) ?? inst.id;

    const myActivity = activityByActor.get(resolvedActorId) ?? [];
    const lastActiveAt = myActivity[0]?.createdAt ?? null;

    const isOnline = lastActiveAt
      ? now - new Date(lastActiveAt).getTime() < ONLINE_WINDOW_MS
      : false;

    // Per-course performance
    const coursePerformance = inst.courses.map((c) => {
      const ratings = c.feedback.map((f) => f.rating);
      const avgRating =
        ratings.length > 0
          ? parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1))
          : null;

      return {
        id: c.id,
        title: c.title,
        slug: c.slug,
        isPublished: c.isPublished,
        approvalStatus: c.approvalStatus,
        enrollmentCount: c._count.enrollments,
        completionCount: c.enrollments.length,
        avgRating,
        reviewCount: ratings.length,
      };
    });

    const totalEnrollments = coursePerformance.reduce(
      (s, c) => s + c.enrollmentCount, 0
    );

    // Activity log (last 10)
    const activityLog = myActivity.slice(0, 10).map((a) => ({
      id: a.id,
      activityType: a.activityType,
      targetTitle: a.targetTitle,
      targetType: a.targetType,
      createdAt: a.createdAt,
    }));

    return {
      id: inst.id,
      name: inst.name,
      email: inst.email,
      specialization: inst.specialization,
      bio: inst.bio,
      createdAt: inst.createdAt,

      // ── Monitoring fields ──────────────────────────────────────────────
      isOnline,
      lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
      totalPlatformActivityCount: myActivity.length,

      // Legacy shape (used by existing overview tab)
      courses: inst.courses.map((c) => ({
        id: c.id,
        _count: { enrollments: c._count.enrollments },
      })),

      // ── Full monitoring data ───────────────────────────────────────────
      coursePerformance,
      totalEnrollments,
      activityLog,
    };
  });

  return NextResponse.json({ instructors: enriched });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { name, email, password, bio, specialization } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required." },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    const [existingUser, existingInstructor] = await Promise.all([
      prisma.user.findUnique({ where: { email: normalizedEmail } }),
      prisma.instructor.findUnique({ where: { email: normalizedEmail } }),
    ]);
    if (existingUser || existingInstructor) {
      return NextResponse.json(
        { error: "This email is already registered." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const instructor = await prisma.instructor.create({
      data: { name: name.trim(), email: normalizedEmail, hashedPassword, bio, specialization },
    });

    return NextResponse.json({
      success: true,
      instructor: { id: instructor.id, name: instructor.name, email: instructor.email },
    });
  } catch (err: any) {
    console.error("create instructor error:", err);
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "This email is already registered." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create instructor." }, { status: 500 });
  }
}