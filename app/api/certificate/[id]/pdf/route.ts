import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateCertificatePDF } from "@/lib/pdf";
import { canAccessCertificate } from "@/lib/rbac/rbac-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

    const { id } = await params;
    const sessionUser = { id: session.user.id, role: (session.user as any).role };

    const canAccess = await canAccessCertificate(id, sessionUser as any);
    if (!canAccess) return new NextResponse("Forbidden", { status: 403 });

    const cert = await prisma.certificate.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        course: { select: { title: true } },
      },
    });

    if (!cert) return new NextResponse("Certificate not found", { status: 404 });

    let quizSummary = [];
    try {
      quizSummary = JSON.parse(cert.quizSummary || "[]");
    } catch {}

    const pdfBytes = await generateCertificatePDF({
      studentName: cert.user.name || "Student",
      courseName: cert.course.title,
      enrollmentDate: cert.issuedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      certificateId: cert.id,
      overallPercentage: cert.overallPercentage,
      quizSummary,
    });

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificate-${cert.id}.pdf"`,
        "Content-Length": String(pdfBytes.length),
      },
    });
  } catch (err) {
    console.error("pdf generation error:", err);
    return new NextResponse("PDF generation failed", { status: 500 });
  }
}
