// FILE PATH: lib/email.ts

import nodemailer from "nodemailer";

function assertSmtpConfigured(): void {
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const host = process.env.SMTP_HOST ?? "";

  const isPlaceholder = (s: string) =>
    s.length === 0 ||
    s.startsWith("your-") ||
    s === "your-app-password" ||
    s === "REPLACE_WITH_64_CHAR_RANDOM_BASE64_STRING";

  if (isPlaceholder(host) || isPlaceholder(user) || isPlaceholder(pass)) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in " +
        "your .env file (use a Gmail App Password). Restart the dev server " +
        "after editing .env."
    );
  }
}

function createTransporter() {
  assertSmtpConfigured();

  const cleanPass = (process.env.SMTP_PASS ?? "").replace(/\s/g, "");

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER!,
      pass: cleanPass,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

const baseStyle = `
  font-family:Arial,sans-serif;max-width:520px;margin:0 auto;
  background:#0a0a0f;color:#e2e8f0;padding:32px;
  border-radius:16px;border:1px solid #1e293b;
`;

const headerHtml = `
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#22d3ee;font-size:28px;margin:0;">NovaMind</h1>
    <p style="color:#94a3b8;margin:4px 0 0;">Learning Management System</p>
  </div>
`;

/**
 * Sends a one-time verification OTP email.
 */
export async function sendOTPEmail(
  to: string,
  otp: string,
  name?: string
): Promise<void> {
  const transporter = createTransporter();
  const from =
    process.env.SMTP_FROM ?? `NovaMind LMS <${process.env.SMTP_USER}>`;

  try {
    await transporter.sendMail({
      from,
      to,
      subject: "Your NovaMind Verification Code",
      text:
        `Your NovaMind verification code is: ${otp}\n\n` +
        `This code expires in 10 minutes. Do not share it with anyone.`,
      html: `
        <div style="${baseStyle}">
          ${headerHtml}
          <h2 style="color:#f1f5f9;font-size:20px;">Hi ${name ?? "there"},</h2>
          <p style="color:#94a3b8;line-height:1.6;">Your one-time verification code is:</p>
          <div style="text-align:center;margin:24px 0;">
            <span style="font-size:48px;font-weight:bold;letter-spacing:12px;color:#22d3ee;background:#0f172a;padding:16px 24px;border-radius:12px;border:2px solid rgba(34,211,238,0.25);">${otp}</span>
          </div>
          <p style="color:#94a3b8;font-size:14px;">
            This code expires in <strong style="color:#f1f5f9;">10 minutes</strong> and can only be used once.
          </p>
          <hr style="border-color:#1e293b;margin:24px 0;" />
          <p style="color:#475569;font-size:12px;text-align:center;">
            If you did not request this code, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  } catch (err: any) {
    if (err?.code === "EAUTH") {
      console.error(
        "[EMAIL] SMTP authentication failed (EAUTH 535). " +
          "Verify SMTP_USER and SMTP_PASS in .env. " +
          "For Gmail: ensure 2-Step Verification is ON, then generate a fresh " +
          "App Password at https://myaccount.google.com/apppasswords"
      );
    } else if (
      err?.code === "ETIMEDOUT" ||
      err?.code === "ECONNECTION" ||
      err?.code === "ECONNREFUSED"
    ) {
      console.error(
        `[EMAIL] SMTP connection failed (${err.code}). ` +
          "Check SMTP_HOST / SMTP_PORT and that outbound port 587 is not blocked."
      );
    } else {
      console.error("[EMAIL] sendMail failed:", err?.message ?? err);
    }
    throw err;
  }
}

/**
 * Notifies an instructor that their course has been approved by an admin.
 * The admin may optionally include a comment.
 */
export async function sendCourseApprovedEmail(opts: {
  to: string;
  instructorName: string;
  courseTitle: string;
  reviewComment?: string | null;
}): Promise<void> {
  const transporter = createTransporter();
  const from =
    process.env.SMTP_FROM ?? `NovaMind LMS <${process.env.SMTP_USER}>`;

  const commentBlock = opts.reviewComment
    ? `<div style="background:#0f2a1a;border:1px solid rgba(52,211,153,0.25);border-radius:10px;padding:16px;margin:16px 0;">
        <p style="color:#6ee7b7;font-size:13px;font-weight:bold;margin:0 0 6px;">Admin Note:</p>
        <p style="color:#a7f3d0;font-size:14px;margin:0;">${opts.reviewComment}</p>
       </div>`
    : "";

  const textComment = opts.reviewComment
    ? `\n\nAdmin note: ${opts.reviewComment}`
    : "";

  try {
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: `✅ Course Approved: "${opts.courseTitle}"`,
      text:
        `Hi ${opts.instructorName},\n\n` +
        `Great news! Your course "${opts.courseTitle}" has been approved by our admin team.${textComment}\n\n` +
        `An admin will publish the course when it is ready to go live for students.\n\n` +
        `Log in to your instructor dashboard to view the status.\n\n` +
        `– NovaMind Team`,
      html: `
        <div style="${baseStyle}">
          ${headerHtml}
          <h2 style="color:#f1f5f9;font-size:20px;">Hi ${opts.instructorName},</h2>
          <div style="background:#0f2a1a;border:1px solid rgba(52,211,153,0.3);border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">✅</div>
            <p style="color:#34d399;font-size:18px;font-weight:bold;margin:0;">Course Approved!</p>
          </div>
          <p style="color:#94a3b8;line-height:1.6;">
            Your course <strong style="color:#f1f5f9;">"${opts.courseTitle}"</strong> has been reviewed and approved by our admin team.
          </p>
          ${commentBlock}
          <p style="color:#94a3b8;line-height:1.6;">
            An admin will publish the course when it is ready for students to enroll. You will be notified once it goes live.
          </p>
          <hr style="border-color:#1e293b;margin:24px 0;" />
          <p style="color:#475569;font-size:12px;text-align:center;">NovaMind Learning Management System</p>
        </div>
      `,
    });
  } catch (err: any) {
    console.error("[EMAIL] sendCourseApprovedEmail failed:", err?.message ?? err);
    throw err;
  }
}

/**
 * Notifies an instructor that their course has been rejected by an admin.
 * A review comment explaining the reason is required for rejection.
 */
export async function sendCourseRejectedEmail(opts: {
  to: string;
  instructorName: string;
  courseTitle: string;
  reviewComment: string;
}): Promise<void> {
  const transporter = createTransporter();
  const from =
    process.env.SMTP_FROM ?? `NovaMind LMS <${process.env.SMTP_USER}>`;

  try {
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: `❌ Course Needs Revision: "${opts.courseTitle}"`,
      text:
        `Hi ${opts.instructorName},\n\n` +
        `Your course "${opts.courseTitle}" has been reviewed and requires revision before it can be approved.\n\n` +
        `Admin feedback: ${opts.reviewComment}\n\n` +
        `Please update your course based on the feedback above and resubmit for review from your instructor dashboard.\n\n` +
        `– NovaMind Team`,
      html: `
        <div style="${baseStyle}">
          ${headerHtml}
          <h2 style="color:#f1f5f9;font-size:20px;">Hi ${opts.instructorName},</h2>
          <div style="background:#2a0f0f;border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">📝</div>
            <p style="color:#f87171;font-size:18px;font-weight:bold;margin:0;">Revision Required</p>
          </div>
          <p style="color:#94a3b8;line-height:1.6;">
            Your course <strong style="color:#f1f5f9;">"${opts.courseTitle}"</strong> has been reviewed and requires some changes before it can be approved.
          </p>
          <div style="background:#1a0f0f;border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:16px;margin:16px 0;">
            <p style="color:#fca5a5;font-size:13px;font-weight:bold;margin:0 0 6px;">Admin Feedback:</p>
            <p style="color:#fecaca;font-size:14px;margin:0;">${opts.reviewComment}</p>
          </div>
          <p style="color:#94a3b8;line-height:1.6;">
            Please update your course based on the feedback above, then resubmit it for review from your instructor dashboard.
          </p>
          <hr style="border-color:#1e293b;margin:24px 0;" />
          <p style="color:#475569;font-size:12px;text-align:center;">NovaMind Learning Management System</p>
        </div>
      `,
    });
  } catch (err: any) {
    console.error("[EMAIL] sendCourseRejectedEmail failed:", err?.message ?? err);
    throw err;
  }
}