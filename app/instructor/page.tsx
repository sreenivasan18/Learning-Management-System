// FILE PATH: app/instructor/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import InstructorDashboardClient from "@/components/instructor/InstructorDashboardClient";

export default async function InstructorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const role = (session.user as any).role;
  if (role === "ADMIN") redirect("/admin");
  if (role !== "INSTRUCTOR") redirect("/403");

  const instructorEmail = session.user.email!;
  const instructorId    = session.user.id;

  const [instructor, unreadMessages] = await Promise.all([
    prisma.instructor.findUnique({
      where: { email: instructorEmail },
      include: {
        courses: {
          include: {
            _count: { select: { enrollments: true, modules: true } },
            modules: {
              select: {
                id: true,
                title: true,
                order: true,
                videoUrl: true,
                videoKey: true,
                videoDurationSecs: true,
                isPublished: true,
                quizzes: {
                  include: {
                    _count: { select: { questions: true, attempts: true } },
                  },
                },
              },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),

    // Count unread admin messages for this instructor.
    // threadId is always admin_<instructorId> (instructor.id = session.user.id for credentials auth).
    prisma.adminMessage.count({
      where: {
        threadId:          `admin_${instructorId}`,
        senderRole:        "ADMIN",
        isReadByRecipient: false,
      },
    }),
  ]);

  if (!instructor) redirect("/auth/signin");

  // Serialize courses — include approvalStatus, reviewComment, isPublished
  // which are needed by InstructorDashboardClient for:
  //   - ApprovalBadge (Pending Review / Approved — Not Live / Published / Rejected)
  //   - ApprovalNotice (rejection feedback text, awaiting review notice)
  //   - "Edit & Resubmit" vs "Edit Course" vs "View Course" link label
  const courses = instructor.courses.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    isPublished: c.isPublished,
    approvalStatus: c.approvalStatus,   // PENDING | APPROVED | REJECTED
    reviewComment: c.reviewComment,     // Admin feedback shown on rejection
    instructor: { name: instructor.name },
    _count: c._count,
    modules: c.modules,
  }));

  return (
    <>
      <Navbar />
      <InstructorDashboardClient
        instructor={{
          name:           instructor.name,
          email:          instructor.email,
          specialization: instructor.specialization,
        }}
        courses={courses as any}
        unreadMessages={unreadMessages}
      />
    </>
  );
}