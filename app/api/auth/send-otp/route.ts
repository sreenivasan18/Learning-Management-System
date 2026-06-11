// FILE PATH: app/api/auth/send-otp/route.ts
//
// CHANGES FROM PREVIOUS VERSION:
// 1. Removed `otp-signin` as a valid purpose (carried over from previous fix).
// 2. Cross-table email uniqueness check for register/google-onboarding.
// 3. Role parameter is now optional for forgot-password.
//    When role is omitted the API auto-detects: it checks the instructors table
//    first, then the users table. This supports the unified forgot-password page
//    which does not ask users to select their role before requesting an OTP.
// 4. ADMIN accounts are always blocked from the forgot-password OTP flow.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOTPEmail } from "@/lib/email";
import { generateOTP } from "@/lib/utils";
import bcrypt from "bcryptjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, name, purpose, role } = body;

    if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address." },
        { status: 400 }
      );
    }

    const validPurposes = ["register", "forgot-password", "google-onboarding"];
    if (!purpose || !validPurposes.includes(purpose)) {
      return NextResponse.json({ error: "Invalid purpose." }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── Rate limiting: max 3 OTPs per email per 10 minutes ──────────────────
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await prisma.oTPVerification.count({
      where: {
        identifier: normalizedEmail,
        createdAt: { gte: tenMinsAgo },
      },
    });
    if (recentCount >= 3) {
      return NextResponse.json(
        {
          error:
            "Too many OTP requests. Please wait 10 minutes before trying again.",
        },
        { status: 429 }
      );
    }

    // ── Email-existence and role guards per purpose ──────────────────────────

    if (purpose === "register" || purpose === "google-onboarding") {
      // Enforce strict cross-table uniqueness: one email = one account.
      const [existingUser, existingInstructor] = await Promise.all([
        prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { role: true },
        }),
        prisma.instructor.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        }),
      ]);

      if (existingInstructor) {
        return NextResponse.json(
          {
            error:
              "This email is already registered as an Instructor account. Please use the Instructor portal to continue.",
            roleConflict: true,
            existingRole: "instructor",
          },
          { status: 409 }
        );
      }

      if (existingUser) {
        if (existingUser.role === "STUDENT") {
          return NextResponse.json(
            {
              error:
                "An account with this email already exists. Please sign in instead.",
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: "An account with this email already exists." },
          { status: 409 }
        );
      }
    } else if (purpose === "forgot-password") {
      // ── UNIFIED forgot-password: auto-detect account from both tables ──────
      // When `role` is explicitly "instructor", check instructors table only.
      // When `role` is "student" or omitted, check instructors table first, then users.
      // This handles the unified forgot-password flow (no role selection required).

      if (role === "instructor") {
        // Explicit instructor path (kept for backwards compat with any old clients)
        const instructor = await prisma.instructor.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        });
        if (!instructor) {
          return NextResponse.json(
            {
              redirectToRegister: true,
              message:
                "No account found. Redirecting you to create a new account.",
            },
            { status: 200 }
          );
        }
      } else {
        // Unified path: check instructors table first, then users table.
        // This means an instructor who uses the unified forgot-password page
        // (without specifying role) is correctly handled.
        const instructor = await prisma.instructor.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        });

        if (!instructor) {
          // Not an instructor — check users table
          const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, role: true },
          });

          if (!user) {
            return NextResponse.json(
              {
                redirectToRegister: true,
                message:
                  "No account found. Redirecting you to create a new account.",
              },
              { status: 200 }
            );
          }

          // ADMIN accounts cannot use the forgot-password OTP flow.
          // Shadow INSTRUCTOR users in the User table also blocked
          // (they should use the instructor path or Google auth).
          if (user.role === "ADMIN" || user.role === "INSTRUCTOR") {
            return NextResponse.json(
              {
                redirectToRegister: true,
                message:
                  "No account found. Redirecting you to create a new account.",
              },
              { status: 200 }
            );
          }
        }
        // instructor found OR user is STUDENT — proceed to OTP generation below
      }
    }

    // ── Atomically invalidate old OTPs and clean up expired ones ───────────
    await Promise.all([
      prisma.oTPVerification.updateMany({
        where: { identifier: normalizedEmail, used: false },
        data: { used: true },
      }),
      prisma.oTPVerification.deleteMany({
        where: { identifier: normalizedEmail, expires: { lt: new Date() } },
      }),
    ]);

    // ── Generate and store OTP ──────────────────────────────────────────────
    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    const otpRecord = await prisma.oTPVerification.create({
      data: { identifier: normalizedEmail, hashedOtp, expires },
    });

    // ── Send OTP email — delete DB record if email fails ────────────────────
    try {
      await sendOTPEmail(normalizedEmail, otp, name);
    } catch (emailErr: any) {
      await prisma.oTPVerification.delete({ where: { id: otpRecord.id } });

      if (emailErr?.message?.includes("SMTP is not configured")) {
        return NextResponse.json(
          {
            error:
              "Email delivery is not configured. Please contact the administrator.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Failed to send OTP email. Please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "OTP sent to your email.",
    });
  } catch (err) {
    console.error("send-otp error:", err);
    return NextResponse.json(
      { error: "Failed to send OTP. Please try again." },
      { status: 500 }
    );
  }
}