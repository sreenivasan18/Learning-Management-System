// FILE PATH: app/courses/page.tsx
//
// APPROVAL WORKFLOW:
//   Students only see courses that are BOTH approved AND published.
//   approvalStatus=APPROVED + isPublished=true is the required conjunction.

import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import Link from "next/link";
import { BookOpen, Clock, Users } from "lucide-react";

export default async function CoursesPage() {
  const courses = await prisma.course.findMany({
    where: {
      approvalStatus: "APPROVED",
      isPublished: true,
    },
    include: {
      instructor: { select: { name: true } },
      _count: { select: { enrollments: true, modules: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-void pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="mb-10">
            <h1 className="text-4xl font-black text-white mb-2" style={{ fontFamily: "var(--font-display)" }}>
              All <span className="text-gradient-cyan">Courses</span>
            </h1>
            <p className="text-text-muted">{courses.length} courses available</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map(course => (
              <Link key={course.id} href={`/courses/${course.slug}`}
                className="glass-bright rounded-2xl border border-border hover:border-cyan-500/30 transition-all group overflow-hidden">
                <div className="h-40 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 relative overflow-hidden">
                  {course.thumbnail
                    ? <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><BookOpen className="w-14 h-14 text-white/15" /></div>}
                  <div className="absolute top-3 left-3 flex gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-black/60 text-white font-mono">{course.category}</span>
                    <span className="text-xs px-2 py-1 rounded-full bg-black/60 text-white font-mono">{course.level}</span>
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="text-white font-bold mb-1 group-hover:text-cyan-300 transition-colors line-clamp-2">{course.title}</h3>
                  <p className="text-text-muted text-xs mb-4">{course.instructor?.name || "NovaMind"}</p>
                  <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> {course._count.modules} modules</span>
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {course._count.enrollments}</span>
                    {course.durationMins > 0 && (
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {Math.round(course.durationMins / 60)}h</span>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-white font-bold">{course.price === 0 ? "Free" : `₹${course.price}`}</span>
                    <span className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">Enroll Now</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}