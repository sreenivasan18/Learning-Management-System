// FILE PATH: app/quiz/[id]/page.tsx
//
// FIXES IN THIS VERSION:
// 1. VIDEO COMPLETION GATE now checks quiz.module.videoKey instead of
//    quiz.module.videoUrl.
//
//    Root cause of the previous bug:
//    - Seeded modules had videoUrl set to YouTube links (e.g. https://youtube.com/…)
//      with videoKey = null (no actual uploaded file).
//    - VideoPlayer.tsx correctly shows "Video Not Available" for non-stream URLs
//      and never triggers the heartbeat system, so VideoProgress.completed is
//      never set to true for those modules.
//    - The old gate condition `if (quiz.module.videoUrl)` was truthy for YouTube
//      URLs, so the gate fired and permanently blocked students from the quiz.
//
//    The correct semantic is:
//    - videoKey  — presence means a real MP4 has been uploaded through the LMS
//                  upload system. Only then is heartbeat tracking possible.
//    - videoUrl  — can be any URL (legacy YouTube links, stream path, etc.).
//                  Using this alone as the gate condition is wrong.
//
//    With this fix:
//    - Modules with only a YouTube videoUrl (videoKey=null): quiz is immediately
//      accessible (no trackable video exists in the LMS).
//    - Modules with an uploaded MP4 (videoKey non-null): student must reach the
//      90% watch threshold before the quiz unlocks.
//
// 2. Added server-side video completion gate: if the module has a video and
//    VideoProgress.completed is false, redirect back to the course module
//    instead of rendering the quiz. This prevents students from seeing quiz
//    questions before completing the video lesson.
// 3. Added course publication check: if the course is not published + approved,
//    enrolled students are redirected to dashboard rather than seeing quiz content
//    from a course that has been unpublished or rejected after enrollment.
// 4. correctAnswer is explicitly excluded from the questions payload sent to
//    the client (was already done, confirmed retained).

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import QuizPlayer from "@/components/quiz/QuizPlayer";

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const userId = session.user.id;
  const role = (session.user as any).role;

  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: "asc" } },
      module: {
        include: {
          course: {
            include: {
              enrollments: role === "STUDENT" ? { where: { userId } } : undefined,
            },
          },
        },
      },
      attempts: { where: { userId }, orderBy: { completedAt: "desc" }, take: 1 },
    },
  });

  if (!quiz) redirect("/dashboard");

  const course = quiz.module.course;

  // ── COURSE PUBLICATION CHECK ──────────────────────────────────────────────
  // Admins can access any quiz regardless of course status (for review).
  // Students: course must be published + approved. If unpublished after
  // enrollment, redirect to dashboard — student cannot access quiz content.
  // Instructors: can access their own course quizzes regardless of publish state.
  if (role === "STUDENT") {
    const isEnrolled = course.enrollments.length > 0;
    if (!isEnrolled) {
      redirect(`/courses/${course.slug}`);
    }

    // If course was unpublished or rejected after enrollment, redirect to dashboard
    if (!course.isPublished || course.approvalStatus !== "APPROVED") {
      redirect("/dashboard");
    }
  }

  if (role === "INSTRUCTOR") {
    // Instructors can only access quizzes from their own courses
    const instructorRecord = await prisma.instructor.findUnique({
      where: { email: session.user.email! },
      select: { id: true },
    });
    if (!instructorRecord || course.instructorId !== instructorRecord.id) {
      redirect("/instructor");
    }
  }

  // ── SERVER-SIDE VIDEO COMPLETION GATE ────────────────────────────────────
  // Students must complete the video before seeing quiz questions.
  // Admins and instructors bypass this gate (for review purposes).
  //
  // FIX: Gate on quiz.module.videoKey (actual uploaded MP4 exists in the LMS)
  // NOT quiz.module.videoUrl (which may be a YouTube link or other external URL
  // that the LMS VideoPlayer cannot track). Only an uploaded MP4 with a videoKey
  // triggers heartbeat-based progress tracking, so only those modules should
  // require video completion before unlocking the quiz.
  if (role === "STUDENT" && quiz.module.videoKey) {
    const videoProgress = await prisma.videoProgress.findUnique({
      where: { userId_moduleId: { userId, moduleId: quiz.module.id } },
      select: { completed: true },
    });

    if (!videoProgress?.completed) {
      // Redirect back to the course — the VideoPlayer and locked quiz UI
      // will inform the student they need to complete the video first.
      redirect(`/courses/${course.slug}`);
    }
  }

  const lastAttempt = quiz.attempts[0] || null;

  // Never send correctAnswer to the client
  const questions = quiz.questions.map(q => ({
    id: q.id,
    question: q.question,
    options: JSON.parse(q.options) as string[],
    explanation: q.explanation || "",
    order: q.order,
    // correctAnswer intentionally omitted
  }));

  return (
    <>
      <Navbar />
      <QuizPlayer
        quiz={{
          id: quiz.id,
          title: quiz.title,
          description: quiz.description || "",
          timeLimit: quiz.timeLimit || null,
        }}
        questions={questions}
        lastAttempt={
          lastAttempt
            ? {
                score: lastAttempt.score,
                maxScore: lastAttempt.maxScore,
                percentage: lastAttempt.percentage,
              }
            : null
        }
        courseSlug={course.slug}
        moduleTitle={quiz.module.title}
      />
    </>
  );
}