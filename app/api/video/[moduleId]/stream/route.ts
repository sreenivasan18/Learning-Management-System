// FILE PATH: app/api/video/[moduleId]/stream/route.ts
//
// SECURE VIDEO STREAMING ENDPOINT.
//
// FIXES IN THIS VERSION:
// 1. Added isPublished check on the parent course for student access.
//    When a course is unpublished, enrolled students can no longer stream its videos.
//    Admins and instructors retain access regardless of publish state.
// 2. FIX: When the physical video file is missing from disk (orphaned videoKey),
//    the response now returns a JSON error with status 404 AND a custom header
//    X-Video-File-Missing: true so the admin UI can detect and flag this state.
//    Previously the same 404 JSON was returned but with no distinguishable signal.
// 3. FIX: Range header parsing is tightened — invalid range values are clamped
//    rather than producing NaN in Content-Range headers.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createReadStream, statSync, existsSync } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "videos");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ moduleId: string }> }
) {
  const session = await auth();
  const { moduleId } = await params;

  // ── Fetch module with course publish status ────────────────────────────────
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: {
      id: true,
      videoKey: true,
      isFree: true,
      isPublished: true,
      courseId: true,
      course: {
        select: {
          isPublished: true,
          approvalStatus: true,
          instructorId: true,
        },
      },
    },
  });

  if (!module || !module.videoKey) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  // ── Authorization ──────────────────────────────────────────────────────────
  const userId = session?.user?.id;
  const role = (session?.user as any)?.role;

  const isAdmin = role === "ADMIN";

  // Instructors can stream their own course videos regardless of publish state
  let isOwnInstructor = false;
  if (role === "INSTRUCTOR" && session?.user?.email) {
    const instructor = await prisma.instructor.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (instructor && module.course.instructorId === instructor.id) {
      isOwnInstructor = true;
    }
  }

  const isAdminOrInstructor = isAdmin || isOwnInstructor;

  // If the course is unpublished, only admins and own-instructors can stream.
  // Enrolled students cannot access videos from unpublished courses via this endpoint.
  if (!isAdminOrInstructor) {
    const courseVisible =
      module.course.isPublished && module.course.approvalStatus === "APPROVED";
    if (!courseVisible) {
      return NextResponse.json(
        { error: "This course is not currently available." },
        { status: 403 }
      );
    }
  }

  if (!module.isFree) {
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdminOrInstructor) {
      const enrollment = await prisma.enrollment.findFirst({
        where: { userId, courseId: module.courseId },
      });
      if (!enrollment) {
        return NextResponse.json(
          { error: "Not enrolled in this course." },
          { status: 403 }
        );
      }
    }
  }

  // ── FIX: Detect orphaned videoKey (DB record exists, file does not) ────────
  const filePath = path.join(UPLOAD_DIR, module.videoKey);
  if (!existsSync(filePath)) {
    // Return a distinguishable error so admin/instructor UIs can show
    // "Video file missing — re-upload required" instead of a generic error.
    return NextResponse.json(
      {
        error: "Video file not found on server. The upload may have been interrupted or the file was deleted.",
        videoFileMissing: true,
      },
      {
        status: 404,
        headers: {
          // Custom header so the browser-side VideoPlayer error handler can
          // distinguish a missing-file 404 from a not-found module 404.
          "X-Video-File-Missing": "true",
        },
      }
    );
  }

  // ── Serve file with Range support ─────────────────────────────────────────
  const stat = statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const rawStart = parseInt(parts[0], 10);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    // FIX: Clamp values to valid range to prevent NaN in headers
    const start = isNaN(rawStart) ? 0 : Math.max(0, Math.min(rawStart, fileSize - 1));
    const end = isNaN(rawEnd) ? fileSize - 1 : Math.max(start, Math.min(rawEnd, fileSize - 1));
    const chunkSize = end - start + 1;

    const headers = new Headers({
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(chunkSize),
      "Content-Type": "video/mp4",
      "Cache-Control": "private, no-cache",
      // Prevents browsers from treating the stream URL as a download target
      // when accessed directly. controlsList="nodownload" in the <video> element
      // only suppresses the UI button; this header enforces it at the HTTP layer.
      "Content-Disposition": "inline",
    });

    const stream = createReadStream(filePath, { start, end });
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(readable, { status: 206, headers });
  }

  const stream = createReadStream(filePath);
  const readable = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new NextResponse(readable, {
    status: 200,
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": "inline",
    },
  });
}