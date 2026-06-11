import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Navbar } from "@/components/layout/Navbar";
import CourseFormClient from "@/components/instructor/CourseFormClient";

export default async function InstructorNewCoursePage() {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).role !== "INSTRUCTOR") redirect("/auth/signin");
  return (
    <>
      <Navbar />
      <CourseFormClient instructors={[]} role="INSTRUCTOR" />
    </>
  );
}
