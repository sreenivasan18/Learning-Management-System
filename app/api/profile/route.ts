// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role;
  // Only students have a StudentProfile
  if (role !== "STUDENT") {
    return NextResponse.json({ error: "Profile is only available for student accounts." }, { status: 403 });
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: session.user.id },
  });
  return NextResponse.json({ profile });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role;
  if (role !== "STUDENT") {
    return NextResponse.json(
      { error: "Profile updates are only available for student accounts." },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, phone, bio, college, education, avatarUrl } = body;

  // Validate phone format if provided
  if (phone && !/^\+?[\d\s\-().]{7,20}$/.test(phone)) {
    return NextResponse.json({ error: "Invalid phone number format." }, { status: 400 });
  }

  const userId = session.user.id;

  // Check phone uniqueness (excluding this user)
  if (phone) {
    const existingPhone = await prisma.studentProfile.findFirst({
      where: { phone: phone.trim(), userId: { not: userId } },
    });
    if (existingPhone) {
      return NextResponse.json(
        { error: "This phone number is already registered." },
        { status: 409 }
      );
    }
  }

  try {
    const [, profile] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { name: name?.trim() || undefined },
      }),
      prisma.studentProfile.upsert({
        where: { userId },
        create: {
          userId,
          phone: phone?.trim() || null,
          bio: bio?.trim() || null,
          college: college?.trim() || null,
          education: education?.trim() || null,
          avatarUrl: avatarUrl?.trim() || null,
        },
        update: {
          phone: phone?.trim() || null,
          bio: bio?.trim() || null,
          college: college?.trim() || null,
          education: education?.trim() || null,
          avatarUrl: avatarUrl?.trim() || null,
        },
      }),
    ]);

    return NextResponse.json({ success: true, profile });
  } catch (err: any) {
    console.error("profile update error:", err);
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "This phone number is already registered." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
  }
}