// FILE PATH: app/api/admin/students/route.ts
//
// MONITORING REWRITE:
// Added to each student record:
//   - lastActiveAt: derived from the most recent VideoProgress.lastHeartbeatAt or
//                   PlatformActivity.createdAt, whichever is later.
//   - isOnline: true if lastActiveAt is within the last 5 minutes.
//   - totalLearningSeconds: sum of VideoProgress.watchedSecs across all modules.
//   - courseProgress: per-enrollment progress % computed from ModuleProgress.
//   - activityLog: last 10 PlatformActivity events for this student.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// A student is "online" if their last recorded activity is within this window.
const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page     = Math.max(1, parseInt(searchParams.get("page")     ?? "1",  10));
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));
  const search   = searchParams.get("search")?.trim() ?? "";

  const where: any = { role: "STUDENT" };
  if (search) {
    where.OR = [
      { name:  { contains: search } },
      { email: { contains: search } },
    ];
  }

  const [totalCount, students] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        profile: true,

        // Enrollments with full module progress for progress % calculation
        enrollments: {
          include: {
            course: {
              select: {
                id: true, title: true, slug: true,
                modules: {
                  where: { isPublished: true },
                  select: { id: true, title: true, order: true },
                  orderBy: { order: "asc" },
                },
              },
            },
            moduleProgress: {
              select: {
                moduleId: true,
                status: true,
                watchedSecs: true,
                videoCompleted: true,
                quizPassed: true,
                startedAt: true,
                completedAt: true,
              },
            },
          },
          orderBy: { enrolledAt: "desc" },
        },

        certificates: {
          include: { course: { select: { id: true, title: true } } },
          orderBy: { issuedAt: "desc" },
        },

        // Video progress: used for total learning time + last-heartbeat timestamp
        videoProgress: {
          select: {
            watchedSecs: true,
            totalSecs: true,
            completed: true,
            lastHeartbeatAt: true,
            moduleId: true,
          },
          orderBy: { lastHeartbeatAt: "desc" },
        },

        // Platform activity: used for last-active timestamp fallback + activity log
        platformActivity: {
          select: {
            id: true,
            activityType: true,
            targetTitle: true,
            targetType: true,
            metadata: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 15,
        },

        _count: {
          select: {
            enrollments:  true,
            certificates: true,
            quizAttempts: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const now = Date.now();

  const enriched = students.map((s) => {
    // ── Last active: latest of heartbeat or platform activity ──────────────
    const lastHeartbeat = s.videoProgress[0]?.lastHeartbeatAt ?? null;
    const lastActivity  = s.platformActivity[0]?.createdAt ?? null;

    let lastActiveAt: Date | null = null;
    if (lastHeartbeat && lastActivity) {
      lastActiveAt = lastHeartbeat > lastActivity ? lastHeartbeat : lastActivity;
    } else {
      lastActiveAt = lastHeartbeat ?? lastActivity ?? null;
    }

    const isOnline = lastActiveAt
      ? now - lastActiveAt.getTime() < ONLINE_WINDOW_MS
      : false;

    // ── Total learning seconds (sum of all video progress) ─────────────────
    const totalLearningSeconds = s.videoProgress.reduce(
      (sum, vp) => sum + (vp.watchedSecs ?? 0),
      0
    );

    // ── Per-enrollment progress % ──────────────────────────────────────────
    const enrollmentsWithProgress = s.enrollments.map((enr) => {
      const totalModules = enr.course.modules.length;
      if (totalModules === 0) {
        return {
          id: enr.id,
          enrolledAt: enr.enrolledAt,
          status: enr.status,
          completedAt: enr.completedAt,
          course: {
            id: enr.course.id,
            title: enr.course.title,
            slug: enr.course.slug,
          },
          progressPct: 0,
          completedModules: 0,
          totalModules: 0,
        };
      }

      const progressByModuleId = new Map(
        enr.moduleProgress.map((p) => [p.moduleId, p])
      );

      let completedModules = 0;
      for (const mod of enr.course.modules) {
        const mp = progressByModuleId.get(mod.id);
        if (mp?.status === "COMPLETED") completedModules++;
      }

      const progressPct = Math.round((completedModules / totalModules) * 100);

      return {
        id: enr.id,
        enrolledAt: enr.enrolledAt,
        status: enr.status,
        completedAt: enr.completedAt,
        course: {
          id: enr.course.id,
          title: enr.course.title,
          slug: enr.course.slug,
        },
        progressPct,
        completedModules,
        totalModules,
      };
    });

    // ── Activity log (last 10 events) ──────────────────────────────────────
    const activityLog = s.platformActivity.slice(0, 10).map((a) => ({
      id: a.id,
      activityType: a.activityType,
      targetTitle: a.targetTitle,
      targetType: a.targetType,
      createdAt: a.createdAt,
    }));

    return {
      id: s.id,
      name: s.name,
      email: s.email,
      createdAt: s.createdAt,
      profile: s.profile,

      // ── Monitoring fields ──────────────────────────────────────────────
      isOnline,
      lastActiveAt: lastActiveAt?.toISOString() ?? null,
      totalLearningSeconds,

      // ── Enrollment / progress ──────────────────────────────────────────
      enrollments: enrollmentsWithProgress,
      certificates: s.certificates,
      activityLog,

      _count: s._count,
    };
  });

  return NextResponse.json({
    students: enriched,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  });
}