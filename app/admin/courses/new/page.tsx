import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import CourseFormClient from "@/components/instructor/CourseFormClient";

export default async function AdminNewCoursePage() {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "ADMIN") redirect("/auth/signin");
  const instructors = await prisma.instructor.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  return (
    <>
      <Navbar />
      <CourseFormClient instructors={instructors} role="ADMIN" />
    </>
  );
}
