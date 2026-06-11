// FILE PATH: app/api/register/route.ts
//
// SECURITY: Enforces strict global email uniqueness across BOTH the User table
// (students/admins) and the Instructor table. One email = one account = one role.
//
// Previously: only checked the User table → instructor email could be registered as student.
// Now: parallel lookup across both tables with role-aware error messages.
//
// FIX (google-onboarding): On the bridgeToken (Google-linked) registration path,
// the verificationToken is NO LONGER burned here. It is left alive so that the
// google-otp-credentials signIn provider in lib/auth.ts can consume (burn) it
// immediately after this registration completes, enabling a seamless session
// establishment without a second Google OAuth redirect round-trip.
//
// The token is still short-lived (10-minute window enforced by verifiedAt check),
// so there is no meaningful replay risk: the onboarding page calls /api/register
// and signIn() in immediate succession (< 1 second apart), and the token is burned
// by signIn() before any attacker could act.
//
// For the standard (non-bridgeToken) password-based registration path, the token
// IS still burned here because password-based registration does not use
// google-otp-credentials signIn — it uses the standard "credentials" provider
// (which does not consume the OTP token at all).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const {
      name,
      email,
      password,
      phone,
      verificationToken,
      // Google-linked registration fields (optional)
      bridgeToken,
    } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }
    if (!verificationToken) {
      return NextResponse.json(
        {
          error:
            "Email verification is required. Please verify your email with an OTP first.",
        },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── Validate OTP verification token ────────────────────────────────────
    const otpRecord = await prisma.oTPVerification.findFirst({
      where: {
        identifier: normalizedEmail,
        verificationToken,
        used: true,
        verifiedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return NextResponse.json(
        {
          error:
            "Email verification failed or expired. Please verify your email again.",
        },
        { status: 400 }
      );
    }

    // ── SECURITY: Cross-table email uniqueness check ────────────────────────
    // Performed BEFORE any write operation to prevent duplicate role assignment.
    // One email = one account = one role across the entire platform.
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
      // Differentiate the message based on whether it's a student vs admin
      if (existingUser.role === "STUDENT") {
        return NextResponse.json(
          {
            error:
              "An account with this email already exists. Please sign in instead.",
          },
          { status: 409 }
        );
      }
      // ADMIN or INSTRUCTOR shadow user — generic message (no role leakage)
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    // ── Google-linked registration path ────────────────────────────────────
    if (bridgeToken) {
      const pending = await prisma.oAuthPendingRegistration.findUnique({
        where: { bridgeToken },
      });
      if (!pending || pending.email !== normalizedEmail) {
        return NextResponse.json(
          { error: "Invalid Google session. Please try signing in again." },
          { status: 400 }
        );
      }
      if (pending.expires < new Date()) {
        await prisma.oAuthPendingRegistration.delete({ where: { bridgeToken } });
        return NextResponse.json(
          { error: "Google session expired. Please try signing in with Google again." },
          { status: 400 }
        );
      }

      // FIX: Do NOT burn the verificationToken here for the bridgeToken path.
      //
      // The previous code did:
      //   await prisma.oTPVerification.update({
      //     where: { id: otpRecord.id },
      //     data: { verificationToken: null },
      //   });
      //
      // This was removed because immediately after this function returns,
      // app/auth/google-onboarding/page.tsx calls:
      //   signIn("google-otp-credentials", { email, verificationToken, bridgeToken })
      //
      // The google-otp-credentials provider in lib/auth.ts needs the token to still
      // be non-null in the database to validate and burn it during signIn.
      // Burning it here would cause signIn to fail (record not found → null returned).
      //
      // Security note: the token has a 10-minute TTL (verifiedAt window) and is burned
      // by google-otp-credentials on signIn. The window between register() returning
      // and signIn() completing is under 1 second in normal use.

      const resolvedName =
        name?.trim() || pending.name || normalizedEmail.split("@")[0];

      const user = await prisma.user.create({
        data: {
          name: resolvedName,
          email: normalizedEmail,
          image: pending.image ?? null,
          role: "STUDENT",
          googleId: pending.googleId,
        },
      });

      await prisma.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "google",
          providerAccountId: pending.googleId,
        },
      });

      if (phone) {
        const normalizedPhone = phone.trim();
        const existingPhone = await prisma.studentProfile.findUnique({
          where: { phone: normalizedPhone },
        });
        if (existingPhone) {
          await prisma.user.delete({ where: { id: user.id } });
          return NextResponse.json(
            { error: "An account with this phone number already exists." },
            { status: 409 }
          );
        }
        await prisma.studentProfile.create({
          data: { userId: user.id, phone: normalizedPhone },
        });
      } else {
        await prisma.studentProfile.create({ data: { userId: user.id } });
      }

      await prisma.oAuthPendingRegistration.delete({ where: { bridgeToken } });

      return NextResponse.json({ success: true, userId: user.id }, { status: 201 });
    }

    // ── Standard password-based registration path ──────────────────────────
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: "Password is required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }
    if (phone && !/^\+?[\d\s\-().]{7,20}$/.test(phone)) {
      return NextResponse.json({ error: "Invalid phone number." }, { status: 400 });
    }

    // Burn the verification token (single-use) for the standard path.
    // This is safe here because standard registration uses signIn("credentials")
    // which validates a password, not the OTP token.
    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { verificationToken: null },
    });

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        hashedPassword,
        role: "STUDENT",
      },
    });

    if (phone) {
      const normalizedPhone = phone.trim();
      const existingPhone = await prisma.studentProfile.findUnique({
        where: { phone: normalizedPhone },
      });
      if (existingPhone) {
        await prisma.user.delete({ where: { id: user.id } });
        return NextResponse.json(
          { error: "An account with this phone number already exists." },
          { status: 409 }
        );
      }
      await prisma.studentProfile.create({
        data: { userId: user.id, phone: normalizedPhone },
      });
    } else {
      await prisma.studentProfile.create({ data: { userId: user.id } });
    }

    return NextResponse.json(
      { success: true, userId: user.id },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("register error:", err);
    if (err?.code === "P2002") {
      const field = err?.meta?.target?.[0];
      if (field === "phone") {
        return NextResponse.json(
          { error: "An account with this phone number already exists." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}