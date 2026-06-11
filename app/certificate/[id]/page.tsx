import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/layout/Navbar";
import CertificateView from "@/components/certificate/CertificateView";
import { canAccessCertificate } from "@/lib/rbac/rbac-helpers";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const sessionUser = { id: session.user.id, role: (session.user as any).role };
  const canAccess = await canAccessCertificate(id, sessionUser as any);
  if (!canAccess) redirect("/403");

  const cert = await prisma.certificate.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } }, course: { select: { title: true, category: true, level: true } } },
  });
  if (!cert) redirect("/dashboard");

  return (
    <>
      <Navbar />
      <CertificateView cert={{ id: cert.id, issuedAt: cert.issuedAt, overallPercentage: cert.overallPercentage, verifyToken: cert.verifyToken, quizSummary: cert.quizSummary }}
        student={{ name: cert.user.name, email: cert.user.email }}
        course={{ title: cert.course.title, category: cert.course.category, level: cert.course.level }} />
    </>
  );
}
