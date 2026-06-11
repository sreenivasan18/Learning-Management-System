import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";

interface QuizSummaryItem {
  quizTitle: string;
  moduleTitle: string;
  totalQuestions: number;
  correctAnswers: number;
  score: number;
  percentage: number;
}

interface CertificateData {
  studentName: string;
  courseName: string;
  enrollmentDate: string;
  certificateId: string;
  overallPercentage: number;
  quizSummary: QuizSummaryItem[];
}

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color: { r: number; g: number; b: number }) {
  page.drawText(text, { x, y, size, font, color: rgb(color.r, color.g, color.b) });
}

export async function generateCertificatePDF(data: CertificateData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // A4 landscape
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Background gradient simulation - dark
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.039, 0.039, 0.059) });

  // Border decorations
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: rgb(0.133, 0.827, 0.933), borderWidth: 2, color: rgb(0.039, 0.039, 0.059) });
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: rgb(0.133, 0.827, 0.933), borderWidth: 0.5, color: rgb(0.039, 0.039, 0.059) });

  // Header accent bar
  page.drawRectangle({ x: 20, y: height - 80, width: width - 40, height: 60, color: rgb(0.063, 0.094, 0.141) });

  // Logo / Brand
  drawText(page, "NOVAMIND", 40, height - 52, fontBold, 22, { r: 0.133, g: 0.827, b: 0.933 });
  drawText(page, "Learning Management System", 40, height - 68, fontRegular, 9, { r: 0.58, g: 0.647, b: 0.725 });

  // Certificate title
  drawText(page, "CERTIFICATE OF COMPLETION", width / 2 - 180, height - 120, fontBold, 22, { r: 0.945, g: 0.961, b: 0.98 });

  // Decorative line
  page.drawLine({ start: { x: 40, y: height - 130 }, end: { x: width - 40, y: height - 130 }, thickness: 1, color: rgb(0.133, 0.827, 0.933) });

  // This is to certify text
  drawText(page, "This is to certify that", width / 2 - 70, height - 155, fontItalic, 12, { r: 0.58, g: 0.647, b: 0.725 });

  // Student name - large
  const nameWidth = fontBold.widthOfTextAtSize(data.studentName.toUpperCase(), 28);
  drawText(page, data.studentName.toUpperCase(), width / 2 - nameWidth / 2, height - 190, fontBold, 28, { r: 0.133, g: 0.827, b: 0.933 });

  // Underline for name
  page.drawLine({ start: { x: width / 2 - nameWidth / 2, y: height - 195 }, end: { x: width / 2 + nameWidth / 2, y: height - 195 }, thickness: 1, color: rgb(0.133, 0.827, 0.933) });

  // has successfully completed
  drawText(page, "has successfully completed", width / 2 - 95, height - 215, fontItalic, 12, { r: 0.58, g: 0.647, b: 0.725 });

  // Course name
  const courseWidth = fontBold.widthOfTextAtSize(data.courseName, 18);
  drawText(page, data.courseName, width / 2 - courseWidth / 2, height - 240, fontBold, 18, { r: 0.945, g: 0.961, b: 0.98 });

  // Enrollment date and cert ID
  drawText(page, `Enrollment Date: ${data.enrollmentDate}`, 40, height - 270, fontRegular, 10, { r: 0.58, g: 0.647, b: 0.725 });
  drawText(page, `Certificate ID: ${data.certificateId}`, 40, height - 285, fontRegular, 10, { r: 0.58, g: 0.647, b: 0.725 });

  // Overall percentage - right side
  const pct = data.overallPercentage.toFixed(1);
  drawText(page, "Overall Quiz Performance", width - 200, height - 270, fontBold, 11, { r: 0.58, g: 0.647, b: 0.725 });
  const pctColor = data.overallPercentage >= 70 ? { r: 0.133, g: 0.827, b: 0.373 } : data.overallPercentage >= 40 ? { r: 1, g: 0.761, b: 0.235 } : { r: 1, g: 0.38, b: 0.38 };
  drawText(page, `${pct}%`, width - 120, height - 295, fontBold, 28, pctColor);

  // Divider
  page.drawLine({ start: { x: 40, y: height - 305 }, end: { x: width - 40, y: height - 305 }, thickness: 0.5, color: rgb(0.133, 0.827, 0.933) });

  // Quiz Summary Table
  // In lib/pdf.ts — replace the quiz summary table section:
  if (data.quizSummary && data.quizSummary.length > 0) {
    drawText(page, "QUIZ PERFORMANCE SUMMARY", 40, height - 325, fontBold, 11, { r: 0.133, g: 0.827, b: 0.933 });

    const tableY = height - 345;
    const maxRows = Math.floor((tableY - 60) / 16); // 60px bottom margin
    const rows = data.quizSummary.slice(0, maxRows);
    const truncated = data.quizSummary.length > maxRows;

    page.drawRectangle({ x: 40, y: tableY - 4, width: width - 80, height: 18, color: rgb(0.063, 0.094, 0.141) });
    const cols = [40, 220, 330, 410, 490, 580, 680];
    const headers = ["Quiz Title", "Module", "Total Q", "Correct", "Score", "Percentage"];
    headers.forEach((h, i) => {
      drawText(page, h, cols[i] + 4, tableY + 1, fontBold, 8, { r: 0.133, g: 0.827, b: 0.933 });
    });

    rows.forEach((item, idx) => {
      const rowY = tableY - 18 - idx * 16;
      if (idx % 2 === 0) {
        page.drawRectangle({ x: 40, y: rowY - 4, width: width - 80, height: 16, color: rgb(0.055, 0.071, 0.102) });
      }
      const titleTrunc = item.quizTitle.length > 22 ? item.quizTitle.substring(0, 22) + "…" : item.quizTitle;
      const modTrunc = item.moduleTitle.length > 15 ? item.moduleTitle.substring(0, 15) + "…" : item.moduleTitle;
      const rowColor = { r: 0.878, g: 0.906, b: 0.941 };
      drawText(page, titleTrunc, cols[0] + 4, rowY, fontRegular, 8, rowColor);
      drawText(page, modTrunc, cols[1] + 4, rowY, fontRegular, 8, rowColor);
      drawText(page, String(item.totalQuestions), cols[2] + 4, rowY, fontRegular, 8, rowColor);
      drawText(page, String(item.correctAnswers), cols[3] + 4, rowY, fontRegular, 8, rowColor);
      drawText(page, String(item.score), cols[4] + 4, rowY, fontRegular, 8, rowColor);
      const pctC = item.percentage >= 70 ? { r: 0.133, g: 0.827, b: 0.373 } : item.percentage >= 40 ? { r: 1, g: 0.761, b: 0.235 } : { r: 1, g: 0.38, b: 0.38 };
      drawText(page, `${item.percentage.toFixed(1)}%`, cols[5] + 4, rowY, fontBold, 8, pctC);
    }); 

    if (truncated) {
      const lastRowY = tableY - 18 - rows.length * 16;
      drawText(page, `+ ${data.quizSummary.length - maxRows} more quizzes (see full report online)`, cols[0] + 4, lastRowY, fontItalic, 8, { r: 0.58, g: 0.647, b: 0.725 });
    }

    const tableHeight = 18 + (rows.length + (truncated ? 1 : 0)) * 16 + 4;
    page.drawRectangle({ x: 40, y: tableY - tableHeight + 14, width: width - 80, height: tableHeight, borderColor: rgb(0.133, 0.827, 0.933), borderWidth: 0.5, color: rgb(0, 0, 0) });
  } else {
    drawText(page, "No quiz attempts recorded.", 40, height - 330, fontItalic, 10, { r: 0.58, g: 0.647, b: 0.725 });
  }

  // Footer
  drawText(page, "Generated by NovaMind LMS • novamind.lms", width / 2 - 140, 32, fontRegular, 9, { r: 0.35, g: 0.42, b: 0.51 });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
