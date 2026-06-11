// FILE PATH: lib/auth.ts
//
// UNIFIED AUTHENTICATION SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
// Architecture:
//   - ONE credential provider ("credentials") handles students AND instructors.
//   - Email is the unique identifier. Role is auto-detected from the database.
//   - Lookup order: instructors table → users table (students/admins).
//   - A separate "admin-credentials" provider remains for explicit admin login.
//   - "otp-credentials" handles passwordless OTP login for existing students.
//   - Google OAuth handles students and instructors via portal-cookie hint.
//   - A "google-otp-credentials" provider handles post-onboarding sign-in.
//
// Role detection for unified credentials flow:
//   1. Look up email in `instructors` table → role = INSTRUCTOR
//   2. Look up email in `users` table:
//        role = STUDENT  → student flow
//        role = ADMIN    → rejected (admin must use admin tab)
//        role = INSTRUCTOR (shadow) → rejected (orphaned state)
//
// After login the JWT contains: id, role, name, email, isInstructor, image.
// Middleware and server pages use session.user.role for all routing decisions.

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// ── Warn instead of crash if Google creds are missing ────────────────────────
const GOOGLE_ENABLED =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

if (!GOOGLE_ENABLED) {
  console.warn(
    "[AUTH] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. " +
      "Google OAuth will be disabled. Set them in .env to enable."
  );
}

if (!process.env.AUTH_SECRET) {
  throw new Error(
    "AUTH_SECRET must be set in .env. " +
      "Generate one with: openssl rand -base64 32"
  );
}

// ── Error codes surfaced to the signin page ───────────────────────────────────
export const AUTH_ERROR_CODES = {
  ADMIN_USE_ADMIN_TAB: "ADMIN_USE_ADMIN_TAB",
  ROLE_MISMATCH_INSTRUCTOR_GOOGLE_ON_STUDENT_PORTAL:
    "ROLE_MISMATCH_INSTRUCTOR_GOOGLE_ON_STUDENT_PORTAL",
  ROLE_MISMATCH_STUDENT_GOOGLE_ON_INSTRUCTOR_PORTAL:
    "ROLE_MISMATCH_STUDENT_GOOGLE_ON_INSTRUCTOR_PORTAL",
} as const;

// ── Providers ─────────────────────────────────────────────────────────────────
const providers: any[] = [
  // ── UNIFIED credentials provider — students and instructors ──────────────
  // One form, one provider. Email determines role automatically.
  // Admins are explicitly blocked here and must use the admin-credentials provider.
  Credentials({
    id: "credentials",
    name: "Sign In",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const { email, password } = credentials as {
        email: string;
        password: string;
      };
      if (!email || !password) return null;

      const normalizedEmail = email.toLowerCase().trim();

      // ── Step 1: Check instructors table first ────────────────────────────
      const instructor = await prisma.instructor.findUnique({
        where: { email: normalizedEmail },
      });

      if (instructor) {
        const valid = await bcrypt.compare(password, instructor.hashedPassword);
        if (!valid) return null;

        // ── Ensure shadow User row exists for this credentials instructor ────
        //
        // PlatformActivity.actorId is a FK to User.id. Without a shadow User
        // row, every logActivity() call from this instructor silently fails
        // (FK violation swallowed by the try/catch in lib/activity.ts), so the
        // admin monitoring panel shows the instructor as permanently offline
        // with no activity history.
        //
        // We upsert here — not just create — so that re-seeding the Instructor
        // table or future credential changes never produce duplicate rows.
        // The shadow row has no hashedPassword (the canonical password lives in
        // the Instructor table), role = INSTRUCTOR, and the same id as the
        // Instructor record so session.user.id is consistent everywhere.
        try {
          await prisma.user.upsert({
            where: { id: instructor.id },
            create: {
              id:    instructor.id,
              name:  instructor.name,
              email: instructor.email,
              image: instructor.avatarUrl ?? null,
              role:  "INSTRUCTOR",
              // No hashedPassword — auth is via the Instructor table only.
              // This user row is a FK anchor for activity logging; it is never
              // used for direct login (role=INSTRUCTOR in User table is blocked
              // by the "orphaned shadow user" guard in this same provider).
            },
            update: {
              // Keep name/email/image in sync with the Instructor record in
              // case the admin updated them since last login.
              name:  instructor.name,
              email: instructor.email,
              image: instructor.avatarUrl ?? null,
            },
          });
        } catch (shadowErr) {
          // upsert can fail if another process concurrently created the row,
          // or if there is an email uniqueness collision with an existing User
          // row that has a different id. Log and continue — a failed shadow
          // upsert must never block a valid instructor login.
          console.error(
            "[AUTH] Failed to upsert shadow User for instructor",
            instructor.email,
            shadowErr
          );
        }

        return {
          id: instructor.id,
          name: instructor.name,
          email: instructor.email,
          role: "INSTRUCTOR",
          isInstructor: true,
        } as any;
      }

      // ── Step 2: Check users table (students + admins + shadow users) ─────
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (!user || !user.hashedPassword) return null;

      // Admins must use the admin-credentials provider (separate tab).
      if (user.role === "ADMIN") {
        console.warn(
          `[AUTH] Admin ${normalizedEmail} attempted unified login — blocked.`
        );
        throw new Error(AUTH_ERROR_CODES.ADMIN_USE_ADMIN_TAB);
      }

      // Orphaned INSTRUCTOR shadow users in the User table — reject.
      if (user.role === "INSTRUCTOR") {
        console.warn(
          `[AUTH] Orphaned INSTRUCTOR shadow user ${normalizedEmail} in users table — rejecting.`
        );
        return null;
      }

      const valid = await bcrypt.compare(password, user.hashedPassword);
      if (!valid) return null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role, // STUDENT
      } as any;
    },
  }),

  // ── Admin credentials — kept separate for security ────────────────────────
  Credentials({
    id: "admin-credentials",
    name: "Admin Login",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const { email, password } = credentials as {
        email: string;
        password: string;
      };
      if (!email || !password) return null;

      const adminUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase().trim(), role: "ADMIN" },
      });
      if (!adminUser || !adminUser.hashedPassword) return null;

      const valid = await bcrypt.compare(password, adminUser.hashedPassword);
      if (!valid) return null;

      return {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      } as any;
    },
  }),

  // ── OTP passwordless login — existing students only ───────────────────────
  // Used by /auth/verify-otp page. Student enters email, receives OTP,
  // verifies it, and is authenticated without a password.
  // Only works for users in the User table with role = STUDENT.
  // Instructors must use password login; admins must use the admin tab.
  Credentials({
    id: "otp-credentials",
    name: "OTP Login",
    credentials: {
      email: { label: "Email", type: "email" },
      verificationToken: { label: "Verification Token", type: "text" },
    },
    async authorize(credentials) {
      const { email, verificationToken } = credentials as {
        email: string;
        verificationToken: string;
      };
      if (!email || !verificationToken) return null;

      const normalizedEmail = email.toLowerCase().trim();

      // Validate the OTP verification token — must be:
      //   used: true        (OTP was correctly verified)
      //   token not null    (not already consumed)
      //   verifiedAt recent (within 10-minute window)
      const otpRecord = await prisma.oTPVerification.findFirst({
        where: {
          identifier: normalizedEmail,
          verificationToken,
          used: true,
          verifiedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRecord) return null;

      // Look up the student — OTP login is for students only.
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, name: true, email: true, role: true },
      });

      if (!user || user.role !== "STUDENT") return null;

      // Burn the verification token — single use only.
      await prisma.oTPVerification.update({
        where: { id: otpRecord.id },
        data: { verificationToken: null },
      });

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      } as any;
    },
  }),

  // ── Google-verified login (post-OTP for new Google users) ────────────────
  // Used by google-onboarding page after registration to establish a session
  // without a password (the user registered via Google, not email/password).
  Credentials({
    id: "google-otp-credentials",
    name: "Google OTP Login",
    credentials: {
      email: { label: "Email", type: "email" },
      verificationToken: { label: "Verification Token", type: "text" },
      bridgeToken: { label: "Bridge Token", type: "text" },
    },
    async authorize(credentials) {
      const { email, verificationToken, bridgeToken } = credentials as {
        email: string;
        verificationToken: string;
        bridgeToken: string;
      };
      if (!email || !verificationToken || !bridgeToken) return null;

      const normalizedEmail = email.toLowerCase().trim();

      const otpRecord = await prisma.oTPVerification.findFirst({
        where: {
          identifier: normalizedEmail,
          verificationToken,
          used: true,
          verifiedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRecord) return null;

      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (!user) return null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      } as any;
    },
  }),
];

// ── Google OAuth provider (conditional on env vars) ───────────────────────────
if (GOOGLE_ENABLED) {
  providers.unshift(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },

  providers,

  callbacks: {
    // ── signIn callback — only executes for Google OAuth ────────────────────
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;

      const googleEmail = (user.email ?? "").toLowerCase().trim();
      const googleSub = account.providerAccountId;
      const googleName = user.name ?? null;
      const googleImage = user.image ?? null;

      if (!googleEmail) return "/auth/error?error=NoEmail";

      // Block admin Google login — admins use email/password only.
      const adminCheck = await prisma.user.findFirst({
        where: { email: googleEmail, role: "ADMIN" },
        select: { id: true },
      });
      if (adminCheck) {
        console.warn(`[AUTH] Admin Google login blocked: ${googleEmail}`);
        return "/auth/error?error=AdminGoogleBlocked";
      }

      // Read the portal hint cookie set by /api/auth/store-portal.
      let portalHint: "student" | "instructor" | null = null;
      try {
        const cookieStore = await cookies();
        const portalCookie = cookieStore.get("auth_portal");
        if (
          portalCookie?.value === "student" ||
          portalCookie?.value === "instructor"
        ) {
          portalHint = portalCookie.value as "student" | "instructor";
        }
      } catch {
        console.warn(
          "[AUTH] cookies() unavailable in signIn callback — skipping portal enforcement"
        );
      }

      // ── EXISTING STUDENT (in users table) ───────────────────────────────
      const existingStudent = await prisma.user.findUnique({
        where: { email: googleEmail },
      });

      if (existingStudent) {
        if (existingStudent.role === "ADMIN") {
          return "/auth/error?error=AdminGoogleBlocked";
        }

        if (
          existingStudent.role === "STUDENT" &&
          portalHint === "instructor"
        ) {
          console.warn(
            `[AUTH] Google role-mismatch: STUDENT ${googleEmail} → instructor portal`
          );
          return `/auth/error?error=${AUTH_ERROR_CODES.ROLE_MISMATCH_STUDENT_GOOGLE_ON_INSTRUCTOR_PORTAL}`;
        }

        if (
          existingStudent.role === "INSTRUCTOR" &&
          portalHint === "student"
        ) {
          console.warn(
            `[AUTH] Google role-mismatch: INSTRUCTOR shadow ${googleEmail} → student portal`
          );
          return `/auth/error?error=${AUTH_ERROR_CODES.ROLE_MISMATCH_INSTRUCTOR_GOOGLE_ON_STUDENT_PORTAL}`;
        }

        if (!existingStudent.googleId) {
          await prisma.user.update({
            where: { id: existingStudent.id },
            data: { googleId: googleSub },
          });
        }

        const existingAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "google",
              providerAccountId: googleSub,
            },
          },
        });
        if (!existingAccount) {
          await prisma.account.create({
            data: {
              userId: existingStudent.id,
              type: "oauth",
              provider: "google",
              providerAccountId: googleSub,
              access_token: account.access_token ?? null,
              refresh_token: account.refresh_token ?? null,
              expires_at: account.expires_at ?? null,
              token_type: account.token_type ?? null,
              scope: account.scope ?? null,
              id_token: account.id_token ?? null,
            },
          });
        }

        (user as any).role = existingStudent.role;
        (user as any).id = existingStudent.id;
        return true;
      }

      // ── EXISTING INSTRUCTOR (in instructors table) ────────────────────────
      const existingInstructor = await prisma.instructor.findUnique({
        where: { email: googleEmail },
      });

      if (existingInstructor) {
        if (portalHint === "student") {
          console.warn(
            `[AUTH] Google role-mismatch: INSTRUCTOR ${googleEmail} → student portal`
          );
          return `/auth/error?error=${AUTH_ERROR_CODES.ROLE_MISMATCH_INSTRUCTOR_GOOGLE_ON_STUDENT_PORTAL}`;
        }

        if (!existingInstructor.googleId) {
          await prisma.instructor.update({
            where: { id: existingInstructor.id },
            data: { googleId: googleSub },
          });
        }

        // Ensure a shadow User row exists for this instructor.
        let shadowUser = await prisma.user.findUnique({
          where: { email: googleEmail },
        });
        if (!shadowUser) {
          shadowUser = await prisma.user.create({
            data: {
              id: existingInstructor.id,
              name: existingInstructor.name,
              email: googleEmail,
              image: existingInstructor.avatarUrl ?? googleImage ?? null,
              role: "INSTRUCTOR",
              googleId: googleSub,
            },
          });
        }

        const existingAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "google",
              providerAccountId: googleSub,
            },
          },
        });
        if (!existingAccount) {
          await prisma.account.create({
            data: {
              userId: shadowUser.id,
              type: "oauth",
              provider: "google",
              providerAccountId: googleSub,
              access_token: account.access_token ?? null,
              refresh_token: account.refresh_token ?? null,
              expires_at: account.expires_at ?? null,
              token_type: account.token_type ?? null,
              scope: account.scope ?? null,
              id_token: account.id_token ?? null,
            },
          });
        }

        (user as any).role = "INSTRUCTOR";
        (user as any).id = shadowUser.id;
        (user as any).isInstructor = true;
        return true;
      }

      // ── NEW GOOGLE USER — redirect to OTP onboarding ─────────────────────
      if (portalHint === "instructor") {
        console.warn(
          `[AUTH] New Google user ${googleEmail} on instructor portal — blocked`
        );
        return "/auth/error?error=InstructorNotFound";
      }

      await prisma.oAuthPendingRegistration.deleteMany({
        where: {
          OR: [
            { email: googleEmail },
            { expires: { lt: new Date() } },
          ],
        },
      });

      const bridgeToken = randomUUID();
      await prisma.oAuthPendingRegistration.create({
        data: {
          email: googleEmail,
          name: googleName ?? null,
          googleId: googleSub,
          image: googleImage ?? null,
          bridgeToken,
          expires: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      return (
        `/auth/google-onboarding?` +
        new URLSearchParams({
          email: googleEmail,
          bridge: bridgeToken,
        }).toString()
      );
    },

    // ── jwt callback — populates token on sign-in ────────────────────────────
    async jwt({ token, user, account }) {
      if (user) {
        token.id = (user as any).id ?? user.id!;
        token.role = (user as any).role ?? "STUDENT";
        token.name = user.name;
        token.email = user.email;
        token.isInstructor = (user as any).isInstructor ?? false;
        token.image = (user as any).image ?? null;
      }
      // For Google OAuth: re-read role from DB to ensure it is authoritative.
      if (account?.provider === "google" && token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: (token.email as string).toLowerCase() },
          select: { id: true, role: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.isInstructor = dbUser.role === "INSTRUCTOR";
        }
      }
      return token;
    },

    // ── session callback — exposes token fields to the client ────────────────
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        (session.user as any).isInstructor = token.isInstructor;
        session.user.image = (token.image as string) ?? null;
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
});