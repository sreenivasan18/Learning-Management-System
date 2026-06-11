import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email: string = body.email ?? "";
    const otp: string = String(body.otp ?? "").trim();

    if (!email || !otp) {
      return NextResponse.json(
        { error: "Email and OTP are required." },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { error: "OTP must be exactly 6 digits." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find the most recent active, unexpired OTP record for this identifier
    const record = await prisma.oTPVerification.findFirst({
      where: {
        identifier: normalizedEmail,
        used: false,
        expires: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return NextResponse.json(
        { error: "Invalid or expired OTP. Please request a new one." },
        { status: 400 }
      );
    }

    // Check attempt count — invalidate after MAX_ATTEMPTS failed tries.
    // `record.attempts` is a real typed field on OTPVerification — no cast needed.
    if (record.attempts >= MAX_ATTEMPTS) {
      // Burn the record so the user must request a fresh OTP
      await prisma.oTPVerification.update({
        where: { id: record.id },
        data: { used: true },
      });
      return NextResponse.json(
        { error: "Too many failed attempts. Please request a new OTP." },
        { status: 429 }
      );
    }

    const isValid = await bcrypt.compare(otp, record.hashedOtp);

    if (!isValid) {
      // Increment attempt count — if this reaches MAX_ATTEMPTS, next call above blocks
      await prisma.oTPVerification.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 },
      });
      const remaining = MAX_ATTEMPTS - record.attempts - 1;
      return NextResponse.json(
        {
          error: `Invalid OTP. ${remaining} attempt${
            remaining !== 1 ? "s" : ""
          } remaining.`,
        },
        { status: 400 }
      );
    }

    // OTP is correct — issue a single-use verification token
    const verificationToken = randomUUID();

    await prisma.oTPVerification.update({
      where: { id: record.id },
      data: {
        used: true,
        verificationToken,
        verifiedAt: new Date(),
        attempts: record.attempts + 1,
      },
    });

    return NextResponse.json({ success: true, verificationToken });
  } catch (err) {
    console.error("verify-otp error:", err);
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 500 }
    );
  }
}