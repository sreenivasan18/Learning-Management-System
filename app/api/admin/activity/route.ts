// FILE PATH: app/api/admin/activity/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page      = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit     = 50;
  const typeFilter = searchParams.get("type") ?? undefined;
  const search    = searchParams.get("search")?.trim() ?? undefined;

  const where: any = {};
  if (typeFilter && typeFilter !== "ALL") where.activityType = typeFilter;
  if (search) {
    where.OR = [
      { actorName: { contains: search } },
      { targetTitle: { contains: search } },
      { activityType: { contains: search } },
    ];
  }

  const [activities, total] = await Promise.all([
    prisma.platformActivity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.platformActivity.count({ where }),
  ]);

  // Aggregate counts by type for the filter bar
  const typeCounts = await prisma.platformActivity.groupBy({
    by: ["activityType"],
    _count: { activityType: true },
    orderBy: { _count: { activityType: "desc" } },
  });

  return NextResponse.json(
    {
      activities,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      typeCounts: typeCounts.map((t) => ({
        type: t.activityType,
        count: t._count.activityType,
      })),
    },
    {
      headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" },
    }
  );
}