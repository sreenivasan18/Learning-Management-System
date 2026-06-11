// app/api/auth/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { verificationToken, email, password } = await req.json();

    if (!verificationToken || !email || !password) {
      return NextResponse.json(
        { error: "Verification token, email, and password are required." },
        { status: 400 }
      );
    }

    // Server-side password strength: minimum 8 characters
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate the verification token — must be:
    //   used: true      (OTP was verified)
    //   token not null  (not already consumed by a previous reset attempt)
    //   verifiedAt recent (within 10-minute window)
    const otpRecord = await prisma.oTPVerification.findFirst({
      where: {
        identifier: normalizedEmail,
        verificationToken,
        used: true,
        verifiedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });

    if (!otpRecord) {
      return NextResponse.json(
        { error: "Invalid or expired verification. Please start the process again." },
        { status: 400 }
      );
    }

    // BURN the verification token immediately — single-use only
    // This prevents replay attacks even if the response is intercepted
    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { verificationToken: null },
    });

    const hashedPassword = await bcrypt.hash(password, 12);

    // Update password — CRITICAL: exclude ADMIN users from student update path
    const [userResult, instructorResult] = await Promise.all([
      prisma.user.updateMany({
        where: {
          email: normalizedEmail,
          // SECURITY: never update admin passwords via forgot-password flow
          role: { not: "ADMIN" },
        },
        data: { hashedPassword },
      }),
      prisma.instructor.updateMany({
        where: { email: normalizedEmail },
        data: { hashedPassword },
      }),
    ]);

    if (userResult.count === 0 && instructorResult.count === 0) {
      // Either the email doesn't exist, or it belongs to an admin (silently fail)
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Password reset successfully. Please sign in.",
    });
  } catch (err) {
    console.error("reset-password error:", err);
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500 }
    );
  }
}