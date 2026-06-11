// FILE PATH: app/api/video/[moduleId]/upload/route.ts
//
// FIXES IN THIS VERSION:
// 1. Instructor ownership check uses resolveInstructorId (email bridge).
// 2. Extracts video duration via ffprobe and stores as videoDurationSecs.
// 3. AUTO-SYNCS durationMins from videoDurationSecs so instructors never need to
//    enter duration manually. After upload, module.durationMins is updated to
//    Math.ceil(videoDurationSecs / 60). If ffprobe is unavailable (returns null),
//    durationMins is left unchanged so any previously entered value is preserved.
//    The heartbeat route also back-fills videoDurationSecs from the browser on
//    first playback if ffprobe was unavailable at upload time.
// 4. ADDED: Logs VIDEO_UPLOADED platform activity event after successful upload.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "videos");

function isMp4MagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const ftyp = buffer.slice(4, 8).toString("ascii");
  if (ftyp === "ftyp") return true;
  const possibleFtyp = buffer.indexOf(Buffer.from("ftyp"));
  return possibleFtyp >= 0 && possibleFtyp <= 16;
}

async function resolveInstructorId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const instructor = await prisma.instructor.findUnique({
    where: { email },
    select: { id: true },
  });
  return instructor?.id ?? null;
}

/**
 * Run ffprobe on the uploaded file and return the duration in whole seconds.
 * Returns null if ffprobe is not installed or the file has no parseable duration.
 * Never throws — all errors are swallowed so a missing ffprobe binary never
 * breaks the upload flow.
 */
async function extractVideoDurationSecs(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      filePath,
    ], { timeout: 15000 });
    const info = JSON.parse(stdout);
    // Prefer the video stream duration; fall back to container format duration.
    const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
    if (videoStream?.duration) {
      const secs = parseFloat(videoStream.duration);
      if (isFinite(secs) && secs > 0) return Math.round(secs);
    }
    if (info.format?.duration) {
      const secs = parseFloat(info.format.duration);
      if (isFinite(secs) && secs > 0) return Math.round(secs);
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ moduleId: string }> }
) {
  // ── Auth & role guard ────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "INSTRUCTOR") {
    return NextResponse.json(
      { error: "Forbidden: only instructors and admins can upload videos." },
      { status: 403 }
    );
  }

  const { moduleId } = await params;

  // ── Module + ownership check ─────────────────────────────────────────────────
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { course: { select: { id: true, title: true, instructorId: true } } },
  });

  if (!module) {
    return NextResponse.json({ error: "Module not found." }, { status: 404 });
  }

  if (role === "INSTRUCTOR") {
    const instructorId = await resolveInstructorId(session.user.email);
    if (!instructorId || module.course.instructorId !== instructorId) {
      return NextResponse.json(
        { error: "Forbidden: you do not own this course." },
        { status: 403 }
      );
    }
  }

  // ── Parse multipart form ─────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart data." }, { status: 400 });
  }

  const file = formData.get("video") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No video file provided." }, { status: 400 });
  }

  // ── File validation ──────────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum allowed size is 500 MB." },
      { status: 413 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }
  if (file.type !== "video/mp4") {
    return NextResponse.json(
      { error: "Invalid file type. Only MP4 videos are allowed." },
      { status: 415 }
    );
  }
  const originalName = file.name || "";
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (ext !== "mp4") {
    return NextResponse.json(
      { error: "Invalid file extension. Only .mp4 files are accepted." },
      { status: 415 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!isMp4MagicBytes(buffer)) {
    return NextResponse.json(
      { error: "File content does not match MP4 format. Upload rejected." },
      { status: 415 }
    );
  }

  // ── Write to disk ────────────────────────────────────────────────────────────
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }

  const safeFilename = `${moduleId}.mp4`;
  const filePath = path.join(UPLOAD_DIR, safeFilename);
  await writeFile(filePath, buffer);

  // ── Extract duration automatically (never requires instructor input) ──────────
  const videoDurationSecs = await extractVideoDurationSecs(filePath);

  // Convert to minutes for the module durationMins field.
  // durationMins is what appears on course cards, detail pages, and admin views.
  // We only set it when we have a real duration value from ffprobe.
  // If ffprobe is unavailable (null), we leave durationMins as-is so any value
  // the instructor previously entered is not clobbered. The heartbeat route will
  // back-fill videoDurationSecs from the browser on first playback.
  const durationMinsFromVideo =
    videoDurationSecs !== null ? Math.ceil(videoDurationSecs / 60) : null;

  const videoKey = safeFilename;
  const videoUrl = `/api/video/${moduleId}/stream`;

  // ── Persist to database ──────────────────────────────────────────────────────
  await prisma.module.update({
    where: { id: moduleId },
    data: {
      videoUrl,
      videoKey,
      videoMimeType: "video/mp4",
      // Always store the raw seconds when available (used by VideoPlayer and heartbeat).
      ...(videoDurationSecs !== null ? { videoDurationSecs } : {}),
      // Auto-populate durationMins from the actual video file so instructors
      // never have to type it. Only written when ffprobe succeeded.
      ...(durationMinsFromVideo !== null ? { durationMins: durationMinsFromVideo } : {}),
    },
  });

  // ── Log platform activity ────────────────────────────────────────────────────
  const actorUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  await logActivity({
    activityType: "VIDEO_UPLOADED",
    actorId:      session.user.id,
    actorName:    actorUser?.name ?? session.user.email ?? session.user.id,
    actorRole:    role,
    targetId:     moduleId,
    targetType:   "MODULE",
    targetTitle:  module.title,
    metadata: {
      courseId:         module.course.id,
      courseTitle:      module.course.title,
      videoDurationSecs,
      durationMins:     durationMinsFromVideo,
      fileSizeBytes:    file.size,
    },
  });

  return NextResponse.json({
    success: true,
    message: "Video uploaded successfully.",
    videoUrl,
    videoDurationSecs,
    durationMins: durationMinsFromVideo,
  });
}