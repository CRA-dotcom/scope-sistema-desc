import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { html, brandingVars, filename } = await req.json();

    if (!html) {
      return NextResponse.json({ error: "HTML content is required" }, { status: 400 });
    }

    // Inject branding CSS variables into the HTML
    const brandingCSS = brandingVars
      ? Object.entries(brandingVars)
          .map(([key, value]) => `${key}: ${value};`)
          .join("\n      ")
      : "";

    const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    :root {
      ${brandingCSS}
    }

    @page {
      size: A4;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      margin: 0;
      padding: 0;
      background: white;
    }

    /* Page divs */
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm 15mm 25mm 15mm;
      page-break-after: always;
      break-after: page;
      position: relative;
      overflow: hidden;
    }

    .page:last-child {
      page-break-after: avoid;
      break-after: avoid;
    }

    /* Page break control */
    h1, h2, h3, h4, h5, h6 {
      page-break-after: avoid !important;
      break-after: avoid !important;
      orphans: 3;
      widows: 3;
    }

    table, figure, blockquote, pre, ul, ol,
    .section, .card, .kpi-card, .finding-card, .print-section {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    h2 + *, h3 + *, h4 + * {
      page-break-before: avoid !important;
      break-before: avoid !important;
    }

    /* Professional defaults for content without its own styles */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10pt 0;
      font-size: 10pt;
    }

    th, td {
      border: 1px solid #ddd;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background-color: var(--brand-primary, var(--primary-color, #1a1a2e)) !important;
      color: white !important;
      font-weight: 600;
      font-size: 9pt;
    }

    img {
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;

    // Dynamic import to avoid build issues
    const puppeteer = (await import("puppeteer-core")).default;

    let executablePath: string;
    let args: string[];

    // Check if running in container with system chromium
    const systemChromium = process.env.CHROMIUM_PATH;
    if (systemChromium) {
      executablePath = systemChromium;
      args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
      ];
    } else {
      // Use @sparticuz/chromium for local dev or serverless
      const chromium = (await import("@sparticuz/chromium")).default;
      chromium.setHeadlessMode = true;
      chromium.setGraphicsMode = false;
      executablePath = await chromium.executablePath();
      args = chromium.args;
    }

    const browser = await puppeteer.launch({
      args,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(fullHtml, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // Wait for web fonts (Google Fonts @import, etc.) with a short fallback.
    // networkidle0 was too strict — would hang if any background request never settled.
    await page
      .evaluate(() =>
        Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ])
      )
      .catch(() => {});

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    });

    await browser.close();

    const safeFilename = (filename || "documento").replace(/[^a-zA-Z0-9_-]/g, "_");

    return new Response(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: `PDF generation failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
